# Vision V1.0 — WAKA Vision Enterprise Camera Platform Architecture Certification

**Mode:** Read-only enterprise architecture audit (**NO implementation, NO SDK integration, NO UI development, NO migrations**)  
**Date:** 2026-08-04  
**Codename:** WAKA Vision  
**Scope:** Universal camera platform architecture that integrates with WAKA POS while remaining usable as a standalone camera manager  
**Current codebase status:** No ONVIF / RTSP / WebRTC / VMS stack exists. Device `getUserMedia` is used only for barcode scanning and product photos.  

**Core design question:**

> Can WAKA support 1–100+ cameras, multi-branch monitoring, POS event replay, and future AI analytics **without changing the underlying layered architecture**?

---

## Executive Summary

WAKA Vision must be built as a **separate camera platform** with a hard boundary: **POS never calls camera protocols directly**. All discovery, credentials, RTSP ingest, and browser playback flow through a **Camera Manager → ONVIF Discovery → RTSP Stream Engine** stack. POS contributes only **business events** (sales, refunds, drawer opens, shift/day close) that Vision binds to a **timeline**.

| Decision | Architecture stance |
|----------|---------------------|
| Browser live view | **Requires RTSP→WebRTC** (primary) with HLS fallback — browsers cannot play RTSP natively |
| Recording | **Prefer existing NVR/DVR/SD/cloud** — Vision is VMS-lite + POS glue, not a forced recorder |
| Protocol target | ONVIF Profile **S** (minimum), Profile **T** preferred; Profile **G** for recording search when NVR supports it |
| POS glue | `AuditLogEntry` + entity IDs (`saleId`, shift, day open) — already present in WAKA |
| Standalone mode | Vision Manager runnable without Sell/Cash modules; shop tenancy still applies |
| Scale path | Same layers from 1 camera → 100+ with gateway horizontal scale + registry partitioning |

**Overall architecture certification status: CERTIFIED AS DESIGN** — ready for phased implementation V1.1→V2.0. **NOT implemented.** Do not write production code until V1.1 scope is explicitly approved.

**Freeze recommendation:** Freeze this **layering and boundary model**. Implementation may choose concrete libraries (e.g. MediaMTX / go2rtc class gateways) without changing the conceptual stack.

---

## Score Table (architecture readiness — not product UX)

| Category | Score | Notes |
|----------|------:|-------|
| Layered separation | **9.0** | Clear anti-corruption boundary from POS |
| Discovery design | **8.5** | Standard WS-Discovery + manual add |
| Streaming design | **8.5** | WebRTC primary; HLS fallback |
| Data model | **8.0** | Registry + credentials + tenancy |
| POS event timeline | **9.0** | Strong existing audit spine |
| Recording strategy | **8.5** | Hybrid / respect existing NVR |
| Compatibility plan | **7.5** | ONVIF-first; brand quirks expected |
| Security | **8.5** | Aligns with WAKA secret patterns |
| Scalability | **8.0** | Layers survive 1→100+ |
| AI reserve | **8.0** | Analytics bus reserved, not built |
| **Overall design confidence** | **8.4 / 10** | Ship-ready architecture |

---

# PART 1 — Universal Camera Architecture

## Target stack

```text
                         WAKA Vision
                              │
                      Camera Manager
                     (registry, authz,
                      layouts, health)
                              │
                 ┌────────────┴────────────┐
                 │                         │
      ONVIF Discovery Service      Recording Adapters
      (WS-Discovery, profiles,     (NVR / SD / cloud
       device info, PTZ, snap)      search — optional)
                 │
         RTSP Stream Engine
         (ingest, reconnect,
          multi-viewer sessions)
                 │
         Playback Gateway
         (RTSP → WebRTC primary
          RTSP → HLS fallback)
                 │
      Browser / Desktop / Mobile
                 │
         WAKA POS Event Bus
         (AuditLogEntry + entities)
                 │
      Timeline / Investigation /
      Command Center deep-links
```

## Hard rules

1. **POS UI and Zustand store must not import ONVIF/RTSP clients.**  
2. Camera Manager is the only module that owns credentials and device sessions.  
3. Stream Engine owns live sessions; Playback Gateway owns browser transport.  
4. Event Timeline owns join keys between POS events and media time ranges.  
5. Vision may run in **standalone Camera Manager mode** (no Sell) with the same Camera Manager API.

## Logical packages (future code boundaries)

| Package (proposed) | Responsibility | May call |
|--------------------|----------------|----------|
| `vision-registry` | Camera CRUD, shop/branch assignment | DB / encrypted secret store |
| `vision-onvif` | Discovery, device/media/PTZ/snapshot | Cameras on LAN only |
| `vision-rtsp` | Pull RTSP, health, reconnect | Cameras / NVR |
| `vision-gateway` | WebRTC / HLS publication | Clients |
| `vision-timeline` | Event↔clip markers | POS audit/entities (read) |
| `vision-ai` (V2) | Analytics consumers | Metadata bus only |
| POS / Cash / EOD | Business events | **vision-timeline API only** |

---

# PART 2 — ONVIF Discovery

## How LAN discovery works

