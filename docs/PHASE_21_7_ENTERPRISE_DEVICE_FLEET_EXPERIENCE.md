# Phase 21.7 — Enterprise Device Fleet Experience

UX-only upgrade to owner Device Management (`/settings/devices`). Phase 20 device architecture, activation, approval, limits, RPC contracts, and SQL schema are unchanged.

**Objective:** Surface the complete device fleet with accurate presence, history, and management tools — matching Internal Admin diagnostic quality for shop owners.

---

## Before vs after UI

### Before (Phase 21.3 Issue C)

```
/settings/devices
  ├── Active devices only (approved + online-ish)
  ├── Pending approval
  └── History (disconnected/revoked) fetched but NOT rendered

Status: status === "active" → "Healthy" badge
Missing: heartbeat presence, search/filters, details panel, rename, staff label
```

### After (Phase 21.7)

```
/settings/devices
  ├── This device (highlight panel — version, last sync, last seen)
  ├── Plan usage + register hint
  ├── Search + filter chips
  └── Fleet buckets (nothing hidden)
        ├── This device
        ├── Approved
        ├── Pending approval
        ├── Offline
        ├── Disconnected
        └── Revoked

Each card: name, platform, badges, presence, last seen/sync, version, short ID, staff
Actions: Approve, Disconnect, Remove, Copy ID, View details, Rename (local alias)
```

---

## Fleet architecture

```
owner_list_shop_devices (RPC — unchanged)
        ↓
fetchShopDevicesForManagement()
        ↓
DeviceManagementPage
        ├── filterFleetDevices() — search + chip filters
        ├── groupFleetDevicesByBucket() — current / approved / pending / offline / disconnected / revoked
        ├── resolveDevicePresence() — heartbeat-first presence
        └── DeviceFleetCard + DeviceFleetDetailsPanel
```

New modules (presentation only):

| Module | Role |
|--------|------|
| `deviceFleetPresence.ts` | Heartbeat → presence states + `[waka-device]` diagnostics |
| `deviceFleetCatalog.ts` | Buckets, filters, search, timeline |
| `deviceFleetLabels.ts` | Local display aliases (localStorage, no RPC) |
| `DeviceFleetCard.tsx` | Enterprise card + owner actions |
| `DeviceFleetDetailsPanel.tsx` | Read-only diagnostics + rename alias |
| `DeviceFleetFilters.tsx` | Search + filter chips |

---

## Heartbeat model

Presence resolution order (same 15-minute online window as Internal Admin rescue console):

```
last_seen_at (shop_device_heartbeat)
        ↓
last_sync_at
        ↓
last_login_at
```

States:

| State | Condition |
|-------|-----------|
| **Online** | Activity within 15 minutes |
| **Recently active** | Activity within 1 hour |
| **Offline** | Older than 1 hour or disconnected/revoked |
| **Unknown** | Approved/active row with no timestamps |

Diagnostics log format (never tokens or credentials):

```
[waka-device] fleet_loaded { count, shopId }
[waka-device] device_id_copied { deviceId }
```

---

## Device lifecycle

```
Sign-in on new device
        ↓
Register (Phase 20 — unchanged)
        ↓
Pending approval → Owner approves → Approved / active
        ↓
Heartbeat + sync while in use
        ↓
Disconnect (session ends, row kept) OR Remove (revoked, slot freed)
        ↓
Still visible in fleet under Disconnected or Revoked — never hidden
```

**Rename:** Display alias stored locally per `shopId:deviceId`. Helps owners recognize devices; does not change server label (no owner rename RPC in Phase 20).

**Current device:** Identified by `currentDeviceFingerprint()`. Remove action hidden for current session; Disconnect still available with explanatory hint.

---

## Owner actions

| Action | When | Consequence (unchanged backend) |
|--------|------|--------------------------------|
| Approve | Pending | Activates device; subject to plan limit |
| Delete request | Pending | Dismisses pending row |
| Disconnect | Approved + active | Ends session; device moves to disconnected |
| Remove | Approved + not current | Revokes + frees license slot |
| Copy device ID | Any | Clipboard fingerprint (short display on card) |
| View details | Any | Timeline + diagnostics panel |
| Save name | Details panel | Local alias only |

---

## Regression checklist

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Fleet with Android, Windows, Web | All visible; platform filters work |
| 2 | Device disconnects | Appears under **Disconnected** |
| 3 | Pending → approved | Moves from **Pending** to **Approved** bucket |
| 4 | Heartbeat ages | Online → Recently active → Offline |
| 5 | Current session | **This device** bucket + badge follow fingerprint |
| 6 | Search / filters | Name, ID, status, platform filters correct |

Tests: `deviceFleetPresence.test.ts`, `deviceFleetCatalog.test.ts`

---

## Verification matrix

| Area | Verified | Notes |
|------|----------|-------|
| Full fleet visible | ✅ | Includes disconnected + revoked |
| Presence from heartbeat | ✅ | Not `status === active` only |
| Current device panel | ✅ | Version, sync, last seen |
| Search & filters | ✅ | 11 filter chips + text search |
| Details + timeline | ✅ | Registered, approved, login, sync, activity |
| Local rename alias | ✅ | UX-only; documented |
| No RPC/schema changes | ✅ | Phase 20 contracts untouched |
| Build | Run `npm run build` | |
| Tests | Run `npm test` | |

---

## Explicit non-goals (unchanged)

- Device activation flow
- Approval RPCs and limits
- Login / authentication
- Staff permissions
- Shop Security PIN
- Subscription system
- SQL schema

---

## Next phase

**Phase 21.8 — Drawer Tolerance & Cash Variance UX** (Issue F from Phase 21.3 stability roadmap). Recommend full enterprise regression certification after 21.8 before major new features.
