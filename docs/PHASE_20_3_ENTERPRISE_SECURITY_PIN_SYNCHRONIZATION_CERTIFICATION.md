# Phase 20.3 — Enterprise Security PIN Synchronization Certification

**Mode:** Read-only forensic audit (no code changes)  
**Date:** July 2026  
**Foundation:** Phase 18.0, 18.1, 20.0, 20.2  
**Verdict:** **Not certified for multi-device owner PIN parity** — shop security PIN is architecturally shop-scoped but implemented as device-local preferences with incomplete cloud propagation.

---

## Executive Summary

| Question | Answer |
|----------|--------|
| Is Back Office PIN disappearing on a second device **correct by design**? | **No** for enterprise multi-device owners — **partially intentional in copy** ("on this phone") but **inconsistent with verification model** |
| What is Back Office PIN scoped to? | **Shop credential** in code (`preferences.backOfficePin`, shop-wide verification) — **device-local in persistence/sync** |
| Do staff PINs sync across devices? | **Yes** — `shop_pos_staff.pin_hash` via cloud RPC + staff cache download |
| Does owner Supabase password sync? | **Yes (account-level)** — Supabase Auth, not device-bound |
| Safest fix direction | Dedicated **shop-scoped server credential** OR reliable **snapshot + incremental preference merge** with upload-on-PIN-save |

**Certification score: 62 / 100** (security hashing strong; multi-device PIN parity failed)

---

## 1. Enterprise PIN Architecture Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│ OWNER ACCOUNT (Supabase Auth)                                            │
│   Email/password, OAuth, recovery — auth.users — ALL devices             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SHOP CREDENTIALS (PostgreSQL + preferences blob)                         │
│   Staff PIN/password → shop_pos_staff (cloud authoritative) ✅ sync      │
│   Shop Security PIN → preferences.backOfficePin (local IndexedDB) ⚠️   │
│   Staff roles, limits → cloud + local merge ✅                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ DEVICE LAYER                                                             │
│   IndexedDB namespace sb:<userId> — PER PHYSICAL DEVICE                  │
│   Device fingerprint (localStorage waka-pos-device-id)                   │
│   Biometric (OS secure enclave — never stored by Waka)                   │
│   Security session (memory, 5 min TTL)                                   │
│   Unlock brute-force limiter (localStorage)                              │
│   Offline staff cache encryption key includes device fingerprint         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Verification hub:** `EnterpriseSecurityService.ts` — single engine for shop PIN, staff PIN, biometric, back-office shell, manager approval, float/day-close overrides.

---

## 2. Complete PIN Inventory

| # | PIN / credential | Purpose | Stored where | Scope | Syncs? |
|---|------------------|---------|--------------|-------|--------|
| 1 | **Owner login password** | Supabase account auth | Supabase `auth.users` | **Owner account** | ✅ All devices |
| 2 | **Back Office / Shop Security PIN** (`backOfficePin`) | Back office unlock, sensitive actions, owner step-up, lock screen fallback | `ShopPreferences.backOfficePin` → IndexedDB per device; optionally `shop_cloud_snapshots.snapshot.preferences` | **Shop (intended)** / **Device (actual)** | ⚠️ Snapshot only, unreliable |
| 3 | **Staff PIN** | Staff login, lock screen, POS identity | `shop_pos_staff.pin_hash` (PG) + local `staffAccounts[].pinHash` | **Shop** | ✅ Cloud RPC + staff cache |
| 4 | **Staff password** | Staff login alternative | `shop_pos_staff.password_hash` + local | **Shop** | ✅ Cloud RPC |
| 5 | **Manager approval PIN** | Discounts, void/reopen bill, float override, pharmacy controlled, day close variance | *No separate store* — verifies staff PIN (manager/supervisor/owner roles) OR shop security PIN | **Shop (verify)** | ✅ Indirect via #2/#3 |
| 6 | **Day close reopen PIN** | Reopen closed business day | Same as manager approval path (`resolveDayCloseApproval`) | **Shop (verify)** | ✅ Indirect |
| 7 | **Pharmacy controlled Rx PIN** | Controlled medicine approval/dispense | Same (`verifyManagerApprovalPinSync`) | **Shop (verify)** | ✅ Indirect |
| 8 | **POS lock PIN** | Unlock after `posLocked` | Staff PIN or shop security PIN (`verifyLockScreenPin`) | **Shop (verify)** | ⚠️ Shop PIN local |
| 9 | **Biometric gate** | Step-up before sensitive actions | OS secure module; `biometricAuthEnabled` flag in preferences | **Device OS + shop pref flag** | ❌ Flag is local |
| 10 | **Security session** | 5-minute elevated auth after PIN/biometric | Memory only (`securitySession.ts`) | **Device session** | ❌ By design |
| 11 | **Unlock brute-force limiter** | Lock screen progressive lockout | `localStorage` `waka.staff.unlock.limiter.v1` | **Device** | ❌ By design |
| 12 | **Pharmacy "pinned notes"** | UI feature — NOT security | Patient profile fields | N/A | N/A |
| 13 | **Register mode fingerprint** | Offline register primary device selection | `preferences.primaryDeviceFingerprint` | **Device (offline register)** | ❌ Unrelated to security |

