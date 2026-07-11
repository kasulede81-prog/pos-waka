# Phase 20.1 — Enterprise Device Management Certification

**Mode:** Read-only enterprise certification (no code changes)  
**Date:** July 2026  
**Prerequisite:** Phase 20.0 — Enterprise Device Management Decommission  
**Method:** Static architecture audit, migration chain analysis, full-repository search, workflow path tracing  
**Runtime scope:** Code and migration definitions only — live Supabase deployment state must be verified separately

---

## Executive Summary

Phase 20.0 successfully decommissioned Primary Device **enforcement** from active production paths. Waka POS now operates on a single **Approved Device** authority model: any owner device that is **approved** and **operational** (`status = active`) has equal management authority.

| Question | Certification Answer |
|----------|---------------------|
| Has Primary Device been completely removed? | **Enforcement: yes.** Legacy columns and compatibility echoes remain by design. |
| Do client and server agree? | **Yes, when migrations 136 + 138 are applied.** |
| Is every approved owner device equal? | **Yes** — `shop_device_can_manage_staff` and client gates use approval + operational status only. |
| Do workflows continue working? | **Certified by static analysis** — no production workflow gates on primary authority. |
| Hidden regressions? | **One deployment risk:** DB not migrated → old RPC behavior. **No client/server split-brain** (flag removed). |
| Enterprise-certified? | **Conditional pass** — production-ready pending migration deployment and column cleanup in a future phase. |

**Overall Enterprise Readiness Score: 91 / 100**  
**Production Readiness Score: 93 / 100** (codebase) · **Conditional on DB migrations 136 + 138**

---

## Current Authority Model (Single Source of Truth)

```
                    ┌─────────────────────────────────────┐
                    │         shop_devices row            │
                    │  approval_status + status           │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   shop_device_is_operational   shop_device_can_manage_staff   Client cache
   (approved + active)          (136: approved operational     isDeviceAuthorized
                                 device fingerprint match)      (deviceAuthority.ts)
          │                           │                           │
          └───────────────────────────┴───────────────────────────┘
                                      │
                         Approved Device = full owner authority
                         Pending / Blocked = gated actions only
```

### Approval Lifecycle

| State | `approval_status` | `status` | Owner POS access | Staff login | Owner actions |
|-------|-------------------|----------|------------------|-------------|---------------|
| **Pending** | `pending` | `disconnected` | Blocked (except allowed paths) | Allowed if policy flag on | Blocked |
| **Approved** | `approved` | `active` | Full | Full | Full |
| **Blocked** | `revoked` / `suspended` / `disabled` | `revoked` / etc. | Blocked | Blocked | Blocked |

### Authority by Actor

| Actor | Authority source | Primary dependency |
|-------|------------------|-------------------|
| **Owner** | Supabase auth + approved operational device | **None** |
| **Staff** | PIN/password + device approval check (`staffLoginSecurity.ts`) | **None** |
| **Internal Admin** | Admin role + admin RPCs (trust, deactivate, forensics) | **None** |
| **Sync engine** | Online + shop context; refreshes device authority cache | **None** |

---

## PART 1 — Architecture Certification

| Area | Status | Evidence |
|------|--------|----------|
| Current authority model | ✅ **Certified** | Pending → Approved → Blocked; no tiered owner authority |
| Approval lifecycle | ✅ **Certified** | `shop_device_register_on_login` (138), `shop_device_set_approval` (133) |
| Owner authority | ✅ **Certified** | Equal for all approved operational devices |
| Staff authority | ✅ **Certified** | Role + permissions; device approval gate only |
| Internal Admin authority | ✅ **Certified** | Trust / deactivate / forensics — no primary tools |
| Sync authority | ✅ **Certified** | `offline/` has zero primary-device references |
| Single source of truth | ✅ **Certified** | Server: `shop_device_is_operational` + `shop_device_can_manage_staff`; Client: `isDeviceAuthorized` |

**Migration chain (live definitions):**

