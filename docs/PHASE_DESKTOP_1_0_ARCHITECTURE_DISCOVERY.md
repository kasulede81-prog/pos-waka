# WAKA POS DESKTOP ARCHITECTURE — PHASE 1

**Date:** 2026-08-16  
**Status:** READ-ONLY architecture discovery (no code, migrations, or deploys)  
**Goal:** Make Windows Desktop a first-class WAKA POS platform while leaving Web and Mobile untouched.

---

## 1. Current Architecture

WAKA POS is already a **single React/Vite application** with three shells:

```text
                    WAKA POS (shared React + lib)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
         WEB            MOBILE           DESKTOP
      Vite/PWA        Capacitor        Electron
      BrowserRouter   android/ios      HashRouter
      Service Worker  native guards    loadFile(dist)
```

| Layer | Location | Role |
|-------|----------|------|
| UI | `src/pages/`, `src/components/` | POS, office, auth, support |
| Business state | `src/store/usePosStore.ts` | Cart, checkout, sales, inventory mutations |
| Domain libs | `src/lib/` | Auth, device, print, sync helpers, Remote Support control plane |
| Offline | `src/offline/` | IndexedDB, sync queue, drafts, backups |
| Hardware adapters | `src/services/hardware/` | Printer, barcode, cash drawer, stubs |
| Cloud | `src/lib/supabase.ts` + `supabase/` | Anon client, RLS, RPCs, migrations |
| Electron shell | `electron/main.cjs`, `preload.cjs` | Window, print IPC, Remote Support native |
| Capacitor shell | `android/`, `ios/`, `capacitor.config.ts` | Mobile native wrappers |

**Key packaging facts**

- App version: `1.0.12` (`package.json`)
- Electron entry: `main: electron/main.cjs`
- Electron build: `npm run build:electron` → `ELECTRON=1` Vite build with `base: "./"`
- Windows portable: `npm run package:windows` → `release/win-build-{stamp}/` + copy to `release/windows-build/`
- electron-builder `appId`: `ug.waka.pos.desktop`
- Capacitor `appId`: `ug.waka.pos`

**Verdict:** Desktop already runs the **same** POS business logic as web/mobile. It is not a separate product. The gap is a **first-class native capability layer** (hardware, diagnostics, packaging), not a second POS engine.

---

## 2. Existing Electron Architecture

### Main process (`electron/main.cjs`)

- Creates a single `BrowserWindow` (1440×900, min 1120×720)
- Loads packaged UI via `loadFile(dist/index.html)`
- Security (must preserve):

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

- External links: `setWindowOpenHandler` → OS browser only
- IPC today:
  - `waka-print` → `webContents.print`
  - `waka-printer-diagnostics` → platform/version snapshot
  - Remote Support channels via `registerRemoteSupportIpc`

### Preload (`electron/preload.cjs`)

Exposes a **narrow** `window.wakaDesktop`:

| API | Status |
|-----|--------|
| `platform` | Live |
| `print(opts)` | Live |
| `getPrinterDiagnostics()` | Live |
| `remoteSupport.*` | Live (fixed no-arg channels) |
| `escPosNetwork` | **Typed in renderer, NOT implemented in preload/main** |

Renderer does **not** receive `ipcRenderer`, `require`, `fs`, or `child_process`.

### Remote Support native (`electron/remoteSupport/`)

Already modular:

- `ipcHandlers.cjs`, `supportAgent.cjs`, `authorizationProvider.cjs`
- Transport modes: `off` (default) \| `mock` \| `lab`
- RustDesk lab spawn is allowlisted; production transport stays OFF

### What should eventually move (architecture only — not done)

| Keep in place | Future modules |
|---------------|----------------|
| `main.cjs` window bootstrap + security prefs | `electron/services/print.cjs` |
| `preload.cjs` as typed bridge only | `electron/hardware/printer.cjs` |
| `electron/remoteSupport/` as-is | `electron/hardware/scanner.cjs` (if native needed) |
| | `electron/hardware/cashDrawer.cjs` |
| | `electron/hardware/escPosNetwork.cjs` |
| | `electron/diagnostics/` |