ONVIF devices advertise via **WS-Discovery**:

- UDP multicast **239.255.255.250:3702** (IPv4)  
- Client sends `Probe` (types typically `tds:Device` / `dn:NetworkVideoTransmitter`)  
- Device replies `ProbeMatch` with `XAddrs` (device service URL), scopes (name, hardware, location, profiles)

**WAKA Vision Discovery Service** (V1.1):

1. Request LAN / local-network permission (Capacitor / desktop / browser constraints).  
2. Multicast Probe (timeout window, e.g. 3–8s).  
3. Collect ProbeMatches → candidate list (IP, XAddr, scopes, UUID).  
4. For each candidate (with credentials): Device service `GetDeviceInformation`, Media `GetProfiles`, `GetStreamUri`, optional `GetSnapshotUri`.  
5. Present “Add camera” with prefilled RTSP URL + metadata.  
6. Persist to Camera Registry (never keep plaintext longer than encrypt-at-rest step).

## Capabilities by phase

| Capability | ONVIF surface | Phase |
|------------|---------------|-------|
| Discovery | WS-Discovery Probe/Hello | V1.1 |
| Authentication | HTTP Digest / WS-Security UsernameToken | V1.1 |
| Device info | `GetDeviceInformation` | V1.1 |
| Profiles | Media1/Media2 `GetProfiles` | V1.1–V1.2 |
| RTSP URI | `GetStreamUri` | V1.1–V1.2 |
| Snapshots | `GetSnapshotUri` / JPEG | V1.2–V1.3 |
| PTZ | PTZ service (Profile S/T) | V1.3+ (optional) |
| Recording search | Profile G (NVR) | V1.4+ / hybrid |
| Events / analytics metadata | PullPoint / Profile M | V2.0 |

## Manual add (required)

Many cameras are on different VLANs, disable discovery, or sit behind NVR. Always support:

- Manual IP / ONVIF port  
- Manual RTSP URL  
- Import from NVR channel list (adapter)

## Network constraints

- Multicast often **does not cross routers** → discovery is per LAN/VLAN.  
- At 100+ cameras, prefer **registry + scheduled add** over constant multicast storms.  
- Desktop/native agents are better discovery hosts than pure browser tabs (browser UDP multicast is limited/unavailable).

**Architecture decision:** Discovery runs in a **Vision Edge Agent** (desktop/native/LAN service). Web POS talks to the agent over authenticated local/HTTPS API — still not “POS calling ONVIF.”

---

# PART 3 — RTSP Streaming

## Reality check

**Browsers cannot natively play RTSP.** Production monitoring UIs use a gateway:

| Path | Latency | Fit |
|------|---------|-----|
| **RTSP → WebRTC** | ~100–500ms | Live till monitoring, multi-view |
| RTSP → LL-HLS / HLS | ~2–15s+ | Remote/low-bandwidth fallback |
| RTSP → MSE proxy | Varies | Secondary |

**Decision:** Playback Gateway **must** convert RTSP for browser clients. Primary = **WebRTC**; fallback = **HLS**. Native desktop may optionally play RTSP more directly via engine bindings, still behind Stream Engine.

## Stream Engine responsibilities

- Session lifecycle: connect, PLAY, teardown  
- Reconnection with exponential backoff + circuit breaker per camera  
- Multi-camera fan-out (one RTSP pull → N viewers via gateway, when possible)  
- Live preview vs fullscreen (client layout only; same session classes)  
- **Recording awareness:** query whether NVR/edge is recording; do not assume Vision is recording  
- Health: last frame time, bitrate estimate, auth failures, offline

## Viewer modes

| Mode | Engine behavior |
|------|-----------------|
| Live preview (tile) | Substream / low-res profile preferred |
| Full screen | Main stream if bandwidth allows |
| Multi-camera | Cap concurrent WebRTC peers; degrade to substreams |
| Event replay | Prefer NVR Profile G / vendor playback API; else cloud clip |

## Reconnection policy (design)

1. Detect stall (no frame > N seconds).  
2. Soft reconnect RTSP without dropping viewer UI (spinner).  
3. After K failures → mark camera `degraded` / `offline` in registry.  
4. Emit health event to Command Center (optional AttentionItem).

---

# PART 4 — Camera Registry

## Logical model

```text
Organization
 └── Shop / Branch
      └── Camera
           ├── Credentials (encrypted ref)
           ├── MediaProfiles[]
           ├── StreamEndpoints[]
           ├── Placement (zone / shelf / till)
           ├── LayoutMembership[]
           └── HealthSnapshot
```