---

## 3. Storage Matrix

| Storage layer | Credentials present | Notes |
|---------------|---------------------|-------|
| **Supabase Auth** | Owner email/password | Account-level; not shop-specific |
| **PostgreSQL `shop_pos_staff`** | `pin_hash`, `password_hash` | Authoritative for staff; device check via `shop_device_can_manage_staff` |
| **PostgreSQL `shop_cloud_snapshots`** | Full `preferences` JSON including `backOfficePin` hash | One row per shop; upload debounced 5 min; requires products OR sales |
| **PostgreSQL `shop_recovery_signals`** | `clear_back_office_pin_at` | Admin clear propagates to devices on sync |
| **IndexedDB** (`localDb`, account `sb:<uid>`) | Full `preferences`, `staffAccounts`, all POS data | **Separate per physical device** |
| **IndexedDB `staffCache`** | Encrypted staff rows (hashes only) | Encryption key includes **device fingerprint** |
| **localStorage** | Device ID, unlock limiter, authority cache, recovery flags | Device-local |
| **Capacitor Secure Storage** | Not used for PINs in current codebase | — |
| **Memory** | `SecuritySession` (5 min), sensitive action state | Cleared on refresh |

**No dedicated SQL column** exists for shop security PIN — only embedded in snapshot JSON and local preferences.

---

## 4. Synchronization Matrix

| Credential | Should sync? | Currently syncs? | Why |
|------------|--------------|------------------|-----|
| Owner Supabase password | ✅ Yes | ✅ Yes | Account identity |
| **Shop Security / Back Office PIN** | ✅ **Yes** (shop-wide secret for all approved owner devices) | ❌ **Unreliable** | Stored in local preferences; incremental cloud merge **preserves local** `backOfficePin`; snapshot upload has gaps |
| Staff PIN | ✅ Yes | ✅ Yes | Cloud-authoritative `shop_pos_staff_*` RPCs |
| Staff password | ✅ Yes | ✅ Yes | Same |
| Manager approval PIN | ✅ Yes (via staff/shop PIN) | ⚠️ Partial | Works when underlying credentials present on device |
| POS lock PIN | ✅ Staff yes; shop PIN should yes | ⚠️ Partial | Same as back office PIN |
| Biometric enabled flag | ⚠️ Optional per device | ❌ No | Reasonable as device preference |
| Security session | ❌ No | ❌ No | Short-lived step-up — correct |
| Unlock limiter state | ❌ No | ❌ No | Device brute-force state — correct |

---

## 5. Multi-Device Workflow Trace

### Scenario: Owner creates Back Office PIN on Phone A, logs in on Phone B

| Step | Phone A | Phone B / Web / Windows |
|------|---------|---------------------------|
| Create PIN | `BackOfficePinForm` → `hashShopSecurityPin` → `setPreferences({ backOfficePin: argon2id:... })` → IndexedDB persist | — |
| Cloud upload | `uploadShopCloudSnapshot` includes preferences **if** debounce elapsed + products/sales exist | — |
| Login device B | — | Fresh IndexedDB `sb:<uid>` with default `backOfficePin: null` |
| Cloud hydrate | — | If `localEmpty`: `restoreShopFromCloudSnapshot` **may** restore PIN from snapshot |
| Incremental sync | — | `pullCloudAndMergeIntoStore` sets `preferences: { ...state.preferences, shifts }` — **keeps local null PIN** |
| UI | "A PIN is saved on this phone" | "No PIN yet" + lock screen **Setup PIN** prompt (`AppShell` `showSetupPin`) |
| Back office | PIN required → unlock works | PIN not configured → open OR prompt to create **second PIN** |

### Root cause (code evidence)

**Incremental merge never pulls `backOfficePin` from cloud:**

```3126:3126:src/offline/cloudSync.ts
      preferences: { ...state.preferences, shifts: mergedShifts },
```

```3273:3273:src/offline/cloudSync.ts
      preferences: { ...state.preferences, shifts: mergedShifts },
```

Only `shifts` merge from cloud pull; all other preference fields including `backOfficePin` stay **device-local**.

**Snapshot path can work but is not guaranteed:**

- Upload: `cloudSnapshotSync.ts` line 216 — skips upload if no products AND no sales
- Upload debounce: 5 minutes minimum interval
- Device B may receive incremental product sync first → `localEmpty` false → snapshot restore skipped

**Product copy explicitly describes device-local behavior:**