**Do not** flatten Remote Support into a generic “execute anything” IPC.

---

## 3. POS Business Logic Map

### End-to-end flow (already shared)

```text
Login (useAuth + supabase)
  → shop / subscription gate
  → device activation (getOrCreateDeviceId → shop_devices)
  → PosPage (/pos)
  → products (store + offline entity cache)
  → cart (usePosStore + draftCart + draftStorage)
  → checkout (PosCheckoutPanel / desktop rails)
  → payment method (cash/mobile money/debt — local, not card terminal)
  → finalizeDraftSale (permissions + date lock + sale row)
  → inventory mutation (same store path, pendingSync)
  → receipt (receiptPrint / documentPrint)
  → enqueueSync → syncEngine → cloudSync
```

### Where logic actually lives

| Concern | Primary location | Reusable on Desktop? |
|---------|------------------|----------------------|
| Cart state | `src/store/usePosStore.ts`, `src/lib/draftCart.ts` | Yes |
| Checkout / sale create | `finalizeDraftSale` in `usePosStore.ts` | Yes |
| Payments (POS) | Store payment fields + cash drawer kick | Yes (terminal is stub) |
| Inventory | Store mutations + StockPage | Yes |
| Receipt | `src/lib/receiptPrint.ts`, `documentPrint.ts` | Yes |
| Customers / debt | Store + customer pages | Yes |
| Product search | POS components + store selectors | Yes |
| Barcode → cart | `src/lib/posScanToCart.ts` + `barcodeAdapter.ts` | Yes |
| Offline | `src/offline/*` IndexedDB | Yes |
| Sync | `syncEngine.ts`, `cloudSync.ts` | Yes |
| Permissions | Effective permission checks in store | Yes |

**Recommendation:** Desktop must **reuse** this stack. Do not create a second cart/checkout/sale engine.

Desktop-specific work belongs in:

1. Native hardware transport (print/LAN ESC/POS/drawer)
2. Desktop UX density (already partly in `PosDesktop*` components)
3. Packaging / updates / diagnostics

---

## 4. Web / Mobile / Desktop Boundary

| Area | Current location | Platform | Should become |
|------|------------------|----------|---------------|
| POS UI pages | `src/pages/PosPage.tsx` | Shared | Shared |
| Cart / checkout / sales | `src/store/usePosStore.ts` | Shared | Shared |
| Auth / session | `src/hooks/useAuth.ts`, `src/lib/supabase.ts` | Shared | Shared |
| Offline IndexedDB | `src/offline/` | Shared | Shared |
| Device fingerprint | `src/lib/deviceId.ts` | Shared | Shared |
| Marketing / PWA SW | `src/main.tsx`, marketing routes | Web | Web-only |
| Capacitor guards / deep links | `Native*Guard`, `nativeAuthDeepLink.ts` | Mobile | Mobile-only |
| Biometrics / Android updates | `biometricAuth.ts`, `updateEngine/` | Mobile-heavy | Mobile (+ optional later desktop) |
| HashRouter | `src/App.tsx` when Electron | Desktop | Desktop shell |
| Electron print IPC | `electron/main.cjs`, preload | Desktop | Desktop capability |
| LAN ESC/POS | Typed but missing native impl | Mixed / broken on desktop | Desktop hardware |
| WebUSB / Web Bluetooth print | `printerAdapter.ts` | Web (limited) | Keep for web; desktop prefers native |
| HID barcode wedge | `barcodeAdapter.ts` | Shared (keyboard) | Shared |
| Camera barcode | `barcodeAdapter.ts` | Shared when camera exists | Shared |
| Cash drawer kick | ESC/POS via printer adapter | Mixed | Desktop native + shared kick bytes |
| Remote Support UI | `src/components/remote-support/` | Shared UI | Shared UI |
| Remote Support native | `electron/remoteSupport/` | Desktop | Desktop-only |
| Platform detection | `isElectronDesktop`, Capacitor, userAgent | Mixed | Capability model (Phase 2) |
| Hardware settings | `HardwareSettingsPage.tsx` | Shared UI | Shared UI + capability-driven panels |

