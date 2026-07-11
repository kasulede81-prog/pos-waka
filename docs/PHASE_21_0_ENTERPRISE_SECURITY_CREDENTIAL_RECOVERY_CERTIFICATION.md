# Phase 21.0 — Enterprise Security Credential Recovery Certification

**Mode:** Read-only forensic audit (NO code changes, NO migrations)  
**Date:** July 2026  
**Foundation:** Phases 18.1, 20.3, 20.4, 20.6  
**Manual finding:** Internal Admin **“Clear back office PIN”** does not reset all shop security credentials.

**Verdict:** Admin recovery is **partial by design and by implementation**. It clears **Shop Security PIN only** (server + snapshot + propagating devices). **Staff PINs, staff passwords, owner auth password, offline caches, and alternate unlock paths survive.** Enterprise “full shop security reset” is **not certified**.

---

## Executive Summary

| Question | Evidence-based answer |
|----------|----------------------|
| What does Internal Admin “Reset PIN” actually reset? | **`admin_shop_reset_backoffice_pin`** → Shop Security PIN (`shop_security_credentials`, snapshot `backOfficePin`, recovery signal). **Not** staff credentials. |
| What survives? | Staff PIN/password hashes, encrypted staff cache, owner Supabase password, unlock limiter state, remembered staff device, security session (until device applies recovery). |
| Do all devices clear immediately? | **No.** Devices apply on **next online** `shop_fetch_recovery_signal` / cloud sync / back-office unlock. **Offline devices retain old Shop Security PIN until online.** |
| Can staff still unlock after admin PIN clear? | **Yes** — staff PIN verification is unchanged (`verifyBackOfficeShellCredential`, `verifyManagerApprovalPinSync`). |
| Should “Reset PIN” become “Reset Shop Security”? | **Yes (naming).** Enterprise standard needs **separate or unified actions** — see Part 12. |
| Migration required for enterprise recovery? | **Partially applied (140).** Full enterprise reset needs **additional scope** (staff bulk clear, cache invalidation signal, offline enforcement) — not present today. |

---

## PART 1 — Complete Credential Inventory

| Credential | Storage | Owner / scope | Verification | Sync path | Reset path (today) |
|------------|---------|---------------|--------------|-----------|-------------------|
| **Owner password** | Supabase `auth.users` | Owner account | Supabase Auth sign-in | Account-level (all devices) | Admin: `admin_shop_send_owner_password_reset`, `adminShopSetOwnerPasswordDirect` (edge fn). **Not** triggered by PIN clear. |
| **Shop Security PIN** | PG `shop_security_credentials.pin_hash`; local `preferences.backOfficePin`; snapshot; `localStorage` `waka.shop.security.pin.cache.v1` | **Shop** (Phase 20.4) | `verifyShopSecurityPin*` → `EnterpriseSecurityService` | `shop_security_pin_get/upsert/clear`, hydrate on login/sync | Owner Settings; Admin `admin_shop_reset_backoffice_pin`; recovery signal |
| **Staff PIN** | PG `shop_pos_staff.pin_hash`; local `staffAccounts[].pinHash` | **Shop per staff** | `verifyStaffPin*` / `staffSecretMatches*` | `shopStaffCloud` push/pull, staff cache download | Owner `resetStaffSecret` in Settings → Staff; **not** admin PIN clear |
| **Staff password** | PG `shop_pos_staff.password_hash`; local `passwordHash` | Shop per staff | Staff login panel | Cloud staff sync | Owner `resetStaffSecret`; **not** admin PIN clear |
| **Manager approval PIN** | *No separate store* | Shop (verify) | `verifyManagerApprovalPinSync` — staff PIN (manager+) **or** Shop Security PIN | Indirect via staff + shop PIN sync | Resets only if underlying staff/shop PIN reset |
| **Sensitive Action PIN** | Same as shop or staff PIN + **security session** | Shop + device session | `SensitiveActionAuthContext` → `verifySecurityCredential` | Session memory only | Clear security session on recovery apply; PINs unchanged |
| **POS lock PIN** | `preferences.posLocked` flag; unlock via staff or shop PIN | Shop verify / device flag | `verifyLockScreenPin` / AppShell unlock | Local preference | `posLocked` cleared on recovery apply; PIN secrets unchanged |
| **Biometric** | OS secure enclave (never stored by Waka) | Device OS | `promptNativeBiometric` → grants security session | N/A | `biometricAuthEnabled` cleared on recovery apply only |
| **Security session** | Memory (`securitySession.ts`, 5 min TTL) | Device session | `isSecuritySessionActive` | None | `clearSecuritySession()` on recovery apply |
| **Unlock limiter** | `localStorage` `waka.staff.unlock.limiter.v1` | Device per staff scope | Lock screen brute-force tiers | None | **Not reset** by admin |
| **Recovery tokens** | Supabase Auth password recovery JWT/link | Owner account | Email link flow | Email | Admin password reset email RPC |
| **Cached PIN metadata** | `localStorage` `waka.shop.security.pin.cache.v1` | Shop/device | Version compare in hydrate | Hydrate | Cleared on `applyShopSecurityPinRecoveryClear` |
| **Offline staff cache** | IndexedDB `staffCache` (encrypted, hashes only) | Shop | Staff offline login | `staffCacheSync` / `offlineStaffCache` | **Not cleared** by admin PIN reset |
| **Staff session** | `localStorage` `waka.staff.session` | Device | Staff auth | None | Admin force logout (separate action) |
| **Remembered staff device** | `localStorage` `waka.staff.remembered.v1` | Device | Staff login UX | None | **Not cleared** by PIN reset |
| **Device authority cache** | `localStorage` `waka.device.authority.v2` | Device | Device management gate | `shop_device_context` | **Not cleared** by PIN reset |

