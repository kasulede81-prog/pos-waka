# Phase 21.1 — Enterprise Shop Security PIN Recovery Completion

Production completion of the Shop Security PIN recovery architecture certified in Phase 21.0. Scope is **Shop Security PIN recovery only** — owner/staff authentication, device activation, subscriptions, and permissions are unchanged.

## Architecture

```
Internal Admin: Clear Shop Security PIN
        │
        ▼
admin_shop_reset_backoffice_pin (migration 140 — unchanged)
        │
        ▼
shop_security_credentials.pin_hash cleared + recovery signal timestamp
        │
        ▼
Owner devices (online): shop_fetch_recovery_signal
        │
        ▼
runShopSecurityPinRecoveryCycle()
  1. recovery_detected
  2. applyAdminBackOfficePinClear (local PIN + verification cache)
  3. migration_blocked
  4. hydrateShopSecurityPin (server → client, force)
  5. hydration_complete
  6. awaiting_new_pin (owner banner / sensitive-action gate)
```

## Recovery triggers

Recovery runs on **every** trigger below (not only full sync):

| Trigger | Entry point |
|---------|-------------|
| App launch | `BackOfficeSessionProvider`, `usePosStore` hydrate, auth session bootstrap |
| App resume | `useShopSecurityPinRecovery` (visibility + Capacitor `appStateChange`) |
| Owner login | `schedulePostLoginBackgroundTasks`, `postAuthCloudHydrate` |
| Cloud reconnect | `waka:network-online`, `online` events |
| Background sync start | `cloudSync.runSyncFlush`, merge paths |

Concurrent calls coalesce via `scheduleShopSecurityPinRecovery()`.

## Before / after

### Before (Phase 21.0 gaps)

```
Admin "Reset PIN" (ambiguous)
        │
        ▼
Server clear only on full sync path
        │
        ▼
Stale local hash may migrate back via migrateLocalShopSecurityPinToCloud()
        │
        ▼
Device keeps old PIN until next full sync
```

### After (Phase 21.1)

```
Admin "Clear Shop Security PIN" (explicit)
        │
        ▼
Recovery cycle on launch / resume / login / reconnect / sync
        │
        ▼
Local cache + verification session cleared immediately
        │
        ▼
Migration blocked until server empty confirmed
        │
        ▼
Hydrate server → client; owner prompted to create new PIN
```

## Cache lifecycle

| Store | On recovery | Notes |
|-------|-------------|-------|
| `preferences.backOfficePin` | Cleared | Shop Security PIN hash only |
| `waka.shop.security.pin.cache.v1` | Removed | Hydration metadata |
| Security verification session | Cleared | `clearSecuritySession` + legacy |
| Migration block flag | Set | Until server reports empty PIN |
| Owner recovery notice | Set | Banner until dismissed or PIN recreated |
| Staff PIN cache | **Untouched** | |
| Owner Supabase session | **Untouched** | |
| Biometric preference | **Untouched** | |

## Migration guard

`migrateLocalShopSecurityPinToCloud()` returns immediately when `isShopSecurityPinMigrationBlocked(shopId)`.

During hydrate, when cloud is empty but local still has a hash **and** migration is blocked, the client applies server state locally (`cleared`) instead of uploading stale data.

Block clears when hydrate confirms `!cloud.configured && !localConfigured` (server empty observed).

**Recovery always wins. Server is authoritative.**

## Diagnostics

Console prefix: `[waka-shop-security]`

Example pipeline:

```
[waka-shop-security] { recovery: "recovery_detected", shopId, reason }
[waka-shop-security] { recovery: "local_cache_cleared", shopId, reason }
[waka-shop-security] { recovery: "migration_blocked", shopId, reason }
[waka-shop-security] { recovery: "hydration_complete", shopId, hydrateResult }
[waka-shop-security] { recovery: "awaiting_new_pin", shopId, reason }
```

Never logs PIN, hash, or secrets.

## Audit logging

**Device (owner shop audit log):** `admin_pin_clear_applied` with `shopId`, `clearedAt`, `recoveryReason`, `recoveryCompleted`, `recoveryAppliedOnDevice`.

**Internal Admin:** existing `admin_reset_backoffice_pin` / `rescue_pin_reset` actions with updated UI labels.

## Owner UX

- Banner: “Shop Security PIN cleared. Create a new Shop Security PIN before using protected features.”
- Sensitive actions requiring Shop Security PIN open creation prompt (no stale-cache bypass).
- Settings → PIN for explicit creation.

## Verification checklist

- [ ] Internal Admin button reads **Clear Shop Security PIN**
- [ ] Admin clear removes server PIN; recovery signal visible in shop console
- [ ] Owner device online within seconds removes local PIN without full sync wait
- [ ] Offline device clears local PIN when signal fetched; hydrates on reconnect
- [ ] Stale local hash is **not** re-uploaded after admin clear
- [ ] Owner sees recovery banner; sensitive settings actions require new PIN
- [ ] Staff PIN / password / owner login unchanged
- [ ] Biometric preference unchanged after recovery

## Regression matrix

| Area | Expected |
|------|----------|
| Owner login | Unchanged |
| Staff login | Unchanged |
| Staff PIN | Unchanged |
| Staff password | Unchanged |
| Manager approval | Unchanged |
| Device activation | Unchanged |
| Device limits | Unchanged |
| Shop Security verification | Works after new PIN created |
| Offline mode | Recovery applies locally; hydrates when online |

## Key files

| File | Role |
|------|------|
| `src/lib/shopSecurityPinRecovery.ts` | Recovery cycle orchestration |
| `src/lib/shopRecoverySignals.ts` | Signal fetch + local apply |
| `src/lib/shopSecurityPinSync.ts` | Hydrate + migration guard |
| `src/lib/shopSecurityPinDiagnostics.ts` | Pipeline diagnostics |
| `src/hooks/useShopSecurityPinRecovery.ts` | Resume / reconnect hooks |
| `src/components/security/ShopSecurityPinRecoveryBanner.tsx` | Owner notice |

## Tests

- `shopSecurityPinRecovery.test.ts` — cycle, coalescing, offline, notice
- `shopRecoverySignals.test.ts` — cache invalidation, idempotency, audit fields
- `shopSecurityPinSync.test.ts` — migration block, hydrate after recovery
