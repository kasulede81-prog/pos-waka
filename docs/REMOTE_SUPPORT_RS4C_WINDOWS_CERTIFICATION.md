# WAKA Remote Support — RS-4C Windows + RustDesk Lab Certification

**Date:** 2026-08-15  
**Phase:** Lab certification (not production)  
**Windows/RustDesk end-to-end certification has NOT been performed.**

```text
RS-4C VERDICT:
NO-GO
```

This agent ran on a Mac (`MacBook-Pro-de-admin.local`, macOS 26.5.1, arm64). The physical Windows laptop was **not reachable**. Isolated hbbs/hbbr was **not running**. No RustDesk client was installed on this Mac. Live phases 2–21 were **not executed** and are not invented.

Production was not used.

---

## Phase 1 — Environment discovery (no code changes)

### 1. Windows Electron build

| Script | What it does |
|---|---|
| `npm run build:electron` | `scripts/build-electron-dist.mjs`: `tsc -b` then `vite build --mode production` with `ELECTRON=1` (relative `base=./` for `file://`) |
| `npm run build:windows` | Electron dist + `windows:icon` |
| `npm run package:windows` | electron-builder **portable** x64 → `release/win-build-*` then `release/windows-build` |
| `npm run installer:windows` | electron-builder **NSIS** x64 |

`package.json` `build.files` includes `dist/**/*` and `electron/**/*`. Main is `electron/main.cjs`. This Mac cannot run the resulting `WAKA POS.exe`.

### 2. How `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` is injected

Read at **Electron main runtime** from `process.env` in `electron/remoteSupport/transportFlag.cjs`.

- Default / unknown → `off`
- Allowed: `off` \| `mock` \| `lab`
- **Not** in Vite `.env.staging.example`
- **Not** baked into the installer
- **Not** settable from React / localStorage

A packaged Windows app stays `off` unless the **Windows process** is started with the env var (shortcut, `cmd`, or a lab launcher). Production default remains off.

### 3. Where `WAKA_REMOTE_SUPPORT_LAB_DIR` is configured

`electron/remoteSupport/processAllowlist.cjs`:

- `WAKA_REMOTE_SUPPORT_LAB_DIR` — absolute path, no `..`
- Documented fallbacks: `{userData}/remote-support-lab`, `{exeDir}/remote-support-lab`

**Gap:** `ipcHandlers.cjs` constructs the Support Agent **without** `appPaths`. In the real app those fallbacks are unused. Lab launch requires `WAKA_REMOTE_SUPPORT_LAB_DIR` (and usually `WAKA_RUSTDESK_EXECUTABLE_PATH`) in the Windows environment.

### 4. How the RustDesk executable is supplied

- Filename must be `rustdesk.exe` or `rustdesk`
- Path must be a file inside an allowlisted lab directory
- `WAKA_RUSTDESK_EXECUTABLE_PATH` recommended
- Renderer `path` / `command` / `executable` are ignored
- RS-4B selected portable **1.4.9**
- No copy of `rustdesk.exe` exists in this repo or on this Mac

### 5. Control-plane staging state

| Item | Value |
|---|---|
| Staging project | `wdirxwvbgsfzbdurmkbf` |
| Production project | `ljaedextsenbkxzzgxcg` (allowlisted, **not used**) |
| Staging cert script | `scripts/staging/rs12_staging_rpc_cert.py` (RS-1.2, 29/29 previously) |
| Staging env file | `.local/waka-pos-staging.env` (not read this phase) |
| Migrations 151/152 | Unchanged this phase |

No throwaway shop or POS A/B devices were created in this phase.

### 6. Device platform detection

`src/lib/shopPresence.ts` `presencePlatform()`:

- Capacitor native → Capacitor platform
- `isElectronDesktop()` (Electron user-agent) → **`windows`**
- else `web`

Heartbeat uses `shop_device_heartbeat` with that platform. Remote Support eligibility requires `windows`.

### 7. Native authorization path

```text
Renderer requestAuthorizationCheck()  (no args)
  → Electron reads partition localStorage (device id + sb-<ref>-auth-token)
  → allowlisted URL only (prod or staging)
  → POST remote_support_customer_inbox
  → authorized only if session status is connecting or active
```