**Sources:** `EnterpriseSecurityService.ts`, `shopSecurityPinSync.ts`, `staffSecret.ts`, `offlineStaffCache.ts`, `securitySession.ts`, `staffLoginLimiter.ts`, `types.ts` (ShopPreferences), migration `140_shop_security_pin_sync.sql`.

---

## PART 2 — Internal Admin Recovery Audit

### Account recovery panel (`AccountRecoveryPanel.tsx`)

| Action | RPC / API | What changes | What survives |
|--------|-----------|--------------|---------------|
| **Send login password reset** | `admin_shop_send_owner_password_reset` + Supabase `resetPasswordForEmail` | Recovery signal timestamp; email to owner | All PINs, staff credentials |
| **Clear back office PIN** | `admin_shop_reset_backoffice_pin` | See Part 3 | Staff PINs, passwords, sessions, caches (partially) |
| **Set login password now** | Edge `admin-set-owner-password` + `admin_shop_password_set_audit` | Supabase auth password | All PINs unless owner changes them |

**UI explicitly documents partial scope** (`AccountRecoveryPanel.tsx:175-176`):

> “Staff switch-user PINs are reset in Settings → Staff on the owner device.”

### Other internal admin actions (not full security reset)

| Action | Function | Security impact |
|--------|----------|-----------------|
| Force logout devices | `adminShopForceLogoutDevices` | Session/auth tokens — **not** PIN hashes |
| Reset sync | `admin_shop_reset_sync` | Sync checkpoints — **not** credentials |
| Suspend / reactivate shop | `rescue_suspend_shop` | Shop access — **not** PIN clear |
| Revoke device trust | `adminShopDeviceSetTrusted(false)` | Device trust flag — **not** PINs |
| Unlock staff account | Owner-only in POS (`unlockStaffAccount`) — **not** internal admin bulk |

**Rescue action taxonomy:** `rescueSupportActions.ts` — `rescue_pin_reset` is audit label only; implementation calls same `adminShopResetBackOfficePin`.

---

## PART 3 — Reset PIN Trace (Clear Back Office PIN)

