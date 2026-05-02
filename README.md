# N7SIX UV-K1 Web Flasher

A browser-based firmware flasher and calibration tool for the **QUANSHENG UV-K1** and **UV-K5 V3** radios (PY32F071 MCU).

🔗 **[Open the Web Flasher](https://n7six.github.io)**

## Features

| Tab | Mode | Description |
|-----|------|-------------|
| **Flash Firmware** | DFU / bootloader | Flash a `.bin` firmware image over USB |
| **Dump Calibration** | Normal | Read and save the full EEPROM calibration image |
| **Restore Calibration** | Normal | Write a previously saved calibration image back |

Direct links:
- Flash mode: `https://n7six.github.io/?mode=flash`
- Dump mode:  `https://n7six.github.io/?mode=dump`
- Restore mode: `https://n7six.github.io/?mode=restore`

## Requirements

- **Browser**: Google Chrome, Chromium, or Microsoft Edge (desktop, v89+).  
  The [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) must be available.  Firefox and Safari are not supported.
- **Cable**: A compatible USB programming cable (USB-C or Baofeng/Kenwood-style dual-jack USB).

## Usage

### Flash Firmware

1. Enter DFU mode: hold **PTT** while connecting the USB cable (or power on while holding PTT). The screen will be blank.
2. Open the Flash tab, select a `.bin` firmware file, click **Flash Firmware**.
3. Select the serial port when the browser asks.
4. The progress bar shows each 256-byte page being written; the radio reboots automatically when done.

### Dump Calibration Data

1. Power on the radio in **normal mode**.
2. Open the Dump Calibration tab, click **Dump Calibration Data**.
3. Select the serial port.
4. When complete, click **Download calibration.dat** to save the file.

> **Tip:** Rename the file with your radio's serial number (printed on the back label).

### Restore Calibration Data

1. Power on the radio in **normal mode**.
2. Open the Restore Calibration tab, select your `.dat` file, click **Restore Calibration Data**.
3. Select the serial port.
4. The radio reboots automatically when the restore is complete.

## Technical Details

The tool communicates over 38400 baud 8N1 serial using the UV-K1/K5 bootloader and firmware serial protocol:

- **Packet framing**: `[0xAB 0xCD][length LE16][obfuscated payload + CRC16][0xDC 0xBA]`
- **Obfuscation**: 16-byte repeating XOR key
- **CRC**: CRC-16/CCITT (poly 0x1021, init 0)

Protocol implementation lives in [`js/protocol.js`](js/protocol.js); the state machines and UI wiring are in [`js/app.js`](js/app.js).

## Firmware Repository

The companion firmware is at [N7SIX/UV-K1Series_ApeX-Edition_v7.6.0](https://github.com/N7SIX/UV-K1Series_ApeX-Edition_v7.6.0).

## License

Apache License 2.0 — see the firmware repository for the full notice.