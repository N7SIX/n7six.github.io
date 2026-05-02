'use strict';

// ─── Obfuscation table (XOR cipher, 16-byte repeating key) ────────────────────
const OBFUS_TBL = new Uint8Array([
    0x16, 0x6c, 0x14, 0xe6, 0x2e, 0x91, 0x0d, 0x40,
    0x21, 0x35, 0xd5, 0x40, 0x13, 0x03, 0xe9, 0x80
]);

// ─── Message type constants ────────────────────────────────────────────────────
// DFU / bootloader mode (radio must be in flash mode)
const MSG_NOTIFY_DEV_INFO   = 0x0518; // radio → host: periodic beacon in DFU
const MSG_NOTIFY_BL_VER     = 0x0530; // host → radio: bootloader-version handshake
const MSG_PROG_FW           = 0x0519; // host → radio: send one 256-byte firmware page
const MSG_PROG_FW_RESP      = 0x051A; // radio → host: page ACK

// Normal operating mode (firmware running)
const MSG_GET_DEV_INFO_REQ  = 0x0514; // host → radio: request firmware version
const MSG_GET_DEV_INFO_RESP = 0x0515; // radio → host: firmware version response
const MSG_READ_EEPROM_REQ   = 0x051B; // host → radio: read 16 bytes from EEPROM
const MSG_READ_EEPROM_RESP  = 0x051C; // radio → host: 16 bytes of EEPROM data
const MSG_WRITE_EEPROM_REQ  = 0x051D; // host → radio: write 16 bytes to EEPROM
const MSG_WRITE_EEPROM_RESP = 0x051E; // radio → host: write confirmation
const MSG_REBOOT            = 0x05DD; // host → radio: request reboot

// ─── EEPROM layout ─────────────────────────────────────────────────────────────
const EEPROM_TOTAL   = 0x2000; // 8 192 bytes — full EEPROM image
const EEPROM_BLOCK   = 16;     // bytes per read/write transaction
const EEPROM_AES_KEY = 0x0F30; // AES key block address (written last on restore)

// ─── Integer helpers (little-endian) ──────────────────────────────────────────
function getU16LE(buf, off) {
    return ((buf[off + 1] & 0xFF) << 8) | (buf[off] & 0xFF);
}

function getU32LE(buf, off) {
    return (((buf[off + 3] & 0xFF) * 0x1000000) +
            ((buf[off + 2] & 0xFF) << 16) +
            ((buf[off + 1] & 0xFF) <<  8) +
             (buf[off    ] & 0xFF)) >>> 0;
}

function setU16LE(buf, off, v) {
    buf[off    ] =  v        & 0xFF;
    buf[off + 1] = (v >>  8) & 0xFF;
}

function setU32LE(buf, off, v) {
    v = v >>> 0;
    buf[off    ] =  v         & 0xFF;
    buf[off + 1] = (v >>  8)  & 0xFF;
    buf[off + 2] = (v >> 16)  & 0xFF;
    buf[off + 3] = (v >> 24)  & 0xFF;
}

// ─── Obfuscation (in-place XOR, applied from buf[off] for len bytes) ──────────
function obfusInPlace(arr, off, len) {
    for (let i = 0; i < len; i++) {
        arr[off + i] ^= OBFUS_TBL[i & 15];
    }
}

// ─── CRC-16 (poly 0x1021, init 0) ─────────────────────────────────────────────
function crc16(buf, off, len) {
    let crc = 0;
    for (let i = 0; i < len; i++) {
        crc ^= (buf[off + i] & 0xFF) << 8;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x8000)
                ? ((crc << 1) ^ 0x1021) & 0xFFFF
                : (crc << 1) & 0xFFFF;
        }
    }
    return crc;
}

// ─── Message buffer factory ────────────────────────────────────────────────────
// Returns a Uint8Array: [type LE2][dataLen LE2][...dataLen zeroed bytes...]
function makeMsg(type, dataLen) {
    const buf = new Uint8Array(4 + dataLen);
    setU16LE(buf, 0, type);
    setU16LE(buf, 2, dataLen);
    return buf;
}

// ─── Packet encoder ───────────────────────────────────────────────────────────
// Wire format: [0xAB 0xCD][msgLen LE2][OBFUS(msg | CRC LE2)][0xDC 0xBA]
// msgLen = len(msgBuf), padded to even
function makePacket(msgBuf) {
    let msgLen = msgBuf.length;
    if (msgLen & 1) msgLen++;            // pad to even

    const pkt = new Uint8Array(8 + msgLen);
    pkt[0] = 0xAB; pkt[1] = 0xCD;       // header magic
    setU16LE(pkt, 2, msgLen);            // message length field

    pkt.set(msgBuf, 4);                  // copy message (zero-padded)

    // CRC over unobfuscated message bytes
    const crc = crc16(pkt, 4, msgLen);
    setU16LE(pkt, 4 + msgLen, crc);

    // Obfuscate message + CRC together
    obfusInPlace(pkt, 4, msgLen + 2);

    pkt[6 + msgLen] = 0xDC;              // footer magic
    pkt[7 + msgLen] = 0xBA;
    return pkt;
}

// ─── Message parser (streaming) ───────────────────────────────────────────────
class MsgParser {
    constructor() { this._buf = new Uint8Array(0); }

    /** Append raw bytes received from the serial port. */
    feed(data) {
        const n = new Uint8Array(this._buf.length + data.length);
        n.set(this._buf);
        n.set(data, this._buf.length);
        this._buf = n;
    }

    /**
     * Try to extract the next complete message from the internal buffer.
     * Returns a Uint8Array [type LE2][dataLen LE2][...data...] on success,
     * or null when not enough data is available yet.
     */
    parse() {
        const buf = this._buf;
        if (buf.length < 8) return null;

        // Locate start marker 0xAB 0xCD
        let start = -1;
        for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i] === 0xAB && buf[i + 1] === 0xCD) { start = i; break; }
        }
        if (start < 0) {
            // Keep last byte only if it could be the start of a marker
            this._buf = (buf[buf.length - 1] === 0xAB) ? buf.slice(-1) : new Uint8Array(0);
            return null;
        }

        if (buf.length - start < 8) return null;

        const msgLen  = getU16LE(buf, start + 2);
        const packEnd = start + 6 + msgLen;          // start of footer

        if (buf.length < packEnd + 2) return null;

        // Validate footer 0xDC 0xBA
        if (buf[packEnd] !== 0xDC || buf[packEnd + 1] !== 0xBA) {
            this._buf = buf.slice(start + 2);        // skip bad start, retry
            return null;
        }

        // Extract and deobfuscate inner section [msg | CRC]
        const inner = buf.slice(start + 4, packEnd); // msgLen + 2 bytes
        obfusInPlace(inner, 0, inner.length);

        // Advance past this packet
        this._buf = buf.slice(packEnd + 2);

        // Return only the message (drop the trailing CRC)
        return inner.slice(0, msgLen);
    }
}