```
Internal Admin UI
  AccountRecoveryPanel / ShopConsoleSupportTab / EnterpriseShopConsolePage
    ↓
  adminShopResetBackOfficePin(shopId)          [wakaInternalAdmin.ts:1488-1507]
    ↓
  RPC admin_shop_reset_backoffice_pin            [140_shop_security_pin_sync.sql:358-421]
    ↓
SERVER (single transaction):
  1. shop_recovery_signals.clear_back_office_pin_at = now()
  2. shop_security_credentials: pin_hash = NULL, pin_version++
  3. shop_cloud_snapshots: preferences.backOfficePin = null (jsonb_set)
  4. audit_logs: admin_reset_backoffice_pin
    ↓
DEVICES (async, requires online):
  shop_fetch_recovery_signal                     [046_shop_account_recovery.sql:118+]
    ↓
  applyShopRecoverySignalsForShop                [shopRecoverySignals.ts:83-98]
    ↓
  applyAdminBackOfficePinClear                   [shopRecoverySignals.ts:32-68]
    ├── clearSecuritySession() + clearLegacySensitiveSession()
    ├── preferences.backOfficePin = null
    ├── preferences.posLocked = false
    ├── preferences.biometricAuthEnabled = false
    ├── applyShopSecurityPinRecoveryClear() → clear localStorage PIN cache metadata
    └── uploadShopCloudSnapshot({ force: true })
    ↓
VERIFICATION:
  verifyShopSecurityPin* → false (no hash)
  verifyBackOfficeShellCredential → staff PIN still works if configured
  verifyManagerApprovalPinSync → staff PIN OR shop PIN (shop path false)
```

**Trigger points for device apply:**

| Caller | File | When |
|--------|------|------|
| Cloud sync (pre-pull) | `cloudSync.ts:3503-3504` | Every `syncShopWithCloud` when online |
| Cloud merge (post-restore) | `cloudSync.ts:3159` | After snapshot restore |
| Post-pull hydrate | `cloudSync.ts:3527-3528` | After staff pull (PIN hydrate separate) |
| Back office session | `BackOfficeSessionContext.tsx:35-36` | On unlock screen mount |
| POS store init | `usePosStore.ts:7678-7679, 7898-7900` | Startup paths |

**Idempotency:** `localStorage` `waka.recovery.pinClearApplied.v1::{shopId}` stores applied `clearedAt` — same timestamp not re-applied.

---

## PART 4 — Shop Security PIN (Phase 20.4)

| Layer | Cleared by admin reset? | Evidence |
|-------|-------------------------|----------|
| **Server hash** (`shop_security_credentials`) | ✅ Yes | Migration 140 lines 381-388 |
| **Recovery signal** | ✅ Yes | `shop_recovery_signals.clear_back_office_pin_at` |
| **Cloud snapshot** `backOfficePin` | ✅ Yes | Migration 140 lines 390-410 |
| **Local preferences** (IndexedDB) | ✅ Only after recovery apply on device | `applyAdminBackOfficePinClear` |
| **localStorage PIN cache metadata** | ✅ On recovery apply | `applyShopSecurityPinRecoveryClear` |
| **Pending owner PIN upsert queue** | ⚠️ Not explicitly cleared | Incremental sync may re-push if local hash remains |
| **Hydrated copies on devices not yet synced** | ❌ Until online | Offline gap |

### Hydrate race (security risk)

`hydrateShopSecurityPin` (`shopSecurityPinSync.ts:194-197`):

When `!cloud.configured && localConfigured`, it calls **`migrateLocalShopSecurityPinToCloud`** — potentially **re-publishing a stale local hash after admin server clear** if:

1. Recovery signal not yet applied, **and**
2. Local `backOfficePin` still populated, **and**
3. Device is online.

**Mitigation in sync order:** `applyShopRecoverySignalsForCurrentShop` runs **before** pull/hydrate in `syncShopWithCloud` (`cloudSync.ts:3503-3528`). **Certified safe only when recovery apply succeeds.** If recovery RPC times out (4s race in `shopRecoverySignals.ts:87-91`), stale local hash may persist and migrate path may run.

---

## PART 5 — Staff PIN

**Admin “Clear back office PIN” does NOT:**

- Delete or rotate `shop_pos_staff.pin_hash`
- Clear `preferences.staffAccounts`
- Refresh encrypted offline staff cache
- Invalidate staff sessions

**Staff PIN still valid for:**

