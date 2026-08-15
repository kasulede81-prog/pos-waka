# WAKA POS — Windows Desktop Lab Build (RS-4C artifact)

**Date:** 2026-08-15  
**Status:** Lab portable EXE produced on macOS. **Not production.**  
**Windows/RustDesk end-to-end certification has NOT yet been performed.**

This document describes the existing Windows packaging workflow and how to run the resulting portable EXE on an isolated laboratory laptop. It does not enable production transport, does not package RustDesk, and does not change the Remote Support authorization model.

Do not start RS-5 from this artifact.

---

## Build command

Use the repository’s existing portable Windows workflow. Do not invent a new installer.

```bash
npm run package:windows
```

That runs:

1. `npm run build:windows`
   - `scripts/build-electron-dist.mjs` → `tsc -b` then `vite build --mode production` with `ELECTRON=1`
   - `npm run windows:icon`
2. `node scripts/run-windows-installer.mjs portable`
   - `npx electron-builder --win portable --x64`

Existing NSIS installer (not used for this lab artifact):

```bash
npm run installer:windows
```

NSIS output name: `WAKA-POS-Setup-${version}.exe`. Installer architecture was not changed.

---

## Windows architecture

| Item | Value |
|---|---|
| Target | `win32` |
| Arch | **x64** |
| electron-builder target | **portable** |
| Electron | 37.10.3 (packaged) |
| App version | 1.0.12 |
| Product name | WAKA POS |

This Mac host can produce the Windows x64 artifact. It cannot execute `WAKA POS.exe`. Windows launch was **not** verified here.

---

## Artifact

Preferred published copy (use this on the laptop):

| Field | Value |
|---|---|
| Filename | `WAKA-POS-Portable-1.0.12.exe` |
| Path | `release/windows-build/WAKA-POS-Portable-1.0.12.exe` |
| Size | 136,004,232 bytes (≈ 129.7 MiB) |
| Build type | electron-builder portable |
| Architecture | x64 |
| Portable or installer | **Portable** (not NSIS) |

Stamped build directory from this run:

```text
release/win-build-20260815T151038/WAKA-POS-Portable-1.0.12.exe
release/win-build-20260815T151038/win-unpacked/WAKA POS.exe
```

`win-unpacked/` is the unpacked Electron tree used to build the portable EXE. Copy the **portable** file to the lab laptop.

RustDesk is **not** inside either tree.

---

## Installation on the Windows lab laptop

1. Copy `WAKA-POS-Portable-1.0.12.exe` to the disposable Windows laptop.
2. Do **not** install this build on a production POS.
3. Double-click the portable EXE. No NSIS install is required.
4. First launch unpacks the Electron app in the portable runtime. That is normal for electron-builder portable.
5. Do **not** place `rustdesk.exe` next to the POS EXE and expect it to start. Transport stays off unless native lab environment variables are set (below).

The Windows POS continues to use the existing WAKA device identity (`waka-pos-device-id` / `shop_devices`). This build does not create another device registry.

---

## Production / default transport: OFF

The packaged native flag reader is `electron/remoteSupport/transportFlag.cjs`:

```text
WAKA_REMOTE_SUPPORT_TRANSPORT  default = off
unknown values                 → off
allowed values                 off | mock | lab
```

This value is read from the **OS process environment** of Electron main. It is:

- not a Vite / `import.meta.env` variable
- not stored in `localStorage`
- not settable from React
- not exposed as a generic IPC setter
- not baked to `lab` in this EXE

### How to verify transport is OFF by default

On the Windows laptop, launch the portable EXE **without** setting any `WAKA_REMOTE_SUPPORT_*` or `WAKA_RUSTDESK_*` variables.

Expected:

- Native mode is `off`
- Support Agent does not spawn a process
- Task Manager must not show `rustdesk.exe` merely because WAKA POS opened
- Opening a shop, logging in, or sending a device heartbeat must not start RustDesk

Transport starts only after **all** of:

1. WAKA control-plane authorization (native inbox check; renderer proof is ignored)
2. explicit `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` on the OS process
3. native allowlist + isolated server pin

This Mac build step did **not** run that Windows check.

---

## Lab configuration (native / OS-level only)

React must not control these values. Do not put them in Vite env files. Do not put credentials in the EXE.

Set them on the Windows process that launches WAKA POS.

### Required for lab launch

| Variable | Example | Purpose |
|---|---|---|
| `WAKA_REMOTE_SUPPORT_TRANSPORT` | `lab` | Selects the lab adapter. Default is `off`. |
| `WAKA_REMOTE_SUPPORT_LAB_DIR` | `C:\WAKA\remote-support-lab` | Absolute allowlisted directory. No `..`. |
| `WAKA_RUSTDESK_EXECUTABLE_PATH` | `C:\WAKA\remote-support-lab\rustdesk.exe` | Absolute path **inside** the lab dir. Filename must be `rustdesk.exe` or `rustdesk`. |
| `WAKA_RUSTDESK_ID_SERVER` | isolated hbbs host | Public `rustdesk.com` hosts are rejected. |
| `WAKA_RUSTDESK_RELAY_SERVER` | isolated hbbr host | Defaults to the ID server if omitted; still must not be public. |
| `WAKA_RUSTDESK_KEY` | isolated server **public** key | Required. Do not put a private server key in the POS environment. |

The current packaged Support Agent does **not** pass Electron `userData` / `exeDir` fallbacks. For this lab EXE, set `WAKA_REMOTE_SUPPORT_LAB_DIR` explicitly. Do not rely on a folder next to the portable EXE unless that env var points at it.

### CMD (session only)

