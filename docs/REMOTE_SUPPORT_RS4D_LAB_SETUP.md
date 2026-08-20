# WAKA POS — RS-4D Lab Setup Preparation

**Date:** 2026-08-20  
**Status:** Preparation only. Default transport remains **off**. Production transport is **not** enabled.  
**Does not claim:** a live WAKA-controlled RustDesk session has been certified.

Use this document on an isolated lab laptop. Do not set these variables on a customer POS.

Related:

- RS-4B: `docs/REMOTE_SUPPORT_RS4B_WINDOWS_TRANSPORT.md`
- RS-4C: `docs/REMOTE_SUPPORT_RS4C_WINDOWS_CERTIFICATION.md` (NO-GO for live Windows/RustDesk)
- Artifact: `docs/REMOTE_SUPPORT_WINDOWS_LAB_BUILD.md`

---

## 1. Implementation verification (no code change to transport default)

Verified in this repo on 2026-08-20:

| Check | Result |
|---|---|
| Flag reader | `electron/remoteSupport/transportFlag.cjs` — default `off`; allowed `off` \| `mock` \| `lab` |
| Lab adapter | `electron/remoteSupport/rustdeskAdapter.cjs` selected only when flag is `lab` |
| Factory | `electron/remoteSupport/transportFactory.cjs` |
| Allowlist | `electron/remoteSupport/processAllowlist.cjs` — filename `rustdesk.exe` or `rustdesk` |
| Isolated pin | `electron/remoteSupport/labConfig.cjs` — rejects `rustdesk.com` family |
| IPC | `electron/remoteSupport/ipcHandlers.cjs` — no renderer path/password; **does not pass `appPaths`** |
| Packaged EXE | `release/windows-build/WAKA-POS-Portable-1.0.12.exe` asar contains RS-4B adapter; **does not** contain `rustdesk.exe` |
| Unit tests | `rs4bTransport.test.ts` + `transport.test.ts` + `nativeBoundary.test.ts` — **49/49 pass** |

`ipcHandlers.cjs` constructs the Support Agent without `appPaths`. Therefore **`WAKA_REMOTE_SUPPORT_LAB_DIR` is required**. A folder next to the POS EXE is ignored unless that env var points at it.

Double-clicking the portable EXE with no lab env keeps transport **off**. RustDesk must not start from POS login or heartbeat.

---

## 2. Windows lab layout

```text
C:\WAKA\
  WAKA-POS-Portable-1.0.12.exe
  remote-support-lab\                 ← WAKA_REMOTE_SUPPORT_LAB_DIR
    rustdesk.exe                      ← portable 1.4.9, not a Windows service
    waka-lab.env                      ← copied from scripts/lab/remote-support-lab.env.example
```

Do not install a RustDesk Windows service. Do not set a permanent password. Do not use public `rustdesk.com`.

---

## 3. Environment variable template

Committed template (placeholders only):

`scripts/lab/remote-support-lab.env.example`

On the laptop:

```bat
copy scripts\lab\remote-support-lab.env.example C:\WAKA\remote-support-lab\waka-lab.env
notepad C:\WAKA\remote-support-lab\waka-lab.env
```

Required keys (Electron **process** env, not Vite):

| Variable | Example |
|---|---|
| `WAKA_REMOTE_SUPPORT_TRANSPORT` | `lab` |
| `WAKA_REMOTE_SUPPORT_LAB_DIR` | `C:\WAKA\remote-support-lab` |
| `WAKA_RUSTDESK_EXECUTABLE_PATH` | `C:\WAKA\remote-support-lab\rustdesk.exe` |
| `WAKA_RUSTDESK_ID_SERVER` | isolated hbbs host |
| `WAKA_RUSTDESK_RELAY_SERVER` | isolated hbbr host |
| `WAKA_RUSTDESK_KEY` | isolated server **public** key (≥ 16 chars) |

Filled copies are gitignored (`scripts/lab/remote-support-lab.env`). Never put these in `.env.production.local`.

Slice A: pin ID/relay/public key in the **Windows process** env only. Do not put them in React, Vite, or the Remote Assistance card. Production EXE default remains `off`.

---

## 4. Windows launch

Do **not** double-click the EXE for a lab transport test. Use the launcher so env is applied to that process only:

```powershell
cd <repo-or-copied-scripts>\scripts\lab
.\launch-waka-pos-lab.ps1 `
  -PosExe "C:\WAKA\WAKA-POS-Portable-1.0.12.exe" `
  -EnvFile "C:\WAKA\remote-support-lab\waka-lab.env"
```

CMD:

```bat
scripts\lab\launch-waka-pos-lab.cmd "C:\WAKA\WAKA-POS-Portable-1.0.12.exe" "C:\WAKA\remote-support-lab\waka-lab.env"
```

The launcher **refuses** to start if transport is not `lab`, if `rustdesk.exe` is missing, if the path is outside the lab dir, if the key is still a placeholder, or if the ID/relay host is public RustDesk.

---

## 5. RustDesk executable allowlist (code)

`resolveLabExecutable`:

