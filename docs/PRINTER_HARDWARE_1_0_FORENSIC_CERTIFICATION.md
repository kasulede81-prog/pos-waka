# PRINTER-HARDWARE-1.0 — FORENSIC THERMAL PRINTER COMPATIBILITY CERTIFICATION

**Mode:** Forensic audit only.  
**Date:** 2026-09-03  
**Hardware observation:** Generic portable unit labeled “Mobile Printer”; manufacturer/model unknown.  
**Observed symptom:** Chrome (macOS) Web Bluetooth chooser titled `pos.waka.ug wants to connect` shows **No compatible devices found.**

**Follow-up implementation (does not change this audit’s verdict):** see `docs/PRINTER_HARDWARE_1_1_ANDROID_BLUETOOTH.md` and `docs/PRINTER_HARDWARE_1_2_CROSS_PLATFORM.md`.

This document does not implement anything. It certifies what the repository did at audit time.

---

## 1. Executive verdict

**Can WAKA currently connect to and print to this class of Bluetooth thermal printer?**

**NO — not reliably, and not via the path that opened the empty chooser.**

WAKA’s only in-browser Bluetooth transport is **Web Bluetooth BLE/GATT**. That API cannot see **Bluetooth Classic / SPP** devices. The Hardware Settings “Print test receipt” button on `https://pos.waka.ug` calls `navigator.bluetooth.requestDevice({ acceptAllDevices: true, … })`. An empty chooser with `acceptAllDevices: true` means Chrome saw **zero BLE advertisements**, not that WAKA’s UUID filter hid a BLE printer.

The physical unit’s exact radio protocol **cannot be read from the repository**. The empty chooser plus a generic “Mobile Printer” label is **consistent with** Classic SPP (or a printer that is off / not advertising BLE). It is **not** proof the printer is defective, that macOS Bluetooth is broken, or that the Settings UI failed to open.

**Exact missing capability for production POS (Android phone/tablet + Capacitor APK, plus typical portable thermals):**

- **Bluetooth Classic / SPP serial write of ESC/POS bytes**, via a **Capacitor/Android native bridge** (and later a desktop native path if Classic printers must work on Mac/Windows without LAN).
- Not: another copy of customer Settings.
- Not: more Web Bluetooth UUID guesses as the primary Android strategy.
- Not: HTML/PDF share as a substitute for a receipt printer.

WAKA already produces **raw ESC/POS bytes** (`EscPosBuilder`, retail/kitchen/restaurant renderers, IndexedDB print queue). The gap is **transport to this printer class**, not receipt HTML.

**Production-readiness score (Bluetooth portable thermal on the real POS model): 2 / 10.**  
LAN ESC/POS on Electron is a separate, implemented path. Browser print / PDF share is a fallback, not thermal hardware.

---

## 2. Current printer architecture

```
WAKA UI
  Settings → Hardware (/office/hardware)
  Settings → Selling (paper size only)
  Settings → Receipt (branding / HTML preview — not transport)
        ↓
Printer Settings
  preferences.receiptPaperSize          (58mm | 80mm | a4)  — HTML/PDF/test-print width
  preferences.hospitalityHardware.printers[]  — multi-printer profiles
        ↓
Connection manager
  NONE for Bluetooth/USB.
  Profiles store connectionType + optional networkHost/port.
  pairedDeviceKey exists on the type and is never written.
  Each print re-opens Web Bluetooth / WebUSB chooser or LAN TCP.
        ↓
Transport  (src/services/hardware/printerAdapter.ts)
  bluetooth → navigator.bluetooth.requestDevice + GATT write
  usb       → navigator.usb.requestDevice + transferOut
  network   → window.wakaDesktop.hardware.printer.printEscPos (Electron TCP :9100)
  builtin   → same as USB
        ↓
ESC/POS / receipt renderer
  EscPosBuilder / buildTestEscPos / buildRetailReceiptEscPos /
  kitchen + restaurant ESC/POS
  Parallel HTML (isolated print) and PDF (jsPDF share)
        ↓
Physical printer
  Only if a transport succeeds.
```

