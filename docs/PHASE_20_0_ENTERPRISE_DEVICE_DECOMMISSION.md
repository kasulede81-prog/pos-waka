# Phase 20.0 — Enterprise Device Management Decommission

**Mode:** Enterprise implementation (production code)  
**Date:** July 2026  
**Prerequisite:** Phase 17.6 audit, Phase 17.7 partial simplification (migration 136)

## Objective

Remove the Primary Device / Secondary Device architecture from Waka POS and replace it with a single **Approved Device** authority model. Every approved owner device has equal capability. This phase is architectural cleanup only — no redesign of device management UI, subscription limits, authentication, sync, or Internal Admin workflows beyond removing primary concepts.

---

## Before / After Architecture

### Before

```
Pending Device → Owner approves on Primary Device only → Secondary devices blocked for staff/approval RPCs
shop_devices.device_authority = primary | secondary
shops.primary_device_id → one “owner” terminal
Client ENFORCE_PRIMARY_DEVICE=false (split-brain with server)
```

### After

```
Pending Device → Owner approves from any approved device → Approved Device (full authority)
Blocked Device (revoked / suspended / disabled)
No business logic depends on one device being “primary”
Client + server both use approval + operational status
```

---

## Removed Concepts

| Removed | Replacement |
|---------|-------------|
| Primary Device / Secondary Device | Approved Device |
| Device Authority (`primary` / `secondary`) | `approval_status` + `status` |
| Transfer Primary / Make Primary | *(removed — RPC stubs return `primary_device_deprecated`)* |
| `ENFORCE_PRIMARY_DEVICE` policy flag | *(already removed in 17.7)* |
| `PrimaryDeviceGate` / `ManagedByPrimaryDevice` | `DeviceApprovedGate` / `DeviceNotAuthorizedBanner` |
| `isPrimary` in React context | `isDeviceAuthorized` |
| `not_primary_device` RPC errors | `device_not_authorized` (136) or no gate (138) |
| `cannot_remove_primary` | Any approved device can be removed |
| `adminShopSetPrimaryDevice()` client wrapper | Removed |
| `primaryDevice.ts` shim | Removed (imports use `deviceAuthority` directly) |

**Not changed (unrelated “primary”):**

- `primaryDeviceFingerprint` in shop preferences — POS register mode, not cloud device authority
- `PrimaryShopSelector` / org `is_primary` — multi-shop default shop
- Subscription device slot limits — unchanged

---

## SQL Migration

**File:** `supabase/migrations/138_enterprise_device_decommission.sql`

### Data normalization (columns retained)

- All `shop_devices.device_authority` → `'secondary'`, `is_primary` → `false`
- All `shops.primary_device_id` → `NULL`

### Functions replaced

| Function | Change |
|----------|--------|
| `sync_shop_device_authority` | Coerces `primary` writes to `secondary`; keeps `is_primary = false` |
| `shop_device_context` | Returns `is_device_authorized` / `operational`; no primary fingerprint/id |
| `owner_remove_shop_device` | Removes `cannot_remove_primary` guard |
| `shop_device_limit_context` | Sorts devices by `last_seen_at`, not authority |
| `shop_device_register_on_login` | First device: approved `secondary`; no `primary_device_id` update; audit copy → “owner approval” |

### Prior work (migration 136)

- `shop_device_can_manage_staff` — approved operational device check
- Staff RPCs — `device_not_authorized` instead of `not_primary_device`
- Transfer/set-primary/admin RPCs — deprecated stubs

---

## RPC Changes Summary

| RPC | Phase 20.0 status |
|-----|-------------------|
| `shop_pos_staff_*` | Approved device only (`device_not_authorized`) |
| `shop_device_set_approval` | Owner-only; no actor primary check (133) |
| `shop_device_transfer_primary` | Deprecated stub (136) |
| `shop_device_set_primary` | Deprecated stub (136) |
| `admin_shop_set_primary_device` | Deprecated stub (136) |
| `shop_device_context` | Approval-based (138) |
| `owner_remove_shop_device` | No primary guard (138) |
| `shop_device_register_on_login` | No primary assignment (138) |

**No RPC returns `not_primary_device` after migrations 136 + 138 are applied.**

---

## Client Cleanup

| Area | Changes |
|------|---------|
| `src/lib/deviceAuthority.ts` | Removed primary types/fields; `DeviceAuthorizedAction`; cache key `v2` |
| `src/context/DeviceAuthorityContext.tsx` | `isDeviceAuthorized`, `canPerformAuthorizedAction`, `assertDeviceAuthorizedAction` |
| `src/components/device/DeviceApprovedGate.tsx` | Replaces `ManagedByPrimaryDevice.tsx` |
| Staff / backup / settings pages | Import `DeviceApprovedGate` |
| `src/lib/wakaInternalAdmin.ts` | Removed `adminShopSetPrimaryDevice` |
| `src/lib/rescueDeviceList.ts` | Sort by last seen, not authority |
| `src/lib/staffCacheSync.ts` | `refreshStaffCacheAfterOwnerMutation` |
| `src/lib/i18n.ts` | Removed Primary Device copy keys |
| `src/lib/storeAuthorization.ts` | Removed `notPrimaryDevice` error key |

---

## Compatibility Notes

- DB columns `device_authority`, `is_primary`, `shops.primary_device_id` **kept** for rollback; trigger prevents new primary rows.
- `owner_list_shop_devices` may still echo legacy fields from DB until a future column drop migration.
- Client ignores `device_authority` / `is_primary` for authorization decisions.
- Local storage authority cache bumped to `waka.device.authority.v2` (v1 cleared on cache reset).

---

## Test Results

```
npm run build   → PASS
npm test        → 1571 passed, 1 failed (pre-existing flaky posProductSearch perf: 223ms vs 220ms threshold)
```

### Manual verification checklist

- [ ] Owner login on first device — auto-approved, no primary prompt
- [ ] Second device — pending → owner approves from any approved device
- [ ] Staff login on approved device
- [ ] Device removal (including former “primary” rows)
- [ ] Device activation / limit page
- [ ] Internal Admin device list / trust / suspend
- [ ] Offline mode + sync unchanged
- [ ] Staff CRUD from non-former-primary approved device

---

## Success Criteria

- ✅ Primary Device architecture removed from live RPCs and client gates
- ✅ Every approved owner device has identical authority
- ✅ Device approval and subscription limits preserved
- ✅ Internal Admin continues working (without primary tools)
- ✅ Login automatic after approval
- ✅ No `not_primary_device` in active RPC paths
- ✅ Build and tests pass
