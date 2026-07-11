# Phase 17.6 — Enterprise Device Management Decommission Audit

**Mode:** Read-only (no code changes)  
**Date:** July 2026  
**Context:** Primary Device / Secondary Device **client policy was disabled** (`ENFORCE_PRIMARY_DEVICE = false` in `deviceAuthorityPolicy.ts`), but substantial primary-device architecture remains in database, RPCs, UI strings, and conditional code paths.

---

## Executive summary

| Layer | Primary/secondary still present? | Actively enforced today? |
|-------|----------------------------------|---------------------------|
| **Client policy flag** | References everywhere | **No** — `ENFORCE_PRIMARY_DEVICE = false` |
| **PostgreSQL schema** | Yes — columns, constraints, backfill | **Yes** — data still maintained |
| **Supabase RPCs** | Yes — `shop_device_can_manage_staff`, transfer, admin set primary | **Yes** — server still gates on `device_authority = 'primary'` |
| **UI copy & components** | Yes — i18n, gates (dormant), badges (hidden) | **Partially** — hidden when flag false |
| **Sync engine** | No primary dependency in `offline/` | **No** |
| **Subscription limits** | Device **count** only | **Yes** — plan slot enforcement |

**Critical finding:** Client and server are **split-brain**. The app behaves as if primary designation is off, but cloud RPCs still reject non-primary devices for staff mutations and some approval paths. This is the highest-risk area before any cleanup.

---

## 1. Device Architecture Report (dependency graph)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     deviceAuthorityPolicy.ts                             │
│  ENFORCE_PRIMARY_DEVICE = false                                        │
│  AUTO_APPROVE_DEVICE_ON_OWNER_LOGIN = true                             │
│  ALLOW_STAFF_LOGIN_WHILE_DEVICE_PENDING = true                         │
│  OWNER_BYPASS_DEVICE_PENDING_ON_LOGIN = true                           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 deviceAuthority.ts    DeviceAuthorityContext    ManagedByPrimaryDevice
 (cache, transfer,       (isPrimary forced true    PrimaryDeviceGate
  approval RPCs)         when flag false)          (pass-through when false)
        │                       │
        ├───────────────────────┼──────────────────────────┐
        ▼                       ▼                          ▼
 deviceActivation.ts     usePosStore staff ops      staffAccountAuthorization
 (login, limit, owner     isPrimaryDeviceCachedSync   ENFORCE check skipped
  auto-approve, bypass)   → always true when false
        │                       │
        ▼                       ▼
 shopDevices.ts           backupRestoreAuthorization   staffCacheSync
 (list, partition)        isPrimaryDeviceCachedSync    isSecondaryStaffTerminal
                          → passes when false           → always false when false
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Supabase (still primary-aware)                   │
│  shop_devices: device_authority, is_primary, device_type                 │
│  shops: primary_device_id, active_device_count                           │
│  RPCs: shop_device_context, shop_device_transfer_primary                 │
│        shop_device_set_approval, shop_device_can_manage_staff            │
│        shop_pos_staff_upsert/delete/set_active/unlock                    │
│        admin_shop_set_primary_device (migration 131)                     │
└─────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 Internal Admin (trusted/suspicious — not primary/secondary)
   AdminDevicesPage, ShopConsoleDevicesTab, adminShopSetPrimaryDevice (unused in UI?)