| Layer | File(s) | Role |
|---|---|---|
| Hardware UI | `src/pages/HardwareSettingsPage.tsx` | Paper size, **Print test receipt**, capability dump, kitchen/receipt profiles |
| Multi-printer UI | `src/components/hardware/PrinterManagementPanel.tsx` | Add/remove/test profiles; station assign; queue |
| Capability probe | `src/services/hardware/printerAdapter.ts` `detectPrinterCapabilities` | `navigator.bluetooth` / `navigator.usb` / Electron bridge presence |
| BT/USB/LAN send | same file `sendEscPosBytes` / `transferBluetooth` / `transferUsb` / `transferNetwork` | Bytes to hardware |
| ESC/POS builder | `src/lib/escPosBuilder.ts` | Epson-compatible commands |
| Retail bytes | `src/lib/retailReceiptEscPos.ts` | Sale receipt → `Uint8Array` |
| Queue | `src/lib/printQueue.ts` + `src/offline/printPayloadStore.ts` | IndexedDB payloads, retry |
| Registry | `src/lib/printerRegistry.ts` | Default receipt / station routing |
| Mutations | `src/store/hardwarePrintMutations.ts` | Persist profiles; `testConfiguredPrinter` |
| HTML fallback | `src/lib/receiptPrint.ts` `printReceiptWithFallback` | Browser print dialog |
| Native share | `src/lib/nativeReceiptPrint.ts` | Capacitor PDF share (not ESC/POS) |
| Electron LAN | `electron/hardware/escPosNetwork.cjs`, `printerIpc.cjs` | TCP 9100 |
| Legacy (not wired) | `lovable-import/lovable-ui/src/lib/printer.ts` | Older BLE connect + writable-char scan |

**There is no Capacitor Bluetooth plugin in `package.json`.** No Android `BLUETOOTH_*` permissions. No iOS Bluetooth usage strings.

---

## 3. Current hardware setup UI

**Route:** `/office/hardware`  
**Gate:** `settings.view`  
**Page:** `HardwareSettingsPage`  
**Screenshot match:** Receipt printing card → **Print test receipt** → Web Bluetooth chooser (`pos.waka.ug wants to connect`).

### Receipt printing card (the screenshot surface)

| Control | Persistence | Behavior |
|---|---|---|
| Paper size 58 / 80 / A4 | `preferences.receiptPaperSize` (shop prefs, `settings.devices`) | Used by HTML/PDF and by `printReceiptWithFallback` → `testPrint` width (`a4` coerced to `80mm` thermal) |
| Print test receipt | None | See §9 |
| Capability line | Live probe | USB / BT / LAN / platform |
| Electron print test | — | Only if `canNativePrint()` (desktop system print) |
| AirPrint hint copy | — | Documents **OS print dialog**, not BLE |

**Classification of this card:** **D / E — implemented for Web Bluetooth + WebUSB + HTML fallback; unsupported as Classic SPP; LAN only in Electron.**

### Kitchen & receipt printers panel

| Control | Persistence | Behavior |
|---|---|---|
| Name, connection `usb \| bluetooth \| network \| builtin` | `hospitalityHardware.printers[]` | Saved locally with shop preferences |
| Paper 58 / 80 | `printer.paperWidth` | Used by ESC/POS enqueue/test **for that profile** |
| Host / port | network only | LAN; Electron required to send |
| Roles, default receipt, station assign | yes | Routing only |
| Test | — | Network: TCP probe then `testPrintProfile`. BT/USB: `sendEscPosBytes` (chooser again) |
| Disconnect / reconnect | **none** | No connect button, no cached GATT, no OS-pair check |
| Diagnostics | `lastError` on profile; queue history | Last send error string |

**Classification:** **B — partially functional.** Profiles and queue are real. Bluetooth “Add printer” **does not discover or pair**; it only stores a label. Actual radio happens later on Test / sale enqueue.

### Other surfaces

| Surface | Printer transport? |
|---|---|
| `/office/settings` → Selling paper size | Same `receiptPaperSize` — **duplicate paper control**, not a second Bluetooth stack |
| Settings → Receipt | Branding + HTML live preview. **Not** printer connect |
| Customer Settings (frozen) | Must not be cloned into admin |

---

## 4. Bluetooth protocol (what WAKA uses)

**WAKA expects BLE/GATT (Web Bluetooth). It does not implement Bluetooth Classic/SPP.**

Source: `src/services/hardware/printerAdapter.ts`.

```
navigator.bluetooth.requestDevice({
  acceptAllDevices: true,
  optionalServices: [0xffe0, 0x18f0],
})
→ device.gatt.connect()
→ getPrimaryService(0xffe0)          // FIRST UUID ONLY
→ getCharacteristic(0xffe1)         // FIRST UUID ONLY
→ characteristic.writeValue(bytes)
→ gatt.disconnect()
```