| Use case | Function | After admin PIN clear |
|----------|----------|----------------------|
| Staff login | `staffOfflineAuth` / staff panel | ✅ Unchanged |
| Lock screen unlock | `verifyLockScreenPin` | ✅ Staff path works |
| Back office shell | `verifyBackOfficeShellCredential` | ✅ Staff tried first |
| Manager approval (hospitality, pharmacy, float) | `verifyManagerApprovalPinSync` | ✅ Staff manager PIN works |
| Sensitive actions (staff_pin mode) | `SensitiveActionAuthContext` | ✅ Unchanged |
| Day close / float override | `verifyFloatVerifyOverride` | ✅ Unchanged |

**Staff PIN reset path (owner only):** `resetStaffSecret` → `usePosStore.ts:2252-2324` → `pushStaffToCloud` — **not** wired to internal admin.

---

## PART 6 — Password Recovery

| Password type | Admin reset? | Workflow |
|---------------|--------------|----------|
| **Owner Supabase password** | Separate actions | Email: `admin_shop_send_owner_password_reset` + `sendOwnerPasswordResetEmail`; Direct: `admin-set-owner-password` edge function |
| **Staff password** | ❌ Not via admin | Owner `resetStaffSecret({ password })` in Settings |
| **Shop Security PIN** | ✅ “Clear back office PIN” | Part 3 trace |

**No single admin action resets both owner password and all PINs.**

---

## PART 7 — Cache Audit

| Cache | Location | Survives admin PIN clear? |
|-------|----------|---------------------------|
| IndexedDB preferences blob | Per-device namespace | ⚠️ Cleared **only when** `applyAdminBackOfficePinClear` runs |
| `waka.shop.security.pin.cache.v1` | localStorage | Cleared on recovery apply |
| `waka.recovery.pinClearApplied.v1` | localStorage | Updated (tracks apply) |
| `waka.staff.unlock.limiter.v1` | localStorage | **Survives** |
| `waka.staff.session` | localStorage | **Survives** (unless force logout) |
| `waka.staff.remembered.v1` | localStorage | **Survives** |
| `waka.device.authority.v2` | localStorage | **Survives** |
| Encrypted staff cache | IndexedDB `staffCache` | **Survives** — staff hashes remain |
| Security session | Memory | Cleared on recovery apply on that device |
| Cloud snapshot (server) | PG | Shop PIN nulled; **staffAccounts in snapshot unchanged** |

---

## PART 8 — Device Audit (Phone A / B / C)

**Scenario:** Admin clears Shop Security PIN while shop has 3 approved devices.

| Device | State when online | State when offline during reset |
|--------|-------------------|--------------------------------|
| **Phone A** (online, syncs) | Recovery applied → shop PIN null, session cleared, snapshot upload | N/A |
| **Phone B** (online, delayed) | Same after next sync / unlock screen | N/A |
| **Phone C** (offline) | **Old shop PIN hash remains in IndexedDB** until online | **Can still unlock with old Shop Security PIN**; staff PIN also works |

**Approved device status:** Devices remain **approved and operational** — admin PIN clear does **not** revoke devices.

**One device still works?** **Yes** — any device offline or any device using **staff PIN** bypass.

---

## PART 9 — Offline Audit

| Question | Answer |
|----------|--------|
| Offline device can unlock with old Shop Security PIN? | **Yes** — until online recovery apply |
| Offline can approve manager actions? | **Yes** — via staff PIN |
| Offline bypass admin reset? | **Yes** — until sync |
| Consistency restored how? | `shop_fetch_recovery_signal` → `applyAdminBackOfficePinClear`; cloud pull merges null snapshot; optional `hydrateShopSecurityPin` |

**Fail-open window:** Duration = offline time after admin reset. **Enterprise gap.**

---

## PART 10 — Enterprise Consistency Comparison

| Platform | Support “reset security” behavior |
|----------|-----------------------------------|
| **Shopify** | Staff PINs / POS PINs managed separately; admin cannot silently unlock merchant POS — merchant resets |
| **Stripe** | Separate API keys, users, 2FA — rotating one credential does not rotate all |
| **Google Workspace** | Admin can reset user password; does not reset all org secrets in one click |
| **Microsoft 365** | Password reset ≠ BitLocker recovery ≠ app passwords — **scoped actions** |
| **Square POS** | Device passcodes + team member PINs — support escalations typically **scoped** |
| **Lightspeed** | Staff credentials managed in back office; support actions documented per credential type |