```

### Core module inventory

| File | Role | Primary/secondary coupling |
|------|------|----------------------------|
| `src/lib/deviceAuthorityPolicy.ts` | **Policy switch** | Defines `ENFORCE_PRIMARY_DEVICE = false` |
| `src/lib/deviceAuthority.ts` | Authority cache, transfer, approval | Heavy — types, RPCs, `isPrimaryDeviceCachedSync` |
| `src/lib/primaryDevice.ts` | **Deprecated re-export** | Alias layer — safe removal candidate after import migration |
| `src/lib/deviceActivation.ts` | Login activation, limits, owner bypass | Medium — reads `device_authority` from RPC responses |
| `src/context/DeviceAuthorityContext.tsx` | React state | Branches on `ENFORCE_PRIMARY_DEVICE` |
| `src/context/DeviceActivationContext.tsx` | Login gate | No primary logic — approval/limit only |
| `src/components/DeviceActivationGateOutlet.tsx` | Route gate | Pending/limit/revoked — not primary |
| `src/components/device/ManagedByPrimaryDevice.tsx` | UI gate | Dormant when flag false |
| `src/components/device/DeviceAuthorityBridge.tsx` | Wires shopId | None |
| `src/lib/staffAccountAuthorization.ts` | Staff CRUD auth | Skips device check when flag false |
| `src/lib/staffCacheSync.ts` | Offline staff cache | `isSecondaryStaffTerminal` dormant when flag false |
| `src/lib/backupRestoreAuthorization.ts` | Backup import gate | Passes when `isPrimaryDeviceCachedSync()` true (always when flag false) |
| `src/lib/shopStaffCloud.ts` | Staff cloud RPCs | Handles `not_primary_device` error from server |
| `src/store/usePosStore.ts` | Staff mutations | Checks `isPrimaryDeviceCachedSync()` — never blocks when flag false |
| `src/pages/DeviceManagementPage.tsx` | `/settings/devices` | UI conditionals on `ENFORCE_PRIMARY_DEVICE` |
| `src/pages/DevicePendingApprovalPage.tsx` | `/device-pending` | Copy still says "Primary Device" |
| `src/pages/DeviceLimitReachedPage.tsx` | `/device-limit` | Slot limit — not primary |
| `src/pages/ConnectedDevicesPage.tsx` | **ORPHAN** — not routed | Legacy owner device list |
| `src/lib/wakaInternalAdmin.ts` | Admin RPCs | `adminShopSetPrimaryDevice`, fleet `device_authority` field |
| `src/lib/rescueDeviceList.ts` | Sorts primary first | Display only |

### SQL migrations (device / primary)

| Migration | Content |
|-----------|---------|
| `088_owner_connected_devices.sql` | Owner list/disconnect (pre-authority) |
| `089_device_status_lifecycle.sql` | `status` enum, `active_device_count` |
| `090_device_limit_enforcement.sql` | Plan limit on new activation |
| `091_device_heartbeat_no_bypass.sql` | Heartbeat rules |
| `107_plan_device_staff_limits.sql` | Plan features |
| `123_shop_staff_device_architecture_phase1.sql` | **`is_primary`, `primary_device_id`, `shop_device_can_manage_staff`** |
| `124_device_authority_phase2.sql` | **`device_authority`, transfer, approval, context RPC** |
| `126_staff_security_phase4.sql` | Staff RPCs use `shop_device_can_manage_staff` |
| `131_admin_recovery_primary_devices.sql` | **`admin_shop_set_primary_device`** |
| `132_enterprise_device_licensing.sql` | Device limit context, licensing |
| `133_device_pending_approval_timeout.sql` | Pending expiry, owner dismiss |
| `095_identity_trust_hardening.sql` | Trust flags, staff upsert variants |

---

## 2. Remaining Primary Device References (every code path)

### 2.1 Policy gate (single switch)

```typescript
// src/lib/deviceAuthorityPolicy.ts
export const ENFORCE_PRIMARY_DEVICE = false;
```

When `false`, these always behave as "primary":
- `isPrimaryDeviceCachedSync()` → `true`
- `canPerformPrimaryActionSync()` → `true`
- `DeviceAuthorityContext.isPrimary` → `true` (for supabase mode)
- `PrimaryDeviceGate` → renders children unchanged
- `ManagedByPrimaryDevice` → returns `null`
- `staffAccountAuthorization` → skips device check
- `isSecondaryStaffTerminal()` → `false`

### 2.2 Still executed regardless of flag

| Path | Behavior |
|------|----------|
| `transferPrimaryDevice()` | Calls `shop_device_transfer_primary` RPC — **still mutates DB** if invoked |
| `setCurrentDeviceAsPrimary()` | Wrapper for transfer — **SettingsSellingPage** still imports (UI hidden when flag false) |
| `adminShopSetPrimaryDevice()` | Internal admin RPC — **exported but no UI caller found** |
| `shop_device_context` RPC | Returns `primary_device_fingerprint`, `device_authority`, `is_primary` |
| DB backfill / triggers | `sync_shop_device_authority` keeps `is_primary` ↔ `device_authority` in sync |
| `rescueDeviceList` sort | Primary devices listed first |
| i18n keys | ~25 EN strings still say "Primary Device", "Secondary Device", "Make Primary" |

### 2.3 UI surfaces (conditional on flag)

| Location | When `ENFORCE_PRIMARY_DEVICE=false` |
|----------|-------------------------------------|
| `DeviceManagementPage` | Badges show platform label only; no transfer button; no primary banner; owner can approve |
| `SettingsStaffRolesPage` | `PrimaryDeviceGate` pass-through |
| `StaffAccessPage` | `PrimaryDeviceGate` pass-through |
| `BackupSyncPage` | `PrimaryDeviceGate` pass-through |
| `SettingsSellingPage` | Register mode primary section hidden |
| `DevicePendingApprovalPage` | **Copy unchanged** — still references Primary Device in i18n |

### 2.4 Server-side enforcement (always active)

`shop_device_can_manage_staff(p_shop_id, p_device_fingerprint)` (migration 124):

1. If shop has **no** operational primary device → returns `true` (any device)
2. If shop **has** operational primary → returns `true` **only** for that fingerprint

Used by:
- `shop_pos_staff_upsert`, `_delete`, `_set_active`, `_unlock`
- `shop_device_set_approval` (actor fingerprint check)
- `shop_device_transfer_primary` (actor must be primary)
- Enterprise device licensing RPCs (132)

**Implication:** Shops with backfilled primary device in DB will **block cloud staff writes** from secondary devices even though client allows them.

---

## 3. Obsolete Database Fields

### 3.1 `shop_devices` table

| Column | Status | Notes |
|--------|--------|-------|
| `device_fingerprint` | **Keep** | Core identity |
| `label`, `platform`, `app_version` | **Keep** | Fleet display |
| `status`, `approval_status` | **Keep** | Activation workflow |
| `is_active` | **Keep** (synced from status) | Legacy mirror |
| `trusted`, `suspicious_flag` | **Keep** | Internal admin trust model (separate from primary) |
| `last_seen_at`, `last_login_at`, `last_sync_at` | **Keep** | Ops |
| `device_authority` | **Obsolete for product policy** | Still written/read; `'primary' \| 'secondary'` |
| `is_primary` | **Obsolete** | Trigger-synced from `device_authority` |
| `device_type` | **Partially obsolete** | `primary_pos` / `secondary_pos` taxonomy from phase 1 |
| `form_factor` | **Keep** | tablet/phone/kitchen/bar |
| `current_staff_client_id` | **Keep** | Presence |
| `approval_requested_at`, `approval_expires_at` | **Keep** | Pending timeout (133) |

### 3.2 `shops` table

| Column | Status |
|--------|--------|
| `primary_device_id` | **Obsolete for policy** — still FK to `shop_devices` |
| `active_device_count` | **Keep** — subscription limit enforcement |

### 3.3 Constraints / indexes (obsolete if primary removed)

- `shop_devices_one_primary_per_shop` (partial unique on `is_primary`)
- `shop_devices_device_authority_check`
- `shop_devices_device_type_check` (primary_pos / secondary_pos values)

### 3.4 RPCs — removal candidates (after migration)

| RPC | Purpose |
|-----|---------|
| `shop_device_transfer_primary` | Promote device |
| `admin_shop_set_primary_device` | Admin recovery promote |
| `shop_device_can_manage_staff` | Primary check — **must replace** before removal |

---

## 4. Broken Workflows (policy change regressions)

| ID | Severity | Workflow | Expected (new policy) | Actual | Root cause |
|----|----------|----------|----------------------|--------|------------|
| **D17.6-001** | 🔴 Critical | Owner adds staff from non-primary device | Staff saves to cloud | Cloud RPC returns `not_primary_device`; client may show success locally | Client flag off; SQL `shop_device_can_manage_staff` still requires primary |
| **D17.6-002** | 🔴 Critical | Owner approves pending device from secondary browser | Approval succeeds | `shop_device_set_approval` may fail with `not_primary_device` when actor FP passed | Same RPC uses `shop_device_can_manage_staff` for actor |
| **D17.6-003** | 🟠 High | Owner login owner-bypass (`OWNER_BYPASS_DEVICE_PENDING_ON_LOGIN`) | Cloud and client agree on approval state | Client `activated: true` with bypass while DB row may stay `pending` | Bypass is client-only |
| **D17.6-004** | 🟡 Medium | Device pending page copy | Neutral "awaiting owner approval" | Still says "Primary Device must approve" | i18n not updated |
| **D17.6-005** | 🟡 Medium | `DeviceManagementPage` line 225 | Only owner approves pending | When flag false, `isPrimary` true — non-owner approved devices could see approve UI | `canPrimary` returns `isApproved` only when flag false |
| **D17.6-006** | 🔵 Low | Transfer primary button | Hidden | Correct when flag false — but RPC still exists if called programmatically | Intentional partial decommission |
| **D17.6-007** | 🔵 Low | `ConnectedDevicesPage` | N/A | Page exists, **not mounted in App.tsx** | Orphan dead page |

**Sync (`offline/cloudSync.ts`):** No references to primary/trusted/activation — **not broken** by primary decommission.

---

## 5. Route Audit

| Route | Component | Status | Primary/secondary exposure |
|-------|-----------|--------|------------------------------|
| `/settings/devices` | `DeviceManagementPage` | **Production** | Conditional UI; core device mgmt |
| `/device-pending` | `DevicePendingApprovalPage` | **Production** | Copy references primary |
| `/device-limit` | `DeviceLimitReachedPage` | **Production** | Slot limit only |
| `/internal/waka/devices` | `AdminDevicesPage` | **Production** | Trust/suspicious — not primary |
| `/internal/waka/shop/:id` → Devices tab | `ShopConsoleDevicesTab` | **Production** | Trust/activate — no primary UI |
| `/internal/waka/activations` | `InternalActivationOpsPage` | **Production** | Business activation — separate from device |
| `/activate` | `BusinessActivationPage` | **Production** | Commercial activation — not device |
| *(none)* | `ConnectedDevicesPage` | **Orphan** | Legacy — duplicate of older owner list |

**Gate stack (App.tsx):** `DeviceActivationProvider` → `DeviceActivationGateOutlet` blocks on pending/limit/revoked — **not** on primary/secondary.

---

## 6. Workflow Audit (decision points)

```
Owner login
  → registerShopDeviceOnLogin (RPC)
  → AUTO_APPROVE if owner (tryOwnerApproveCurrentDevice)
  → OWNER_BYPASS if slot free + pending
  → DeviceActivationGateOutlet: pending → /device-pending, limit → /device-limit