```3181:3184:src/lib/i18n.ts
  settingsBackOfficePinCleared: "PIN removed. Back office opens without a PIN on this device.",
  settingsBackOfficePinActiveShort: "A PIN is saved on this phone.",
```

---

## 6. Verification Pipeline (per credential type)

### Shop Security / Back Office PIN

| Stage | Implementation |
|-------|----------------|
| **Creation** | `BackOfficePinForm` → `hashShopSecurityPin()` → Argon2id via `hashStaffSecretAsync` |
| **Storage** | `usePosStore.setPreferences` → IndexedDB persist → optional snapshot upload |
| **Hashing** | Argon2id prefix `argon2id:`; legacy plaintext 4–6 digits still verify |
| **Sync** | Full snapshot only; no incremental preference merge; no dedicated RPC |
| **Verification** | `verifyShopSecurityPinAsync` → `EnterpriseSecurityService.verifyBackOfficeShellCredential`, lock screen, sensitive actions |
| **Reset** | Owner clears in Settings; admin `admin_shop_reset_backoffice_pin` + `shop_recovery_signals` |
| **Recovery** | `applyAdminBackOfficePinClear` clears local PIN on sync |
| **Deletion** | `setPreferences({ backOfficePin: null })` |

### Staff PIN

| Stage | Implementation |
|-------|----------------|
| **Creation** | `StaffCreateWizard` / `addStaffAccount` → `hashStaffSecretAsync` |
| **Storage** | Local `staffAccounts` + cloud `shop_pos_staff_upsert` |
| **Hashing** | Argon2id / bcrypt / legacy |
| **Sync** | `pullShopStaffFromCloud`, `staffCacheSync`, `mergeStaffAccountsForCloudSync` |
| **Verification** | `verifyStaffPin` / `staffSecretMatchesAsync` |
| **Reset** | `resetStaffSecret` → cloud upsert |
| **Lockout** | Cloud `failed_pin_attempts`, `locked_until`; local mirror |

### Manager / approval PINs

No separate credential — **reuses** staff PIN (role-filtered) or shop security PIN via `verifyManagerApprovalPinSync`.

---

## 7. Password Relationship

| Credential | Belongs to |
|------------|------------|
| Owner Supabase password | **Owner account** (global) |
| Staff password | **Shop** (per staff row) |
| Shop Security PIN | **Shop** (semantic) — **device copy** (implementation) |
| Biometric | **Device** (OS) + shop toggle |
| Security session | **Device session** (ephemeral) |

---

## 8. Security Review

| Control | Status | Notes |
|---------|--------|-------|
| Argon2id hashing (staff + shop PIN) | ✅ | `staffSecret.ts`, `shopPinSecret.ts` |
| Plaintext never in staff cache | ✅ | `sanitizeStaffForCache` |
| Progressive lockout (lock screen) | ✅ | `staffLoginLimiter.ts` — localStorage |
| Staff cloud lockout | ✅ | `shop_pos_staff` fields + RPC |
| Audit logging | ✅ | `staffSecurityAudit`, `enterpriseSecurity/audit`, `staffSessionAudit` |
| Biometric never stored | ✅ | Native OS only |
| Admin PIN clear propagation | ✅ | `shop_recovery_signals` |
| **Cross-device PIN sync** | ❌ | Gap — see Part 4 |
| **Sync security impact if fixed** | Low risk if hash-only sync | Never sync plaintext; use server-side hash or encrypted preference merge |

Synchronizing the **hash** across devices does **not** reduce security vs banking apps — it aligns with account-bound step-up secrets. Device-local-only model is **weaker for UX**, not stronger for security, when owners expect one PIN everywhere.

---

## 9. Enterprise Comparison

| Product | Owner/step-up PIN behavior | Waka today | Waka should be |
|---------|---------------------------|------------|----------------|
| **Apple ID** | Account-bound; all devices | N/A (uses Supabase for login) | — |
| **WhatsApp** | Linked-device encryption; account session | Staff cloud sync ✅ | Shop PIN should match |
| **Banking apps** | App PIN / biometrics sync with account | Shop PIN device-local ❌ | Shop PIN on all owner devices |
| **Stripe Dashboard** | Account password + 2FA; no per-device PIN | Supabase ✅ | Back office PIN = shop step-up |
| **Shopify Admin** | Account login; staff have shop-scoped access | Similar staff model ✅ | Owner step-up should be shop-wide |
| **Microsoft Authenticator** | Device-bound TOTP — different class | Biometric per device ✅ | Keep biometric local |

**Conclusion:** Owner/security PIN for back office should behave like a **shop account step-up secret** (all approved owner devices), not like a **device passcode**.

---

## 10. Architecture Decision Table

