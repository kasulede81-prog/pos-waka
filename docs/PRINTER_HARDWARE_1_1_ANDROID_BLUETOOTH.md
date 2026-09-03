# PRINTER-HARDWARE-1.1 — Android Bluetooth Classic/SPP + BLE

**Date:** 2026-09-03  
**Depends on:** `docs/PRINTER_HARDWARE_1_0_FORENSIC_CERTIFICATION.md` (historical audit — conclusions unchanged)

This document describes the implemented Android native Bluetooth **transport**. Receipt/kitchen ESC/POS generation, print queue, and LAN/USB paths are unchanged.

---

## Architecture

```
ESC/POS bytes (EscPosBuilder / retail / kitchen / drawer kick)
        ↓
printQueue.ts  (queued → sending → done | failed)
        ↓
printerAdapter.sendEscPosBytes(profile)
        ↓
Android: WakaBluetoothPrinter Capacitor plugin
        ↓
Classic RFCOMM/SPP  or  BLE GATT write
        ↓
Thermal printer
```

Web browsers still use Web Bluetooth (BLE/GATT only). Electron still uses LAN ESC/POS. iOS has no Classic SPP in this release.

---

## Classic SPP

Standard UUID: `00001101-0000-1000-8000-00805F9B34FB`

Connect order:

1. Secure RFCOMM to SPP UUID  
2. Insecure RFCOMM to SPP UUID  
3. Additional UUIDs advertised on the bonded device (`getUuids()`)  
4. One controlled channel-1 reflection fallback used by many cheap printers  

If none succeed:  
`This Bluetooth device does not expose a supported printer connection.`

Writes are chunked (512 bytes) with a short pause. Byte order is unchanged.

---

## BLE / GATT

Used when the saved id starts with `ble:` or connect `mode` is `ble`.

Preferred characteristics:

- `0xffe0` / `0xffe1`  
- `0x18f0` / `0x2af1`  

Otherwise the first writable characteristic is used. Write-without-response is preferred. Chunk size follows MTU − 3.

A BLE speaker/keyboard with no writable printer characteristic fails with the same unsupported-device message.

---

## Saved printer

Local shop preference `PrinterProfile` (not a new database table):

- `pairedDeviceKey` — `classic:AA:BB:…` or `ble:AA:BB:…`  
- `bluetoothTransport` — `classic` | `ble`  
- `pairedDeviceName` — display only  

Android’s bond lives in the OS. WAKA stores only the opaque id needed to reconnect after app restart.

---

## Permissions

| API | Permissions |
|---|---|
| 31+ | `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (`neverForLocation`) |
| ≤30 | `BLUETOOTH`, `BLUETOOTH_ADMIN` (install-time), `ACCESS_FINE_LOCATION` for discovery |

Location is **not** treated as sufficient on Android 12+.

---

## Operator UI

`/office/hardware` → Kitchen & receipt printers → connection **bluetooth** → **Find device**.

Filters:

- Likely printers (name/class hint)  
- All Bluetooth devices  

Discovery is not certification. A headset may appear under All; connect/print still fails clearly if it is not a printer.

---

## Pairing

Unbonded devices use Android `createBond()` (system pairing UI). After pairing, scan/paired list refresh and **Use this printer**.

---

## Assumptions

- Inexpensive portable POS thermals typically speak ESC/POS over Classic SPP.  
- Paper width 58mm/80mm is the existing profile field.  
- Drawer kick is the same ESC/POS pulse on the same transport.

---

## Limitations / unsupported

- iOS Classic SPP  
- Web Bluetooth Classic SPP (browser chooser remains BLE-only)  
- Electron Bluetooth Classic (use LAN or Android)  
- Fake “every Bluetooth device is a printer”  
- Uploading Bluetooth identities to Supabase  

---

## Automated vs physical certification

Unit tests cover capability detection, saved-device print, failure propagation, queue failure, and profile persistence.

**Physical printer certification is still required** on a real Android device:

| Test | Expected |
|---|---|
| A Classic thermal | Discover/pair, test receipt, sale receipt, kitchen chit, drawer if wired, reconnect after app restart |
| B BLE thermal | Detected as BLE, writable char, test receipt |
| C Speaker/headset | May list under All; must not be certified; clear failure |
| D Bluetooth off | “Turn on Bluetooth to connect a printer.” |
| E Permission denied | “Bluetooth permission is required to find printers.” |

Until A–E pass on hardware, do not claim production certification for a specific printer model.

Cross-platform transport selection (web / Electron / iOS honesty) is documented in `docs/PRINTER_HARDWARE_1_2_CROSS_PLATFORM.md`.