Device check
  → shop_device_register_on_login / shop_device_ensure_activation
  → evaluateDeviceLimitBlock (plan slot count)
  → approval_status: pending | approved | revoked

Approval
  → Owner: setDeviceApprovalStatus (RPC) — ⚠ may require primary actor FP on server
  → Pending timeout: 1 min (133) → retry path
  → Staff login: ALLOW_STAFF_LOGIN_WHILE_DEVICE_PENDING

Activation
  → shop_device_ensure_activation
  → staff cache provision (scheduleStaffCacheProvisioning)

Sync
  → No primary check in cloudSync
  → Staff push: shop_pos_staff_upsert — ⚠ server primary check

Logout / Replacement
  → owner_record_device_replacement, recordDeviceReplacementCompleted
  → disconnectOwnerShopDevice / removeOwnerShopDevice

Recovery
  → backupRestore cloud_recovery purpose bypasses primary
  → user_import: client passes (flag false); async checks canPerformPrimaryAction → approved only
```

---

## 7. Permission Audit

| Check | Assumes primary? | When flag false |
|-------|------------------|-----------------|
| `RoleProtectedRoute` | No | — |
| `staffAccountAuthorization` | Yes (optional) | **Skipped** |
| `usePosStore` staff CRUD | Yes | **Skipped** (client) |
| `canPerformPrimaryAction` | Yes | Returns **approved** only |
| `assertPrimaryDeviceAction` | Yes | Only blocks **pending** |
| `authorizeBackupRestore` | Yes | **Passes** |
| SQL staff RPCs | Yes | **Still enforced** |
| `settings.devices` permission | No | Owner/manager access |

**Staff login while pending:** Allowed by policy (`ALLOW_STAFF_LOGIN_WHILE_DEVICE_PENDING`).

---

## 8. Sync Audit

| Concern | Depends on primary? |
|---------|---------------------|
| Sale push queue | No |
| Product/inventory sync | No |
| Staff cache download | No (all approved devices refresh) |
| Staff cache upload after mutation | `refreshStaffCacheAfterPrimaryMutation` — skips if secondary; **never secondary when flag false** |
| Cloud snapshot pull/push | No |
| Multi-device merge | No |

**Verdict:** Sync layer is **decoupled** from primary designation. Staff **cloud writes** are the exception (server RPC).

---

## 9. Subscription Audit

| Mechanism | Primary-aware? |
|-----------|----------------|
| `device_limit` from plan features | **No** — count only |
| `shop_device_limit_context` RPC | **No** — active count vs limit |
| `evaluateDeviceLimitBlock` | **No** |
| `subscriptionEnforcement.test.ts` | Device cap tests — not primary |
| `max_devices` on subscription row | Count cap only |

First device on shop may still be assigned `device_authority = 'primary'` in SQL during registration — **historical**, not used for billing.

---

## 10. Internal Admin Audit

| Surface | Primary/secondary UI | Trust model |
|---------|---------------------|-------------|
| `AdminDevicesPage` | Fleet card shows trusted/suspicious | **Trust** — separate from primary |
| `ShopConsoleDevicesTab` | Activate/trust/force logout | No primary badges |
| `adminShopSetPrimaryDevice` | **No UI button found** | RPC exists for rescue |
| `AdminDeviceForensicsPanel` | Diagnostics | No primary |
| Ops widgets `DeviceFleetCard` | "Trusted / Untrusted" | Not primary/secondary |

Internal admin has largely moved to **trust/suspicious** flags; primary promotion is **admin RPC only** (migration 131).

---

## 11. UI Audit (strings & components still mentioning primary)

### i18n (`src/lib/i18n.ts`) — EN keys

- `notPrimaryDevice`, `managedByPrimaryTitle`, `managedByPrimaryBody`
- `devicePendingApprovalBody`, `devicePendingApprovalHint`, `deviceApprovalOwnerOnlyHint`
- `deviceMgmtPrimaryBadge`, `deviceMgmtSecondaryBadge`
- `deviceMgmtTransferPrimary`, `deviceMgmtMakePrimary`, `deviceMgmtUsageHint`
- `registerModePrimaryDevice`, `deviceMgmtRegisterPrimaryHint`

### Components (dormant or conditional)

- `ManagedByPrimaryDevice`, `PrimaryDeviceGate`
- `DeviceManagementPage` — transfer/make primary (hidden)
- `DevicePendingApprovalPage` — comment + i18n
- `StaffCacheMissingScreen` — "secondary device" comment

---

## 12. Dead Code Audit

| Item | Verdict |
|------|---------|
| `ConnectedDevicesPage.tsx` | **Orphan** — not in `App.tsx` |
| `primaryDevice.ts` | **Deprecated shim** — re-exports `deviceAuthority` |
| `adminShopSetPrimaryDevice()` | **Unused in UI** — RPC wrapper only |
| `transferPrimaryDevice` / UI handlers | **Reachable only if flag true** — dead UI path today |
| `ManagedByPrimaryDevice` / `PrimaryDeviceGate` | **Dormant** when flag false — keep until cleanup or remove with flag |
| `isSecondaryStaffTerminal` | **Always false** when flag false |
| `device_type` primary_pos/secondary_pos | **Legacy column** — form_factor superseded |
| Migrations 123–131 | **Not unused** — still define live RPCs |

---

## 13. Cleanup Plan

### Safe to remove (after server alignment)

1. `ENFORCE_PRIMARY_DEVICE` flag and all branches — once server no longer checks primary
2. `ManagedByPrimaryDevice`, `PrimaryDeviceGate` components
3. `primaryDevice.ts` shim (migrate imports to `deviceAuthority`)
4. `ConnectedDevicesPage.tsx` (orphan)
5. i18n primary/secondary strings (replace with approval/limit copy)
6. `transferPrimaryDevice`, `setCurrentDeviceAsPrimary` client wrappers
7. UI conditionals in `DeviceManagementPage` for transfer/badges

### Keep (still required)

1. `deviceActivation.ts` + `DeviceActivationContext` — limit & approval workflow
2. `/device-pending`, `/device-limit` routes
3. `shop_devices.status`, `approval_status`, fingerprint columns
4. `trusted` / `suspicious_flag` — internal admin trust
5. `active_device_count`, plan device limit RPCs
6. `DeviceManagementPage` — approval, disconnect, remove (owner)

### Needs migration (SQL — do not drop until RPCs updated)

1. **`shop_device_can_manage_staff`** — replace with owner-role check or approved-device check
2. **`shop_device_transfer_primary`** — drop after no callers
3. **`admin_shop_set_primary_device`** — drop or repurpose for admin "set approved device"
4. **`shops.primary_device_id`** — drop FK after RPCs stop writing
5. **`shop_devices.device_authority`, `is_primary`** — deprecate columns (nullable → remove)
6. **`shop_devices.device_type`** primary_pos/secondary_pos — migrate to `form_factor` only
7. Partial unique index `shop_devices_one_primary_per_shop` — drop

### Needs replacement

1. **Staff cloud write authorization** — use `user_is_shop_owner` OR `approval_status = approved` instead of primary fingerprint
2. **Device approval actor check** — owner-only (already requires owner) should **not** use `shop_device_can_manage_staff`
3. **Pending approval copy** — remove "Primary Device" language
4. **Owner bypass** — either sync DB on bypass or remove bypass and rely on auto-approve RPC fix

---

## 14. Enterprise Device Certification

| Module | Score | Notes |
|--------|-------|-------|
| Authentication | **8.5/10** | Login + device activation solid; split-brain on staff cloud |
| Device activation | **8.0/10** | Limit + pending work; owner bypass desync risk |
| Device management (owner UI) | **7.5/10** | Functional with flag false; stale copy |
| Internal Admin | **8.5/10** | Trust model; primary RPC unused in UI |
| Offline | **9.0/10** | Staff cache refresh not primary-gated when flag false |
| Sync | **9.0/10** | No primary dependency in sync engine |
| Recovery | **8.5/10** | Cloud recovery bypasses primary correctly |
| Replacement | **8.0/10** | `owner_record_device_replacement` — count-based |

**Overall device architecture readiness for decommission:** **7.8/10** — safe to **plan** cleanup, **not safe to delete** SQL/columns until `shop_device_can_manage_staff` is replaced and D17.6-001/002 are resolved.

---

## 15. Recommended decommission sequence (implementation phase — not done here)

1. **Fix split-brain** — SQL: change `shop_device_can_manage_staff` to owner-role or any-approved-device (no primary)
2. **Fix approval RPC** — remove primary actor check for owners
3. **Update i18n** — remove Primary Device user-facing copy
4. **Remove client flag + gates** — delete `ENFORCE_PRIMARY_DEVICE` branches
5. **Drop transfer RPCs** — client + `admin_shop_set_primary_device`
6. **Migrate schema** — drop `primary_device_id`, `device_authority`, `is_primary`
7. **Delete orphan** — `ConnectedDevicesPage`, `primaryDevice.ts`

---

*Phase 17.6 audit complete. No code was modified. Do not delete primary-device artifacts until server RPCs are migrated — client policy alone is insufficient.*