| Function | Defining migration | Primary enforcement |
|----------|-------------------|---------------------|
| `shop_device_can_manage_staff` | **136** | None — approved operational only |
| `shop_device_context` | **138** | None — returns `is_device_authorized` |
| `shop_device_register_on_login` | **138** | None — first device = approved secondary |
| `owner_remove_shop_device` | **138** | None — no `cannot_remove_primary` |
| `shop_device_limit_context` | **138** | None — sort by `last_seen_at` |
| `shop_device_set_approval` | **133** | None — owner-only, no actor primary check |
| `shop_pos_staff_*` | **136** | Returns `device_not_authorized`, not `not_primary_device` |
| `shop_device_transfer_primary` | **136** | Stub → `primary_device_deprecated` |
| `shop_device_set_primary` | **136** | Stub → `primary_device_deprecated` |
| `admin_shop_set_primary_device` | **136** | Stub → `primary_device_deprecated` |
| `owner_list_shop_devices` | **136** | Echoes legacy JSON fields; sort by pending/active, not primary |
| `sync_shop_device_authority` | **138** | Coerces `primary` → `secondary`; `is_primary := false` |

---

## PART 2 — Authentication Certification

Static workflow validation (credential and session logic unchanged per Phase 20.0 scope):

| Workflow | Status | Notes |
|----------|--------|-------|
| Owner login | ✅ | Supabase auth unchanged; device registration via `shop_device_register_on_login` |
| Owner logout | ✅ | No primary checks in auth path |
| Staff login | ✅ | `staffLoginSecurity.ts` — approval status, not primary |
| Staff logout | ✅ | Unaffected |
| Pending device | ✅ | `DeviceActivationGateOutlet` → `/device-pending` |
| Approved device | ✅ | Auto-redirect from pending/limit routes when activated |
| Rejected device | ✅ | Revoked path → pending/retry flow |
| Device re-login | ✅ | Existing approved device updates presence only |
| Device switching | ✅ | Each fingerprint independent; no primary assignment |
| Session restoration | ✅ | Auth session + cached authority (`waka.device.authority.v2`) |
| Offline login | ✅ | Local auth mode bypasses cloud device gates |
| Multi-device login | ✅ | Each device own row; equal when approved |

**Policy flags** (`deviceAuthorityPolicy.ts`): `AUTO_APPROVE_DEVICE_ON_OWNER_LOGIN`, `ALLOW_STAFF_LOGIN_WHILE_DEVICE_PENDING`, `OWNER_BYPASS_DEVICE_PENDING_ON_LOGIN` — unchanged, approval-based.

---

## PART 3 — Device Approval Certification

| Workflow | Status | Implementation |
|----------|--------|----------------|
| Pending registration | ✅ | Second+ device → `pending`; audit: "owner approval" (138) |
| Owner approval | ✅ | `setDeviceApprovalStatus` → `shop_device_set_approval` (133) |
| Owner rejection | ✅ | Revoke pending → delete row + audit |
| Device removal | ✅ | `owner_remove_shop_device` (138) — any device removable |
| Device rename | ✅ | Label update via presence/registration paths |
| Current device | ✅ | Fingerprint match in UI; no primary badge |
| Trusted device | ✅ | Internal Admin trust flags (separate from approval) |
| Suspended device | ✅ | `approval_status` blocked states |
| Blocked device | ✅ | Revoked/disabled/suspended gates |
| Device reactivation | ✅ | Approved + disconnected → active on login |

**UI pages:** `/settings/devices`, `/device-pending`, `/device-limit` — no Primary Device copy in device-management i18n keys.

---

## PART 4 — Staff Management Certification

| Workflow | Status | Gate |
|----------|--------|------|
| Create staff | ✅ | `usePosStore` + `isDeviceAuthorizedForManagementSync` |
| Edit staff | ✅ | Same |
| Delete staff | ✅ | Same |
| Staff PIN login | ✅ | Approval check in `staffLoginSecurity.ts` |
| Manager approval | ✅ | Role permissions — no device primary |
| Staff permissions | ✅ | Unchanged |
| Lock screen | ✅ | Unchanged |
| PIN reset | ✅ | Cloud RPC + device fingerprint passed |
| Password reset | ✅ | Unchanged |
| Cloud synchronization | ✅ | `refreshStaffCacheAfterOwnerMutation` — all approved devices |