Renderer `authorized=true` is ignored. `grant_jti` is not exposed.

### 8. Process supervisor

`electron/remoteSupport/processSupervisor.cjs` is the **only** spawn site. `shell: false`, argument array. Crash → `transport_failed`, no auto-restart. Not a Windows service.

### 9. Transport adapter

`rustdeskAdapter.cjs` in lab mode:

- Requires allowlisted exe + pinned isolated server + key
- Rejects `rustdesk.com` hosts
- Never `--password` / `--install-service` / `--silent-install`
- Process up → `transport_ready`, **not** `transport_active`

### 10. Electron IPC

| Channel | Method |
|---|---|
| `waka:remote-support:get-status` | `getStatus` |
| `waka:remote-support:authorization-check` | `requestAuthorizationCheck` |
| `waka:remote-support:start-transport` | `startAuthorizedTransport` |
| `waka:remote-support:stop-transport` | `stopTransport` |
| `waka:remote-support:get-transport-status` | `getTransportStatus` |
| `waka:remote-support:end` | `endSession` / stop |

Extra IPC payloads are discarded. Preload does not expose `spawn`, RustDesk, or credentials.

---

## Why live certification stopped

| Required asset | Status from this agent |
|---|---|
| Physical Windows laptop `RS3-WINDOWS-TEST` | **Unreachable** (`ping` unknown host; LAN `172.20.10.0/28` shows only this Mac + gateway) |
| Isolated hbbs/hbbr | **Not running** (Docker engine empty / no lab containers) |
| RustDesk 1.4.9 portable on Windows | **Not present** |
| RustDesk technician client on this Mac | **Not installed** |
| SSH / RDP / agent on the laptop | **None** |
| Lab env vars on this host | **Unset** |

Phase 3 rule: if a lab server is unavailable, **STOP**. Public RustDesk was not substituted.

This Cursor session cannot click Allow on a cashier screen, move a Windows mouse, or reboot the laptop. Inventing PASS rows would be a false certification.

---

## Exact requirements to finish RS-4C on the laptop

Operator actions (human + this checklist), isolated only:

