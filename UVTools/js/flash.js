// js/flash.js
// UV-K5 Web Flasher core logic (Web Serial + protocol)
// Adds: 
// - Auto-load of firmware from URL param ?firmwareURL=... (or ?fw=...)
// - Requires i18n.js to be loaded first (window.i18nReady).
// - Defines window.updateUI() to (re)apply translations to the DOM.
// - Shows progress bar during flashing, hides it after successful completion.
// - Percentage text is centered via #progressLabel overlay.
// - Dump and restore

'use strict';

// ========== CONSTANTS ==========
const BAUDRATE = 38400;

// Message types
const MSG_NOTIFY_DEV_INFO = 0x0518;
const MSG_NOTIFY_BL_VER = 0x0530;
const MSG_PROG_FW = 0x0519;
const MSG_PROG_FW_RESP = 0x051A;
const MSG_DEV_INFO_REQ = 0x0514;
const MSG_DEV_INFO_RESP = 0x0515;
const MSG_READ_EEPROM = 0x051B;
const MSG_READ_EEPROM_RESP = 0x051C;
const MSG_WRITE_EEPROM = 0x051D;
const MSG_WRITE_EEPROM_RESP = 0x051E;
const MSG_REBOOT = 0x05DD;

const OBFUS_TBL = new Uint8Array([
  0x16, 0x6c, 0x14, 0xe6, 0x2e, 0x91, 0x0d, 0x40,
  0x21, 0x35, 0xd5, 0x40, 0x13, 0x03, 0xe9, 0x80
]);

// Calibration memory layout
const CALIB_SIZE = 512; // bytes
const CHUNK_SIZE = 16;
let CALIB_OFFSET = 0x1E00; // Default for firmware < v5.0.0

// ========== STATE ==========
let port = null;