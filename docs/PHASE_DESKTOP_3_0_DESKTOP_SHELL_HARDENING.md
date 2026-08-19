# WAKA POS DESKTOP — PHASE 3
# DESKTOP SHELL HARDENING

**Date:** 2026-08-16  
**Status:** Implemented (Electron shell only — no POS rewrite)  
**Depends on:**  
- [`PHASE_DESKTOP_1_0_ARCHITECTURE_DISCOVERY.md`](./PHASE_DESKTOP_1_0_ARCHITECTURE_DISCOVERY.md)  
- [`PHASE_DESKTOP_2_0_PLATFORM_CAPABILITY_BOUNDARY.md`](./PHASE_DESKTOP_2_0_PLATFORM_CAPABILITY_BOUNDARY.md)

---

## Objective

Make the Windows Electron desktop shell production-quality and stable while keeping the shared POS application unchanged.

Scope: window lifecycle, packaged `file://` loading, HashRouter desktop behavior, navigation security, single-instance, renderer recovery, preload safety, IPC error sanitization.

Out of scope: ESC/POS, cash drawer, RustDesk packaging, RS-5, migrations, offline/auth rewrites.

---

## Pre-change shell snapshot

| Area | Before Phase 3 |
|------|----------------|
| Window | 1440×900, min 1120×720, `show: false`, `ready-to-show` |
| Security prefs | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| Load | `loadFile(dist/index.html)` |
| External links | `setWindowOpenHandler` → `shell.openExternal` + deny |
| Single instance | **Missing** |
| Navigation harden | **No** `will-navigate` / redirect guards |
| Crash recovery | Log-only `did-fail-load`; no recovery UI |
| DevTools | Not auto-opened (already good) |
| Preload | Narrow `wakaDesktop` (print, diagnostics, remoteSupport) |
| Router | Electron → `HashRouter`; else `BrowserRouter` |

---

## What changed

| Path | Role |
|------|------|
| `electron/main.cjs` | Single-instance, navigation guards, lifecycle, recovery load, sanitized print errors, `waka:shell:reload-app` |
| `electron/preload.cjs` | Adds named `reloadApp()` only |
| `electron/shell/navigationSecurity.cjs` | Pure allow/deny/open-external classification |
| `electron/shell/errors.cjs` | Safe error strings for renderer |
| `electron/shell/recovery.html` | Minimal desktop recovery page (Retry / Reload POS) |
| `src/lib/electronDesktop.ts` | Types `reloadApp` |
| `src/lib/desktopShellSecurity.test.ts` | Navigation + sanitize unit tests |
| `src/lib/remoteSupport/nativeSafety.test.ts` | Asserts shell hardening invariants |

---

## Behavior notes

### Single instance
One WAKA POS instance per Windows user session. Second launch focuses/restores the existing window.

### Navigation
In-window navigation allowed only for packaged `dist/index.html` and `electron/shell/recovery.html`.  
`http(s)` opens in the OS browser. `javascript:`, `data:`, other `file://`, etc. are denied.

### Renderer crash
`render-process-gone` → controlled recovery page. Does **not** clear IndexedDB, auth/session storage, or device identity. No restart loop of the whole app.

### POS-safe close
No automatic destructive restart. Offline persistence remains untouched on window close.

### Remote Support
Transport default remains **off**. No RustDesk packaging. Lab supervisor remains the only `child_process` site.

### Web / Mobile
No `android/` / `ios/` / Capacitor / routing semantic changes for non-Electron.

---

## Verification checklist

- [x] Security flags preserved (`contextIsolation` / `nodeIntegration: false` / `sandbox`)
- [x] No generic IPC; only named `waka:shell:reload-app` added
- [x] No production DevTools auto-open
- [x] Platform / nativeSafety / shell / transport / nativeBoundary tests (67 passed)
- [x] `npx tsc --noEmit` / `tsc -b` via builds
- [x] `npm run build:electron` OK
- [x] `npm run build` (web) OK
- [x] `npm run package:windows` OK → `release/win-build-20260816T231815/` + `release/windows-build/WAKA-POS-Portable-1.0.12.exe`
- [x] Remote Support transport default **off**

---

## Stop

Phase 3 complete. Phase 4 (hardware capabilities) is not started.
