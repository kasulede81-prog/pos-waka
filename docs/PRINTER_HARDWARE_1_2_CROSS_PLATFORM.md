# PRINTER-HARDWARE-1.2 — Cross-platform hardware transport

**Date:** 2026-09-03  
**Depends on:** `docs/PRINTER_HARDWARE_1_1_ANDROID_BLUETOOTH.md`

WAKA uses one printer profile and one ESC/POS pipeline on every platform. Only the **transport** changes.

```
EscPosBuilder → Uint8Array → printQueue → printerAdapter → selectPrinterTransport → physical printer
```

Receipt generation, kitchen routing, drawer kick, and queue retry semantics are unchanged.

---

## Browser limitation (do not ignore)

Chrome Web Bluetooth exposes **BLE/GATT** devices.

It does **not** expose Bluetooth Classic SPP/RFCOMM printers.

Safari / iOS has even less Web Bluetooth.

Adding UUIDs to `navigator.bluetooth.requestDevice()` does not turn Classic Bluetooth into BLE.

```
Bluetooth Classic SPP printer  →  Android native app  →  YES
Bluetooth Classic SPP printer  →  Chrome website      →  NO (browser API limitation)
```

---

## Compatibility (software-implemented)

| Environment | Classic SPP | BLE | Network | USB |
|---|---|---|---|---|
| Android app | Implemented (native SPP) | Implemented (native GATT) | Implemented (local TCP 9100) | Not implemented (no native USB thermal path) |
| Android Chrome | Not available | Browser-dependent Web Bluetooth | Desktop/Android bridge only | Browser-dependent WebUSB |
| Windows Chrome/Edge | Not available | Browser-dependent Web Bluetooth | Electron desktop bridge only | Browser-dependent WebUSB |
| macOS Chrome | Not available | Browser-dependent Web Bluetooth | Electron desktop bridge only | Browser-dependent WebUSB |
| iOS Safari | Not available | Restricted / typically absent | Electron desktop bridge only | Restricted |
| Electron | Not implemented (no Classic stack added) | Web Bluetooth only if Chromium exposes it | Implemented (existing LAN bridge) | WebUSB if Chromium exposes it |

Cells are **software implemented**, not physically certified.

---

## Transports

| Kind | Where |
|---|---|
| `native-classic` | Android `WakaBluetoothPrinter` RFCOMM/SPP |
| `native-ble` | Android `WakaBluetoothPrinter` GATT write |
| `web-bluetooth` | Browser BLE, known services `FFE0/FFE1` and `18F0/2AF1` |
| `web-usb` | `navigator.usb` where the OS allows it |
| `electron-network` | Existing `window.wakaDesktop.hardware.printer` TCP bridge |
| `android-network` | `WakaNetworkPrinter` private IPv4 TCP (same policy as Electron) |

Browsers cannot open arbitrary port 9100 sockets. There is **no cloud print server**. LAN printing stays local via Electron or the Android app.

---

## Web BLE discovery

Primary chooser uses **service filters** and printer name prefixes, plus `optionalServices` for the known printer GATT services.

`acceptAllDevices` is a manual “Show all BLE devices” action only. It is still BLE-only. Classic SPP printers will not appear. Cheap BLE printers that advertise neither `FFE0`/`18F0` nor a printer-like name may need that fallback because Web Bluetooth cannot read undeclared services.

---

## Capability vs available vs connected

- **Supported** — WAKA has an implementation for this environment.
- **Available** — this runtime currently exposes the API/hardware.
- **Connected** — the selected printer accepted a session.
- **Printer-compatible** — heuristic hint only; the operator can still pick from all Bluetooth devices.

`/office/hardware` shows that matrix instead of a broken empty chooser.

---

## Electron

Existing LAN ESC/POS and system print are unchanged. No third-party Bluetooth stack was added. Classic SPP on Windows/macOS desktop is **not** claimed.

---

## Physical certification still required

Software and Android compile checks do not prove a printer works.

Still required on real hardware: Android Classic, Android BLE, Android Chrome BLE, Windows/macOS Chrome BLE, iPhone Safari UI honesty + network via desktop if used, non-printer Bluetooth device, desktop Classic SPP explained (not an empty chooser).