---

## 5. Hardware Architecture Proposal

### Principle

```text
React renderer
  → typed window.wakaDesktop.* only
  → preload (contextBridge)
  → main process services
  → Windows / USB / network
```

Renderer must **never** receive:

- `ipcRenderer`
- `require` / Node builtins
- `child_process` / arbitrary shell
- service-role keys, grant secrets, RustDesk passwords

### Proposed capability surface (future)

```text
window.wakaDesktop = {
  platform,
  print,                      // existing
  getPrinterDiagnostics,      // existing
  remoteSupport,              // existing (unchanged)
  hardware: {
    printer: { printHtml, printEscPos, listTargets, getStatus },
    scanner: { /* only if OS-level API needed; HID stays in renderer */ },
    cashDrawer: { kick },
    diagnostics: { snapshot },
  },
}
```

### Mapping to current adapters

| Capability | Today | Future desktop path |
|------------|-------|---------------------|
| System print dialog | Electron `waka-print` | Keep |
| Thermal ESC/POS over LAN | Missing (`escPosNetwork` gap) | Implement in main; expose via preload |
| Thermal via WebUSB/BT | Browser APIs | Keep for web; optional fallback |
| Cash drawer | ESC/POS kick bytes | Prefer desktop printer/drawer transport |
| Barcode HID | Renderer keyboard buffer | Keep (no Node needed) |
| Barcode camera | MediaDevices | Keep |
| Payment terminal | Stub | Out of scope for early desktop phases |
| Scale | Stub | Out of scope for early desktop phases |

### Hardware capability model (design)

Prefer **capabilities** over scattered `isElectron` checks:

```text
Platform: web | mobile | desktop

Capabilities:
  nativePrinting
  escPosNetwork
  cashDrawer
  barcodeScannerHid
  barcodeScannerCamera
  desktopDiagnostics
  offlinePOS
  remoteSupportNative
```

Web → existing browser behavior  
Mobile → existing Capacitor behavior  
Desktop → enable native printing / LAN ESC/POS / diagnostics without rewriting POS logic

---

## 6. Offline / Sync Architecture

| Piece | Location | Desktop reuse |
|-------|----------|---------------|
| IndexedDB `waka-pos-offline` | `src/offline/localDb.ts` | Yes |
| Sync queue | `src/offline/syncEngine.ts` | Yes |
| Cloud push / pending sales | `src/offline/cloudSync.ts` | Yes |
| Draft cart | `src/offline/draftStorage.ts` | Yes |
| Entity cache | `src/offline/entityStore.ts` | Yes |
| Connectivity | `useOfflineStatus`, `deviceOnline` | Yes (Electron uses browser online events) |
| Session resilience | `offlineSessionResilience.ts` | Yes |

**Recommendation:** Do **not** introduce a second local database for desktop. IndexedDB in Chromium/Electron is sufficient. Harden reliability later (Phase 6) instead of forking storage.

---

## 7. Security Boundaries

```text
┌─────────────────────── React renderer ───────────────────────┐
│  No Node. No service role. Anon Supabase + RLS only.         │
│  Access native only via window.wakaDesktop (typed).          │
└─────────────────────────────┬────────────────────────────────┘
                              │ contextBridge (preload)
┌─────────────────────────────▼────────────────────────────────┐
│  Preload: narrow invoke wrappers only                        │
└─────────────────────────────┬────────────────────────────────┘
                              │ ipcMain handlers
┌─────────────────────────────▼────────────────────────────────┐
│  Main: print, diagnostics, Remote Support agent              │
│  Partition reader / transport secrets stay in main             │
└─────────────────────────────┬────────────────────────────────┘
                              │
                    Windows OS / hardware
```

**Must remain true**