**Enterprise expectation:** Support performs **explicit, scoped** recovery with **audit trail**. A single “reset everything” is rare; **clear labeling** and **no stale credential windows** are mandatory.

**Waka today:** Scoped to Shop Security PIN but **labeled ambiguously** (“Reset login & back office PIN” header vs “Clear back office PIN” button). **Staff bypass** and **offline stale window** fail strict enterprise bar.

---

## PART 11 — Security Risks

| Risk | Severity | Evidence |
|------|----------|----------|
| **Partial reset** — admin thinks all PINs cleared | **High** | UI header vs button label; staff path documented but easy to miss |
| **Stale shop PIN on offline device** | **High** | No push invalidation; recovery requires pull |
| **Staff PIN bypass after “PIN reset”** | **High** | `verifyManagerApprovalPinSync` staff path unchanged |
| **Hydrate re-migration of cleared PIN** | **Medium** | `shopSecurityPinSync.ts:194-197` if recovery apply fails/times out |
| **Staff cache retains old hashes** | **Medium** | `offlineStaffCache` not invalidated on admin clear |
| **Unlock limiter not reset** | **Low** | Cosmetic/support confusion |
| **Security session on devices not hitting recovery** | **Medium** | Memory-only; 5 min TTL limits exposure |
| **Duplicate credential semantics** | **Low** | Manager approval = staff OR shop PIN (by design) |
| **Snapshot staffAccounts not scrubbed** | **Medium** | Admin RPC only nulls `backOfficePin` in snapshot |

---

## PART 12 — Enterprise Recovery Architecture Recommendation

### Option A — Separate actions (recommended baseline)

| Action | Scope |
|--------|-------|
| **Reset Shop Security PIN** | `shop_security_credentials`, snapshot, recovery signal, force hydrate clear on all devices |
| **Reset all Staff PINs** | Bulk null `shop_pos_staff.pin_hash`, bump staff version, invalidate staff cache signal |
| **Reset owner password** | Existing Supabase / edge fn flows |

**Pros:** Matches Stripe/Google/MS model; least surprise; auditable per credential.  
**Cons:** Support must run multiple steps for full lockout.

### Option B — One “Reset Shop Security” (enterprise bundle)

Single admin action that atomically:

1. Clears Shop Security PIN (existing RPC)
2. Rotates/invalidate all staff PIN hashes (new)
3. Sets `staff_cache_invalidate_at` recovery signal (new)
4. Optionally forces `posLocked` + session revoke on next sync
5. Does **not** change owner Supabase password (remain separate — account vs shop)

**Pros:** One support click for “shop locked out of sensitive actions.”  
**Cons:** Requires careful UX (“this will require all staff to get new PINs from owner”).

**Recommendation:** **Option A for Phase 21.1 implementation**, with UI rename immediately; **Option B as optional “Full shop credential lockdown”** after staff bulk RPC exists. **Do not redesign authentication** — extend recovery signals table pattern from Phase 20.4.

---

## PART 13 — Recovery Matrix

| Credential | Current admin reset | Should reset (enterprise) | Recovery required on device |
|------------|--------------------|---------------------------|----------------------------|
| Owner password | Separate action | Separate action | Re-login |
| Shop Security PIN | ✅ Clear back office PIN | ✅ Yes | Auto on sync |
| Staff PIN | ❌ No | ⚠️ Separate action or bundle | Staff cache refresh + owner sets new PIN |
| Staff password | ❌ No | ⚠️ Separate action | Same |
| Manager approval | ❌ Indirect only | Same as staff/shop PIN | N/A (verify-only) |
| Sensitive session | ⚠️ Cleared on apply | ✅ Yes | Auto |
| POS lock flag | ⚠️ Cleared on apply | ✅ Yes | Auto |
| Biometric enabled flag | ⚠️ Cleared on apply | ✅ Yes (disable step-up) | Auto |
| Unlock limiter | ❌ No | Optional | Optional |
| Offline staff cache | ❌ No | ✅ On staff reset | Re-download |
| Device approval | ❌ No | ❌ No (unless device compromise) | N/A |

---

## PART 14 — Deployment Audit

