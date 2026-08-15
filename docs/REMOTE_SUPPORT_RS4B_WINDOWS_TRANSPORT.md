# WAKA Remote Support — RS-4B Windows Transport (Lab Only)

**Date:** 2026-08-15  
**Status:** Native lab launch path implemented. **Not production.**  
**Windows/RustDesk end-to-end certification has NOT been performed.**

RS-4A added the transport abstraction. RS-4B makes `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` able to start and stop an allowlisted portable executable on a disposable Windows laptop. It does not enable production, does not install a service, and does not claim RustDesk works.

---

## Architecture

```text
WAKA Cloud
  → Remote Support Control Plane
  → Customer approval
  → Electron main (RS-2.1 native authorization)
  → Support Agent (in-process supervisor)
  → RustDesk adapter (lab only)
  → Process supervisor (only spawn site)
  → Allowlisted portable executable
```

The control plane remains authoritative. The executable is transport only.

React still cannot see:

- executable path
- command / arguments
- RustDesk ID / password
- hbbs / hbbr / key
- `grant_jti`

---

## Process boundary

| Layer | May spawn? |
|---|---|
| React / renderer | **No** |
| `electron/preload.cjs` | **No** |
| Support Agent | No (delegates) |
| `processSupervisor.cjs` | **Yes**, lab only, `shell: false`, argument array |
| Windows service / boot task | **No** |

There is no generic `execute(command)` IPC. Extra renderer IPC arguments are discarded.

---

## Feature flag

Native environment only. Not localStorage. Unknown values become `off`.

| Value | Behavior |
|---|---|
| `off` (default, production) | Disabled adapter. No launch. |
| `mock` | In-memory mock only. No executable. |
| `lab` | May launch after native WAKA authorization **and** allowlisted exe + pinned server. |

```text
WAKA_REMOTE_SUPPORT_TRANSPORT=off
```

---

## Native lab configuration

All of these are process-environment / native config. The renderer cannot set them through IPC.

| Variable | Required for launch | Purpose |
|---|---|---|
| `WAKA_REMOTE_SUPPORT_TRANSPORT=lab` | Yes | Selects the lab adapter |
| `WAKA_REMOTE_SUPPORT_LAB_DIR` | Yes | Absolute allowlisted directory |
| `WAKA_RUSTDESK_EXECUTABLE_PATH` | Recommended | Absolute path **inside** the lab dir, filename `rustdesk.exe` or `rustdesk` |
| `WAKA_RUSTDESK_ID_SERVER` | Yes | Isolated hbbs host. Public `rustdesk.com` hosts are rejected |
| `WAKA_RUSTDESK_RELAY_SERVER` | Yes (or defaults to ID server) | Isolated hbbr host |
| `WAKA_RUSTDESK_KEY` | Yes | Isolated server **public** key |

The supervisor also accepts default roots under Electron `userData/remote-support-lab` or `exeDir/remote-support-lab` when those paths exist. Tests inject filesystem and `spawn`.

---

## RustDesk executable requirements

- File exists
- Path is a file, not a directory
- Filename is `rustdesk.exe` or `rustdesk`
- Resolved path is inside an approved lab directory
- No `..` segments, no relative paths, no renderer-supplied path

Intended lab binary: portable **RustDesk 1.4.9** (the version researched in RS-3). Live Windows behavior is still untested.

---

## Locked options (documented for 1.4.9)

Passed as `--option <key> <value>` (no shell string):

```text
enable-file-transfer=N
enable-clipboard=N
enable-terminal=N
enable-tunnel=N
enable-audio=N
enable-camera=N
enable-record-session=N
enable-remote-restart=N
enable-block-input=N
enable-privacy-mode=N
enable-lan-discovery=N
verification-method=use-temporary-password
direct-server=N
custom-rendezvous-server=<isolated>
relay-server=<isolated>
key=<public key>
```

Never passed:

```text
--password
--install-service
--silent-install
```

### Unsupported (reported, not hidden)

| Requirement | Why |
|---|---|
| Remote shutdown disable | No first-class 1.4.9 setting |
| Credential lifecycle = WAKA grant | Temporary password is client-generated |
| `transport_active` from process start | Process up ≠ desktop session |

`credentialLifecycleUnsupported` and `credentialRotationUnsupported` are returned. Killing the process is the stop/cleanup mechanism. That is **not** production-ready credential control.

---

## Credential model

```text
WAKA grant          → authorization (server-side, never sent to RustDesk)
Temporary password  → transport secret inside the client process
```