### Camera (canonical fields)

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `organizationId` | UUID | Tenant |
| `shopId` | UUID | **Assigned shop** (= WAKA `shops.id`) |
| `branchId` | UUID? | Optional enterprise branch |
| `name` | string | Operator label |
| `locationLabel` | string | “Till 1”, “Entrance”, “Warehouse A” |
| `ip` | string? | Last known |
| `brand` | string? | Hikvision / Dahua / … |
| `model` | string? | From ONVIF device info |
| `serial` | string? | From device info |
| `onvifXAddr` | string? | Device service URL |
| `onvifProfiles` | string[] | e.g. `S`, `T`, `G` |
| `mediaProfileToken` | string? | Active profile |
| `rtspUrlMain` | secret-ref | Never plaintext in logs |
| `rtspUrlSub` | secret-ref? | Multi-view |
| `credentialId` | UUID | FK to encrypted secret |
| `status` | enum | `online` \| `degraded` \| `offline` \| `unconfigured` |
| `recordingMode` | enum | `none` \| `camera_sd` \| `nvr` \| `dvr` \| `cloud` \| `hybrid` |
| `nvrChannelId` | string? | When behind NVR |
| `timezone` | string | Align with shop TZ (Kampala default) |
| `createdAt` / `updatedAt` | ISO | |
| `lastSeenAt` | ISO? | Health |

### Credentials

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `username` | Stored encrypted or vaulted |
| `secretCiphertext` | Argon2id is for **verification** hashes; camera passwords need **reversible encryption** (AES-GCM) with shop-scoped key — distinct from PIN hashes |
| `keyVersion` | Rotation |
| `scope` | `shopId` |

**Security note:** Unlike staff PINs (one-way hash), camera passwords must be decryptable by the Stream Engine. Use **envelope encryption**, never log plaintext, never sync secrets to unauthorized devices.

### Layout

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `shopId` | |
| `name` | “Front of house 2×2” |
| `grid` | `1` \| `4` \| `9` \| `16` \| `custom` |
| `slots[]` | `{ index, cameraId, stream: main\|sub }` |

### EventMarker (POS timeline)

| Field | Notes |
|-------|-------|
| `id` | UUID |
| `shopId` | |
| `occurredAt` | From `AuditLogEntry.at` or entity timestamp |
| `source` | `audit` \| `sale` \| `shift` \| `day_drawer` \| … |
| `auditLogId` | Optional |
| `saleId` / `shiftId` / `dayCloseId` / … | Join keys |
| `cameraIds[]` | Cameras covering zone |
| `mediaStartAt` / `mediaEndAt` | Clip window (± pre/post roll) |
| `recordingLocator` | NVR query handle / cloud clip URL |

---

# PART 5 — POS Event Timeline

## Event spine (existing WAKA)

Primary glue: **`AuditLogEntry`** (`at`, `actorUserId`, `deviceId`, `action`, `payload`).

| Business event | Audit / entity | Timeline action |
|----------------|----------------|-----------------|
| Sale | `sale_completed` + `Sale.id` / `createdAt` | Jump to ±T seconds around till cameras |
| Refund / return | `sale_refund` / `sale_return` | Replay |
| Void | `sale_void` | Replay |
| Hardware drawer kick | `drawer_open` | Replay till cam |
| Cash movement | `cash_drawer_adjustment` | Replay |
| Day open | `day_drawer_open` | Replay |
| Shift start / end / close count | `shift_*` | Replay |
| Day close | `day_close*` (Phase 35) | Replay closing window |

## Flow

```text
Sale completed
  → AuditLogEntry { saleId, at }
  → Vision Timeline Adapter (async, non-blocking)
  → EventMarker { cameraIds from till zone, media window }
  → Investigation / sale detail “View cameras”
  → Playback Gateway seeks NVR/cloud at occurredAt − preRoll
```

## Design rules

1. Timeline adapter **must never block** sale completion or sync.  
2. Markers work **offline** from local audit/sales; media fetch may wait for LAN/cloud.  
3. Deep-link Investigation Center: `/office/audit-center?category=sales…` + Vision panel.  
4. Zone mapping: Camera `locationLabel` / `Placement` → Till / Entrance / Stock — configurable per shop.

---

# PART 6 — Multi-Camera Layout

| Grid | Use |
|------|-----|
| 1 | Focus / fullscreen investigation |
| 4 | Typical retail counter + entrance |
| 9 | Supermarket / restaurant floor |
| 16 | Warehouse / large store (substreams required) |
| Custom | Irregular (e.g. 1 large + 3 small) |

### Responsive

| Form factor | Default |
|-------------|---------|
| Desktop / ultrawide | 4 / 9 / 16 with keyboard slot focus |
| Tablet | 4 (portrait 1–2) |
| Phone | 1 (+ swipe between cameras); avoid 16 |

### Performance policy

- Prefer **substream** for grids ≥4.  
- Max simultaneous WebRTC peers configurable (device class).  
- Pause off-screen tiles (IntersectionObserver / native equivalent).

---

# PART 7 — Recording Strategy

**Principle:** WAKA Vision should **not become a recorder** when the business already records on camera SD, NVR, DVR, or cloud.

| Mode | Who records | Vision role |
|------|-------------|-------------|
| `camera_sd` | Edge SD card | Live + snapshot; limited history |
| `nvr` / `dvr` | On-prem recorder | Live + Profile G / vendor playback search |
| `cloud` | Vendor cloud | Deep-link / API clip fetch |
| `hybrid` | NVR + cloud failover | Prefer NVR LAN; cloud remote |
| `none` | — | Live only (still valuable with POS markers) |

### When Vision might store media (optional, later)

- Short **incident clips** around POS events (privacy-scoped, retention-limited)  
- Never default to 24/7 cloud DVR in V1