| Item | Value in production adapter |
|---|---|
| API | Web Bluetooth (`navigator.bluetooth`) |
| Filters | **None** (`acceptAllDevices: true`) |
| optionalServices | `0xffe0`, `0x18f0` (16-bit) |
| Service used after connect | **`0xffe0` only** |
| Characteristic used | **`0xffe1` only** |
| Alternate pair `0x18f0` / `0x2af1` | Declared, **never used** |
| Write | `writeValue` only (not `writeValueWithoutResponse`) |
| Notifications | Not used |
| Persistence | None. `pairedDeviceKey` unused |
| Reconnect | New chooser every send |
| Disconnect | Immediate after write |

**Critical distinction**

| | BLE/GATT | Classic SPP |
|---|---|---|
| WAKA production code | Yes (Web Bluetooth) | **No** |
| Chrome chooser | Yes | **Never listed** |
| Typical cheap “Mobile Printer” | Some newer units | **Most portable 58mm units** |

`lovable-import/lovable-ui/src/lib/printer.ts` (not imported by `src/`) is still BLE-only, but it scans all GATT services for a writable characteristic and caches the connection. Production WAKA does neither.

**Physical printer protocol:** *Protocol cannot be determined from repository.*  
Hardware evidence (empty `acceptAllDevices` chooser) only proves: **no BLE advertisement reached Chrome at that moment.**

---

## 5. Browser compatibility

Web Bluetooth ≠ Capacitor native Bluetooth. Capacitor uses the system WebView, not Chrome.

| Platform | Web Bluetooth | Classic Bluetooth | Native bridge | Thermal printer viability |
|---|---|---|---|---|
| Mac Chrome | Yes (chooser observed) | No | No | **BLE GATT printers only.** Classic portable units: **not visible**. HTML/OS print is the real fallback. |
| Windows Chrome | Yes (Chromium) | No | No | Same as Mac Chrome. |
| Android Chrome | Yes (Chromium) | No | No | BLE-only in the **browser**. Not the Capacitor APK. |
| iOS Safari | **No** | No | No | HTML/AirPrint/share only. |
| Capacitor Android | Typically **`navigator.bluetooth` absent** in WebView | **No plugin / no manifest perms** | **None** | Adapter marks Android `escPosAvailable: false` when BT/USB APIs missing: *“Native thermal SDK not installed.”* |
| Capacitor iOS | **No** (WKWebView) | No (no MFi/SPP) | **None** | PDF share / AirPrint. Classic dongles generally **impossible**. |
| Electron | Only if Chromium Web Bluetooth enabled (not a dedicated WAKA path) | No | **LAN ESC/POS TCP only** | Network printers: yes. BT portable: **no**. System print: yes. |

`resolveCapabilityState` (`printerAdapter.ts`): USB → SUPPORTED; Web Bluetooth present → PARTIAL + `escPosAvailable`; Android/iOS without those APIs → PARTIAL, **`escPosAvailable: false`**.

---

## 6. Capacitor compatibility

