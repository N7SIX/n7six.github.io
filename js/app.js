'use strict';

// ─── RadioComm ────────────────────────────────────────────────────────────────
// Wraps a Web Serial port: opens/closes it, runs a background read loop that
// feeds bytes into MsgParser, and exposes a promise-based waitForMsg().
class RadioComm {
    constructor(logFn) {
        this._log          = logFn;
        this.port          = null;
        this.reader        = null;
        this.writer        = null;
        this._parser       = new MsgParser();
        this._waiters      = [];     // [{type, resolve, reject, timer}]
        this._readActive   = false;
        this._lastDataTime = 0;      // ms timestamp of last received byte
    }

    /** Request a serial port and open it at 38400 8N1. */
    async connect() {
        this.port = await navigator.serial.requestPort();
        await this.port.open({
            baudRate:    38400,
            dataBits:    8,
            stopBits:    1,
            parity:      'none',
            flowControl: 'none',
        });
        this.writer      = this.port.writable.getWriter();
        this.reader      = this.port.readable.getReader();
        this._readActive = true;
        this._lastDataTime = Date.now();
        this._readLoop().catch(e => {
            if (this._readActive) this._log('error', 'Read error: ' + e.message);
        });
        this._log('info', 'Serial port opened (38400 8N1)');
    }

    /** Close the serial port and cancel any pending waiters. */
    async disconnect() {
        this._readActive = false;
        this._cancelWaiters(new Error('Disconnected'));
        try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); this.reader = null; } } catch (_) {}
        try { if (this.writer) { this.writer.releaseLock(); this.writer = null; } } catch (_) {}
        try { if (this.port)   { await this.port.close();   this.port   = null; } } catch (_) {}
        this._log('info', 'Serial port closed');
    }

    /** Encode msgBuf as a packet and write it to the port. */
    async send(msgBuf) {
        await this.writer.write(makePacket(msgBuf));
    }

    /**
     * Resolve when a complete message of the given type arrives.
     * Pass msgType = null to accept any type.
     * Rejects with an Error after `timeout` ms (default 10 s).
     */
    waitForMsg(msgType = null, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const w = { type: msgType, resolve, reject, timer: null };
            if (timeout > 0) {
                w.timer = setTimeout(() => {
                    const i = this._waiters.indexOf(w);
                    if (i >= 0) this._waiters.splice(i, 1);
                    reject(new Error(
                        `Timeout waiting for message type ${msgType !== null ? '0x' + msgType.toString(16) : 'any'}`
                    ));
                }, timeout);
            }
            this._waiters.push(w);
        });
    }

    /**
     * Resolve when no bytes have been received for `idleMs` milliseconds.
     * Used by dump/restore to ensure the radio is in normal (non-DFU) mode
     * before sending EEPROM commands.
     */
    waitForIdle(idleMs = 500) {
        this._lastDataTime = Date.now();
        return new Promise(resolve => {
            const check = () => {
                if (Date.now() - this._lastDataTime >= idleMs) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            setTimeout(check, idleMs);
        });
    }

    // ── internals ──────────────────────────────────────────────────────────────

    async _readLoop() {
        while (this._readActive) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.length > 0) {
                this._lastDataTime = Date.now();
                this._parser.feed(value);
                let msg;
                while ((msg = this._parser.parse()) !== null) {
                    const type = getU16LE(msg, 0);
                    this._dispatchMsg(type, msg);
                }
            }
        }
    }

    _dispatchMsg(type, msg) {
        for (let i = 0; i < this._waiters.length; i++) {
            const w = this._waiters[i];
            if (w.type === null || w.type === type) {
                this._waiters.splice(i, 1);
                clearTimeout(w.timer);
                w.resolve({ type, buf: msg });
                return;
            }
        }
    }

    _cancelWaiters(err) {
        const ws = this._waiters.splice(0);
        for (const w of ws) { clearTimeout(w.timer); w.reject(err); }
    }
}