| Credential | Correct architecture | Justification |
|------------|---------------------|---------------|
| Owner login password | **Owner account** | Supabase identity — already correct |
| **Shop Security / Back Office PIN** | **Shop** (all approved owner devices) | Same shop, same owner operations; verified as shop-wide in `EnterpriseSecurityService` |
| Staff PIN | **Shop** | Already cloud-authoritative |
| Staff password | **Shop** | Already cloud-authoritative |
| Manager approval PIN | **Shop (verify only)** | Delegates to staff/shop PIN — correct |
| POS lock PIN | **Staff = shop; Owner path = shop PIN** | Lock uses same credentials |
| Biometric enable flag | **Device preference** (optional shop default) | OS-bound; reasonable per-device |
| Security session | **Device ephemeral** | 5-minute step-up — correct |
| Unlock limiter | **Device** | Brute-force state — correct |
| Offline staff cache key | **Device + shop** | Encryption binding — correct for offline |

---

## 11. Migration Blueprint (design only — do not implement in 20.3)

### Recommended: Shop-scoped server credential (preferred)

1. **SQL:** Add `shop_security_pin_hash text` on `shops` or `organizations` (nullable); RPCs `shop_security_pin_get`, `shop_security_pin_set` (owner-only, approved device).
2. **Never store plaintext server-side** — client sends PIN once, server hashes Argon2id (or client sends hash with rate limit).
3. **Login hydrate:** Fetch hash into memory cache; merge into local preferences for offline verify.
4. **PIN save:** Write server first, then local, then invalidate other devices on next sync (or push notification).
5. **Backward compat:** On first login after migration, if server null but local hash exists → upload local hash to server.
6. **Offline:** Keep local hash copy for verify when offline; reconcile on reconnect.
7. **Admin clear:** Already have `shop_recovery_signals` — extend to null server column + snapshot.

### Alternative: Fix snapshot + incremental merge (smaller change, weaker)

1. Merge `backOfficePin` from latest cloud snapshot on every owner login.
2. Force `uploadShopCloudSnapshot({ force: true })` immediately on PIN save/clear.
3. Include `backOfficePin` in incremental preference merge with last-write-wins timestamp.
4. Add `preferencesUpdatedAt` for conflict resolution.

### Conflict handling

- **Server wins** for shop security PIN (support/admin clear authoritative).
- **Last-write-wins with audit** for owner-initiated change from two devices simultaneously.

### Existing users

- Devices with local PIN only → one-time upload to server on next online session.
- Devices without PIN → pull from server on hydrate.
- No PIN reset required unless admin recovery.

---

## 12. Bug Report — Disappearing Back Office PIN

| Classification | Verdict |
|----------------|---------|
| ✅ Correct by design | **No** — enterprise multi-device owners expect shop-wide PIN |
| ⚠️ UX inconsistency | **Yes** — i18n says "this phone" but product positioning is cloud shop |
| ❌ Enterprise architecture bug | **Yes** — shop-scoped verification + device-local persistence/sync gap |

**Evidence chain:**

1. PIN stored in `preferences.backOfficePin` (shop preferences struct) — not device preferences struct.
2. Verified by `EnterpriseSecurityService` as **shop security PIN** — used for owner-level actions shop-wide.
3. Incremental cloud sync **does not merge** `backOfficePin` (`cloudSync.ts` lines 3126, 3273).
4. Snapshot upload **conditional** and **debounced** — PIN may never reach cloud.
5. New device IndexedDB starts with `backOfficePin: null` (`defaultSeed.ts`).
6. UI prompts **create PIN again** (`AppShell` `showSetupPin`, `settingsBackOfficePinNone`).
7. i18n explicitly documents **device-local** semantics ("on this phone") — historical intentional choice, now misaligned with Phase 20 multi-device owner model.

---

## 13. Regression / Non-Goals (unchanged)

This audit did **not** modify: subscriptions, sync engine logic, POS, device limits, staff RPCs, or activation (Phase 20.2).

---

## 14. Verification

- ✅ Read-only — no code, SQL, or test changes
- ✅ Evidence from: `BackOfficePinForm.tsx`, `cloudSync.ts`, `cloudSnapshotSync.ts`, `EnterpriseSecurityService.ts`, `shopPinSecret.ts`, `staffRecovery.ts`, `offlineStaffCache.ts`, `i18n.ts`, migrations 046/131, Phase 18.0 audit

---

## 15. Success Criteria Checklist

| Criterion | Met? |
|-----------|------|
| Which PINs belong to owner account | ✅ Documented |
| Which PINs belong to shop | ✅ Documented |
| Which PINs belong to device | ✅ Documented |
| Back Office PIN disappearing — defect or design | ✅ **Defect** (sync gap + historical device-local UX) |
| Safest migration path | ✅ Server credential recommended |
| No implementation in this phase | ✅ |

**Phase 20.4 (proposed):** Implement shop-scoped security PIN synchronization per Migration Blueprint §11.