| Check | Result |
|---|---|
| `@capacitor-community/bluetooth-le` / serial / printer plugin | **Not in `package.json`** |
| Android `BLUETOOTH`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE` | **Absent** from `AndroidManifest.xml` |
| Android 12+ nearby devices | **Not declared** |
| `ACCESS_FINE_LOCATION` | Present (geolocation / legacy scan), **not wired to a printer plugin** |
| iOS `NSBluetoothAlwaysUsageDescription` / `NSBluetoothPeripheralUsageDescription` | **Absent** (`ios/App/App/Info.plist`) |
| `sunmiBuiltIn` | Hard-coded `false` |
| Platform capability `escPosNetwork` on mobile | **false** (`src/platform/capabilities.ts`) |

**Capacitor Android/iOS cannot talk to this printer with the current binary.** Adding Web Bluetooth UUID lists will not create Classic SPP.

---

## 7. ESC/POS analysis

WAKA **does** generate raw ESC/POS, independent of HTML.

| Feature | Implementation | Suitable for generic ESC/POS thermal? |
|---|---|---|
| Init | `ESC @` | Yes |
| Code page | `ESC t 0` (CP437) | Yes for ASCII/UGX digits; **not a Unicode/Luganda page** |
| Text | `TextEncoder` (UTF-8 bytes into a CP437 session) | ASCII/numbers OK. Luganda / non-Latin **may print garbage** |
| Bold / double / align | ESC/GS standard | Yes |
| Columns | 32 (`58mm`) / 42 (`80mm`) | Yes |
| Line feed / feed / partial cut | `LF`, `ESC d`, `GS V 66 3` | Yes on most Epson-compatible units |
| Drawer kick | `ESC p` pin 2 | Printers with drawer port |
| QR | **Placeholder text `(QR)`** — not GS QR | Not a real QR |
| Barcode | **None** | — |
| Logo / raster | **None** | — |
| UGX | `UGX 1,234` via `toLocaleString` | ASCII — OK |

Retail sale bytes: `buildRetailReceiptEscPos` → queue → `sendEscPosBytes`.  
Test bytes: `buildTestEscPos`.

**HTML/PDF receipts are a different output path.** A correct on-screen receipt does not prove the thermal printer received ESC/POS.

---

## 8. Paper-size flow

Two independent widths:

```
A. preferences.receiptPaperSize   (58mm | 80mm | a4)
   Settings Selling + Hardware receipt card
   → HTML @page CSS, PDF mm width, Hardware testPrint (a4 → 80mm thermal)

B. printer.paperWidth             (58mm | 80mm only)
   PrinterManagementPanel
   → EscPosBuilder cols, kitchen/retail/restaurant enqueue, profile Test
```

**Changing A does change** HTML/PDF and the Hardware **Print test receipt** thermal width.  
**Changing A does not change** ESC/POS for a configured profile (that uses B).  
**Changing B does change** generated ESC/POS column width when that profile prints.

A4 is **browser/office paper**, not a thermal roll command.

---

## 9. Test-print flow

### Button: “Print test receipt” (`HardwareSettingsPage`)

```
testPrint()
  → printReceiptWithFallback(plainText, receiptPaperSize)
      → detectPrinterCapabilities()
      → if escPosAvailable:
            testPrint({ width: 58|80, lines })
              → buildTestEscPos
              → if usbAvailable: transferUsb  (WebUSB chooser, empty filters)
              → if bluetoothAvailable: transferBluetooth  ← THIS OPENED THE SCREENSHOT
      → catch swallowed; HTML fallback
      → if not Capacitor: printIsolatedHtmlDocument (browser print)
      → else: "No printing method available."
```

- **Does not** require a saved printer profile.
- **Does** require WebUSB and/or Web Bluetooth to attempt thermal bytes.
- On Mac Chrome: Bluetooth API present → **chooser every click**.
- USB is tried **first**; if the user cancels USB, code still proceeds to Bluetooth.
- Errors from `testPrint` are **dropped** if HTML fallback succeeds. User can see “Printed via browser fallback.” after a failed/empty BLE chooser if the print dialog opens.
- `transferBluetooth` surfaces `Error.message` only if the whole `printReceiptWithFallback` thermal path fails **and** HTML also fails.

### Button: profile “Test”

```
optional testNetworkPrinterConnection (LAN only)
→ testConfiguredPrinter(id)
    → testPrintProfile(profile)
        → sendEscPosBytes(profile)
            → bluetooth | usb | network | builtin