1. Disposable Windows laptop on a network this Mac can reach (or run the tests while seated at both machines).
2. Isolated Linux/Docker `hbbs`/`hbbr` **≥ 1.1.16**, ports 21115–21117 on the lab host only, public key recorded. **No** `rustdesk.com`.
3. Portable `rustdesk.exe` **1.4.9** in e.g. `C:\WAKA\remote-support-lab\`.
4. Staging WAKA build on the laptop (`wdirxwvbgsfzbdurmkbf`), throwaway shop, two enrolled Windows devices (A and B).
5. Launch WAKA POS with:

```text
WAKA_REMOTE_SUPPORT_TRANSPORT=lab
WAKA_REMOTE_SUPPORT_LAB_DIR=C:\WAKA\remote-support-lab
WAKA_RUSTDESK_EXECUTABLE_PATH=C:\WAKA\remote-support-lab\rustdesk.exe
WAKA_RUSTDESK_ID_SERVER=<isolated-host>
WAKA_RUSTDESK_RELAY_SERVER=<isolated-host>
WAKA_RUSTDESK_KEY=<isolated-public-key>
```

6. Technician Mac: same isolated server, no public rendezvous.
7. Execute phases 6–21 at the keyboard. Record the table below with **actual** evidence.

Until that happens, RS-4C remains **NO-GO**.

---

## Machine / environment (this run)

| Field | Value |
|---|---|
| Agent host | macOS 26.5.1 arm64 |
| LAN | `172.20.10.4/28` |
| Windows laptop | Not discovered |
| RustDesk client version | Not installed |
| RustDesk server version | Not running |
| Network test | Not run |
| WAKA project used | **None** (no staging session created) |

---

## Configuration that would be used (not applied)

See RS-4B. Default production flag remains `off`. No installer change. No service. No permanent password.

---

## Certification table

All live rows are **NOT EXECUTED**. That is a fail for certification, not a skip-as-pass.

| Test | Expected | Actual | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 1. Windows registration | POS A/B windows + approved | Not run | **FAIL** | No laptop |
| 2. Request | REQUESTED + dialog on A | Not run | **FAIL** | No laptop |
| 3. No approval | Transport DENIED, process down | Not run | **FAIL** | No laptop |
| 4. Customer approval | WAKA connecting, native authorized | Not run | **FAIL** | No laptop |
| 5. RustDesk start | Process starts after approve | Not run | **FAIL** | No laptop |
| 6. Desktop connection | Screen visible | Not run | **FAIL** | No laptop |
| 7. Mouse | Moves / clicks | Not run | **FAIL** | No laptop |
| 8. Keyboard | Types | Not run | **FAIL** | No laptop |
| 9. Customer visibility | Cashier sees activity, no privacy mode | Not run | **FAIL** | No laptop |
| 10. File transfer blocked | DENIED both ways | Not run | **FAIL** | No laptop |
| 11. Clipboard blocked | DENIED both ways | Not run | **FAIL** | No laptop |
| 12. Terminal blocked | DENIED | Not run | **FAIL** | No laptop |
| 13. Tunnel blocked | DENIED | Not run | **FAIL** | No laptop |
| 14. Remote restart blocked | DENIED | Not run | **FAIL** | No laptop |
| 15. Customer End | Live desktop disconnects | Not run | **FAIL** | No laptop |
| 16. Old credential reuse | DENIED | Not run | **FAIL** | No laptop |
| 17. Admin Revoke | Live desktop disconnects | Not run | **FAIL** | No laptop |
| 18. Wrong device | POS B denied, no process | Not run | **FAIL** | No laptop |
| 19. Expired authorization | DENIED | Not run | **FAIL** | No laptop |
| 20. Windows reboot | No unattended access | Not run | **FAIL** | No laptop |
| 21. UAC | Recorded, no permanent service | Not run | **FAIL** | No laptop |
| 22. Same-LAN | Documented | Not run | **FAIL** | No laptop |
| 23. NAT/relay | Documented | Not run | **FAIL** | No laptop |
| 24. RustDesk crash | `transport_failed`, no restart | Not run | **FAIL** | No laptop |
| 25. No public-server fallback | Pinned lab only | Not run | **FAIL** | No laptop |
| 26. No permanent password | None | Not run | **FAIL** | No laptop |
| 27. No Windows service | None | Not run | **FAIL** | No laptop |
| 28. No boot persistence | None | Not run | **FAIL** | No laptop |

Unit tests from RS-4B (mock/lab supervisor, no live desktop) are **not** a substitute for this table.

---

## Security findings

1. **Certification cannot be claimed** without the laptop and isolated server.
2. Packaged Windows app will not enter lab mode unless process env is set (good for production default `off`; lab must be launched explicitly).
3. `appPaths` fallbacks are not wired in `ipcHandlers` — lab dir env is mandatory on the real POS.
4. `transport_active` still has no proven connection detector (RS-4B).
5. Old-credential reuse after End remains the critical untested security question.

---

## UAC findings

**NOT TESTED.** Do not install a permanent service to “make UAC work.” If a later seated lab shows UAC needs a service, mark `UAC_REQUIRES_SERVICE` and keep unattended access forbidden.

---

## Credential lifecycle

Documented (RS-3/RS-4B), **not live-verified**: temporary password is client-generated; process kill is the stop mechanism; 30s recent-session window exists in source.

---

## Disconnect behavior

Customer End and Admin Revoke are implemented in control plane + native stop. **Actual desktop disconnection was not observed.**

---

## Final verdict

```text
NO-GO
```

GO requires a seated lab that proves remote desktop, required approval, real End/Revoke disconnect, no leftover credentials, no unattended access, no public fallback, disabled dangerous features, wrong-device deny, and reboot deny. None of those were run.

RS-5 / production deployment was **not** started.

---

## Safety confirmation

```text
Production database modified: NO
Production code deployed: NO
Production transport enabled: NO
Production POS accessed: NO
Production RustDesk session: NO
Permanent RustDesk password: NO
Windows RustDesk service: NO
Unattended access: NO
```