```bat
set WAKA_REMOTE_SUPPORT_TRANSPORT=lab
set WAKA_REMOTE_SUPPORT_LAB_DIR=C:\WAKA\remote-support-lab
set WAKA_RUSTDESK_EXECUTABLE_PATH=C:\WAKA\remote-support-lab\rustdesk.exe
set WAKA_RUSTDESK_ID_SERVER=<isolated-host>
set WAKA_RUSTDESK_RELAY_SERVER=<isolated-host>
set WAKA_RUSTDESK_KEY=<isolated-public-key>
WAKA-POS-Portable-1.0.12.exe
```

### PowerShell (session only)

```powershell
$env:WAKA_REMOTE_SUPPORT_TRANSPORT = "lab"
$env:WAKA_REMOTE_SUPPORT_LAB_DIR = "C:\WAKA\remote-support-lab"
$env:WAKA_RUSTDESK_EXECUTABLE_PATH = "C:\WAKA\remote-support-lab\rustdesk.exe"
$env:WAKA_RUSTDESK_ID_SERVER = "<isolated-host>"
$env:WAKA_RUSTDESK_RELAY_SERVER = "<isolated-host>"
$env:WAKA_RUSTDESK_KEY = "<isolated-public-key>"
Start-Process ".\WAKA-POS-Portable-1.0.12.exe"
```

User-level Windows environment variables (System Properties → Environment Variables) also work, because Electron main reads `process.env`. Do not set these on a production POS.

---

## RustDesk lab directory

RustDesk is **not** packaged and was **not** installed by this build.

Expected laboratory layout (matches RS-4B allowlist):

```text
WAKA-POS-Portable-1.0.12.exe     ← this artifact (transport off by default)

C:\WAKA\remote-support-lab\      ← WAKA_REMOTE_SUPPORT_LAB_DIR
└── rustdesk.exe                 ← provided separately by the lab
```

Place a portable RustDesk 1.4.9 binary yourself. Do not install a Windows RustDesk service. Do not set a permanent password. Do not use public `rustdesk.com` rendezvous.

---

## How to launch LAB mode

1. Isolated Windows laptop only. No customer data.
2. Isolated `hbbs` / `hbbr` (not public RustDesk). Record the **public** key.
3. Create `C:\WAKA\remote-support-lab\rustdesk.exe`.
4. Start the portable EXE with the native environment variables above.
5. Sign in to the intended WAKA shop on that device.
6. Create a **staging or fake** Remote Support request. Customer Allow.
7. Only then may the native layer attempt to start the allowlisted process.

Process start is `transport_ready`, not proof of a live desktop session.

**Windows/RustDesk end-to-end certification has NOT yet been performed.**

---

## Electron security (packaged)

Inspected in the packaged `app.asar`:

```text
contextIsolation = true
nodeIntegration  = false
sandbox          = true
```

Packaged `electron/preload.cjs` exposes only:

- `wakaDesktop.platform`
- `wakaDesktop.print`
- `wakaDesktop.getPrinterDiagnostics`
- `wakaDesktop.remoteSupport.getStatus`
- `wakaDesktop.remoteSupport.endSession`
- `wakaDesktop.remoteSupport.requestAuthorizationCheck`
- `wakaDesktop.remoteSupport.startAuthorizedTransport`
- `wakaDesktop.remoteSupport.stopTransport`
- `wakaDesktop.remoteSupport.getTransportStatus`

It does **not** expose `ipcRenderer`, `require`, `child_process`, `fs`, generic command execution, or generic process spawning.

IPC start/stop handlers discard extra renderer arguments.

---

## Static inspection of this artifact

Scanned `app.asar` and the unpacked tree.

| Check | Result |
|---|---|
| Supabase service-role key | **Not present.** `service_role` hits are supabase-js documentation strings. |
| RustDesk permanent password | **Not present.** |
| Refresh token secret | **Not present.** Hits are supabase-js docs / field names. |
| `grant_jti` secret | **Not present.** Hits are field names, comments, and log redaction. |
| Private RustDesk server key | **Not present.** |
| Hard-coded `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` | **Not present.** Default remains `off`. |
| Public RustDesk server fallback | **Not present.** `rustdesk.com` appears only as a **reject** list. |
| `rustdesk.exe` packaged | **No.** |

The production Vite client still embeds the existing **public anon** Supabase JWT (`role=anon`). That is the normal POS client key, not a service-role key and not a Remote Support grant.

---

## Security limitations

- This is a **lab build** of the existing Windows desktop app. Treat the laptop as disposable.
- Transport off-by-default was verified in packaged source and static scan, not by running Windows.
- Lab mode still cannot make `transport_active` from process start alone.
- Customer End / Admin Revoke / UAC / NAT / reboot / mouse / keyboard were **not** tested.
- Do not enable these environment variables on production POS machines.
- Do not deploy this as a production remote-support release.

---

## What this build does not claim

The following require the physical Windows laboratory and are **not** claimed:

- RustDesk works
- remote desktop works
- mouse or keyboard control works
- UAC works
- NAT works
- Customer End disconnects RustDesk
- Admin Revoke disconnects RustDesk
- reboot security works

---

## Safety confirmation

```text
Build command:                 npm run package:windows
Artifact:                      release/windows-build/WAKA-POS-Portable-1.0.12.exe
Build result:                  PASS (artifact produced on macOS)
TypeScript:                    PASS (tsc --noEmit and tsc -b)
Electron security:             PASS (packaged main/preload inspected)
Production transport:          OFF
RustDesk included:             NO
RustDesk installed:            NO
Windows end-to-end test:       NOT PERFORMED
Production modified:           NO
Migrations modified:           NO
RS-5 started:                  NO
Windows/RustDesk certification: NOT YET PERFORMED
```