```

Requires a saved profile. Bluetooth still opens a **new** Web Bluetooth chooser (no saved device).

---

## 10. Discovery failure analysis

Observed: Chrome Web Bluetooth chooser, **No compatible devices found**, `acceptAllDevices: true`.

| # | Hypothesis | Rank vs this evidence |
|---|---|---|
| 1 | Printer off | Possible. Same empty list. Not proven. |
| 2 | Not paired in macOS | **Web Bluetooth does not require OS pairing** for BLE. Pairing a Classic device in macOS Settings **does not** list it here. |
| 3 | Already connected to another phone | Possible (Classic units often stop advertising). Not proven. |
| 4 | **Printer is Bluetooth Classic/SPP** | **Highest architectural fit.** Web Bluetooth never lists Classic. Generic “Mobile Printer” class is typically SPP. Repo cannot confirm this unit’s radio. |
| 5 | Does not advertise BLE | Same as 4 from Chrome’s point of view. |
| 6 | WAKA BLE filters exclude it | **Ruled out for the empty list.** Filters are not used. UUID mismatch would fail **after** a device is selected. |
| 7 | Required service UUID missing | Would not empty `acceptAllDevices` chooser. Would fail `getPrimaryService(0xffe0)` later. |
| 8 | Browser lacks Classic profile | **True on all listed browsers.** Explains empty list if the printer is Classic. |
| 9 | macOS does not expose Classic to Web Bluetooth | **True.** Confirmed platform limitation, not a WAKA bug. |
| 10 | Needs native Android Bluetooth | **True for production POS** if the printer is Classic. Not why Mac Chrome was empty. |
| 11 | Vendor app required for first pair | Possible for some clones. Not evidenced. |

**Do not state a single root cause for this serial number.** State: **WAKA showed a BLE-only picker; no BLE device appeared.**

---

## 11. Pairing analysis

**What operators might assume**

```
Printer ON → Phone/Mac Bluetooth settings → Pair
→ WAKA Hardware → Connect → Paper size → Test
```

**What WAKA actually does**

```
Printer ON (must advertise BLE)
→ Open /office/hardware
→ Print test receipt
→ Chrome Web Bluetooth chooser (BLE only)
→ If selected: GATT 0xffe0/0xffe1 write → disconnect
→ No OS-pair step, no “Connected” badge, no reconnect
```

Adding a “bluetooth” profile in Kitchen & receipt printers **does not pair**. `pairedDeviceKey` is never set.

OS pairing a Classic printer is **invisible** to this chooser.

---

## 12. Offline behavior

| Question | Current behavior |
|---|---|
| Print without internet? | **Yes, if a local transport works.** No Supabase call in `printerAdapter` / ESC/POS / queue. |
| Cloud required to configure? | No. Prefs + queue live in local shop state / IndexedDB. |
| Same printer after restart? | **Profile persists.** **BLE/USB session does not.** Next print opens a chooser again. |
| After Bluetooth drop | Immediate disconnect after each write. No supervisor. |
| After device reboot | Same: saved profile, no radio session. |
| LAN | Electron + reachable private IP; no cloud. |
| Capacitor | Thermal path **unimplemented**; PDF share is local. |

Printing is offline-capable **architecturally**. This Bluetooth printer is not connected in any persisted way.

---

## 13. Multiple printers

The **data model already supports** many printers: kitchen, bar, coffee, dessert, grill, pizza, fryer, receipt, other; station `printerIds`; default receipt; per-terminal assignment via floor stations.

The **Bluetooth transport does not**. One ephemeral GATT write, no device identity.

UI is designed for multiple **profiles**, not multiple simultaneous radios.

---

## 14. Permission analysis

| Platform | Printer-relevant permission | Present? |
|---|---|---|
| Android Capacitor | `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` / `BLUETOOTH_ADVERTISE` | **No** |
| Android | `NEARBY_DEVICES` | **No** |
| Android | Location (legacy BLE scan) | Fine/coarse **yes**, unused by printer code |
| Android | USB host | Not declared for printers |
| iOS | Bluetooth usage descriptions | **No** |
| iOS | Local network | Not for this printer |
| Chrome | User gesture + site Bluetooth permission | Required; chooser **did** open on pos.waka.ug (HTTPS) |
| Electron LAN | Private IPv4 policy in `lanHostValidation.cjs` | Implemented |

Do not add permissions in this milestone.

---

## 15. Security analysis

| Topic | Finding |
|---|---|
| Device identifiers | Not persisted (`pairedDeviceKey` unused). |
| Bluetooth address | Never stored. |
| Shop scope | Printer profiles sit on **shop preferences** (`hospitalityHardware`). Same shop/device isolation as other prefs. No extra RLS table. |
| Cross-shop | Switching shops loads that shop’s prefs; no global printer registry. |
| Unauthorized connect | Any user who can open Hardware and grant the browser chooser can send bytes. Mutations need `settings.devices` for persist. |
| LAN | Private IPv4 only in Electron; good. |
| Secrets | No printer passwords in code. |

No RLS/schema change is recommended in this audit.

---

## 16. Error handling (user-visible)

| Message | Source |
|---|---|
| Web Bluetooth not available. | `transferBluetooth` |
| Bluetooth printer connection failed. | no `gatt` |
| Bluetooth thermal print failed. / `Error.message` (chooser cancel, GATT) | catch |
| WebUSB not available. / USB thermal print failed. | USB path |
| Network printer host not set. | LAN |
| LAN ESC/POS needs the Waka desktop app… | LAN without Electron |
| Could not connect to printer | LAN / UI status |
| Printer not found. | profile Test |
| Native thermal SDK not installed. Use Receipt Print or save/share PDF. | Android/iOS without Web BT/USB |
| Web Bluetooth may work with compatible printers; use browser print as fallback. | Mac/Win Chrome capability line |
| Printed via native thermal path. / Printed via browser fallback. | Hardware test |
| Test print failed. / Sending test print… | Profile Test |
| Printing failed. On phone or tablet… | `receiptPrintBlocked` |
| Missing print payload. / Printer not configured. / Print failed | Queue |
| Chrome: No compatible devices found. | **Browser chooser — not a WAKA string** |

**Not implemented as WAKA errors:** paper out, printer busy, unsupported model.

Browser `DOMException` names can leak to the user on profile Test. Hardware test-print often **hides** BLE failure behind HTML fallback.

---

## 17. Test matrix (certification — not executed on the physical unit)

Mark: PASS / FAIL / UNIMPLEMENTED / UNKNOWN.  
No UNKNOWN promoted to PASS. No fictional hardware PASS.

| Test | Browser (Mac Chrome) | Capacitor Android | Capacitor iOS | Electron |
|---|---|---|---|---|
| Discover printer (Classic portable) | **FAIL** (BLE chooser empty) | **UNIMPLEMENTED** | **UNIMPLEMENTED** | **UNIMPLEMENTED** (no BT) |
| Discover printer (BLE GATT) | UNKNOWN (no BLE unit certified) | **UNIMPLEMENTED** | **UNIMPLEMENTED** | UNKNOWN |
| Connect (persist) | **UNIMPLEMENTED** | **UNIMPLEMENTED** | **UNIMPLEMENTED** | LAN: implemented, not this unit |
| Reconnect | **UNIMPLEMENTED** | **UNIMPLEMENTED** | **UNIMPLEMENTED** | LAN: new TCP each job |
| Send ESC/POS | Code exists; radio FAIL/UNKNOWN | **UNIMPLEMENTED** | **UNIMPLEMENTED** | LAN only |
| Test receipt | Opens BLE chooser; may HTML-fallback | PDF/share path, not this printer | PDF/share | System print and/or LAN |
| 58mm ESC/POS width | Code PASS (32 cols) | Code unused | unused | LAN uses profile width |
| 80mm ESC/POS width | Code PASS (42 cols) | unused | unused | LAN |
| Offline printing | Transport-local if connected | PDF local | PDF local | LAN local |
| App restart | Profile yes; BT session no | n/a | n/a | LAN host persisted |
| Bluetooth reconnect | **UNIMPLEMENTED** | **UNIMPLEMENTED** | **UNIMPLEMENTED** | n/a |

---

## 18. Root-cause register

### P0-PRINT-BT-CLASSIC — blocks all production printing to this printer class

| | |
|---|---|
| **Finding** | Production Bluetooth path is Web Bluetooth BLE/GATT only. Typical portable “Mobile Printer” units use Classic SPP. Chrome’s empty chooser is the expected BLE-only result. |
| **Evidence** | `transferBluetooth` + `requestDevice`; no SPP/RFCOMM; no Capacitor BT plugin; screenshot chooser; `acceptAllDevices: true` still empty. |
| **Platforms** | Mac/Win Chrome (this test), Android Chrome (BLE-only), Capacitor Android/iOS (no bridge). |
| **Recommended fix** | Native **Classic SPP** write of existing ESC/POS bytes on Capacitor Android first. Do not treat Web Bluetooth as the Android product path. |
| **Risk** | Shipping “Bluetooth printers supported” while the common hardware class never appears. |

### P0-PRINT-CAPACITOR-NATIVE — blocks Android APK (primary POS)

| | |
|---|---|
| **Finding** | `escPosAvailable` is false on Android/iOS when Web APIs are missing. Manifest has no BT printer permissions. Adapter copy: native SDK not installed. |
| **Evidence** | `resolveCapabilityState` android/ios branch; `package.json`; `AndroidManifest.xml`; `capabilities.ts` mobile `escPosNetwork: false`. |
| **Platforms** | Capacitor Android (critical), Capacitor iOS. |
| **Recommended fix** | Android BluetoothSocket / serial plugin + permission set; reuse `EscPosBuilder` + print queue. |
| **Risk** | Shops on APK cannot print to the test unit at all. |

### P1-PRINT-GATT-HARDCODE — blocks even BLE printers that are not 0xffe0/0xffe1

| | |
|---|---|
| **Finding** | After a BLE device is chosen, only service `0xffe0` / char `0xffe1` are opened. `0x18f0`/`0x2af1` unused. No writable-characteristic scan. |
| **Evidence** | `BT_PRINTER_SERVICES[0]`, `BT_PRINTER_CHARS[0]`. Contrast: lovable-import `findWritableChar`. |
| **Platforms** | Any Web Bluetooth environment. |
| **Recommended fix** | If BLE remains a secondary path: enumerate services/characteristics (as in lovable-import). Not a substitute for SPP. |
| **Risk** | A real BLE printer could appear in the chooser and still fail to print. |

### P1-PRINT-NO-SESSION — reconnect / POS reliability

| | |
|---|---|
| **Finding** | No connection manager. Chooser every job. `pairedDeviceKey` dead. Immediate disconnect. |
| **Evidence** | `transferBluetooth` end-to-end; `upsertPrinter` omits `pairedDeviceKey`. |
| **Platforms** | All Web Bluetooth. |
| **Recommended fix** | Persist native MAC/bond id after first pair; silent reconnect. |
| **Risk** | Unusable at checkout even if discovery worked. |

### P2-PRINT-TWO-WIDTHS — 58/80 confusion

| | |
|---|---|
| **Finding** | Shop `receiptPaperSize` and profile `paperWidth` can disagree. |
| **Evidence** | Hardware card vs `PrinterManagementPanel`; `retailReceiptPrint` uses profile width. |
| **Platforms** | All. |
| **Recommended fix** | One width for thermal output; A4 stays HTML/PDF only. |
| **Risk** | Test looks 58mm; sale prints 80mm wrap. |

### P2-PRINT-ENCODING — Luganda / UTF-8

| | |
|---|---|
| **Finding** | UTF-8 payload with CP437 selected. |
| **Evidence** | `ESC t 0` + `TextEncoder`. |
| **Platforms** | All ESC/POS transports. |
| **Recommended fix** | Later: code page or image-line for non-ASCII. Not P0 for ASCII UGX receipts. |
| **Risk** | Local-language headers garbage. |

### P2-PRINT-QR-PLACEHOLDER

| | |
|---|---|
| **Finding** | QR is text stub, not GS QR. |
| **Evidence** | `EscPosBuilder.qrPlaceholder`. |
| **Recommended fix** | Vendor QR command when a payment QR is required. |

### P3-PRINT-ERRORS-SWALLOWED

| | |
|---|---|
| **Finding** | Hardware test-print falls back to HTML and can report success after BLE failure. |
| **Evidence** | `printReceiptWithFallback` try/catch then `printReceiptText`. |
| **Recommended fix** | Surface “thermal failed, opened browser print” explicitly. |

### P3-PRINT-NAV-COMPLEXITY

| | |
|---|---|
| **Finding** | Paper size in Selling and Hardware; branding on Receipt; connect implied but missing. |
| **Recommended fix** | One Hardware workspace; Selling/Receipt stay content, not radios. |

---

## 19. Exact smallest viable implementation

**Do not implement in this certification.** Smallest later change that unblocks the arrived printer **and** Android POS:

1. **Identify the radio on the unit** (Android Bluetooth settings: Classic vs LE). If Classic — do not spend a phase on Web Bluetooth filters.
2. **Capacitor Android SPP (or BLE-serial) plugin** that accepts `Uint8Array` already produced by `EscPosBuilder`.
3. **Android permissions** for connect/scan (and location only if a chosen plugin requires it on old APIs).
4. **Connection manager:** pick bonded device once, store id on `PrinterProfile.pairedDeviceKey`, reconnect without a browser chooser.
5. **Wire `sendEscPosBytes` bluetooth** to the native bridge on Capacitor; leave Web Bluetooth as optional desktop/Chrome experiment.
6. **Reuse** print queue, ESC/POS renderers, paperWidth, kitchen/receipt profiles.

**Not smallest:** Electron Classic stack first, iOS MFi, new receipt HTML, new Settings pages, UUID spray, USB-only, LAN-only (this unit is Bluetooth).

**Desktop:** keep HTML/OS print + existing LAN ESC/POS. Add Classic only if shops must print from Mac/Windows to the same dongle.

**iOS:** treat as **best-effort** (AirPrint/PDF or BLE-only hardware). Do not promise Classic SPP.

---

## 20. Recommended next implementation phase

**PRINTER-HARDWARE-2.0 — Android Classic/SPP (or confirmed-BLE) native transport**

- Hardware ID of the test unit (settings screen + if possible GATT vs SPP).
- One Android native write path + Hardware UI “Select paired printer”.
- Test print and one post-sale receipt through the existing queue.
- No sale-finalization, Settings freeze, or financial changes.

Then: persist/reconnect, 58mm default for portable rolls, error copy, optional BLE writable-char scan.

---

## 21. What must NOT be changed (when implementation starts)

- Sale finalization, payments, revenue, WAC, stock RPCs, Drawer V2 financial math, Reports, EFRIS, receipt **financial** contents.
- Customer Settings milestones (do not rebuild Settings; add a **support/hardware intervention** connect flow only).
- Ask WAKA.
- Do not install plugins or edit manifests **in an audit**. Implementation phase may; this certification did not.

---

## 22. Test plan (for the implementation phase)

1. Confirm printer radio in Android Bluetooth (Classic vs LE).  
2. Pair in Android settings.  
3. Capacitor APK: device appears in WAKA bonded list (not Chrome chooser).  
4. Test ESC/POS 58mm and 80mm.  
5. Offline: airplane mode, print still works.  
6. Kill app, reprint without re-choosing if bonded.  
7. Drop BT, reconnect, one receipt.  
8. Regression: HTML/PDF share still works; LAN Electron unchanged.  
9. iOS: document FAIL/AirPrint only unless BLE hardware is confirmed.  
10. Mac Chrome: document Classic still invisible; do not use as the certification platform.

---

## 23. Production-readiness score

| Path | Score | Note |
|---|---|---|
| HTML / PDF / OS print | 7/10 | Works; not this thermal. |
| Electron LAN ESC/POS | 6/10 | Implemented; not this Bluetooth unit. |
| Web Bluetooth BLE | 2/10 | Chooser exists; no session; hardcoded GATT; empty vs Classic. |
| Capacitor Android thermal | **1/10** | No plugin, no permissions, capability false. |
| Capacitor iOS thermal | **1/10** | No Bluetooth surface. |
| **This “Mobile Printer” on WAKA POS** | **2/10** | Bytes exist; radio does not. |

**Overall certification:** **NOT PRODUCTION-READY** for Bluetooth portable thermals on Android/Capacitor.

---

## 24. Final answers

**Why does the physical printer not appear in WAKA?**  
WAKA opened the **Web Bluetooth BLE** picker. That picker does not list Classic SPP devices. With `acceptAllDevices: true`, an empty list means Chrome saw no BLE advertisements (printer Classic / off / not advertising LE). WAKA UUID filters did not hide it.

**What protocol does WAKA use?**  
**BLE/GATT via Web Bluetooth**, then write `0xffe0` / `0xffe1`.

**What protocol does the printer use?**  
**Cannot be determined from the repository.** Hardware class + empty BLE chooser are consistent with **Bluetooth Classic/SPP**.

**Smallest architecture change?**  
**Capacitor Android native serial (Classic SPP, or BLE if the unit is LE) that sends existing ESC/POS bytes, with a persisted paired device.** Do not design the product around Mac Chrome Web Bluetooth.

---

AUDIT STATUS: COMPLETE  
IMPLEMENTATION: NONE  
SOURCE CHANGES: DOCUMENT ONLY (`docs/PRINTER_HARDWARE_1_0_FORENSIC_CERTIFICATION.md`)  
DATABASE CHANGES: NONE  
PRINTER CONFIG MIGRATIONS: NONE  
DEPENDENCIES INSTALLED: NONE  
ANDROIDMANIFEST / INFO.PLIST / CAPACITOR: UNCHANGED  
RECEIPT RENDERER / CHECKOUT / SYNC / AUTH: UNCHANGED  
FINANCIAL DOMAINS: UNCHANGED  
SETTINGS (CUSTOMER): UNCHANGED  
ASK WAKA: UNCHANGED  
COMMIT: NOT PERFORMED  
PUSH: NOT PERFORMED  
DEPLOYMENT: NOT PERFORMED