**Legacy error handling:** `shopStaffCloud.ts` still maps `not_primary_device` alongside `device_not_authorized` — **rollback compatibility only**, not an active dependency.

---

## PART 5 — Backup Certification

| Workflow | Status | Gate |
|----------|--------|------|
| Manual backup | ✅ | Role + plan entitlement |
| Automatic backup | ✅ | No primary check |
| Restore | ✅ | `authorizeBackupRestore` / async variant |
| Backup authorization | ✅ | `isDeviceAuthorizedForManagementSync` |
| Export | ✅ | Approved device required on cloud |
| Import | ✅ | `canPerformDeviceAuthorizedAction("backup_import")` |
| Recovery | ✅ | `cloud_recovery` purpose bypasses device gate (unchanged) |
| Cloud backup | ✅ | No primary dependency |

---

## PART 6 — Synchronization Certification

| Domain | Status | Primary dependency |
|--------|--------|-------------------|
| Sales sync | ✅ | None in `offline/` |
| Inventory sync | ✅ | None |
| Purchases | ✅ | None |
| Customers | ✅ | None |
| Suppliers | ✅ | None |
| Expenses | ✅ | None |
| Reports | ✅ | None |
| Staff | ✅ | `pullAndMergeStaffDuringCloudSync` uses approval context only |
| Devices | ✅ | Heartbeat/presence — no primary |
| Offline queue | ✅ | Unaffected |
| Conflict resolution | ✅ | Unaffected |
| Multi-device behavior | ✅ | Equal push/pull for approved devices |

Sync calls `fetchDeviceAuthorityContext()` once per sync cycle for staff provisioning — **same RPC count as before**, and migration 138 **removes** the primary-device subquery from `shop_device_context`.

---

## PART 7 — Internal Admin Certification

| Workflow | Status | Notes |
|----------|--------|-------|
| Device list | ✅ | `AdminDevicesPage` — fleet view |
| Trust | ✅ | `adminShopDeviceSetTrusted` |
| Untrust | ✅ | Via trust toggle |
| Activate | ✅ | `adminShopDeviceSetActive` |
| Deactivate | ✅ | Same |
| Suspend | ✅ | Via shop console security tab (shop-level) |
| Force logout | ✅ | Staff session tools — unchanged |
| Device audit | ✅ | Audit logs + device events |
| Device investigation | ✅ | `AdminSyncInvestigationPanel` |
| Forensics | ✅ | `AdminDeviceForensicsPanel` |

**Removed:** `adminShopSetPrimaryDevice` client wrapper — **confirmed absent** from `wakaInternalAdmin.ts`.  
**Display-only:** `device_authority` may appear in fleet/investigation panels — **not used for authorization**.

---

## PART 8 — Subscription & Device Limits

| Check | Status | Notes |
|-------|--------|-------|
| Device slot limits | ✅ | `count_shop_active_devices` — approved + active only |
| Subscription enforcement | ✅ | `resolve_shop_device_limit` unchanged |
| Starter / Business / Waka Plus | ✅ | Plan codes via `effectiveSubscription.ts` |
| Pending devices | ✅ | Do not consume slots |
| Approved devices | ✅ | Count toward limit |
| Limit exceeded | ✅ | `limit_blocked` on register/approve |
| Authority regression | ✅ | Limits decoupled from primary designation |

---

## PART 9 — Security Certification

| Control | Status | Notes |
|---------|--------|-------|
| Authorization | ✅ | Single model: approved operational device |
| Owner privileges | ✅ | Owner role + device approval |
| Staff privileges | ✅ | Role/permissions independent of primary |
| Sensitive actions | ✅ | `DeviceAuthorizedAction` enum — no `primary_transfer` |
| Approval flow | ✅ | Owner-only RPC; expiry + limit checks |
| Audit logging | ✅ | `device_approved`, `device_removed`, `device_pending_approval`, etc. |
| Session integrity | ✅ | Supabase session unchanged |
| Replay protection | ✅ | Staff lockout / device fingerprint tracking unchanged |
| Device removal | ✅ | No primary guard; revokes slot |