---

# PART 8 — Compatibility Matrix

| Brand / class | Discovery | RTSP | ONVIF notes | V1 stance |
|---------------|-----------|------|-------------|-----------|
| **Hikvision** | Usually | Yes | ONVIF often needs enabling; ISAPI quirks | Support via ONVIF + manual RTSP |
| **Dahua** | Usually | Yes | Similar enablement | Support |
| **Uniview** | Usually | Yes | ONVIF S/T common | Support |
| **Axis** | Strong | Yes | Clean ONVIF citizen | Support |
| **TP-Link VIGI** | Mixed | Yes | Verify ONVIF on model | Support + manual RTSP |
| **Reolink** | Mixed | Yes | Some models ONVIF “client” limited | Manual RTSP first-class |
| **Generic ONVIF S/T** | Yes | Yes | Baseline | **Primary target** |
| NVR as device | Channel list | Yes | Often better entry than 50 ProbeMatches | Adapter in V1.3 |

**Certification expectation:** V1.2 “works” = Profile S stream + auth + reconnect on a reference Axis/Hikvision/Dahua unit + one generic ONVIF camera. Brand-specific polish is continuous, not a blocker for architecture.

---

# PART 9 — Future AI Layer (architecture reserve only)

No AI implementation in V1.x.

```text
Stream Engine / NVR metadata
        │
 Analytics Ingest Bus  (vision-ai)
        │
 ┌──────┼──────────────┐
Motion  Person   Queue   Shelf   Cash-drawer zone
        │
 Alert Rules → AttentionItem / Investigation marker
```

| Capability | Consumes | Emits |
|------------|----------|-------|
| Motion | Frames / ONVIF events | Zone motion markers |
| Person detection | Frames / edge AI | Count / loiter |
| Queue detection | Counter cameras | Wait-time attention |
| Theft alerts | Exit + unpaid sale heuristics | Critical attention |
| Cash drawer alerts | Till camera + `drawer_open` | Linked replay |
| Shelf monitoring | Aisle cameras | Empty-shelf ops (not inventory engine rewrite) |

**Rule:** AI never writes POS financial truth. It only creates **markers and alerts**.

---

# PART 10 — Security

| Concern | Design |
|---------|--------|
| Credential storage | AES-GCM envelope encryption; shop-scoped keys; key versioning |
| Transport | HTTPS/TLS to Vision APIs; WebRTC DTLS-SRTP; prefer RTSP-over-TCP/TLS when camera supports |
| LAN discovery | Explicit user permission; segment to camera VLAN; disable continuous Probe in large sites |
| Authentication | WAKA session + Vision permission (e.g. `vision.view`, `vision.manage`) |
| Camera authorization | Per-role: view live / manage registry / export clips |
| Logging | Redact RTSP URLs, passwords, tokens (follow `staffSyncDiagnostics` hygiene) |
| Sensitive actions | Reuse PIN/biometric gates for credential reveal / camera delete |
| Multi-device | Align with shop device approval — only trusted devices run Edge Agent |
| Privacy | Retention policy for optional incident clips; staff disclosure |

---

# PART 11 — WAKA Integration

| Module | Integration |
|--------|-------------|
| **Sell** | Optional till-zone preview; never block checkout; event markers on `sale_completed` |
| **Cash Drawer** | Markers on `drawer_open`, adjustments, day open |
| **End of Day** | Closing-window replay from day-close timestamp (Phase 35 boundary) |
| **Reports** | Link outs only; Vision is not a financial report |
| **Investigation Center** | Primary investigation UX — “View cameras” on timeline rows |
| **Command Center** | Attention items for offline cameras / safe-limit + camera review |
| **Back Office** | Vision Manager entry under Shop / Ops (IA TBD with Phase 37.1) |
| **Standalone** | Vision Manager without Sell for camera-only customers |

### Non-blocking guarantee

Sale completion, sync queue (P0), and cash ledger paths **must not await** Vision. Timeline adapter = async / queue / best-effort.

---

# PART 12 — Enterprise Benchmark (workflows only)

| VMS concept (Milestone, Nx, HikCentral, Dahua DSS, Axis CS) | WAKA Vision adoption |
|------------------------------------------------------------|----------------------|
| Device registry + credentials | Yes — Camera Registry |
| Live multi-view layouts | Yes — Layout entity |
| Recording server ownership | Prefer customer NVR; optional clips |
| Event/alarm list | Map to Investigation + Attention |
| Bookmark / investigation export | EventMarker + clip locator |
| User roles | WAKA permissions |
| Multi-site | `organizationId` + `shopId` |
| Analytics add-ons | Reserved `vision-ai` bus |

Do **not** copy vendor UIs. Adopt **accountability workflows**: find device → watch live → jump from business event → export evidence.

---

## Scalability

| Scale | Architecture behavior |
|-------|------------------------|
| 1 camera | Single Edge Agent optional; direct LAN gateway |
| 4–16 | One agent; substreams for grids |
| 100+ | Multiple agents / VLAN segments; registry pagination; disable multicast scan storms; NVR-centric add |
| Multi-branch | Registry partitioned by `shopId`; HQ read-only monitor via cloud gateway (V1.5+) |
| Cloud monitoring | Playback Gateway in VPC/edge; never expose raw camera passwords to browsers |