// ─── Utility: current Unix time truncated to 32-bit (seconds) ─────────────────
function unixTs32() {
    return Math.floor(Date.now() / 1000) & 0xFFFFFFFF;
}

// ─── Utility: decode BL version string from MSG_NOTIFY_DEV_INFO ───────────────
function decodeBlVer(msgBuf) {
    // BL version is ASCII at msgBuf[20..36], null-terminated
    let end = 20;
    while (end < 36 && msgBuf[end] !== 0) end++;
    try { return new TextDecoder().decode(msgBuf.slice(20, end)); } catch (_) { return '?'; }
}

// ─── Utility: decode firmware version from MSG_GET_DEV_INFO_RESP ──────────────
function decodeFwVer(msgBuf) {
    // Firmware version is ASCII at msgBuf[4..20], null-terminated
    let end = 4;
    while (end < 20 && msgBuf[end] !== 0) end++;
    try { return new TextDecoder().decode(msgBuf.slice(4, end)); } catch (_) { return '?'; }
}

// ─── Flash firmware (radio must be in DFU / bootloader mode) ──────────────────
async function doFlash(comm, fwImage, onProgress, onLog) {
    const totalPages = Math.ceil(fwImage.length / 256);

    // ── Step 1: Wait for radio to beacon (MSG_NOTIFY_DEV_INFO = 0x0518) ───────
    onLog('info', 'Waiting for radio in DFU mode…  (hold PTT while connecting the cable)');

    let firstDevInfo;
    try {
        firstDevInfo = await comm.waitForMsg(MSG_NOTIFY_DEV_INFO, 60000);
    } catch (_) {
        throw new Error('Radio not detected. Ensure it is in DFU mode and try again.');
    }

    const blVer = decodeBlVer(firstDevInfo.buf);
    onLog('info', `Radio detected — bootloader version: ${blVer}`);

    // ── Step 2: Handshake — respond to 3 DEV_INFO beacons with BL_VER ─────────
    onLog('info', 'Handshaking…');
    for (let i = 0; i < 3; i++) {
        // Wait for the next beacon (radio sends them every ~200 ms)
        try { await comm.waitForMsg(MSG_NOTIFY_DEV_INFO, 2000); } catch (_) { /* timeout OK */ }

        const hs = makeMsg(MSG_NOTIFY_BL_VER, 4);
        hs[4] = 0x2A; // '*' — accept any BL version
        await comm.send(hs);
    }
    onLog('info', 'Handshake complete');

    // ── Step 3: Flash pages ────────────────────────────────────────────────────
    onLog('info', `Flashing ${fwImage.length} bytes in ${totalPages} pages…`);
    onProgress(0, `0 / ${totalPages} pages`);

    const centisTs = Math.floor(Date.now() / 10) & 0xFFFFFFFF; // centisecond timestamp

    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        let success = false;
        for (let retry = 0; retry < 5; retry++) {
            // Build MSG_PROG_FW (dataLen = 268)
            const pgMsg = makeMsg(MSG_PROG_FW, 268);
            setU32LE(pgMsg,  4, centisTs);
            setU16LE(pgMsg,  8, pageIdx);
            setU16LE(pgMsg, 10, totalPages);
            // bytes 12-15 remain 0 (reserved)
            const off = pageIdx * 256;
            const len = Math.min(256, fwImage.length - off);
            pgMsg.set(fwImage.subarray(off, off + len), 16);

            await comm.send(pgMsg);

            // Wait for MSG_PROG_FW_RESP
            let resp;
            try {
                resp = await comm.waitForMsg(MSG_PROG_FW_RESP, 3000);
            } catch (_) {
                onLog('warn', `Page ${pageIdx + 1}: no response, retry ${retry + 1}/5`);
                continue;
            }

            const err = getU16LE(resp.buf, 10);
            if (err !== 0) {
                onLog('warn', `Page ${pageIdx + 1}: error code ${err}, retry ${retry + 1}/5`);
                continue;
            }

            success = true;
            break;
        }

        if (!success) {
            throw new Error(`Failed to flash page ${pageIdx + 1} after 5 retries`);
        }

        const pct = Math.round(((pageIdx + 1) / totalPages) * 100);
        onProgress(pct, `${pageIdx + 1} / ${totalPages} pages`);
    }

    onProgress(100, 'Complete');
    onLog('success', 'Firmware flashed successfully! The radio will restart with the new firmware.');
}