---

## PART 10 — Codebase Certification (Repository Search)

### Production code — active dependencies

| Pattern | Production hits | Classification |
|---------|-----------------|----------------|
| `not_primary_device` | `shopStaffCloud.ts` error mapping only | **Rollback compatibility** |
| `device_authority` / `is_primary` | `shopDevices.ts` parse types; `wakaInternalAdmin.ts` fleet fields; `deviceActivation.ts` optional parse | **Migration compatibility** — not used for gates |
| `ManagedByPrimaryDevice` / `PrimaryDeviceGate` | **Not on disk** — removed; routes use `DeviceApprovedGate` | **Dead (removed)** |
| `primaryDevice.ts` shim | **Not on disk** | **Dead (removed)** |
| `adminShopSetPrimaryDevice` | **Not in codebase** | **Dead (removed)** |
| `ENFORCE_PRIMARY_DEVICE` | **Not in codebase** | **Dead (removed)** |
| `isPrimary` (device context) | **Not in DeviceAuthorityContext** — replaced by `isDeviceAuthorized` | **Removed** |
| `registerModePrimaryDevice` | `SettingsSellingPage` + i18n | **Unrelated** — POS register mode preference |
| `PrimaryShopSelector` / `is_primary` shop | Multi-shop org default | **Unrelated** |
| `isPrimaryFloorTable` | Hospitality table layout | **Unrelated** |

### Migration files (historical)

Migrations **123–133** contain primary-device logic in historical `CREATE OR REPLACE` bodies. **Superseded** by 136 + 138 for all enforcement paths. These files are **rollback/history compatibility**, not live behavior after migration apply.

### Documentation

Phase 17.6 audit describes pre-20.0 split-brain — **historical reference only**. Phase 20.0 doc is current architecture record.

---

## PART 11 — UI Certification

| Surface | Primary Device copy? | Status |
|---------|---------------------|--------|
| `/settings/devices` (`DeviceManagementPage`) | No | ✅ Approved / Pending / Blocked badges |
| `/device-pending` | No | ✅ "Waiting for device approval" |
| `/device-limit` | No | ✅ Slot limit messaging |
| Staff / backup gates | No | ✅ `DeviceNotAuthorizedBanner` |
| Device approval dialogs | No | ✅ Approve / Reject / Remove |
| Notifications | No | ✅ Owner approval audit text (138) |
| Settings → Selling register mode | **"Primary register device"** | ⚠️ **Unrelated concept** — local register preference, not cloud authority |

**User-visible Primary Device strings in device management: none certified.**

---

## PART 12 — Database Certification

### Tables & columns (deprecated, retained)

| Artifact | Status | Production role |
|----------|--------|-----------------|
| `shop_devices.device_authority` | Deprecated | Coerced to `secondary` by trigger (138) |
| `shop_devices.is_primary` | Deprecated | Always `false` after 138 data migration |
| `shops.primary_device_id` | Deprecated | Nulled by 138 data migration |
| `shop_devices_one_primary_per_shop` index | Legacy | Harmless when no `is_primary = true` |
| `device_type` (`primary_pos`, etc.) | Legacy taxonomy | Not used for authority |

### RPCs — production behavior (post 136+138)

| Returns `not_primary_device`? | Returns `cannot_remove_primary`? |
|------------------------------|----------------------------------|
| **No** (staff RPCs use `device_not_authorized`) | **No** (138 removes guard) |

### Triggers

`sync_shop_device_authority` (138): prevents new primary rows — **compatibility shim**, not enforcement.

---

## PART 13 — Performance Certification

| Check | Result |
|-------|--------|
| Additional queries in `shop_device_context` | **Improvement** — primary device lookup removed (138) |
| Extra RPC calls on client | **None added** — same `shop_device_context` on authority refresh |
| Sync regressions | **None identified** — sync path unchanged except authority field names |
| Approval slowdown | **None** — `shop_device_set_approval` has no actor primary check |
| Registration slowdown | **None** — single insert path; no `primary_device_id` update |