Underlying layers remain the same at every scale.

---

## Root Cause Register (pre-implementation risks)

| ID | Severity | Risk | Mitigation in architecture |
|----|----------|------|------------------------------|
| **RC-1** | P0 | POS calling ONVIF/RTSP directly | Hard package boundary + API-only integration |
| **RC-2** | P0 | Assuming browsers play RTSP | Mandatory Playback Gateway (WebRTC/HLS) |
| **RC-3** | P0 | Vision becomes forced cloud DVR | RecordingMode prefers existing NVR/SD |
| **RC-4** | P1 | Discovery fails across VLANs | Manual RTSP + NVR adapter first-class |
| **RC-5** | P1 | Credential leak in logs/sync | Envelope encryption + redaction |
| **RC-6** | P1 | Blocking POS on media | Async EventMarker pipeline |
| **RC-7** | P1 | 16-tile overload on mobile/WebRTC | Substream + peer caps + pause offscreen |
| **RC-8** | P2 | Brand ONVIF quirks | Compatibility matrix + manual URL |
| **RC-9** | P2 | AI coupled to ledger | Analytics bus read-only to POS |
| **RC-10** | P2 | Clock skew breaks event replay | NTP guidance; use shop TZ; expandable pre/post roll |

---

## P0 / P1 / P2 Implementation Roadmap

Aligned with the recommended Vision phases:

| Phase | Goal | Architecture slice |
|-------|------|--------------------|
| **V1.0** | Architecture certification | **This document** |
| **V1.1** | ONVIF discovery | `vision-onvif` + Edge Agent probe + registry draft |
| **V1.2** | RTSP live view | `vision-rtsp` + Playback Gateway WebRTC (+ HLS fallback) |
| **V1.3** | Camera manager | CRUD, test stream, layouts 1/4/9, health |
| **V1.4** | POS event linking | EventMarker + Investigation “View cameras” |
| **V1.5** | Mobile & remote | Substream defaults, cloud gateway path |
| **V2.0** | AI features | `vision-ai` bus — motion/queue/theft/shelf |

### Value checkpoints

- After **V1.2:** discover + watch live (standalone camera value).  
- After **V1.4:** **POS event → camera replay** — primary differentiator vs commodity VMS for SMB.  
- After **V2.0:** analytics without re-architecture.

### P0 before any code merge

1. Approve layer boundaries and “POS never talks ONVIF.”  
2. Approve WebRTC-primary playback.  
3. Approve credential encryption approach (reversible secrets ≠ PIN hashes).  
4. Approve NVR-first recording philosophy.

### P1 during V1.1–V1.4

5. Edge Agent packaging (desktop/native).  
6. Zone → camera mapping for tills.  
7. Investigation Center deep-link contract.  
8. Compatibility lab (3+ brands).

### P2 later

9. Profile G NVR search polish.  
10. Multi-branch HQ wall.  
11. AI bus + attention rules.  
12. Optional short incident clip vault.

---

## Future AI Roadmap (non-binding)

1. Motion / tamper via ONVIF events (cheap).  
2. Person / queue on edge or gateway.  
3. Cash-drawer zone correlation with `drawer_open`.  
4. Exit-camera + unpaid basket heuristics (alert only).  
5. Shelf emptiness signals for ops (not stock ledger writes).

---

## Integration Contract Sketches (design only)

```text
VisionCameraManager.listCameras(shopId) → Camera[]
VisionCameraManager.testConnection(cameraId) → HealthSnapshot
VisionPlayback.openLive(cameraId, quality) → WebRtcSession | HlsSession
VisionTimeline.markersNear(shopId, at, window) → EventMarker[]
VisionTimeline.openReplay(markerId) → PlaybackSession
```

POS / Investigation call **only** these (or successors). No RTSP URLs in POS bundles.

---

## Freeze Recommendation

| Artifact | Freeze? |
|----------|---------|
| Layered architecture & POS boundary | **Yes** |
| WebRTC-primary browser playback | **Yes** |
| NVR-first recording philosophy | **Yes** |
| Concrete gateway vendor/binary | **No** — choose at V1.2 |
| UI layouts / Back Office placement | **No** — product IA later |
| AI models | **No** — V2 only |

---

## Success Criteria — V1.0

| Criterion | Status |
|-----------|--------|
| Universal layered architecture documented | **Met** |
| ONVIF discovery approach defined | **Met** |
| Browser streaming approach decided (WebRTC + HLS) | **Met** |
| Registry + security model defined | **Met** |
| POS event timeline join designed against real `AuditLogEntry` spine | **Met** |
| Compatibility & recording strategy defined | **Met** |
| AI reserved without implementation | **Met** |
| Phased V1.1–V2.0 roadmap | **Met** |
| Code written | **Forbidden / none** |

---

## Manual Lab Checklist (for V1.1+ acceptance — not V1.0)