// ─── Dump calibration data (radio must be in normal operating mode) ────────────
async function doDump(comm, onProgress, onLog) {
    // ── Step 1: Wait for idle line ────────────────────────────────────────────
    onLog('info', 'Waiting for radio to settle…');
    await comm.waitForIdle(500);

    // ── Step 2: Query device info to get firmware version ─────────────────────
    onLog('info', 'Requesting device info…');
    const ts = unixTs32();

    const infoReq = makeMsg(MSG_GET_DEV_INFO_REQ, 4);
    setU32LE(infoReq, 4, ts);
    await comm.send(infoReq);

    let infoResp;
    try {
        infoResp = await comm.waitForMsg(MSG_GET_DEV_INFO_RESP, 5000);
    } catch (_) {
        throw new Error('No response from radio. Make sure it is powered on in normal mode.');
    }

    const fwVer = decodeFwVer(infoResp.buf);
    onLog('info', `Firmware version: ${fwVer}`);

    // ── Step 3: Read EEPROM in 16-byte blocks ─────────────────────────────────
    onLog('info', `Reading ${EEPROM_TOTAL} bytes of EEPROM data…`);
    onProgress(0, `0 / ${EEPROM_TOTAL} bytes`);

    const data = new Uint8Array(EEPROM_TOTAL);
    let offset  = 0;

    while (offset < EEPROM_TOTAL) {
        const rdReq = makeMsg(MSG_READ_EEPROM_REQ, 8);
        setU16LE(rdReq, 4, offset);
        setU16LE(rdReq, 6, EEPROM_BLOCK);
        setU32LE(rdReq, 8, ts);
        await comm.send(rdReq);

        let resp;
        try {
            resp = await comm.waitForMsg(MSG_READ_EEPROM_RESP, 5000);
        } catch (_) {
            throw new Error(`Timeout reading EEPROM at offset 0x${offset.toString(16).toUpperCase()}`);
        }

        // Validate the response matches what we asked for
        const respOff  = getU16LE(resp.buf, 4);
        const respSize = resp.buf[6];
        if (respOff !== offset || respSize !== EEPROM_BLOCK) {
            onLog('warn', `Unexpected response at 0x${offset.toString(16).toUpperCase()}, retrying…`);
            continue; // retry same offset
        }

        data.set(resp.buf.slice(8, 8 + EEPROM_BLOCK), offset);
        offset += EEPROM_BLOCK;

        const pct = Math.round((offset / EEPROM_TOTAL) * 100);
        onProgress(pct, `${offset} / ${EEPROM_TOTAL} bytes`);
    }

    onProgress(100, 'Complete');
    onLog('success', 'Calibration data read successfully!');
    return data;
}