1. Lab roots = `WAKA_REMOTE_SUPPORT_LAB_DIR` only in the packaged app (`appPaths` unused).
2. Path must be absolute, no `..`, no NUL.
3. File must exist, be a file, basename `rustdesk.exe` or `rustdesk`.
4. Symlinks/junctions are rejected (`executable_symlink_rejected`).
5. `realpath` of the file must stay **inside** the real lab root (`executable_path_rejected` on escape).
6. Renderer `command` / `path` / `password` are ignored.

Errors: `lab_dir_not_configured`, `executable_path_rejected`, `executable_symlink_rejected`, `executable_not_allowlisted`.

Isolated server pin errors: `server_pin_required`, `public_server_forbidden`, `unknown_host_forbidden`, `server_key_invalid`.

The public key is written to `remote-support-lab/appdata/RustDesk/config/RustDesk2.toml` (mode 0600) and is **not** passed on process argv or child env. ID/relay hosts must be the configured lab server (IPv4 or DNS, optional port). Public `rustdesk.com` and URL/path hosts are rejected.

Main-process watchdog re-checks WAKA `remote_support_session` authorization about every 15s and stops RustDesk on expire/revoke. `before-quit` and window destroy stop the transport and kill the spawned process.

Process start → `transport_ready`, **not** `transport_active`. That is not proof of a live desktop session.

---

## 6. Device eligibility (Connect Remotely)

`evaluateRemoteSupportEligibility` + `shop_devices` (no second registry).

Must all be true:

| Field | Required |
|---|---|
| `platform` | `windows` (Electron heartbeat uses `presencePlatform()` → `windows`) |
| `is_active` | true |
| `status` | `active` (or empty); `revoked` is blocked |
| `approval_status` | `approved` if set |
| `last_seen_at` | within **15 minutes** (`REMOTE_SUPPORT_ONLINE_MS`) |
| Ticket fingerprint | same as this POS `waka-pos-device-id` |

Web / browser POS is `web` → **ineligible**. Keep the Windows portable app signed in and in the foreground so heartbeat stays fresh.

Native start still requires control-plane inbox session `connecting` or `active` after customer Allow. A pending request does not spawn RustDesk.

---

## 7. Operator checklist

### A. Isolated RustDesk server (shared)

- [ ] Lab-only hbbs/hbbr (not `rustdesk.com`)
- [ ] Ports reachable from Windows POS and Mac technician on the lab network only
- [ ] Public key recorded; private key **not** in POS env
- [ ] Manual Mac ↔ Windows RustDesk on **this isolated server** already proven (optional smoke; public-cloud smoke is not WAKA lab)

### B. Windows POS setup

- [ ] Disposable laptop, no customer data
- [ ] Copy `WAKA-POS-Portable-1.0.12.exe`
- [ ] Create `C:\WAKA\remote-support-lab\`
- [ ] Place portable **RustDesk 1.4.9** as `C:\WAKA\remote-support-lab\rustdesk.exe`
- [ ] Copy env example → `waka-lab.env` and fill isolated host/key
- [ ] Sanity: launch POS **without** lab env → Task Manager must **not** show `rustdesk.exe`
- [ ] Lab launch via `launch-waka-pos-lab.ps1`
- [ ] Sign in (prefer **staging** shop; production EXE talks to `ljaedextsenbkxzzgxcg`)
- [ ] Confirm Devices: this PC is `windows`, **approved**, heartbeat recent
- [ ] Optional: send Need Help so Admin has a ticket bound to this device fingerprint

### C. Mac technician setup

- [ ] Same isolated hbbs/hbbr/key as Windows
- [ ] RustDesk client pinned to that server (not public)
- [ ] WAKA Internal Admin in the browser/app for the **same** environment as the POS (staging vs production)
- [ ] WAKA does **not** auto-connect the Mac client; you will enter the Windows RustDesk ID after spawn

### D. WAKA Admin flow

- [ ] Open Admin Support Inbox
- [ ] Select the shop/ticket whose `device_fingerprint` is this Windows POS
- [ ] Confirm Connect Remotely is enabled (not “unsupported platform” / stale heartbeat)
- [ ] Click **Connect Remotely** and submit a reason
- [ ] Wait for Windows **Allow** (do not skip)
- [ ] After Allow, watch Task Manager for `rustdesk.exe` (lab env only)
- [ ] If Allow succeeds but RustDesk does not start: check lab env, allowlist path, public-server reject, inbox session status

### E. RustDesk flow (after WAKA spawn)

- [ ] Windows: `rustdesk.exe` running; note the ID / temporary password (WAKA does not map `grant_jti` to this)
- [ ] Mac: connect to that ID on the **isolated** server
- [ ] Confirm screen (and, if in scope, input)
- [ ] Customer **End** on POS → native `stopTransport` should stop the process
- [ ] Optional: Admin revoke → transport must stop; no silent restart
- [ ] Record: spawn = `transport_ready`; live desktop is a separate observation

---

## 8. What this preparation does not do

- Does not set default `WAKA_REMOTE_SUPPORT_TRANSPORT=lab`
- Does not apply migrations
- Does not change production schema
- Does not package `rustdesk.exe`
- Does not certify UAC, NAT, reboot, or production Remote Support
- Does not start RS-5

When the checklist is executed at the machines, record evidence in a follow-up RS-4D certification note. Until then, RS-4C live verdict remains **NO-GO**.