- [ ] WS-Discovery finds ≥1 ONVIF camera on lab LAN  
- [ ] Manual RTSP add works when discovery blocked  
- [ ] Live WebRTC preview <1s typical LAN latency  
- [ ] Reconnect recovers after cable pull  
- [ ] Credentials never appear in logs  
- [ ] Completing a sale never waits on Vision  
- [ ] Investigation row opens replay window around `saleId` timestamp (V1.4)

---

*End of Vision V1.0 architecture certification — design only; no implementation in this phase.*  
*Next recommended build phase: **V1.1 — ONVIF Discovery** (Edge Agent + Probe + registry draft), still without POS timeline coupling.*

---

# Vision V1.1 — Discovery & Camera Manager (implemented)

**Date:** 2026-08-04  
**Scope delivered:** Discover / manual RTSP / NVR import / registry / camera test — **no live view, no playback, no AI, no POS event linking**

## What shipped

| Capability | Location |
|------------|----------|
| Vision Manager UI | `/office/vision` → `VisionCamerasPage` |
| Settings entry | Settings hub card + back-office search |
| Auto discovery | Edge Agent `POST /v1/discover/onvif` + demo fallback |
| Manual RTSP | IP/port/path/user/pass → test → save |
| NVR import | Hikvision / Dahua / generic channel read API |
| Camera registry | IndexedDB KV `vision-camera-registry::*` |
| Credential vault | AES-GCM `vision-cred-vault::*` (reversible; not PIN hashes) |
| Zones + profiles | Reserved zone taxonomy + retail/pharmacy/restaurant suggestions |
| Camera test panel | Online / resolution / FPS / latency / signal / ONVIF / RTSP / snapshot |
| Edge Agent | `npm run vision:edge` → `scripts/vision-edge-agent/server.mjs` |

## Hard boundary preserved

POS UI talks only to `features/vision/*` and the local Edge Agent HTTP API. No ONVIF/RTSP imports in Sell, Cash, or Zustand store.

## Operator flow

```text
Settings → WAKA Vision
  → Scan network | Add RTSP | Import NVR
  → Select camera
  → Name / Location / Zone / Profile
  → Test
  → Save
```

## How to run real LAN discovery

```bash
npm run vision:edge
# keep running, then open the app → Settings → WAKA Vision → Scan network
```

Without the agent, Scan/NVR use **demo candidates** (clearly labeled) so the wizard can still be exercised.

## Explicitly not in V1.1

- Live WebRTC preview (V1.2)
- Playback / event timeline (V1.4)
- AI (V2.0)

*End of Vision V1.1 implementation notes.*

---

# Vision V1.2 — Enterprise Live View

**Date:** 2026-08-04  
**Scope delivered:** Live camera workspace + Edge Agent streaming (WebRTC primary, HLS fallback) — **no playback, recording UI, AI, motion, timeline, or POS event replay**

## Streaming architecture

```text
Browser (Live View)
  → Edge Agent HTTP (127.0.0.1:39217)  open / health / close
       → MediaMTX API (9997) register RTSP path (credentials stay on agent)
       → returns WHEP (:8889) + HLS (:8888) URLs only
  → Browser plays WHEP (WebRTC) or falls back to HLS (hls.js / native)
RTSP never reaches the browser.
```

Without MediaMTX, the Edge Agent still opens **demo sessions** so grids, status, recovery, and details can be certified offline.

## WebRTC pipeline

1. Live tile resolves RTSP (main, or substream for 9+/16 grids).
2. Vault secret is read in the POS process and sent only to the local Edge Agent over `stream/open`.
3. Agent injects credentials into the RTSP source URL and registers an on-demand MediaMTX path.
4. Browser performs WHEP offer/answer against MediaMTX (`whepPlayer.ts`).

## HLS fallback

If WHEP fails or is unavailable, `hlsPlayer.ts` attaches HLS via `hls.js` (or native Safari HLS). Preferred mode is advertised on the session (`webrtc` | `hls` | `demo`).

## Multi-camera layouts

| Grid | Route / UI |
|------|------------|
| 1 / 2 / 4 / 9 / 16 | `/office/vision/live` → `VisionLiveViewPage` |
| Phone | Forced single-camera focus |
| Tablet / desktop / ultrawide | Default 4 / 9 / 16; dense CSS grids |
| Performance | Substream preferred at 9+; unused tiles not mounted beyond grid size |

Entry points: Vision Manager **Open Live View**, Settings search (`vision-live`).

## Recovery behavior

- Connection states: connecting → live / demo → reconnecting → error
- Exponential backoff retries (up to 8) on tile error or offline health
- Manual **Refresh stream** resets retry counter
- Health poll every 8s does not tear down the media pipeline

## Camera status & details

Each tile shows name, health (Healthy / Warning / Offline / Reconnecting), latency, resolution, FPS, recording source, last seen.  
Selecting a tile opens the details panel (brand, model, firmware placeholder, IP, zone, assigned POS, recording method, ONVIF/RTSP, codec, resolution, FPS, playback mode) from V1.1 registry + live session health.

## Stream controls

Mute/unmute · Fullscreen · Refresh · Snapshot placeholder (deferred capture)  
No recording controls.

## Security (preserved)