// ─── Restore calibration data (radio must be in normal operating mode) ─────────
async function doRestore(comm, calibData, onProgress, onLog) {
    if (calibData.length !== EEPROM_TOTAL) {
        throw new Error(
            `Invalid calibration file: expected ${EEPROM_TOTAL} bytes, got ${calibData.length}`
        );
    }

    // ── Step 1: Wait for idle line ────────────────────────────────────────────
    onLog('info', 'Waiting for radio to settle…');
    await comm.waitForIdle(500);

    // ── Step 2: Query device info ─────────────────────────────────────────────
    onLog('info', 'Requesting device info…');
    const ts = unixTs32();

    const infoReq = makeMsg(MSG_GET_DEV_INFO_REQ, 4);
    setU32LE(infoReq, 4, ts);
    await comm.send(infoReq);

    let infoResp;
    try {
        infoResp = await comm.waitForMsg(MSG_GET_DEV_INFO_RESP, 5000);
    } catch (_) {
        throw new Error('No response from radio. Make sure it is powered on in normal mode.');
    }

    const fwVer = decodeFwVer(infoResp.buf);
    onLog('info', `Firmware version: ${fwVer}`);

    // ── Step 3: Write EEPROM in 16-byte blocks (AES key block 0x0F30 deferred) ─
    onLog('info', `Writing ${EEPROM_TOTAL} bytes of EEPROM data…`);
    onProgress(0, `0 / ${EEPROM_TOTAL} bytes`);

    let offset    = 0;
    let aesKeyBuf = null;

    // Main write pass — skip the AES key block (write it last)
    while (offset < EEPROM_TOTAL) {
        if (offset === EEPROM_AES_KEY) {
            // Save for end and skip
            aesKeyBuf = calibData.slice(offset, offset + EEPROM_BLOCK);
            offset += EEPROM_BLOCK;
            continue;
        }

        const wrote = await _writeEepromBlock(comm, ts, offset, calibData.subarray(offset, offset + EEPROM_BLOCK), onLog);
        if (!wrote) {
            throw new Error(`Failed to write EEPROM at offset 0x${offset.toString(16).toUpperCase()}`);
        }
        offset += EEPROM_BLOCK;

        const pct = Math.round(((offset) / EEPROM_TOTAL) * 95); // leave last 5% for AES key
        onProgress(pct, `${offset} / ${EEPROM_TOTAL} bytes`);
    }

    // Write AES key block last (if present in range)
    if (aesKeyBuf) {
        onLog('info', 'Writing AES key block…');
        await _writeEepromBlock(comm, ts, EEPROM_AES_KEY, aesKeyBuf, onLog);
    }

    // ── Step 4: Reboot ────────────────────────────────────────────────────────
    onLog('info', 'Sending reboot command…');
    const rebootMsg = makeMsg(MSG_REBOOT, 0);
    await comm.send(rebootMsg);

    onProgress(100, 'Complete');
    onLog('success', 'Calibration data restored! The radio is rebooting.');
}

