# WAKA Remote Support — RS-3.1 Isolated Windows + RustDesk Transport Lab

**Date:** 2026-08-15  
**Parent:** [RS-3 spike](./REMOTE_SUPPORT_RS3_RUSTDESK_SPIKE.md)  
**RS-4:** **Not started.**  
**Final decision:**

```text
NO-GO TO RS-4
```

This phase was required to close RS-3’s empirical blockers on a disposable Windows machine. That machine does not exist in this environment. An isolated localhost-only OSS server was stood up and torn down. No Windows desktop session was created. The mandatory transport proofs therefore remain open.

Do not read this as a production go-ahead.

| Tag | Meaning |
|---|---|
| **LIVE** | Executed in this lab on 2026-08-15 |
| **DOC** | Official RustDesk documentation |
| **SRC** | Public rustdesk / rustdesk-server source |
| **UNTESTED** | Required by RS-3.1; not executed |
| **BLOCKED** | Could not run because the required machine was missing |

---

## 1. Environment

### What was required

| Role | Required name | Present? |
|---|---|---|
| Disposable Windows POS stand-in | `RS3-WINDOWS-TEST` | **No** |
| Disposable Linux RustDesk server | `RS3-RUSTDESK-SERVER` | **Substituted** — Docker Linux VM on this Mac, localhost-only |
| Separate technician PC | technician/test computer | **No** — same Mac; RustDesk client not installed |

### Host used for the server substitute

| Field | Value |
|---|---|
| Machine | MacBook Pro (`MacBook-Pro-de-admin.local`) |
| OS | macOS 26.5.1 (build 25F80) |
| Architecture | arm64 |
| Display | 2560 × 1600 Retina |
| Observed LAN address | `172.20.10.4/28` |
| UAC | Not applicable (not Windows) |
| Logged-in account | `admin` (local administrator group) |
| Hypervisors | None (no UTM, Parallels, VMware, VirtualBox, or Windows VM) |
| Docker Desktop | 4.83.0; engine **29.6.2** linux/arm64 |
| RustDesk client on this Mac | **Not installed** |
| Customer data on this host | Not a POS; no shop session created |

### Windows (`RS3-WINDOWS-TEST`)

| Field | Value |
|---|---|
| Windows edition | **BLOCKED — VM does not exist** |
| Windows version / build | **BLOCKED** |
| x64 / x86 | **BLOCKED** |
| UAC configuration | **BLOCKED** |
| Logged-in account | **BLOCKED** |
| Administrator privileges | **BLOCKED** |
| Display resolution | **BLOCKED** |
| Network type | **BLOCKED** |

### Linux server (Docker substitute for `RS3-RUSTDESK-SERVER`)

| Field | Value |
|---|---|
| Distribution | Docker Desktop Linux VM (`OS=linux`, `Arch=arm64`) |
| Installation method | Official image `rustdesk/rustdesk-server:1.1.16` |
| Public IP | **None published.** Host bind was `127.0.0.1` only |
| Firewall | Host publish restricted to loopback; LAN `172.20.10.4` ports closed |
| Native Linux VPS | **Not used** |

### Technician machine

| Field | Value |
|---|---|
| OS | Same macOS host |
| RustDesk version | **Not installed — no technician client session** |

---

## 2. Exact versions