- Credential vault unchanged (AES-GCM); browser never stores RTSP passwords in stream URLs
- Edge Agent remains the ONVIF/RTSP boundary (`127.0.0.1` bind)
- Live View gated by `settings.view` like Vision Manager
- Discovery / registry / vault / POS / Inventory / Reports / EOD left untouched beyond Live View entry links

## How to run

```bash
npm run vision:edge
npm run vision:mediamtx   # optional — real RTSP→WebRTC/HLS
# App → Settings → WAKA Vision → Open Live View
```

Manual certification targets: one ONVIF camera, one manual RTSP camera, one imported NVR channel (when available), plus demo tiles without MediaMTX.

## Performance summary

- 1–4 streams: main RTSP preferred
- 9–16 streams: substream preferred when registered; grid clamps to available camera count
- Desktop dense layout uses CSS grid columns; phones stay single-focus

## Regression summary

| Area | Status |
|------|--------|
| Discovery / registry / vault | Unchanged (V1.1) |
| POS / Inventory / Reports / EOD | Untouched |
| Timeline / Playback / AI | Not introduced |
| Edge Agent | Extended with `/v1/stream/*` only (v1.2.0) |

## Explicitly not in V1.2

- Playback / event timeline (V1.4)
- Camera Manager polish (V1.3)
- AI (V2.0)
- Recording / cloud storage / motion detection

*End of Vision V1.2 implementation notes.*

---

# Vision V1.3 — Camera Manager & DVR/NVR Integration

**Date:** 2026-08-04  
**Scope delivered:** Installer-friendly camera management — source wizard, DVR/NVR-first import, assignment, health cards, installer dashboard, hardware guidance  
**Explicitly not delivered:** AI · Playback · POS event replay · Cloud recording · Motion detection

## Before vs after installation workflow

| Before (V1.1) | After (V1.3) |
|---------------|--------------|
| Flat Scan / Manual / NVR buttons | First-run **source wizard** (NVR recommended) |
| One-by-one NVR channel save | Multi-select + **Import all / Import selected** |
| Raw status text on cards | Healthy / Warning / Offline with test metrics |
| No technician overview | **Installation dashboard** KPIs |
| Hikvision / Dahua / generic NVR | + Uniview, TP-Link VIGI, Reolink templates |
| Branch field schema-only | Branch assignment in wizard + edit |

## Camera source wizard

Empty registry opens:

1. **Connect DVR / NVR** (recommended) — best for most businesses  
2. **Discover ONVIF IP Cameras** (enterprise) — direct LAN cameras  
3. **Add RTSP Camera Manually** (advanced)

Copy states clearly that **WAKA never records video**; the recorder remains storage.

## DVR/NVR integration

- Connect → Edge Agent `POST /v1/nvr/channels` (TCP probe + brand RTSP templates)  
- Read cameras → candidate list with checkbox multi-select  
- Assign (name / location / zone / profile / POS / branch) → Save one or bulk  
- Supported vendor templates: Hikvision, Dahua, Uniview, TP-Link VIGI, Reolink, Generic ONVIF  
- Edge Agent version **1.3.0** (additive vendor templates only)

## Camera assignment

Each camera supports Name, Location, Zone, Business Profile, Assigned POS, Assigned Branch. Profiles still auto-suggest names/zones; retail now includes **Warehouse**.

## Installer dashboard

Shows Connected / Online / Offline / Recorder / Storage type / Recording status / Network (Edge Agent) status derived from the registry + agent health.

## Camera health

Registry cards map status + last test to 🟢 Healthy / 🟡 Warning / 🔴 Offline and surface resolution, FPS, latency, recording source, last seen.

## Hardware recommendation section

Informational “WAKA Vision Starter” and “Business” packs under Vision settings — no shopping cart.

## Scan UX

Progress phases while scanning (agent → discover → collect), device type labels (camera vs recorder), retry rescan. Discovery engine internals unchanged.

## Security (preserved)

AES-GCM vault · Edge Agent boundary · credentials never in browser stream URLs · Live View untouched.

## Regression summary

| Area | Status |
|------|--------|
| Live View / streaming | Unmodified |
| Discovery ONVIF probe | Unmodified (UI progress only) |
| Registry KV schema | Unchanged (thin bulk + branch helpers) |
| Credential vault | Unchanged |
| POS / Inventory / Reports / EOD | Untouched |
| Playback / Timeline / AI | Not introduced |

## How to run

```bash
npm run vision:edge
# App → Settings → WAKA Vision
# Empty shop → source wizard → Connect DVR/NVR (or ONVIF / RTSP)
```

*End of Vision V1.3 implementation notes.*

---

# Vision V1.3.5 — Enterprise Monitoring Workspace

**Date:** 2026-08-04  
**Scope:** Operator monitoring workspace (dashboard, floor plan, groups, layouts, favorites, search, status center)  
**Not in scope:** Playback · AI · POS timeline · Recording · Live streaming engine changes

## Surfaces

| Route | Role |
|-------|------|
| `/office/vision` | Install / CRUD (V1.1–V1.3) |
| `/office/vision/monitor` | **Monitoring workspace (V1.3.5)** |
| `/office/vision/live` | Streaming grid (reads `?grid=&cameras=&camera=` only) |