// Helper: write one 16-byte block, with retry.  Returns true on success.
async function _writeEepromBlock(comm, ts, offset, data16, onLog) {
    for (let retry = 0; retry < 5; retry++) {
        const wrReq = makeMsg(MSG_WRITE_EEPROM_REQ, 24);
        setU16LE(wrReq,  4, offset);
        setU16LE(wrReq,  6, EEPROM_BLOCK);
        wrReq[7] = 1;                    // allow_password flag
        setU32LE(wrReq,  8, ts);
        wrReq.set(data16.slice(0, EEPROM_BLOCK), 12);
        await comm.send(wrReq);

        let resp;
        try {
            resp = await comm.waitForMsg(MSG_WRITE_EEPROM_RESP, 5000);
        } catch (_) {
            onLog('warn', `Write timeout at 0x${offset.toString(16).toUpperCase()}, retry ${retry + 1}/5`);
            continue;
        }

        const respOff = getU16LE(resp.buf, 4);
        if (respOff !== offset) {
            onLog('warn', `Unexpected write response at 0x${offset.toString(16).toUpperCase()}, retry ${retry + 1}/5`);
            continue;
        }
        return true;
    }
    return false;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/**
 * Append a styled line to a log <div>.
 * level: 'info' | 'success' | 'warn' | 'error'
 */
function appendLog(logId, level, text) {
    const el  = document.getElementById(logId);
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'log-line log-' + level;

    const now  = new Date();
    const hms  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    line.textContent = `[${hms}] ${text}`;

    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function clearLog(logId) {
    const el = document.getElementById(logId);
    if (el) el.innerHTML = '';
}

function setProgress(barId, pctId, labelId, pct, label) {
    const bar   = document.getElementById(barId);
    const pctEl = document.getElementById(pctId);
    const lblEl = document.getElementById(labelId);
    if (bar)   { bar.style.width = pct + '%'; bar.setAttribute('aria-valuenow', pct); }
    if (pctEl) pctEl.textContent = pct + '%';
    if (lblEl) lblEl.textContent = label;
}

function show(id)  { document.getElementById(id)?.classList.remove('d-none'); }
function hide(id)  { document.getElementById(id)?.classList.add('d-none'); }
function enable(id)  { const el = document.getElementById(id); if (el) el.disabled = false; }
function disable(id) { const el = document.getElementById(id); if (el) el.disabled = true;  }

// ─── App initialisation ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Browser compatibility check ───────────────────────────────────────────
    if (!('serial' in navigator)) {
        show('unsupported-alert');
        // Disable all action buttons
        ['flash-btn', 'dump-btn', 'restore-btn'].forEach(disable);
    }

    // ── Tab selection via URL parameter: ?mode=flash|dump|restore ─────────────
    const params = new URLSearchParams(window.location.search);
    const modeMap = { flash: 'flash-tab', dump: 'dump-tab', restore: 'restore-tab' };
    const tabId   = modeMap[params.get('mode')] || 'flash-tab';
    const tabEl   = document.getElementById(tabId);
    if (tabEl) { bootstrap.Tab.getOrCreateInstance(tabEl).show(); }

    // ── Firmware file input ───────────────────────────────────────────────────
    let fwImage = null;
    document.getElementById('fw-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) { fwImage = null; disable('flash-btn'); return; }
        file.arrayBuffer().then(ab => {
            fwImage = new Uint8Array(ab);
            const kb = (fwImage.length / 1024).toFixed(1);
            appendLog('flash-log', 'info', `Firmware loaded: ${file.name} (${kb} KB, ${fwImage.length} bytes)`);
            enable('flash-btn');
        });
    });

    // ── Calibration file input ────────────────────────────────────────────────
    let calibData = null;
    document.getElementById('calib-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) { calibData = null; disable('restore-btn'); return; }
        file.arrayBuffer().then(ab => {
            calibData = new Uint8Array(ab);
            appendLog('restore-log', 'info',
                `Calibration file loaded: ${file.name} (${calibData.length} bytes)`);
            if (calibData.length !== EEPROM_TOTAL) {
                appendLog('restore-log', 'error',
                    `⚠ Expected ${EEPROM_TOTAL} bytes — this file may be invalid.`);
            }
            enable('restore-btn');
        });
    });

    // ── Flash button ──────────────────────────────────────────────────────────
    let flashComm = null;
    document.getElementById('flash-btn').addEventListener('click', async () => {
        if (!fwImage) return;
        disable('flash-btn');
        show('flash-abort-btn');
        show('flash-progress-container');
        setProgress('flash-progress-bar', 'flash-progress-pct', 'flash-progress-label', 0, 'Connecting…');

        flashComm = new RadioComm((lvl, msg) => appendLog('flash-log', lvl, msg));
        try {
            await flashComm.connect();
            await doFlash(
                flashComm, fwImage,
                (pct, lbl) => setProgress('flash-progress-bar', 'flash-progress-pct', 'flash-progress-label', pct, lbl),
                (lvl, msg) => appendLog('flash-log', lvl, msg)
            );
        } catch (e) {
            appendLog('flash-log', 'error', '✗ ' + e.message);
            setProgress('flash-progress-bar', 'flash-progress-pct', 'flash-progress-label', 0, 'Failed');
            document.getElementById('flash-progress-bar').classList.add('bg-danger');
        } finally {
            if (flashComm) { await flashComm.disconnect().catch(() => {}); flashComm = null; }
            hide('flash-abort-btn');
            enable('flash-btn');
        }
    });

    document.getElementById('flash-abort-btn').addEventListener('click', async () => {
        appendLog('flash-log', 'warn', 'Aborting…');
        if (flashComm) { await flashComm.disconnect().catch(() => {}); flashComm = null; }
        hide('flash-abort-btn');
        enable('flash-btn');
    });

    // ── Dump button ───────────────────────────────────────────────────────────
    let dumpComm = null;
    let dumpedData = null;
    document.getElementById('dump-btn').addEventListener('click', async () => {
        disable('dump-btn');
        show('dump-abort-btn');
        show('dump-progress-container');
        hide('dump-download-container');
        dumpedData = null;
        setProgress('dump-progress-bar', 'dump-progress-pct', 'dump-progress-label', 0, 'Connecting…');

        dumpComm = new RadioComm((lvl, msg) => appendLog('dump-log', lvl, msg));
        try {
            await dumpComm.connect();
            dumpedData = await doDump(
                dumpComm,
                (pct, lbl) => setProgress('dump-progress-bar', 'dump-progress-pct', 'dump-progress-label', pct, lbl),
                (lvl, msg) => appendLog('dump-log', lvl, msg)
            );
            show('dump-download-container');
        } catch (e) {
            appendLog('dump-log', 'error', '✗ ' + e.message);
            setProgress('dump-progress-bar', 'dump-progress-pct', 'dump-progress-label', 0, 'Failed');
            document.getElementById('dump-progress-bar').classList.add('bg-danger');
        } finally {
            if (dumpComm) { await dumpComm.disconnect().catch(() => {}); dumpComm = null; }
            hide('dump-abort-btn');
            enable('dump-btn');
        }
    });

    document.getElementById('dump-abort-btn').addEventListener('click', async () => {
        appendLog('dump-log', 'warn', 'Aborting…');
        if (dumpComm) { await dumpComm.disconnect().catch(() => {}); dumpComm = null; }
        hide('dump-abort-btn');
        enable('dump-btn');
    });

    // ── Dump download button ──────────────────────────────────────────────────
    document.getElementById('dump-download-btn').addEventListener('click', () => {
        if (!dumpedData) return;
        const blob = new Blob([dumpedData], { type: 'application/octet-stream' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'calibration.dat';
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Restore button ────────────────────────────────────────────────────────
    let restoreComm = null;
    document.getElementById('restore-btn').addEventListener('click', async () => {
        if (!calibData) return;
        disable('restore-btn');
        show('restore-abort-btn');
        show('restore-progress-container');
        setProgress('restore-progress-bar', 'restore-progress-pct', 'restore-progress-label', 0, 'Connecting…');

        restoreComm = new RadioComm((lvl, msg) => appendLog('restore-log', lvl, msg));
        try {
            await restoreComm.connect();
            await doRestore(
                restoreComm, calibData,
                (pct, lbl) => setProgress('restore-progress-bar', 'restore-progress-pct', 'restore-progress-label', pct, lbl),
                (lvl, msg) => appendLog('restore-log', lvl, msg)
            );
        } catch (e) {
            appendLog('restore-log', 'error', '✗ ' + e.message);
            setProgress('restore-progress-bar', 'restore-progress-pct', 'restore-progress-label', 0, 'Failed');
            document.getElementById('restore-progress-bar').classList.add('bg-danger');
        } finally {
            if (restoreComm) { await restoreComm.disconnect().catch(() => {}); restoreComm = null; }
            hide('restore-abort-btn');
            enable('restore-btn');
        }
    });

    document.getElementById('restore-abort-btn').addEventListener('click', async () => {
        appendLog('restore-log', 'warn', 'Aborting…');
        if (restoreComm) { await restoreComm.disconnect().catch(() => {}); restoreComm = null; }
        hide('restore-abort-btn');
        enable('restore-btn');
    });
});
