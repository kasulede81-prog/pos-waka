# WAKA Remote Support — RS-3 RustDesk Technical Spike

**Date:** 2026-08-15  
**Status:** Research spike complete. **RS-4 not started.**  
**Evidence class:** Official RustDesk documentation and public source as of 2026-08-15.  
**Live Windows lab:** **Not executed** in this environment (host is macOS; no disposable `RS3-WINDOWS-TEST` VM was available).

This document must not be read as a production go-ahead. Claims below are tagged:

| Tag | Meaning |
|---|---|
| **DOC** | Stated in official RustDesk docs / GitHub releases |
| **SRC** | Visible in public rustdesk / rustdesk-server source or official architecture notes |
| **UNTESTED** | Required WAKA lab test; not run here |
| **INFERENCE** | Reasonable integration conclusion; must be proven on a throwaway Windows machine |

---

## Executive verdict

```text
RUSTDESK VIABLE WITH BLOCKERS
```

RustDesk can be a **transport** for WAKA Remote Support (screen + mouse + keyboard, self-hosted rendezvous/relay, disableable file transfer and clipboard). It is **not** an authorization system and must not become one.

It is **not** RS-4-ready until:

1. A disposable Windows lab proves start/stop, forced disconnect, no unattended access, UAC, and NAT.
2. WAKA owns session start/stop; RustDesk never has a permanent usable password + always-on service on a customer POS.
3. Forced disconnect after Customer End / Admin Revoke is proven (likely **RustDesk Server Pro** console/API, not OSS `hbbs`/`hbbr` alone).
4. One-time transport credentials are proven to be **unusable after WAKA revoke** (RustDesk’s built-in “one-time password” is **not** a WAKA grant).

```text
ACCEPTABLE

WAKA authorization
       ↓
temporary permission
       ↓
RustDesk transport
       ↓
remote desktop


UNACCEPTABLE

RustDesk
       ↓
permanent access
       ↓
WAKA POS
```

---

## Evidence and isolation

| Item | Result |
|---|---|
| Production WAKA / production Supabase | **Not used** |
| Staging Remote Support sessions | **Not used** |
| Customer POS / customer accounts | **Not used** |
| RustDesk installed on this Mac or any POS | **No** |
| RustDesk added to WAKA installer | **No** |
| Migrations 151/152 / `shop_devices` | **Unchanged** |
| Electron / RS-2.1 code | **Unchanged in this phase** |
| Public RustDesk SaaS used for a WAKA session | **No** |

Primary sources:

- [Self-host](https://rustdesk.com/docs/en/self-host/)
- [Client](https://rustdesk.com/docs/en/client/)
- [Advanced settings](https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/)
- [Client configuration / custom client](https://rustdesk.com/docs/en/self-host/client-configuration/)
- [Unattended access](https://rustdesk.com/blog/rustdesk-unattended-access-setup)
- [Access control (Pro)](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/permissions/)
- [Audit logs / disconnect (Pro)](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/audit-logs/)
- [OIDC (Pro)](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/oidc/)
- [License (Pro)](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/license/)
- [Windows portable elevation](https://rustdesk.com/docs/en/client/windows/windows-portable-elevation/)
- Client release **1.4.9** (2026-07-06): https://github.com/rustdesk/rustdesk/releases/tag/1.4.9
- Client license: **AGPL-3.0** (https://github.com/rustdesk/rustdesk)
- Server OSS: https://github.com/rustdesk/rustdesk-server

---

## Control plane vs transport

### WAKA owns (already implemented RS-1 → RS-2.1)

```text
technician identity
shop
POS device (shop_devices)
support reason
customer approval
session authorization
session expiry
customer End
admin Revoke
audit
permissions (canRemoteSupport)
```

### RustDesk may own (transport only)

```text
desktop capture
keyboard/mouse transport
NAT traversal
relay
connection
video/input transport
```

### RustDesk must NOT own

```text
WAKA authorization
shop membership
technician permissions
customer approval
session lifecycle
billing
device licensing
```

**INFERENCE:** If a technician can connect using only a RustDesk ID + password while WAKA says `not_authorized`, the architecture has failed.

---

## Target architecture (not implemented)

```text
                    WAKA CLOUD
                       │
                       │ authorization
                       ▼
              Remote Support Control
                       │
                 WAKA grant
                       │
                       ▼
                WAKA POS Electron
                       │
                 authorized only
                       ▼
              WAKA Support Agent (future)
                       │
                       ▼
                    RustDesk client
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          hbbs                  hbbr
             │                   │
             └─────────┬─────────┘
                       ▼
              Support Technician
```

This spike did **not** stand up hbbs/hbbr or a Windows client.

---

## Isolated Windows test machine

| Field | Value |
|---|---|
| Host used for this report | macOS (darwin) Cursor environment |
| Proposed lab name | `RS3-WINDOWS-TEST` |
| Windows version | **UNTESTED** — require a disposable VM (recommend Windows 10/11 22H2+ x64) |
| Architecture | **UNTESTED** — x64 to match WAKA Electron Windows build |
| RustDesk version to test | Client **1.4.9** (latest stable as of 2026-07-06) |
| Network | Isolated lab / throwaway VPS only. **Do not** open ports on WAKA production. |
| UAC | **UNTESTED** — lab must have UAC enabled (real POS default) |
| Interactive session | **UNTESTED** — cashier logged in, WAKA POS running |

Do **not** use a customer POS or any machine with shop data.

---

## Server architecture (DOC / SRC)

There are two server binaries ([official self-host](https://rustdesk.com/docs/en/self-host/)):

| Process | Role | Default ports |
|---|---|---|
| **hbbs** | ID / rendezvous / signaling. Clients keep their IP/port registered. Brokers hole-punch. | TCP 21115, 21116, 21118 (WebSocket). UDP 21116. Pro HTTP API: TCP **21114**. |
| **hbbr** | Relay when P2P hole-punch fails. | TCP 21117, 21119 (WebSocket). |

Minimum working set: TCP **21115–21117** + UDP **21116**.

Behavior (DOC):

1. While RustDesk is running, the machine **continuously pings hbbs**.
2. Connector A asks hbbs for B.
3. hbbs tries UDP hole-punch (direct).
4. If that fails, A↔B traffic goes through **hbbr**.
5. Official claim: hole-punch succeeds in the majority of cases; relay is fallback.

OSS hbbs persists peer state (`db_v2.sqlite3` in rustdesk-server). hbbr is largely in-memory plus optional blacklist files (SRC).

**WAKA implication:** As long as the POS client is running and registered, the machine is **discoverable** on hbbs. That is why “RustDesk always running + permanent password” equals unattended access.

---

## Client architecture (DOC)

- Cross-platform client (Windows, macOS, Linux, Android; iOS cannot be controlled).
- Can run **portable** (no install) or **installed** (Windows service).
- Default UI shows: **ID**, **one-time password**, connect-to-ID box.
- Settings: General (service), Security (permissions, password), Network (ID/Relay/API/Key), Display, Account (Pro login).
- CLI (official): `--password`, `--get-id`, `--set-id`, `--silent-install`, `--config`. Community/source also document `--connect`, `--install-service`, `--option`.
- Windows CLI often needs elevation; stdout often requires `| more` / `Out-String` (community, widely repeated).

**WAKA implication:** Portable + no service is closer to “transport only while authorized.” Installed service is how RustDesk implements unattended access.

---

## Authentication model (DOC)

RustDesk connection auth is **device-password / click-to-accept**, not WAKA shop membership.

| Mechanism | Official meaning | WAKA fit |
|---|---|---|
| **One-time / temporary password** | Rotating random password shown on the controlled client. `verification-method=use-temporary-password`. Length 6/8/10. | Closest to “session password.” **Not** issued by WAKA. **Not** API-created on OSS. Expires/rotates on the **client**, not when WAKA revokes. |
| **Permanent password** | Fixed password (`--password`, Settings → Security). Core of [unattended access](https://rustdesk.com/blog/rustdesk-unattended-access-setup). | **Forbidden for WAKA v1.** Combined with a service = connect without cashier. |
| **Click confirmation** | `approve-mode=click` (or `password-click`). Human on the POS must accept. | Useful extra customer signal. **Not** a substitute for WAKA approval (cashier could accept a random RustDesk connect). |
| **ID whitelist** | Docs explicitly: ID is reported by the connecting client; **not an authentication mechanism**. | Defense in depth only. |
| **Pro users / OIDC / LDAP** | Server Pro: users, groups, 2FA, access control, strategies. | Can identify the **technician login on RustDesk**, not automatically a WAKA `internal_admins` row. |
| **Pro access control** | Who may connect to which device. Disabled user/device cannot be accessed. | Complementary gate. **WAKA grant must still be required.** |

Audit log auth values (Pro, DOC): `Click Confirmation`, `One-time Password`, `Permanent Password`, `Switch Sides`, plus optional 2FA.

**There is no documented OSS API that mints a WAKA-scoped, single-use, server-revocable RustDesk credential.**

---

## One-time session credentials

**Question:** Can WAKA do request → approve → one-time RustDesk auth → connect → expire?

| Need | Official answer |
|---|---|
| One-time / temporary password | **Yes (DOC)** — client-generated rotating password |
| API-created credential (OSS) | **No (DOC)** — OSS is hbbs/hbbr only |
| API-created / address-book password (Pro) | **Partial (DOC)** — Pro `--address_book_password`, device deploy, strategies. Not the same as `remote_support_sessions.grant_jti` |
| Expires when WAKA grant expires | **Not documented** — temporary password lifecycle is RustDesk’s, not WAKA’s |
| Non-reusable after Customer End | **UNTESTED** — must rotate/clear password and disconnect |
| Session-specific ID | RustDesk **ID is a stable device ID**, not a per-session token |

**INFERENCE (blocker until proven):** WAKA must treat RustDesk passwords as **transport secrets it creates/destroys**, not as authorization. After End/Revoke:

1. Invalidate WAKA grant (already exists).
2. Force-disconnect the session (**UNTESTED**).
3. Clear or rotate the RustDesk password so the old secret cannot reconnect.

Do **not** invent a new credential protocol in RS-3. Do **not** expose `grant_jti` to RustDesk.

---

## Forced disconnect

| Path | Official | Live |
|---|---|---|
| Controlled user closes connection / stops service | Expected to drop session | **UNTESTED** |
| Pro web console Logs → Connection → **Disconnect** | **DOC:** running connection can be terminated; controller sees “disconnected from the web console” | **UNTESTED** |
| Pro `users.py force-logout` | Logs the **user** out of Pro; community reports this is **not** the same as killing an in-progress desktop session | **UNTESTED** / do not rely on it |
| OSS hbbs/hbbr API to kill a session | **Not documented** | Assume **unavailable** |
| Kill RustDesk process on POS | OS-level; would drop transport | **UNTESTED**; RS-2 forbids renderer `child_process`. A future **Support Agent** (not React) would own this. |

**Blocker for RS-4 until lab-proven:** Customer End and Admin Revoke must terminate an **active** RustDesk desktop session within a few seconds, not merely refuse a *new* WAKA grant.

Closest documented mechanism: **RustDesk Server Pro console Disconnect** (and any Pro API equivalent). OSS-only is likely “stop the client process.”

---

## Unattended access

Official unattended recipe ([blog](https://rustdesk.com/blog/rustdesk-unattended-access-setup)):

1. Set a **permanent password**.
2. Install RustDesk as a **system service** (starts with Windows, available at login screen).

That is exactly:

```text
machine starts
     ↓
RustDesk starts
     ↓
technician connects
     ↓
WITHOUT CUSTOMER APPROVAL
```

**WAKA v1 must not use this recipe.**

Safer documented levers (still **UNTESTED**):

| Setting | Intent |
|---|---|
| `verification-method=use-temporary-password` | No permanent password |
| `approve-mode=click` or `password-click` | Human on POS must accept |
| `allow-only-conn-window-open=Y` | Connections only while RustDesk window is open (install required) |
| Do **not** install the Windows service | Process dies with session / when WAKA stops it |
| Portable exe only during authorized window | No boot-time listener |

**INFERENCE:** Even without a permanent password, if the client is running and a current one-time password is visible/guessable, someone who knows the ID can try to connect. WAKA must not leave the transport listening after End.

Reboot test (**UNTESTED**, mandatory before RS-4): after reboot, with WAKA POS started and **no** approved session, technician connect must fail.

---

## Start / stop model

Desired:

```text
NO REQUEST        → RustDesk NOT running/listening
Customer approves → WAKA auth → start transport
Customer Ends     → revoke → disconnect → stop transport
```

What docs support:

- Client can run portable without service (**DOC**).
- Service can be installed (`--silent-install`, `--install-service` in community CLI) — **do not** for v1.
- `--option` can toggle permissions; `--password` sets permanent password (avoid).
- There is **no** documented “start listening only for N minutes then exit” API tied to an external grant.

**INFERENCE (closest safe architecture):**

```text
WAKA authorized_stub
  → Support Agent starts portable/custom client (no service)
  → set temporary-password-only
  → technician connects
WAKA End / Revoke
  → Pro Disconnect and/or terminate client process
  → rotate/clear password
  → client not listening
```

RS-2/RS-2.1 must **not** spawn this from the React renderer. A future native Support Agent owns process lifetime.

---

## File transfer

**Available:** Yes. Default `enable-file-transfer=Y` (**DOC**). Separate File Transfer session type exists (Pro audit `conn-type=1`).

**Disableable:** Yes.

```text
enable-file-transfer=N
```

Also: `one-way-file-transfer=Y` (blocks controlled → controller only — **not enough** for WAKA).

**WAKA v1:** **NO** file transfer, both directions. Must be Override/Strategy so the cashier cannot re-enable it. **UNTESTED** that a custom/locked client cannot bypass this.

---

## Clipboard

**Available:** Yes. Default `enable-clipboard=Y` (**DOC**).

**Disableable:** Yes.

```text
enable-clipboard=N
disable-clipboard=Y
```

**WAKA v1:** **NO** clipboard sync. Revisit later as a product decision. **UNTESTED**.

---

## Capability matrix

Sources: [Advanced settings](https://rustdesk.com/docs/en/self-host/client-configuration/advanced-settings/). Live disablement **UNTESTED**.

| Capability | Available (DOC) | Disableable (DOC) | WAKA v1 |
|---|---|---|---|
| Screen | Yes | Core product | **YES** |
| Mouse / keyboard | `enable-keyboard` (default Y) | Y/N | **YES** |
| File transfer | `enable-file-transfer` (default Y) | Y/N | **NO** |
| Clipboard | `enable-clipboard` (default Y) | Y/N | **NO** |
| Terminal | `enable-terminal` (default Y) | Y/N | **NO** |
| Port forwarding / TCP tunnel | `enable-tunnel` (default Y) | Y/N | **NO** |
| Unattended (permanent password + service) | Yes, documented recipe | Do not enable | **NO** |
| Recording | `enable-record-session` (default Y) | Y/N | **NO** |
| Audio | `enable-audio` (default Y) | Y/N | **NO** |
| Camera | `enable-camera` (default Y) | Y/N | **NO** |
| Remote restart | `enable-remote-restart` (default Y) | Y/N | **NO** |
| Remote shutdown | Not a first-class setting in the same list | Treat as **NO** until proven | **NO** |
| Lock / lock-screen connect | Related options exist (permanent password on lock, ≥1.4.7) | Avoid permanent password | **NO** |
| Block local input | `enable-block-input` (Windows) | Y/N | **NO** (cashier must keep control) |
| Privacy mode (blank local screen) | `enable-privacy-mode` | Y/N | **NO** for v1 (customer must see the session) |
| Chat | Client UI feature | Not fully inventoried | **NO** until needed |
| Elevation / UAC | Portable vs installed; Request Elevation | Install + signing | See Windows session |
| Display switching | Client remote toolbar | n/a | Optional |
| LAN discovery | `enable-lan-discovery` (default Y) | Y/N | **NO** (reduce accidental exposure) |

---

## Technician identity

Desired: `WAKA Support — Technician: John`.

| Layer | Identity |
|---|---|
| WAKA | `internal_admins` + `canRemoteSupport` + session `technician_name` |
| RustDesk OSS | Device ID + password. Controller is “whoever has the ID/password.” |
| RustDesk Pro | Logged-in user; OIDC/LDAP possible; audit “Controlling Side” user + device + IP |

**DOC:** Pro access control uses the **logged-in** controlling user (web/iOS may have no device ID).

**INFERENCE:** Do **not** share one RustDesk password among all WAKA technicians. Map later:

```text
WAKA internal_admins.user_id  →  RustDesk Pro user (OIDC)   // technician
shop_devices.id               →  RustDesk transport ID      // device
remote_support_sessions.id    →  WAKA session (authoritative)
```

Without Pro, technician identity in RustDesk is weak. WAKA UI/audit remain the customer-facing identity.

---

## Device identity

| ID | Role |
|---|---|
| `shop_devices.id` | WAKA authorization identity |
| `waka-pos-device-id` (localStorage) | Current POS fingerprint — **not** hardware auth |
| RustDesk ID | **Transport identity** (`--get-id` / `--set-id`, must start with a letter) |
| Windows machine SID / hostname | OS identity; do not replace `shop_devices` |

Do **not** create a mapping table in RS-3.

Future (only if RS-4 needs it): 1:1 `shop_devices.id` ↔ RustDesk ID, stored as transport metadata, never as authorization.

---

## NAT / network (DOC; live UNTESTED)

| Scenario | Expected (DOC) | Live |
|---|---|---|
| Same LAN | Direct / LAN optimization | **UNTESTED** |
| Different networks | Hole-punch, else hbbr | **UNTESTED** |
| Symmetric NAT / strict firewall | Likely relay | **UNTESTED** |
| Outbound-only POS | Clients outbound to hbbs/hbbr; no inbound POS port if relay works | **UNTESTED** |
| Inbound on **WAKA infra** | Isolated lab: 21115–21117 TCP, 21116 UDP; optional 21118/21119 WS; Pro 21114 or 443 | Do **not** open on production |

Encryption (SRC / long-standing maintainer statements): session traffic uses NaCl (Ed25519, Curve25519-XSalsa20-Poly1305). Clients pin `id_ed25519.pub`. Relay is not supposed to decrypt session content. **UNTESTED** in this spike.

---

## Self-hosting (DOC)

WAKA can run RustDesk **without** public RustDesk rendezvous for customer sessions.

| Component | Notes |
|---|---|
| hbbs | Required. Generates `id_ed25519` / `id_ed25519.pub`. OSS: SQLite peer DB. |
| hbbr | Required for NAT fallback. No separate Pro license. |
| Database | OSS: SQLite. Pro: console/users/devices (own store). |
| Auth | OSS: none for operators. Pro: local users, 2FA, OIDC, LDAP. |
| TLS | Clients use crypto + server public key. Web client needs reverse proxy HTTPS on 21118/21119. Pro API typically 443 via proxy. |
| Domain / DNS | Dedicated lab hostname, not `pos.waka.ug`. |
| Ports | See above. |
| Firewall | Isolated VPS/security group only. |
| Certificates | For HTTPS API/web client. |
| Monitoring / backup / updates | Required if WAKA operates the server; not designed here. |
| Public RustDesk servers | Clients default to public servers if unconfigured. **Custom client / locked Network settings required** so POS never falls back to public infra. |

---

## Server security (DOC / SRC; not penetration-tested)

| Topic | Official / source | This spike |
|---|---|---|
| Session encryption | NaCl E2EE; server “does nothing” to payload (maintainer, historical) | Not independently audited |
| Key management | `id_ed25519` private on hbbs host; pub on clients | Treat as infra secret |
| Client↔server auth | Public key pin; peer UUID/PK correlation on hbbs (SRC) | — |
| Relay | Pairs by UUID; optional speed limits / IP lists (SRC) | — |
| Credential storage | Permanent password on **device**; Pro users in Pro DB | Never store WAKA service-role or shop JWT in RustDesk |
| Logging | Pro: connection, file, alarm, console | OSS logging is operational, not WAKA audit |
| Brute-force | Pro alarms: >30 consecutive attempts, burst attempts | **UNTESTED** |
| Rate limit | hbbr bandwidth limiters (SRC) | Not WAKA session TTL |
| Session expiration | Client auto-disconnect on inactivity (`allow-auto-disconnect`) | **Not** WAKA 5-minute grant TTL |

WAKA session TTL and revoke remain authoritative.

---

## Custom client (DOC; not built)

**Feasible (Pro Basic+):** Custom Client Generator — name, logo, icon, preloaded server, signing workflow, disable/hide settings.

Documented locks useful to WAKA:

- Pin ID / Relay / API / Key
- `hide-network-settings` / `hide-server-settings` / `disable-settings`
- `enable-file-transfer=N`, `enable-clipboard=N`, `enable-terminal=N`, `enable-tunnel=N`
- `verification-method=use-temporary-password`
- `disable-change-permanent-password=Y`
- `incoming-only` (custom-client option exists in 1.4.9 changelog)
- `allow-only-conn-window-open=Y`

**Not built in RS-3.** Unsigned custom EXEs hit Windows SmartScreen/UAC “Unknown publisher” (public issues). WAKA would need **code signing**.

OSS custom builds are AGPL: modifications distributed to shops likely require source disclosure. Prefer **unmodified official client** + config, or **Pro generator**, unless legal signs off on AGPL.

---

## Windows installation (not implemented)

Possible future layout (RS-4+, not now):

```text
WAKA-POS-Setup.exe
      ├── WAKA POS
      └── WAKA Remote Support Agent  →  starts/stops RustDesk transport
```

| Topic | Finding |
|---|---|
| Installer | Official EXE/MSI; `--silent-install`. **Do not add to production installer in RS-3.** |
| Service | Required for unattended / some UAC paths. **Conflict with WAKA “no unattended.”** |
| Permissions | Capture + input need install or elevation. |
| UAC | Portable: local user must Accept/Elevate. Installed service: better UAC continuity (**DOC**). Community: installed service can still glitch on UAC (e.g. 1.4.1). **UNTESTED.** |
| Defender | Unsigned/custom binaries will be noisy. |
| Signing | Required for a WAKA-branded agent. |
| Updates | Client self-update exists; WAKA should pin versions. |
| Uninstall | Official uninstall / `--uninstall` (community). |
| User-session process | Required for “cashier watches the mouse.” Service-only login-screen access is unattended-shaped. |

**Tension (blocker to design, not just to test):** best UAC behavior wants a service; WAKA security forbids always-on unattended service. Lab must find a middle: e.g. install for drivers/UAC but **no permanent password** and **service stopped** except during an authorized WAKA session.

---

## Interactive Windows session (DOC / UNTESTED)

Target:

```text
Cashier at POS
  → technician connects
  → cashier sees the mouse move
  → WAKA banner stays visible
```

| Situation | Docs | Live |
|---|---|---|
| User logged in, POS running | Core use case | **UNTESTED** |
| Screen locked | Permanent-password-on-lock option ≥1.4.7 — avoid | **UNTESTED** |
| UAC prompt | Portable needs local Accept; service better | **UNTESTED** |
| Account switch | Not specified | **UNTESTED** |
| Windows restart | Service would come back = unattended risk | **UNTESTED** |
| POS app restart | Independent of RustDesk process | **UNTESTED** |
| RustDesk restart | Re-registers with hbbs | **UNTESTED** |

Customer-visible session (**DOC / INFERENCE**):

- RustDesk shows a connection-management UI on the controlled side (elevation/accept).
- WAKA already has `RemoteSupportSessionBanner`. It can stay visible if RustDesk does not cover the full screen in a way that hides it — **UNTESTED**.
- Privacy mode would **hide** the cashier’s view — keep **off**.
- Closing WAKA does **not** automatically kill RustDesk unless the Support Agent ties lifetimes — **UNTESTED**.
- Windows may show additional capture indicators depending on version — **UNTESTED**.

---

## WAKA customer UX (conceptual only — not wired to RustDesk)

Existing RS-1 UI is enough. Do not connect it to transport in RS-3.

```text
Allow Remote Support  →  WAKA approve RPC  →  Electron authorization check
End Remote Support    →  WAKA customer_end  →  native check DENIED  →  (future) kill transport
```

Copy already states the engine is not installed until a later phase. Keep that honest until RS-4.

---

## Security tests (required lab — not run)

| Test | Expected | This spike |
|---|---|---|
| A. Connect without WAKA approval | DENIED | **UNTESTED** |
| B. Connect after WAKA approval | ALLOWED | **UNTESTED** |
| C. Customer End | DISCONNECTED | **UNTESTED** |
| D. Admin Revoke | DISCONNECTED | **UNTESTED** |
| E. Expired WAKA authorization | DENIED | **UNTESTED** |
| F. Wrong device | DENIED | **UNTESTED** |
| G. Restart Windows | NO UNATTENDED ACCESS | **UNTESTED** |
| H. Permanent RustDesk credential | Must not exist or must be unusable outside WAKA session | **DOC:** permanent password exists and is the unattended feature — **do not enable** |

WAKA control-plane sides of A/E/F are already proven in RS-1.2 staging (29/29). They do **not** yet stop a RustDesk process.

---

## Licensing

| Component | License | WAKA implication |
|---|---|---|
| RustDesk client | **AGPL-3.0** | Shipping a **modified** client to shops likely requires offering source. Legal review required before forking. |
| rustdesk-server OSS | Open source (project is AGPL-family; confirm exact file at pin time) | Fine to run unmodified hbbs/hbbr. |
| RustDesk Server Pro | **Commercial**, licensed per **hbbs** machine ([license docs](https://rustdesk.com/docs/en/self-host/rustdesk-server-pro/license/)) | Needed for console, API, audit Disconnect, OIDC, custom client (Basic+). Relays unlicensed. |
| Public pricing (third-party summaries, verify on rustdesk.com/pricing) | OSS $0; Pro Individual ~$9.90/mo; Basic ~$19.90/mo (10 users / 100 devices); custom quotes | Treat as **indicative**. Buy only after legal + lab. |

**Recommendation:** Plan for **Server Pro** if WAKA needs forced disconnect, technician login, and a locked custom client. Do not depend on public RustDesk cloud.

---

## WAKA integration recommendation

Do **not** connect RustDesk to production control plane yet.

| WAKA piece | Role vs RustDesk |
|---|---|
| Control plane | **Only** authority. Approve / end / revoke / grant assert stay here. |
| Electron RS-2.1 | Asks control plane “is this POS authorized?” Never starts RustDesk from React. |
| Future Support Agent | Native process: start/stop transport **after** `authorized_stub`; stop on deny. No service-role key. No shop JWT inside RustDesk. |
| `shop_devices` | Unchanged. Optional later transport-ID field — not in RS-3. |
| `remote_support_sessions` | WAKA session record. Do not store RustDesk permanent passwords. Optional later: `transport_session_ref` (already a placeholder column; unused). |
| `grant_jti` | Stays server-side. **Never** send to RustDesk or the renderer. |

Suggested future sequence (RS-4 design, not implementation):

```text
authorized_stub
  → agent starts locked-down client (no service, no permanent password)
  → technician uses Pro login + current temporary secret
  → customer End / admin Revoke
  → WAKA RPC invalidates grant
  → Pro Disconnect + agent stops client + password rotated
```

Use a **MockAuthorizationProvider** / isolated hbbs+hbbr lab until that loop is proven.

---

## Security blockers for RS-4

1. **No live Windows proof** of connect, UAC, banner, End, Revoke, reboot.
2. **OSS cannot force-disconnect** via a documented API; Pro Disconnect is documented but untested.
3. **RustDesk one-time password ≠ WAKA grant.** Must prove leftover password cannot reconnect after End.
4. **Permanent password + service = unattended access.** Must be designed out.
5. **UAC vs no-service tension** unresolved.
6. **Public-server fallback** if Network settings are unlocked.
7. **AGPL / signing / Pro license** not decided.
8. **Technician identity** not mapped to WAKA admins.
9. **Process control** must live in a native agent, not the renderer (RS-2 rule).
10. **File transfer / clipboard / terminal / tunnel** default **on** — must be locked off.

---

## Lab checklist (next, still isolated)

On a disposable `RS3-WINDOWS-TEST` VM and a throwaway Linux VPS (not WAKA production):

1. Install RustDesk **1.4.9** portable (no service) on the VM.
2. Run OSS hbbs/hbbr on the VPS; pin `id_ed25519.pub`.
3. Same-LAN and internet NAT connects.
4. Confirm screen / mouse / keyboard; measure latency (**UNTESTED**).
5. Set `enable-file-transfer=N`, `enable-clipboard=N`; verify both directions blocked.
6. No permanent password; reboot; confirm technician **cannot** connect.
7. Start client, connect, stop client / kill process; confirm session dies.
8. If Pro trial is approved: console **Disconnect** during an active session.
9. UAC prompt with portable vs installed.
10. Confirm WAKA-style banner can remain visible (manual overlay is enough).

Only after that lab should WAKA decide RS-4.

---

## Production confirmation

```text
Production database modified: NO
Production WAKA code modified: NO
Migration modified: NO
WAKA installer modified: NO
RustDesk installed on production POS: NO
Real customer session created: NO
Remote support transport connected to production: NO
```

RS-4 was **not** started.