---

## PART 14 — Regression Certification

| Vertical / module | Status | Notes |
|-------------------|--------|-------|
| Retail | ✅ | POS, sales, stock — no primary gates |
| Hospitality | ✅ | Floor/table "primary" is layout-only |
| Pharmacy | ✅ | Unrelated to device authority |
| Wholesale | ✅ | Unrelated |
| Internal Admin | ✅ | No primary tools |
| Inventory | ✅ | Unaffected |
| Reports | ✅ | Unaffected |
| Command Center | ✅ | Unaffected |
| Authentication | ✅ | Credential flow unchanged |
| Backup | ✅ | Approval-based gate only |

**Expected behavior:** Identical to pre-20.0 for end users, except non-primary approved devices now have full authority (intended improvement).

---

## PART 15 — Enterprise Certification Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| **Architecture** | 95 | Clean approved-device model; legacy columns documented |
| **Authentication** | 94 | Unchanged credentials; approval gates clear |
| **Approval** | 96 | Owner-any-device approval; limits intact |
| **Security** | 93 | Consistent server/client gates; legacy error string remains |
| **Synchronization** | 97 | Zero sync primary deps |
| **Internal Admin** | 95 | Full ops minus primary tools |
| **Performance** | 96 | Fewer SQL lookups in context RPC |
| **Maintainability** | 88 | Legacy types in `shopDevices.ts`; historical migrations |
| **Developer Experience** | 90 | Clear naming post-20.0; some compat fields confuse |
| **Enterprise Readiness** | 91 | Conditional on migration deploy |
| **Overall Readiness** | **91** | |
| **Production Readiness (code)** | **93** | |

---

## Workflow Certification Matrix

| Workflow | Server | Client | UI | Certified |
|----------|--------|--------|-----|-----------|
| Owner login (first device) | 138 auto-approve | Activation context | — | ✅ |
| Owner login (2nd device pending) | 138 pending insert | `/device-pending` | Approval copy | ✅ |
| Owner approves from device B | 133 owner RPC | `setDeviceApprovalStatus` | DeviceManagementPage | ✅ |
| Staff CRUD from device B | 136 `device_not_authorized` if unapproved | `usePosStore` gate | DeviceApprovedGate pages | ✅ |
| Backup import | — | `backupRestoreAuthorization` | BackupSyncPage | ✅ |
| Device removal (any approved) | 138 no primary guard | `removeOwnerShopDevice` | Confirm dialog | ✅ |
| Admin trust/deactivate | Admin RPCs | `AdminDevicesPage` | Fleet card | ✅ |
| Plan limit block | 132/138 limit checks | `/device-limit` | Limit UI | ✅ |
| Transfer primary (legacy call) | 136 stub | No UI | — | ✅ Deprecated |

---

## Security Certification Summary

- **Threat model unchanged:** Device approval still required for cloud owner actions.
- **Improvement:** Eliminates false rejection of approved secondary devices (pre-17.6 split-brain).
- **Residual:** Pre-migration DB could still enforce primary if 136/138 not applied — **deployment control**, not code defect.

---

## Regression Report

| Risk | Severity | Mitigation |
|------|----------|------------|
| DB migrations 136/138 not applied | 🔴 High | Deploy migrations before client; verify RPC bodies in Supabase dashboard |
| Stale authority cache (v1 key) | 🟡 Low | `clearDeviceAuthorityCache` clears v1; TTL 5 min |
| `owner_list` JSON still includes `is_primary` | 🟢 None | Client ignores for authorization |
| `registerModePrimaryDevice` user confusion | 🟡 Low | Rename in future UX pass (out of 20.0 scope) |
| Orphan `ConnectedDevicesPage` | 🟢 None | Not routed; no user impact |

**No functional regressions identified in static analysis.**

---

## Remaining Technical Debt