| Component | Version | Evidence |
|---|---|---|
| RustDesk Server OSS image | `rustdesk/rustdesk-server:1.1.16` | `docker pull` **LIVE** |
| Image digest | `sha256:8ecdab65deb7c84652a626380e31d11a8f1fbafd97916d57f95c20628f943c00` | **LIVE** |
| Image created | 2026-07-20T22:35:15Z | **LIVE** inspect |
| Image arch | linux/arm64, 5.46 MB | **LIVE** |
| hbbs / hbbr release notes | 1.1.16 (2026-07-20) | [GitHub release](https://github.com/rustdesk/rustdesk-server/releases/tag/1.1.16) |
| Client (Windows portable) | Intended test: **1.4.9** | **UNTESTED** — not installed |
| RustDesk Server Pro | Not licensed / not installed | **UNTESTED** |
| WAKA POS on the Windows VM | No test WAKA build on a Windows VM | **UNTESTED** |

Release 1.1.16 notes (**DOC**): offline-peer overflow fix; mio 0.8.11; **unauthenticated UDP punch-hole reflection/amplification fix**. Pin **≥ 1.1.16** if WAKA later self-hosts.

The scratch image has no shell, so `hbbs --version` could not be exec’d. Version is the image tag + digest above.

---

## 3. Server configuration (LIVE)

Isolated lab only. **Not** on WAKA production networks. **Not** using public RustDesk rendezvous.

```text
Mac host
  Docker Desktop linux/arm64
    network: rs31-isolated (user-defined bridge)
    rs31-hbbs  rustdesk/rustdesk-server:1.1.16  command: hbbs -r 127.0.0.1:21117
    rs31-hbbr  rustdesk/rustdesk-server:1.1.16  command: hbbr
  host publish:
    127.0.0.1:21115/tcp → hbbs NAT test
    127.0.0.1:21116/tcp → hbbs ID / hole-punch
    127.0.0.1:21116/udp → hbbs heartbeat
    127.0.0.1:21117/tcp → hbbr relay
  NOT published:
    21118 (hbbs websocket)
    21119 (hbbr websocket)
    21114 (Pro console — OSS has none)
```

| Item | Value |
|---|---|
| Restart policy | `no` (not `unless-stopped`) |
| Data dir | `/tmp/rs31-rustdesk-lab/data` (destroyed after tests) |
| SQLite | `db_v2.sqlite3` created by hbbs |
| Generated public key | `nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=` |
| Private key | Written to `id_ed25519` (88 bytes). **Not copied into this repo. Destroyed with the lab dir.** |
| `ALWAYS_USE_RELAY` | `N` (hbbs log) |
| `rendezvous-servers` | `[]` (hbbs log — no public rendezvous configured on the server) |
| `relay-servers` | `["127.0.0.1:21117"]` |
| hbbr limits (defaults) | LIMIT_SPEED 32 Mb/s; TOTAL 1024 Mb/s; SINGLE 128 Mb/s |

### Client configuration required to use only this server

Intended (not applied — no client):

```text
ID server:   127.0.0.1
Relay:       127.0.0.1
Key:         nLemXVaIMI89rZpwPtUqDo0YlayHK8zJsEzOcaqZWCI=
API server:  (empty for OSS)
```

**Public-server fallback:** **UNTESTED** on a client. Server-side, this hbbs had `rendezvous-servers=[]` and was unreachable except on loopback. Official clients default to public RustDesk servers if Network settings are empty (**DOC**). Preventing fallback requires a locked custom client or locked Network settings. That was not proven on Windows.

### Firewall / bind evidence (LIVE)

| Probe | Result |
|---|---|
| `127.0.0.1:21115/16/17` TCP | `connect_ex=0` (open) |
| `127.0.0.1:21118/19` TCP | `connect_ex=61` (refused — not published) |
| `172.20.10.4:21115/16/17/18/19` TCP | `connect_ex=61` (closed — not on LAN) |
| Host `lsof` | Docker proxy listening on `127.0.0.1` only |

hbbs still *listens* on `:21118` **inside** the container. That port was not published to the host. Keep it unpublished unless a web client is required. Official docs warn that 21118/21119 trust `X-Real-IP` / `X-Forwarded-For` if exposed (**DOC**).

### Stop / start (LIVE)

| Action | Observed |
|---|---|
| Stop hbbs | `21115`/`21116` closed; hbbr `21117` stayed up |
| Start hbbs | `21115`/`21116` open again; same public key |
| Stop hbbr | `21117` closed; hbbs `21116` stayed up |
| Start hbbr | `21117` open again |

Expected client behavior when hbbs is down: new registrations / new connections fail (**DOC**). **UNTESTED** with a real client.  
Expected when hbbr is down: direct hole-punch may still work; relay-required paths fail (**DOC**). **UNTESTED**.

### Teardown (LIVE)

```text
docker stop/rm rs31-hbbs rs31-hbbr
docker network rm rs31-isolated
rm -rf /tmp/rs31-rustdesk-lab
ports 21115–21117 closed
```

Local Docker cache still has `rustdesk/rustdesk-server:1.1.16` (15.9 MB). It is **not running**. It is not a WAKA production dependency.

No production ports were opened.

---

## 4. Client configuration

**Not applied.** No portable Windows client, no service, no permanent password, no unattended access.

Intended locked-down options for the missing Windows lab (**DOC**, client ≥ settings in 1.4.x):

```text
verification-method=use-temporary-password
approve-mode=password-click          # or click
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
allow-remote-config-modification=N
direct-server=N
allow-only-conn-window-open=Y        # install required
```

`enable-remote-shutdown` is **not** a first-class key in the official advanced-settings list reviewed on 2026-08-15. Treat remote shutdown as unavailable / must be proven absent.

---

## 5. Tests

### Phase 3 — Windows portable client

**BLOCKED.** No `RS3-WINDOWS-TEST`.

| Question | Result |
|---|---|
| RustDesk ID | **UNTESTED** |
| Temporary password shown | **UNTESTED** |
| When password changes | **SRC** (see §13) — **UNTESTED** live |
| Old password reconnect | **UNTESTED** |
| Permanent password | **Not configured** (nothing to configure) |
| Windows service | **Not installed** |

### Phase 4 — Basic remote session

**BLOCKED.** No technician → Windows session.

| Check | Result |
|---|---|
| Screen / mouse / keyboard / scroll / type | **UNTESTED** |
| Settings, Device Manager, Explorer, printers, USB, services | **UNTESTED** |
| Connection time, latency, stability, CPU, memory | **UNTESTED** |

### Phase 5 — Customer-visible control

**BLOCKED.**

| Question | Result |
|---|---|
| Does RustDesk cover the screen? | **UNTESTED** |
| Local connection indicator? | **UNTESTED** |
| Can WAKA remain visible? | **UNTESTED** |
| Privacy mode exist? | **DOC:** yes (`enable-privacy-mode`, default Y) |
| Privacy mode disabled? | **Not configured** — no client |
| Cashier sees technician activity? | **UNTESTED** |

Do **not** enable privacy mode. WAKA requires the cashier to watch the session.

### Phase 6 — Disable dangerous features

**BLOCKED.** Settings were not applied to a client. Attempts were not made.

| Capability | Configured OFF | Actually blocked | Evidence |
|---|---|---|---|
| File transfer | No (no client) | **UNTESTED** | DOC: `enable-file-transfer=N` exists; default Y |
| Clipboard | No | **UNTESTED** | DOC: `enable-clipboard=N`; default Y |
| Terminal | No | **UNTESTED** | DOC: `enable-terminal=N`; default Y |
| Tunnel | No | **UNTESTED** | DOC: `enable-tunnel=N`; default Y |
| Audio | No | **UNTESTED** | DOC: `enable-audio=N`; default Y |
| Camera | No | **UNTESTED** | DOC: `enable-camera=N`; default Y |
| Recording | No | **UNTESTED** | DOC: `enable-record-session=N`; default Y |
| Remote restart | No | **UNTESTED** | DOC: `enable-remote-restart=N`; default Y |
| Remote shutdown | No dedicated key found | **UNTESTED** | Must be proven absent on 1.4.9 |
| Block local input | No | **UNTESTED** | DOC: `enable-block-input=N`; Windows-only |
| Privacy mode | No | **UNTESTED** | DOC: `enable-privacy-mode=N`; default Y |
| LAN discovery | No | **UNTESTED** | DOC: `enable-lan-discovery=N`; install required |

**Blocker:** defaults are **on**. Configuration without a live refuse-test is not enough for RS-4.

### Phase 7 — No unattended access

**BLOCKED** (reboot / connect-without-approval).

What this lab *did* avoid:

- No Windows service
- No permanent password
- No unattended recipe

What this lab *did not* prove:

```text
reboot Windows → technician connect → DENIED
```

If RustDesk is started manually and a current temporary password is visible, a technician who knows the ID can try to connect **without any WAKA approval**. That is expected RustDesk behavior (**DOC**). WAKA authorization is a separate layer that does not exist until a Support Agent starts/stops the process.

**This remains a blocker** until the reboot test is run on Windows.

### Phase 8 — Password lifecycle

**UNTESTED** live. Source behavior (**SRC**, rustdesk `connection.rs` / `password_security.rs`, reviewed 2026-08-15):

1. Temporary password is generated in the **client process**, not by WAKA and not by OSS hbbs.
2. On **authorized** connection close, the controlled client calls `password::update_temporary_password()` — the displayed secret rotates.
3. After **10 consecutive wrong** temporary-password attempts, it also rotates (PR #14682).
4. `is_recent_session` can accept the **previous session password** for `SESSION_TIMEOUT` = **30 seconds** after last receive.
5. That recent-session table is **in-process**. Killing the client should drop it.

| Question | Live | Source implication |
|---|---|---|
| Does A remain valid after a clean session end? | **UNTESTED** | Displayed A should rotate; A may work ≤30s via recent-session |
| Can A be reused after restart? | **UNTESTED** | Should fail if no permanent password and process memory is gone |
| Can WAKA destroy the secret? | **UNTESTED** | Closest: stop process + no permanent password. No OSS API to mint/revoke |

**Do not claim RustDesk temporary password = WAKA grant.**

**Credential invalidation: BLOCKER** until the A→end→A-reconnect and A→restart→A-reconnect tests are run.

### Phase 9 — Process stop

**UNTESTED** (no session). Expected from process model: kill controlled RustDesk → transport dies; restart does not auto-reconnect the old controller. Must be proven.

### Phase 10 — Forced disconnect

| Test | Result |
|---|---|
| A. Close controlled-side process | **UNTESTED.** Only plausible OSS method. |
| B. Pro console Logs → Connection → Disconnect | **UNTESTED.** No Pro license / console. **DOC:** button exists; controller sees “disconnected from the web console.” |
| C. Official programmatic API for **one active desktop session** | **Not found** in official Pro CLI (`audits.py` is view-only; `users.py force-logout` logs out a **Pro user**, not a desktop session; `devices.py` enable/disable is not documented as “drop this live stream now”). Third-party `rustdesk-api-server-pro` `/admin/sessions/kill` is **not** official RustDesk and kills **auth tokens**, not desktop sessions. |

```text
ACTIVE DESKTOP SESSION
        ↓
DISCONNECT
        ↓
REMOTE DESKTOP ENDS
```

**BLOCKER FOR RS-4** until either:

1. process-kill is proven immediate and complete on Windows, **and** leftover credentials cannot reconnect, or
2. Pro console Disconnect (and a supported automation of that same action) is proven.

Do not treat user logout / device disable as proven session kill.

### Phase 11 — WAKA End simulation

**Not connected to production WAKA.** No mock agent was implemented in the POS app.

Conceptual mock only:

```text
AUTHORIZED → start portable RustDesk
DENIED     → stop transport
```

Recommendation **if** later Windows tests match source (not proven):

```text
Customer End / Admin Revoke
  1. Invalidate WAKA grant (already exists; control plane)
  2. Terminate the RustDesk process on the POS (native Support Agent)
  3. If Pro is purchased: also call console Disconnect as defense in depth
  4. Do not rely on password rotation alone (30s recent-session window)
```

All three are the conservative set. **Minimum that might work:** (1)+(2). **UNTESTED.**

Do **not** implement this in WAKA yet.

### Phase 12 — Admin Revoke simulation

Same transport action as Customer End: WAKA grant → `DENIED` → stop process (+ Pro Disconnect if available). **UNTESTED.** Not wired to production revoke RPC.

### Phase 13 — Windows UAC

**BLOCKED.** No Windows session. No service was installed.

Open design tension (unchanged from RS-3):

- Portable: local cashier often must accept elevation (**DOC**).
- Installed service: better UAC continuity, and is also the unattended path if a permanent password exists.

WAKA must not leave a service + permanent password after any UAC experiment.

### Phase 14 — Windows reboot

**BLOCKED.** Required result:

```text
After reboot, no customer approval → no remote connection
```

Not proven.

### Phase 15 — NAT

**BLOCKED** for client paths. Server-only notes:

| Scenario | Result |
|---|---|
| Same LAN | **UNTESTED** |
| Different Internet | **UNTESTED** |
| POS behind NAT | **UNTESTED** |
| Restrictive NAT | **UNTESTED** |
| Isolated server bind | **LIVE:** loopback only; LAN closed |
| Traffic uses public RustDesk | Server had empty `rendezvous-servers`. Client fallback **UNTESTED** |

### Phase 16 — Server failure

| Case | Live (ports) | Client session |
|---|---|---|
| hbbs unavailable | New `21115/21116` closed; hbbr stayed | **UNTESTED** |
| hbbr unavailable | `21117` closed; hbbs stayed | **UNTESTED** |
| Server down during **active** session | No active session | **UNTESTED** — do not treat RustDesk reconnect as WAKA authorization |

### Phase 17 — Security boundary

| Step | Expected | Result |
|---|---|---|
| ID + old temp password, WAKA DENIED | DENIED | **UNTESTED** (no WAKA mock + no client) |
| WAKA AUTHORIZED, transport started | ALLOWED | **UNTESTED** |
| WAKA DENIED while session active | DISCONNECTED | **UNTESTED — blocker** |

### Phase 18 — Technician identity

Server Pro was **not** installed. OSS identity is RustDesk ID + password only.

| Pro feature | Investigated live? |
|---|---|
| Technician account / login / 2FA / OIDC | **No** |
| Access control / audit / controlling-side user | **DOC only** |

Do **not** create shared technician credentials.

Mapping `internal_admins` → RustDesk Pro user is **not proven** and must not be designed as a shared password.

---

## 6. Evidence summary

### What this lab actually proved

1. Official OSS `hbbs`/`hbbr` **1.1.16** runs in Docker on linux/arm64.
2. They can be bound to **127.0.0.1** and are then unreachable on the LAN address.
3. WebSocket ports can stay unpublished.
4. hbbs and hbbr restart independently; the Ed25519 public key survives hbbs restart.
5. The lab can be destroyed: containers gone, keys deleted, ports closed.
6. No WAKA production system was involved.

### What this lab did not prove

Everything that requires a Windows interactive desktop and a technician client: screen, input, UAC, reboot, NAT, feature disable, credential reuse, forced disconnect, customer visibility, public-server fallback, Pro identity/audit.

---

## 7. Actual results vs WAKA session model

```text
WAKA authorization
       ↓
temporary permission
       ↓
native Support Agent
       ↓
RustDesk transport
       ↓
Windows POS desktop
```

**Not demonstrated.** The only live layer was isolated `hbbs`/`hbbr`.

RustDesk still does **not** know about WAKA grants. Starting the client is still enough for someone with the current temporary password to attempt a connection.

---

## 8. Security findings

1. **Missing Windows lab is itself a security finding.** RS-4 must not invent “we tested it.”
2. **OSS has no session-authorization API.** hbbs will broker any registered client.
3. **Temporary password ≠ WAKA grant** (**SRC**). Rotation on close is client-local; 30s recent-session reuse window exists in source.
4. **Permanent password + service = unattended access** (**DOC**). Not enabled here; not disproven on reboot.
5. **Dangerous features default ON** (**DOC**). Disablement untested.
6. **Public client fallback** if Network/key are unset (**DOC**). Untested.
7. **No official Pro API** found that kills one live desktop session. Console button is documented; automation is not.
8. **21118/21119 header spoofing** if web client ports are exposed (**DOC**). Keep closed.
9. **1.1.16 UDP punch-hole amplification fix** — do not self-host older OSS.
10. Lab private key was generated and destroyed. It was never a WAKA secret and must not be reused.

---

## 9. UAC findings

**UNTESTED.** Design tension remains: portable vs service. Do not install a lasting service to “solve” UAC.

---

## 10. Reboot findings

**UNTESTED.** Required: no approval → no connection. **Blocker.**

---

## 11. NAT findings

**UNTESTED** for real sessions. Isolated server did not use public RustDesk infrastructure and was not reachable off loopback.

---

## 12. Forced-disconnect findings

| Method | Status |
|---|---|
| Kill controlled process | Expected; **UNTESTED** |
| Pro console Disconnect | Documented; **UNTESTED**; no Pro |
| Official session-kill API | **Not documented** |
| `users.py force-logout` | Different object (Pro login) |

**Blocker for RS-4.**

---

## 13. Credential lifecycle findings

| Fact | Class |
|---|---|
| Temp password is client-generated | SRC / DOC |
| Rotates on authorized close | SRC |
| Rotates after 10 failed attempts | SRC (PR #14682) |
| 30s recent-session may accept the old session password | SRC |
| Process kill should drop recent-session memory | INFERENCE |
| Live A/B reconnect tests | **UNTESTED — blocker** |

WAKA cannot “issue” this secret via OSS API. A future agent can only start/stop the process and refuse to leave a permanent password.

---

## 14. Technician identity findings

OSS: ID/password. No WAKA `internal_admins` mapping. Pro not available. **Limitation stands.** Do not share one RustDesk password among technicians.

---

## 15. Licensing findings

Unchanged from RS-3; still not a purchase decision.

| Component | License | Note |
|---|---|---|
| Client | AGPL-3.0 | Modified/distributed client likely needs source offer. Legal review before forking. |
| Server OSS 1.1.16 | Used only as a local Docker image for this lab | Fine unmodified |
| Server Pro | Commercial, per hbbs | Needed for console Disconnect, OIDC, custom client generator (Basic+). **Not used.** |

Do not embed a modified AGPL client in `WAKA-POS-Setup.exe` without legal sign-off.

---

## 16. Recommended architecture

**Not recommended as proven-safe.** It remains the **candidate** if a future Windows lab passes:

```text
WAKA Cloud
   ↓
Remote Support Control Plane          ← only authority
   ↓
Customer Approval
   ↓
Electron Native Boundary              ← RS-2.1; no process spawn from React
   ↓
WAKA Support Agent (future, native)
   ↓
Locked RustDesk portable client
   no service, no permanent password
   file/clipboard/terminal/tunnel off
   pinned isolated hbbs/hbbr + key
   ↓
Self-hosted hbbs/hbbr ≥ 1.1.16
   ↓
Authenticated WAKA technician
   (Pro user later; never a shared password)
```

This lab only proved the **self-hosted hbbs/hbbr** box can run in isolation.

If the Windows lab later shows leftover passwords reconnect, or process-kill does not drop the session, **abandon this candidate** rather than weakening WAKA authorization.

---

## 17. RS-4 blockers

1. No `RS3-WINDOWS-TEST` — screen/mouse/keyboard unproven.
2. Customer visibility / privacy-mode-off unproven.
3. Feature-disable refuse-tests unproven.
4. Unattended / reboot deny unproven.
5. Credential A cannot-reconnect unproven (30s recent-session is a source risk).
6. Forced disconnect unproven; no official session-kill API.
7. Active-session + WAKA DENIED → DISCONNECTED unproven.
8. UAC vs no-service tension unresolved.
9. NAT and public-fallback unproven.
10. Technician identity / Pro audit unproven.
11. AGPL / signing / Pro purchase undecided.

---

## 18. RS-4 GO / CONDITIONAL GO / NO-GO

| Requirement | Result | Blocker? |
|---|---|---|
| Windows desktop control | **UNTESTED** | **Yes** |
| Mouse | **UNTESTED** | **Yes** |
| Keyboard | **UNTESTED** | **Yes** |
| Customer visibility | **UNTESTED** | **Yes** |
| No unattended access | Not enabled; reboot **UNTESTED** | **Yes** |
| No permanent password | None created | No (lab only) |
| Temporary credential | SRC only | **Yes** (live lifecycle unknown) |
| Credential invalidation | SRC 30s window; live **UNTESTED** | **Yes** |
| Customer End | **UNTESTED** | **Yes** |
| Admin Revoke | **UNTESTED** | **Yes** |
| Forced disconnect | No official API; process-kill **UNTESTED** | **Yes** |
| File transfer disabled | Config exists; refuse **UNTESTED** | **Yes** |
| Clipboard disabled | Config exists; refuse **UNTESTED** | **Yes** |
| Terminal disabled | Config exists; refuse **UNTESTED** | **Yes** |
| Tunnel disabled | Config exists; refuse **UNTESTED** | **Yes** |
| UAC | **UNTESTED** | **Yes** |
| Windows reboot | **UNTESTED** | **Yes** |
| NAT | **UNTESTED** | **Yes** |
| Self-hosting | **LIVE** OSS 1.1.16 localhost | Partial — not a Windows proof |
| Public fallback prevented | Server isolated; client **UNTESTED** | **Yes** |
| Technician identity | OSS ID/password only | **Yes** for WAKA mapping |
| Audit | Pro not installed | **Yes** for transport audit |
| Licensing | AGPL + optional Pro | Decision pending; not a lab pass |

```text
NO-GO TO RS-4
```

RS-3’s paper verdict (`RUSTDESK VIABLE WITH BLOCKERS`) is unchanged. RS-3.1 closed **only** “can we run isolated hbbs/hbbr without publishing ports.” It did **not** close the Windows transport blockers. Implementing a Support Agent or installer hook now would be RS-4 without evidence.

**Re-run this exact checklist** when a disposable `RS3-WINDOWS-TEST` VM and a separate technician machine exist. Do not skip to implementation.

---

## Isolation confirmation

```text
Production database modified: NO
Production WAKA code modified: NO
Migration modified: NO
WAKA installer modified: NO
RustDesk installed on production POS: NO
Real customer session created: NO
Production remote-control session created: NO
Production ports opened: NO
RS-4 started: NO
```

Additional lab hygiene:

```text
Windows service installed: NO
Permanent RustDesk password created: NO
Public RustDesk infrastructure used for a session: NO
grant_jti exposed: NO
shop JWT sent to RustDesk: NO
shop_devices mapping table created: NO
Production Support Agent created: NO
RustDesk dependency added to the WAKA app: NO
Lab containers left running: NO
Lab private key retained: NO
```

RS-4 was not started.