| Component | Status |
|-----------|--------|
| Migration **140** (`shop_security_credentials`, updated `admin_shop_reset_backoffice_pin`) | **Applied** (remote at 140+) |
| Migration **141** (owner-first auth) | Unrelated to credential recovery |
| Client recovery apply (`shopRecoverySignals.ts`) | **Present** — depends on online sync |
| Dedicated staff bulk reset RPC | **Missing** |
| Staff cache invalidation signal | **Missing** |
| Push notification to force recovery before POS use | **Missing** |

**Conclusion:** Current architecture **supports Shop Security PIN recovery only**. **Full shop credential recovery requires incremental additions** — not a greenfield auth redesign.

---

## PART 15 — Deliverables

### 1. Credential architecture

See Part 1 + Phase 20.3 diagram (still valid; add `shop_security_credentials` as authoritative server store post-20.4).

### 2. Recovery flow diagram

```mermaid
sequenceDiagram
  participant Admin as Internal Admin
  participant RPC as admin_shop_reset_backoffice_pin
  participant DB as PostgreSQL
  participant Dev as Owner Device
  participant Staff as Staff PIN path

  Admin->>RPC: Clear back office PIN
  RPC->>DB: recovery_signal + credentials null + snapshot null
  Note over Staff: Staff PINs unchanged in shop_pos_staff

  Dev->>DB: shop_fetch_recovery_signal (online)
  DB-->>Dev: clear_back_office_pin_at
  Dev->>Dev: applyAdminBackOfficePinClear
  Note over Dev: Shop PIN null; staff PIN still verifies

  Staff->>Dev: Lock screen / manager approval
  Dev-->>Staff: Success via staff PIN hash
```

### 3. Internal Admin reset trace

See **Part 3**.

### 4. Credential dependency graph

```
Owner Password (Supabase Auth)
  └── independent

Shop Security PIN (shop_security_credentials)
  ├── Back office unlock (fallback)
  ├── Manager approval (fallback)
  ├── POS lock unlock (fallback)
  ├── Sensitive actions (shop_security_pin mode)
  └── Biometric step-up fallback PIN

Staff PIN (shop_pos_staff)
  ├── Staff login
  ├── Lock screen (primary)
  ├── Back office unlock (primary)
  ├── Manager approval (primary)
  ├── Sensitive actions (staff_pin mode)
  └── Float / day-close / pharmacy (role-gated)

Admin Clear Back Office PIN
  └── clears ONLY Shop Security PIN subtree
```

### 5. Security risk report

See **Part 11**.

### 6. Enterprise recovery recommendation

See **Part 12** — **Option A now**, optional **Option B bundle** after staff invalidation RPC.

### 7. Minimal implementation scope (design only — no code in 21.0)

| Priority | Change | Why |
|----------|--------|-----|
| **P0** | Rename admin UI: **“Clear Shop Security PIN”** (not “Reset PIN”) | Stops support misinterpretation |
| **P0** | Block `migrateLocalShopSecurityPinToCloud` when `clear_back_office_pin_at` > local cache | Prevents PIN resurrection after admin clear |
| **P1** | Recovery apply on **every app foreground** (not only full sync) | Shrinks offline stale window |
| **P1** | New RPC `admin_shop_reset_staff_pins(shop_id)` + staff version bump + cache invalidation signal | Enterprise staff lockout |
| **P2** | Optional bundle RPC `admin_shop_reset_security_credentials` wrapping PIN clear + staff clear | Option B |
| **P2** | Invalidate encrypted staff cache on recovery signal | Offline staff login uses fresh hashes |

**Explicitly out of scope:** Redesigning `EnterpriseSecurityService`, changing staff approval rules, merging owner password into PIN reset.

---

## Success Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Every security credential inventoried | ✅ Part 1 |
| Which credentials admin currently resets | ✅ Shop Security PIN only |
| Which survive | ✅ Staff PIN/password, offline caches, owner password |
| Caches / offline validity | ✅ Documented — stale window exists |
| Should “Reset PIN” → “Reset Shop Security” | ✅ Rename + separate staff action recommended |
| Minimum implementation for full shop lockout | ✅ Part 15.7 (staff bulk + cache invalidation) |

---

*Phase 21.0 — read-only forensic certification. No code, migrations, or refactors were performed.*