- No service-role keys in renderer or preload
- No Supabase refresh tokens in native transport path for RS
- No generic “run command” IPC
- Keep `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- Remote Support transport default OFF; lab-only spawn allowlisted

---

## 8. Device Identity

| Piece | Behavior |
|-------|----------|
| `getOrCreateDeviceId()` | UUID in `localStorage` key `waka-pos-device-id` |
| Platform label | Capacitor platform, else Electron → `"windows"`, else `"web"` (`shopPresence.ts`) |
| Cloud registry | `shop_devices` (fingerprint, platform, approval, last_seen) |
| Activation | `deviceActivation.ts` + DeviceActivationContext |

**Do not replace** this identity system for desktop.

**Desktop reliability needs (later, additive):**

- Ensure Electron always reports platform `windows`
- Stable fingerprint across portable EXE restarts (same user profile / storage)
- Clear “approved Windows POS” eligibility for Remote Support and hardware
- Optional richer diagnostics (OS build, printer list) — **context only**, not a second registry

---

## 9. Recommended Directory Structure

Evolve in place; do not invent a second app root.

```text
src/
  pages/                 # shared routes (PosPage, etc.)
  components/
    pos/                 # including PosDesktop* UX
    remote-support/      # control-plane UI
  store/                 # shared business state
  offline/               # shared IndexedDB/sync
  lib/                   # shared domain libs
  services/hardware/     # adapters (call capabilities)
  platform/              # NEW (Phase 2): Platform + Capabilities
  desktop/               # NEW (optional): desktop-only UI helpers

electron/
  main.cjs               # window + security + register handlers
  preload.cjs            # typed bridge only
  remoteSupport/         # KEEP as dedicated module
  services/              # NEW: print, diagnostics registration
  hardware/              # NEW: escPosNetwork, drawer transport
  diagnostics/           # NEW: Windows snapshot helpers

docs/
  PHASE_DESKTOP_1_0_...  # this document
  PHASE_DESKTOP_2_0_...  # future phases