WAKA does not mint, store, or log the RustDesk password. After End/Revoke the supervisor terminates the process. Source review (RS-3) says the in-memory temporary password dies with the process. A 30-second recent-session window exists in RustDesk source and is **unverified** on Windows.

Do not store transport secrets in Supabase, React, or `remote_support_sessions`.

---

## Server pinning

Lab start is refused unless ID server, relay, and key are set.

Public hosts containing `rustdesk.com` are rejected (`public_server_forbidden`).

If pinning cannot be guaranteed, lab transport must not start. That check is implemented. Live proof that a misconfigured client cannot fall back is **not** done (no Windows client run).

---

## Lifecycle

### Start

```text
Customer approves
  → WAKA session connecting/active
  → native authorization check (renderer state ignored)
  → allowlisted process starts
  → transport_starting → transport_ready
  → transport_active only if a connection probe proves a session
```

Default probe is **false**. Process start never becomes `active` by itself.

### Stop (customer End or admin Revoke)

```text
WAKA customer_end / admin_revoke
  → native authorization denied
  → disconnect
  → terminate process
  → credential cleanup attempt (reports unsupported)
  → transport stopped
  → agent exits
```

### Crash

```text
unexpected process exit → transport_failed
no automatic restart
new WAKA request + customer approval required for a new start
```

### Reboot

No service, no `--silent-install`, no boot task. After reboot the process is gone. POS launch does not start transport.

---

## Failure handling

| Condition | Result |
|---|---|
| Flag off / unknown | No launch |
| WAKA not connecting/active | No launch |
| Wrong device | No launch |
| Missing lab dir / exe | `executable_not_allowlisted` / `lab_dir_not_configured` |
| Missing or public server pin | Refuse start |
| Crash | `transport_failed`, no restart |
| Unknown transport state | Fail-closed stop |

---

## Security boundary

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- No `child_process` in preload or renderer
- No service-role key, no `grant_jti` in React or RustDesk
- Logs: session/device/status/error codes only. Process stdout/stderr sanitized; secrets dropped
- Device identity still comes from partition `waka-pos-device-id` (not hardware auth), then the control plane binds the inbox

---

## Windows lab instructions (manual, later)

Do this on disposable machines only. Not production POS.

1. Windows laptop `RS3-WINDOWS-TEST` with no customer data.
2. Isolated `hbbs`/`hbbr` **≥ 1.1.16** (not public RustDesk). Record the public key.
3. Place portable `rustdesk.exe` 1.4.9 in an absolute lab directory, e.g. `C:\WAKA\remote-support-lab\rustdesk.exe`.
4. Start WAKA POS Electron with:

```text
WAKA_REMOTE_SUPPORT_TRANSPORT=lab
WAKA_REMOTE_SUPPORT_LAB_DIR=C:\WAKA\remote-support-lab
WAKA_RUSTDESK_EXECUTABLE_PATH=C:\WAKA\remote-support-lab\rustdesk.exe
WAKA_RUSTDESK_ID_SERVER=<isolated-host>
WAKA_RUSTDESK_RELAY_SERVER=<isolated-host>
WAKA_RUSTDESK_KEY=<isolated-public-key>
```

5. Technician Mac uses the same isolated server. Do not use public rendezvous.
6. Create a **staging or fake** Remote Support request. Customer Allow. Confirm the portable process starts.
7. Confirm the banner does **not** say session active unless a real desktop session is proven.
8. Customer End: process must terminate. Reboot: process must not return.

This coding phase does **not** run that test.

---

## Unresolved RustDesk blockers

1. No live Windows UAC / reboot / NAT / feature-disable refuse tests.
2. No official API to force-disconnect a live desktop session (process kill is the lab mechanism).
3. Temporary password ≠ WAKA grant; 30s recent-session window untested.
4. `transport_active` has no proven connection detector yet.
5. Portable vs service UAC tension unresolved.
6. AGPL / signing / Server Pro not decided.
7. Option application on portable 1.4.9 is documented, not live-verified.

---

## Safety confirmation

```text
Production database modified: NO
Production migrations modified: NO
Production code deployed: NO
Production transport enabled: NO
Production installer modified: NO
RustDesk installed on production POS: NO
Permanent RustDesk password: NO
Permanent Windows RustDesk service: NO
Unattended access: NO
Production remote session: NO
Windows certification: NOT PERFORMED
RS-4 production deployment: NO
```
