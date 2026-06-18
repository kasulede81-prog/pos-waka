# Waka POS — Local Mode Security Model

This document describes how **local (offline-first) authentication** affects roles, subscription entitlements, and data access in Waka POS. It is the authoritative threat model for single-owner vs shared-device deployments.

## What “local mode” means

When the app runs without Supabase cloud auth (`authMode === "local"`), or when a user signs in through the local/offline path:

| Behavior | Local mode |
|----------|------------|
| **Resolved role** | Always **`owner`** (`resolveAuthRole` in `permissions.ts`) |
| **Subscription snapshot** | `{ kind: "local_full" }` → effective tier **`waka_plus`** |
| **Plan gates** | **`hasEffectivePermission` skips tier checks** — all role permissions apply |
| **Backup restore/export (plan)** | **`canUseBackupRestore` returns true** |
| **Activation gate** | Bypassed for local accounts |
| **Profit visibility helpers** | `canSeeOfficeProfit` returns true for any role in local mode |

This is **intentional** for Uganda small shops using a single phone or tablet as the sole POS device without cloud accounts.

## Intended use: single owner

Local mode is designed for:

- One business owner on one device
- Offline-first operation without subscription friction
- Full catalog, sales, stock, reports, and settings on that device

The owner is trusted with all data on the device because **they physically control the hardware**.

## Shared-device risk

Local mode is **not** designed for:

- Multiple staff sharing one device with **only** local login
- Untrusted users with DevTools / console access
- Devices left unlocked in a public area

In local mode, **every session resolves to owner**. There is no role separation at the auth layer. Staff PINs and back-office locks are **UX deterrents**, not cryptographic boundaries, when the underlying session is owner.

### Mitigations for shared devices (operational)

1. Use **Supabase cloud auth** with `shop_members` roles (cashier, manager, stock keeper, waiter).
2. Enable **back-office PIN** and **staff profiles** for shift switching on owner devices.
3. Use **device lock** (`posLocked`) between shifts.
4. Do not leave the app signed in as owner on shared tablets.

## Offline Supabase mode (cached session)

When Supabase is configured but the device is temporarily offline:

- Role comes from **`shop_members`** (or fail-closed to **`waiter`** if unresolved).
- Subscription tier is read from the **cached snapshot** on device.
- Route and store permission checks behave the same as online.
- **IndexedDB holds the full shop** — anyone with physical access + unlocked browser profile can read local data regardless of route guards.

## Data access assumptions

Waka POS is a **client-authoritative offline-first** application:

1. **Route guards** and **store permission checks** prevent accidental or casual misuse through the UI.
2. **They do not** prevent a determined user with console access from calling store methods (mitigated in P0 security sprints via store-layer checks).
3. **Supabase RLS** is the real boundary for cloud-synced multi-device shops.
4. **Local IndexedDB** is readable by any code running in the same browser origin.

Assume: **physical access to an unlocked session = full data access** unless cloud roles and device policy are used.

## Dev / simulator overrides

Additional local-only surfaces (not production Supabase builds unless misconfigured):

| Mechanism | When active | Effect |
|-----------|-------------|--------|
| `devRoleOverride` in preferences | DEV or no Supabase config; real auth role must be owner | Simulates another role for testing |
| Internal admin preview (`?preview=1`) | DEV or `VITE_INTERNAL_ADMIN_PREVIEW=1` | Mock admin UI without RPC |

These must remain disabled in production Supabase deployments.

## Related code

- `src/lib/sessionActor.ts` — session role resolution
- `src/lib/permissions.ts` — `resolveAuthRole`, role matrix
- `src/lib/subscriptionEntitlements.ts` — `hasEffectivePermission`, `canUseBackupRestore`
- `src/lib/homeProfit.ts` — local profit visibility bypass
- `src/context/ActivationContext.tsx` — local activation bypass

## Summary

| Deployment | Trust model |
|------------|-------------|
| **Local single device** | Owner trusts themselves; full owner powers by design |
| **Cloud multi-user** | Role matrix + RLS; local cache still sensitive |
| **Shared local tablet** | **High risk** — use cloud staff roles instead |

No behavioral changes are required for local mode until product requirements explicitly add “local staff login without owner session.”