```

Business logic stays under `src/`. Native I/O grows under `electron/`. Capability detection lives in `src/platform/` so web/mobile do not import Electron modules.

---

## 10. Files That Should Remain Untouched

**DO NOT TOUCH WITHOUT REVIEW** (shared web/mobile critical path):

| Path | Why |
|------|-----|
| `src/store/usePosStore.ts` | Core cart/checkout/sale engine |
| `src/offline/**` | Offline DB + sync semantics |
| `src/lib/supabase.ts` | Anon client / session storage |
| `src/hooks/useAuth.ts` | Auth bootstrap for all platforms |
| `src/lib/deviceId.ts` | Device fingerprint contract |
| `src/lib/deviceActivation.ts` | Device limits / registration |
| `android/**`, `ios/**` | Mobile shells |
| `capacitor.config.ts` | Mobile packaging |
| `src/components/Native*Guard*.tsx` | Mobile routing safety |
| `supabase/migrations/151*.sql`, `152*.sql` | Remote Support control plane (frozen history) |
| Production Supabase project | Out of scope for desktop architecture |
| Marketing / SEO / PWA paths | Web-only product surface |

**Touch carefully (desktop-adjacent shared):**

| Path | Why careful |
|------|-------------|
| `src/services/hardware/*` | Shared adapters; desktop changes must not break web/mobile |
| `src/lib/documentPrint.ts` / `receiptPrint.ts` | Multi-platform print |
| `src/App.tsx` | Router split Electron vs others |
| `src/lib/electronDesktop.ts` | Bridge types for all Electron APIs |
| `electron/main.cjs` / `preload.cjs` | Security boundary |

**Desktop-first safe expansion zones:**

- `electron/hardware/` (new)
- `electron/services/` (new)
- `src/platform/` (new)
- Desktop-only components under `src/components/pos/PosDesktop*` / `src/desktop/`
- Docs under `docs/PHASE_DESKTOP_*`

---

## 11. Implementation Phases

Adjusted to this repository (already has Electron shell + RS + Windows portable):

| Phase | Focus | Outcome |
|-------|-------|---------|
| **1 — Architecture** | This document | Shared vs native boundaries agreed |
| **2 — Platform boundary** | `src/platform` capabilities; reduce raw `isElectron` sprawl | Web/mobile unchanged; desktop selects native paths |
| **3 — Desktop shell hardening** | Main/preload structure; HashRouter/file:// polish; window UX | Stable desktop host without POS rewrite |
| **4 — Hardware capability layer** | Implement `escPosNetwork`; drawer via native print path; diagnostics | Real Windows printer/drawer support |
| **5 — Desktop POS UX** | Build on existing `PosDesktop*` rails; keyboard/scanner focus | Cashier-grade Windows layout |
| **6 — Offline/sync hardening** | Reuse IndexedDB; desktop soak tests | Reliable offline sell on Windows |
| **7 — Windows packaging / update** | Portable + NSIS; version channel; icon/signing policy | Repeatable lab/prod desktop builds |
| **8 — Hardware testing** | Real printer/drawer/scanner on Windows lab | Certification checklist |
| **9 — Remote Support (later)** | Keep current RS architecture; lab transport only until certified | No redesign; no production transport by default |

**Explicit non-goals until later:** card terminals, scales, second auth system, second device registry, production RustDesk.

---

## 12. Risks / Technical Debt

1. **`escPosNetwork` typed but unimplemented** — desktop thermal/LAN printing appears available but fails at runtime.
2. **Platform checks are scattered** (`isElectronDesktop`, Capacitor, `window.wakaDesktop`, userAgent) — risk of web/mobile regressions when “fixing desktop.”
3. **`usePosStore.ts` is a large shared monolith** — desktop work must prefer adapters/capabilities around it, not invasive rewrites.
4. **Hardware adapters assume browser APIs** — WebUSB/BT often unavailable or awkward in Electron; native path is required for serious Windows POS.
5. **Portable EXE + `localStorage` identity** — fingerprint stability depends on Chromium profile location; document and test carefully.
6. **Remote Support proximity** — easy to accidentally couple hardware IPC with RS; keep modules separate.
7. **Update story** — mobile has update engine pieces; desktop Windows update/channel is not first-class yet.
8. **Single codebase temptation** — “desktop-only if” inside shared checkout is how web/mobile break; use capability gates at edges.

---

## 13. Final Recommendation

**Proceed with Desktop as a first-class shell around the existing shared POS — not a fork.**

1. Keep one business engine (`usePosStore`, offline, Supabase anon+RLS, `shop_devices`).
2. Keep Electron security model exactly as-is (`contextIsolation`, no `nodeIntegration`, `sandbox`).
3. Grow native I/O under `electron/hardware` + preload typed APIs.
4. Introduce a thin `src/platform` capability layer so Web and Mobile stay behavior-compatible.
5. Close the LAN ESC/POS gap early (Phase 4) — highest-value desktop hardware win.
6. Leave Remote Support alone except as an already-separated desktop module.
7. Do not deploy production schema/transport changes as part of desktop architecture work.

**Gate:** Review and approve this Phase 1 document before Phase 2 implementation.

---

## Appendix — Key file index

| Path | Purpose |
|------|---------|
| `electron/main.cjs` | Desktop window + print IPC + RS registration |
| `electron/preload.cjs` | `window.wakaDesktop` bridge |
| `electron/remoteSupport/` | Native RS agent/transport |
| `src/lib/electronDesktop.ts` | Desktop detection + type surface |
| `src/pages/PosPage.tsx` | Sell entry |
| `src/store/usePosStore.ts` | POS business engine |
| `src/offline/` | IndexedDB + sync |
| `src/lib/deviceId.ts` | Device fingerprint |
| `src/services/hardware/` | Printer/barcode/drawer adapters |
| `package.json` `build` | electron-builder Windows targets |
| `scripts/run-windows-installer.mjs` | Portable/NSIS stamped output |

---

*End of Phase 1 — READ-ONLY. No application code, migrations, packages, or deploys were changed by this discovery phase (documentation only).*