## Dashboard

Total / Online / Warning / Offline / Recording / Last Event (last seen until V1.4) / Active Recorder.

## Floor plan

Upload store layout image (local KV, ≤2.5 MB). Drag or tap-to-place camera pins (`x%`/`y%`). Does not alter camera registry rows.

## Camera groups

Collapsible groups: Entrance, Checkout, Sales floor, Loading bay, Storage, Office, Parking, Kitchen, Safe, Other — mapped from existing `zoneId`.

## Saved layouts

Presets (4 / 9 / Cashier / Warehouse / Entrance / Closing) + operator-saved layouts open Live View via query params without changing WHEP/HLS code.

## Favorites & search

⭐ favorites sort first. Search: name, zone, recorder, brand, branch, assigned POS.

## Status center

Healthy / Warning / Offline counts, recording count, latency hint, network / Edge Agent status.

## Multi-branch

Branch filter uses existing `branchLabel` — no schema migration.

## Workspace KV (separate from registry)

`vision-monitor-workspace::${shopScopeId}` — favorites, collapsed groups, floor plan, layouts, selected branch.

## Responsive

Phone: one-camera Live links; tablet/desktop/ultrawide: multi-column monitor + dense grids.

## Regression summary

| Area | Status |
|------|--------|
| Live streaming / Edge Agent | Unchanged (page query wiring only) |
| Discovery / registry / vault | Unchanged |
| POS / Timeline / Playback / AI | Not introduced |

*End of Vision V1.3.5 implementation notes.*

---

# Vision V1.4 — Analog-First CCTV Architecture

**Date:** 2026-08-04  
**Type:** Architectural product refinement (installer UX + documentation)  
**Not rewritten:** Live View · streaming · Edge Agent APIs · credential vault · camera registry schema · POS timeline / playback / AI

> Note: Earlier roadmap labeled “V1.4” as POS Event Timeline. That work remains next as **Vision V1.5**. This V1.4 locks **analog/DVR-first** as the primary market architecture.

## Why DVR-first was chosen

Most target businesses already run **analog HD cameras (TVI/AHD/CVI)** into a **Hikvision/Dahua DVR** with a local surveillance HDD. Replacing that stack is expensive and unnecessary. WAKA Vision is the **intelligence layer** above the existing CCTV brain — not a camera replacement product.

## Analog-first deployment strategy

```text
PRIMARY
Analog Cameras (sensors)
  → DVR (CCTV brain + recording + HDD)
    → Vision Edge Agent (LAN boundary)
      → WAKA Vision (manage / monitor / assign)
        → WAKA POS (future event links)

SECONDARY
IP Cameras → NVR → Vision

ADVANCED
Manual RTSP
```

WAKA **never** talks to analog cameras directly. WAKA **never** records video — the DVR remains storage.

## Updated installation workflow

1. First-run wizard: **Use Existing CCTV System** (recommended) → IP Cameras + NVR → Manual RTSP  
2. Helper: “WAKA Vision works with your existing CCTV system. No need to replace your cameras.”  
3. Connect DVR → read channels → Import all / selected → assign location / POS / zone / branch / profile  

## Recorder-first management model

Vision Manager shows **Recorders → Channels → Assigned cameras**.  
Installer dashboard KPIs are recorder-centric (Connected DVR, recorder health, storage, camera count, offline cameras, network, recording).  
Camera cards appear **after** selecting a recorder.  
Recorder meta (display name, capacity labels) lives in `vision-recorder-meta::*` — **not** in the camera registry.

## Updated hardware recommendations

Installer packages (informational only):

- **Starter:** 8CH Hikvision DVR · 4 analog HD cameras · 1TB HDD · PSU · BNC  
- **Business:** 16CH DVR · 8–16 cameras · 4TB HDD  

## Enterprise architecture diagram

```text
[Analog HD cams]──BNC──▶[DVR + HDD]──LAN──▶[Vision Edge Agent]
                                              │
                                              ▼
                                         [WAKA Vision]
                                              │
                                              ▼
                                           [WAKA POS]
```

## Regression summary

| Area | Status |
|------|--------|
| Live View / streaming | Unmodified |
| Edge Agent / APIs | Unmodified |
| Camera registry KV | Unmodified |
| Credential vault | Unmodified |
| Installer UX / wizard / hardware copy | Updated (V1.4) |
| Recorder meta KV | Additive (`vision-recorder-meta::*`) |
| POS Event Timeline | Deferred to V1.5 |

*End of Vision V1.4 Analog-First architecture notes.*

---

# Vision V1.4.5 — Activation & Licensing (audit)

Read-only certification:  
`docs/VISION_1_4_5_ENTERPRISE_VISION_ACTIVATION_AND_LICENSE_CERTIFICATION.md`

**Finding (audit):** Vision was ungated beyond `settings.view`.  

**Implementation:** Internal Admin Shop Console → **Vision** tab provisions enablement, license, limits, features, and trial (`144_shop_vision_settings.sql`). Customers see status only — no self-enable switch. See V1.4.5 certification for details.