| ID | Item | Priority | Recommended phase |
|----|------|----------|-------------------|
| TD-01 | Drop `device_authority`, `is_primary`, `shops.primary_device_id` columns | Medium | 20.2 or schema cleanup |
| TD-02 | Remove `shop_devices_one_primary_per_shop` partial unique index | Low | With TD-01 |
| TD-03 | Simplify `ShopDeviceRow` — remove legacy authority fields from client types | Low | 20.2 |
| TD-04 | Remove `not_primary_device` from `shopStaffCloud.ts` error mapping | Low | After all prod DBs on 136+ |
| TD-05 | Stop echoing `is_primary` in `owner_list_shop_devices` JSON | Low | 20.2 |
| TD-06 | Delete orphan `ConnectedDevicesPage.tsx` | Low | Hygiene |
| TD-07 | Rename `registerModePrimaryDevice` → "Designated register device" | Low | UX clarity |
| TD-08 | Historical migrations 123–133 primary comments | Info | No action — immutable history |

---

## Dead Code Report

| Item | On disk? | Routed/imported? | Verdict |
|------|----------|-------------------|---------|
| `ManagedByPrimaryDevice.tsx` | **No** | No | ✅ Removed |
| `primaryDevice.ts` | **No** | No | ✅ Removed |
| `adminShopSetPrimaryDevice` | **No** | No | ✅ Removed |
| `ENFORCE_PRIMARY_DEVICE` | **No** | No | ✅ Removed |
| `ConnectedDevicesPage.tsx` | Yes | **Not in App routes** | ⚠️ Orphan — safe to delete later |
| Transfer primary UI buttons | No | No | ✅ Removed |

---

## Migration Compatibility Report

| Scenario | Behavior |
|----------|----------|
| **Fresh install** (all migrations) | Approved-device model only |
| **Upgrade with 136+138** | Data normalized; triggers coerce primary writes |
| **Upgrade without 136** | Staff RPCs may return `not_primary_device` — **do not deploy client without 136** |
| **Upgrade without 138** | Context RPC still queries primary; removal blocked — **do not certify without 138** |
| **Rollback** | Deprecated columns retain historical data; stub RPCs prevent primary transfer |

**Certification assumes migrations 136 and 138 are applied in order.**

---

## Recommendations (Informational — No Implementation in 20.1)

1. **Deploy gate:** Block production client release until Supabase confirms migrations 136 + 138 applied.
2. **Post-deploy smoke test:** Owner staff CRUD from second approved device; approve pending from non-first device; remove any approved device.
3. **Future 20.2:** Column drop + type cleanup (TD-01 through TD-05).
4. **Optional:** Rename register-mode "Primary register device" string to avoid user confusion with deprecated cloud primary concept.

---

## Success Criteria Checklist

| Criterion | Result |
|-----------|--------|
| Primary Device architecture fully decommissioned | ✅ Enforcement removed |
| Every approved owner device has equal authority | ✅ |
| Client and server fully aligned | ✅ Conditional on migrations |
| Authentication unchanged | ✅ |
| Device approval works correctly | ✅ |
| Internal Admin remains functional | ✅ |
| Subscription limits remain correct | ✅ |
| Backup and sync operational | ✅ |
| No production workflow depends on Primary Device | ✅ |
| Remaining references are migration/rollback compatibility only | ✅ With noted exceptions (register mode, org primary shop) |
| Waka POS Device Management enterprise-certified | ✅ **Conditional pass** |

---

## Certification Verdict

**Waka POS Device Management is certified for enterprise production** under the Approved Device architecture, subject to:

1. Application of Supabase migrations **136** and **138** to all environments before release.
2. Acknowledgment of documented technical debt (legacy columns and compatibility echoes) scheduled for a future schema cleanup phase.

The legacy Primary/Secondary model no longer governs any active production code path. Remaining artifacts are intentional compatibility layers or unrelated "primary" terminology (register mode, multi-shop default).

**Certified by:** Phase 20.1 static enterprise audit  
**Next recommended phase:** 20.2 schema cleanup (optional) or payment integration prep on certified baseline
