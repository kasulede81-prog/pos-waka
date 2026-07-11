# Phase 17.7 — Device Management Simplification

**Status:** Implemented  
**Migration:** `136_device_management_simplification.sql`

## Objective

Every approved device is equal. There is no Primary Device gate on staff management, device approval, or backup restore.

## Target login flow

```
Email → Password → Authenticate → Register/find device → Within limit?
  YES → Login immediately
  NO  → Device Limit screen
```

## What changed

### PostgreSQL (critical — fixes split-brain)

- **`shop_device_can_manage_staff`** now checks that the caller device is **approved and operational**, not `device_authority = 'primary'`.
- Staff RPCs return **`device_not_authorized`** instead of **`not_primary_device`** when the device check fails.
- **`shop_device_transfer_primary`**, **`shop_device_set_primary`**, and **`admin_shop_set_primary_device`** are deprecated stubs (`primary_device_deprecated`).
- **`owner_list_shop_devices`** sorts by pending status and last activity, not primary authority.

### Client

- Removed **`ENFORCE_PRIMARY_DEVICE`** and primary/secondary UI gates.
- **`isDeviceAuthorizedForManagementSync()`** replaces primary-device checks in store, staff auth, and backup restore.
- **Settings → Devices** uses **Approved / Pending approval / Blocked** terminology.
- Removed transfer-primary actions and **`primaryDevice.ts`** shim.
- **`DeviceApprovedGate`** / **`DeviceNotAuthorizedBanner`** replace primary-only messaging.

### Kept (unchanged)

- Device activation and pending approval
- Device limit enforcement
- Trusted devices, last active, remote logout
- Device history and internal admin fleet tools
- Audit logs

## Deferred (Phase 17.7 follow-up)

Schema cleanup in a later migration after production verification:

- Drop `device_authority`, `is_primary`, `primary_device_id`
- Remove deprecated RPCs entirely
- Delete orphan `ConnectedDevicesPage.tsx` if still unused

## Verification checklist

- [ ] Owner adds/edits staff from any **approved** device
- [ ] Owner approves pending device from any signed-in owner session
- [ ] Pending/unapproved device blocked from staff cloud writes (`device_not_authorized`)
- [ ] Device limit still blocks over-limit approval
- [ ] Remote logout and sync unchanged
- [ ] `npm run build` and `npm test` pass

## Do not proceed

Payment provider integration should wait until this phase is deployed and verified in production.
