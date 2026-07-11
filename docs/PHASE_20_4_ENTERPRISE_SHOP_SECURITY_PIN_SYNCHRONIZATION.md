# Phase 20.4 — Enterprise Shop Security PIN Synchronization

**Date:** July 2026  
**Status:** Complete  
**Build:** `npm run build` ✅  
**Tests:** `npm test` ✅

---

## 1. Enterprise Shop Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL shop_security_credentials (server authoritative) │
│   pin_hash (Argon2id only)                                  │
│   pin_version (monotonic)                                   │
│   pin_updated_at / pin_updated_by                           │
└─────────────────────────────────────────────────────────────┘
              ▲ upsert / clear / migrate          │
              │                                   ▼ get (hydrate)
┌─────────────┴───────────────────────────────────────────────┐
│ Client: shopSecurityPinSync.ts (dedicated path)               │
│   hydrateShopSecurityPin → preferences.backOfficePin (cache)  │
│   saveShopSecurityPinToCloud / clearShopSecurityPinOnCloud    │
│   migrateLocalShopSecurityPinToCloud (one-time)               │
└───────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│ Verification (unchanged)                                      │
│   EnterpriseSecurityService / shopPinSecret / lock screen     │
│   Offline verify against local cached hash                    │
└─────────────────────────────────────────────────────────────┘
```

**Scope:** Shop Security / Back Office PIN only. Staff PINs, passwords, biometrics, and device credentials unchanged.

---

## 2. Synchronization Flow

| Event | Flow |
|-------|------|
| **Login / activation** | `finalizeActivation` → `hydrateShopSecurityPin` |
| **Background sync** | `syncShopWithCloudInner` → `hydrateShopSecurityPin` |
| **First device setup** | Hash locally → `saveShopSecurityPinToCloud` → local cache |
| **Second device login** | Hydrate → `preferences.backOfficePin` populated — **no setup prompt** |
| **Owner changes PIN** | Verify current → hash → cloud upsert → local persist |
| **Owner clears PIN** | Cloud clear → local null |
| **Legacy migration** | Local hash + empty server → `shop_security_pin_migrate` |
| **Admin recovery** | `admin_shop_reset_backoffice_pin` clears credentials + recovery signal |
| **Conflict** | **Server wins** on fetch; version_conflict triggers re-hydrate |

---

## 3. Migration Report

| Scenario | Behavior |
|----------|----------|
| Phone A has PIN, server empty | First hydrate calls `shop_security_pin_migrate` — uploads hash once |
| Phone B fresh install | Hydrate downloads hash — no recreation |
| Server already configured | Migrate skipped (`already_configured`) |
| Plaintext legacy local PIN | `migrateShopPinIfPlaintext` before upload |
| No forced logout | Migration is background on hydrate |
| Snapshot `backOfficePin` | **Not** used as sync source (dedicated RPC only) |

**Deploy:** Apply migration **140** before client release.

---

## 4. Security Report

| Control | Status |
|---------|--------|
| Argon2id hashing | ✅ Client-side hash before upload; server validates prefix |
| Plaintext on server | ❌ Never stored |
| Reversible encryption | ❌ Not used |
| Offline verify | ✅ Local `preferences.backOfficePin` cache after hydrate |
| Lockout / brute-force | ✅ Unchanged (staff limiter + shop verify paths) |
| Audit logging | ✅ SQL audit_logs on create/change/clear/migrate/admin reset |
| Biometric / dialogs | ✅ Unchanged |
| Diagnostics | ✅ Events only — no PIN digits or hash values logged |

---

## 5. Diagnostics Report

**Prefix:** `[waka-shop-security-pin]`

| Event | When |
|-------|------|
| `pin_hydrate_start` / `pin_hydrate_success` / `pin_hydrate_failed` | Login/sync hydrate |
| `pin_synced` | Cloud hash applied locally |
| `pin_migrated` | One-time local → server upload |
| `pin_created` / `pin_changed` / `pin_cleared` | Owner settings actions |
| `pin_recovery_applied` | Admin recovery signal applied |
| `pin_version_conflict` | Server version newer during upsert |

---

## 6. RPC Certification

| RPC | Role |
|-----|------|
| `shop_security_pin_get` | Hydrate hash + version (approved operational device) |
| `shop_security_pin_upsert` | Owner create/change with version check |
| `shop_security_pin_clear` | Owner remove PIN |
| `shop_security_pin_migrate` | One-time upload when server empty |
| `admin_shop_reset_backoffice_pin` | Internal admin clear (updated in 140) |

---

## 7. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/140_shop_security_pin_sync.sql` | Table + RPCs + admin reset |
| `src/lib/shopSecurityPinSync.ts` | Dedicated sync module |
| `src/lib/shopSecurityPinDiagnostics.ts` | Enterprise logging |
| `src/components/settings/BackOfficePinForm.tsx` | Cloud save/clear + verify current PIN |
| `src/context/DeviceActivationContext.tsx` | Hydrate after activation |
| `src/offline/cloudSync.ts` | Hydrate on background sync |
| `src/lib/shopRecoverySignals.ts` | Recovery cache reset |
| `src/lib/i18n.ts` | Shop-scoped copy + new errors |
| `src/lib/shopSecurityPinSync.test.ts` | Unit tests |

---

## 8. Regression

Unchanged: device management, activation, staff auth, permissions, POS, sync engine (except dedicated PIN hydrate hook).

---

## 9. Success Criteria

| Criterion | Met |
|-----------|-----|
| Same Shop Security PIN on all approved owner devices | ✅ |
| No PIN recreation on device change | ✅ |
| PIN changes propagate | ✅ |
| Offline verify after hydrate | ✅ |
| Argon2id hash only on server | ✅ |
| Auto migration for existing local PIN | ✅ |
| Credential scope consistency | ✅ |
