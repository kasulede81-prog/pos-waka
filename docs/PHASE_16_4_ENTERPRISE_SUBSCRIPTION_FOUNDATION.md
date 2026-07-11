# Phase 16.4 — Enterprise Subscription Foundation Report

**Date:** July 10, 2026  
**Mode:** Architecture consolidation (no new features, no UI redesign, no payment integration)

---

## Executive Summary

Phase 16.4 establishes a **single Enterprise Subscription Resolver** used across the client, with **server-side SQL aligned to the same rules**. Promotional grants are first-class in resolution. Trial expiry is consistent. Bootstrap subscription initialization has one owner. The codebase is ready for Phase 16.5 (Enterprise Subscription Engine mutations).

**Verification:** `npm run build` ✅ · `npm test` ✅ (1512 passed, 4 skipped)

---

## 1. Subscription Resolver Architecture

### Authoritative resolver

| Layer | File | Entry point |
|-------|------|-------------|
| **Enterprise resolver** | `src/lib/effectiveSubscription.ts` | `resolveEffectiveSubscription()` |
| **Feature gates (delegated)** | `src/lib/subscriptionEntitlements.ts` | `resolveEffectivePlanTier()` → resolver |
| **Device limits** | `src/lib/shopDevices.ts` | `parsePlanDeviceLimit()` → `resolveEffectiveDeviceLimit()` |
| **License display** | `src/lib/desktopLicenseDisplay.ts` | `resolveDesktopLicenseDisplay()` → resolver |
| **Server tier** | `supabase/migrations/134_enterprise_subscription_foundation.sql` | `shop_effective_plan_code()` |
| **Server device limits** | Same migration | `resolve_shop_device_limit()` → effective tier |

### Resolution pipeline

```
SubscriptionSnapshot (row + promotionalGrant)
        │
        ▼
resolveBaseSubscription()     ← trial expiry, period expiry, status
        │
        ▼
resolveActivePromotionalGrantTier()   ← non-revoked, unexpired grant
        │
        ▼
effectivePlan = max(base, grant) by tier rank
        │
        ▼
EffectiveSubscription snapshot
```

### `EffectiveSubscription` fields

```typescript
planCode, planTier, subscriptionType, status, source,
billingCycle, startsAt, expiresAt, trialEndsAt,
promotionalGrant, effectivePlan, isTrial, isPaid,
isExpired, daysRemaining, deviceLimit
```

### Engine extension point (Phase 16.5)

`SUBSCRIPTION_ENGINE_EXTENSION_POINT` in `effectiveSubscription.ts` exposes `resolverVersion: "16.4"` and `resolveEffectiveSubscription` for future `grant()`, `extend()`, `renew()`, `cancel()` to plug in.

---

## 2. Source-of-Truth Certification

| Source | Role after 16.4 | Certified? |
|--------|-----------------|------------|
| `subscriptions` + `subscription_plans` | Primary persisted subscription | ✅ |
| `promotional_grants` | First-class overlay in resolver (client + server) | ✅ |
| `resolveEffectiveSubscription()` | Single derived effective state | ✅ |
| `SubscriptionContext` snapshot | Cache; refetch on `waka:subscription-updated` | ✅ |
| `shops.current_plan_code` | Still unused (no change this phase) | ⚠️ Orphan |
| `user_metadata` | Not used for billing | ✅ N/A |

**Rule:** No code should compute effective tier independently. All readers use `resolveEffectivePlanTier()` or `resolveEffectiveSubscription()`.

---

## 3. Client/Server Consistency Report

### Before 16.4

| Scenario | Client | Server |
|----------|--------|--------|
| Business trial (active) | Business | **Free** ❌ |
| Expired trial | Business (no `trial_ends_at` check) | Free |
| Promotional grant on free | Business | **Ignored** ❌ |
| Device limit with grant | Grant tier | Raw subscription plan ❌ |

### After 16.4

| Scenario | Client | Server |
|----------|--------|--------|
| Business trial (active) | Business | Business ✅ |
| Expired trial (`trial_ends_at` past) | Free | Free ✅ |
| Promotional grant upgrade | Grant tier if higher | Grant tier if higher ✅ |
| Device limit | Effective tier | Effective tier ✅ |

### SQL helpers added (migration 134)

- `_normalize_plan_code(text)`
- `_resolve_promotional_grant_tier(org_id)`
- `_resolve_subscription_base_tier(status, plan, trial_ends, period_end)`
- `shop_effective_plan_code(shop_id)` — rewritten
- `resolve_shop_device_limit(shop_id)` — uses effective tier plan features

---

## 4. Bootstrap Conflict Resolution

### Problem

Two signup paths could create competing subscription rows:

- `bootstrap_owner_workspace` → Business trial (30 days)
- `save_owner_business_profile_bundle` → Free active if no row exists

Race: profile bundle could insert Free before bootstrap, blocking Business trial.

### Resolution

**Single owner:** `bootstrap_owner_workspace` (migration 117) is the only subscription initializer.

**Change:** Removed subscription insert block from `save_owner_business_profile_bundle` in migration 134. Onboarding bundle now only persists org/shop/profile data.

**Client comment updated:** `businessProfile.ts` documents bootstrap as subscription init path.

---

## 5. Promotional Grant Integration Report

| Aspect | Status |
|--------|--------|
| Fetched with subscription snapshot | ✅ `fetchActivePromotionalGrant()` |
| Included in `EffectiveSubscription.promotionalGrant` | ✅ |
| Upgrade-only overlay (never downgrade paid tier) | ✅ Client + server |
| `source: "promotional_grant"` when grant drives tier | ✅ |
| Server RPCs using `shop_effective_plan_code` | ✅ Now grant-aware |

No separate client-only overlay path remains for tier calculation.

---

## 6. Trial Logic Certification

### Unified rules (client + server)

1. `status` in (`trial`, `trialing`) + `trial_ends_at` in future → tier from `plan_code`
2. `status` in (`trial`, `trialing`) + `trial_ends_at` past → **free** (expired)
3. `status = expired` → free
4. `status = active` + `current_period_end` past → free
5. Otherwise → tier from `plan_code`

### Fix applied

Previously, client ignored `trial_ends_at` while status remained `trial`, allowing expired trials to retain Business access. Now expired trials correctly resolve to free.

**Tests:** `effectiveSubscription.test.ts`, updated `subscriptionEntitlements.test.ts`, `p0Verification.test.ts` (fixture date fixed).

---

## 7. Device Limit Resolution Certification

| Before | After |
|--------|-------|
| Client: `resolveEffectivePlanTier` + row `max_devices` | `resolveEffectiveDeviceLimit()` from resolver |
| Server: raw subscription plan features | `shop_effective_plan_code` → plan catalog features |

Promotional grant boosting free → business now yields **4 devices** on both client and server.

---

## 8. Audit Payload Standard

**File:** `src/lib/subscriptionAuditPayload.ts`

```typescript
SubscriptionAuditPayload {
  action, before, after, reason, source, actorId,
  durationDays, billingCycle, subscriptionType, timestamp
}
```

**Builder:** `buildSubscriptionAuditPayload()` — ready for Phase 16.5 mutations.

**Test:** `subscriptionAuditPayload.test.ts`

Mutations are **not** rewired this phase; structure only.

---

## 9. Dead Code Removal Report

| Item | Action | Safe? |
|------|--------|-------|
| `adminSubscriptionSetPlan()` TS wrapper | **Removed** from `wakaInternalAdmin.ts` | ✅ Zero callers |
| `resolveBasePlanTier()` (private) | Replaced by resolver internals | ✅ |
| `resolveExpiryMs()` in desktopLicenseDisplay | Removed; uses resolver | ✅ |
| Duplicate device limit logic in `shopDevices` | Removed | ✅ |
| SQL `admin_subscription_set_plan` RPC | **Kept** (migration history / direct SQL) | N/A |

**Not removed:** Production RPCs, migration history, `adminShopSetSubscriptionPlan` (live path).

---

## 10. Phase 16.5 Readiness Assessment

| Prerequisite | Status |
|--------------|--------|
| Single resolver for reads | ✅ Ready |
| Standardized `EffectiveSubscription` snapshot | ✅ Ready |
| Standardized audit payload shape | ✅ Ready |
| Client/server tier agreement | ✅ Ready |
| Bootstrap single init path | ✅ Ready |
| Engine extension point exported | ✅ Ready |
| Mutation RPCs unified | ❌ Phase 16.5 |
| `grant/extend/renew/cancel/processDailyExpiry` | ❌ Phase 16.5 |
| Trial master switch (platform settings) | ❌ Phase 16.6+ |
| Internal Admin subscription card redesign | ❌ Later phase |

### Recommended Phase 16.5 first steps

1. Create `subscription_engine_*` RPC family wrapping existing admin mutations
2. Route `adminShopSetSubscriptionPlan`, trial extend, status changes through engine TS client
3. Emit `buildSubscriptionAuditPayload()` on every mutation
4. Add `processDailyExpiry()` cron (separate sub-phase if needed)

---

## Files Changed

### New

- `src/lib/effectiveSubscription.ts`
- `src/lib/effectiveSubscription.test.ts`
- `src/lib/subscriptionAuditPayload.ts`
- `src/lib/subscriptionAuditPayload.test.ts`
- `supabase/migrations/134_enterprise_subscription_foundation.sql`
- `docs/PHASE_16_4_ENTERPRISE_SUBSCRIPTION_FOUNDATION.md`

### Modified

- `src/lib/subscriptionEntitlements.ts` — delegates to resolver
- `src/lib/shopDevices.ts` — device limits via resolver
- `src/lib/desktopLicenseDisplay.ts` — display via resolver
- `src/lib/fetchShopSubscription.ts` — comment update
- `src/lib/businessProfile.ts` — comment update
- `src/lib/wakaInternalAdmin.ts` — removed dead wrapper
- `src/lib/subscriptionEntitlements.test.ts` — trial expiry test
- `src/lib/p0Verification.test.ts` — fixture trial date

---

## Success Criteria Checklist

- [x] Exactly one effective subscription resolver exists
- [x] Client and server resolve subscriptions identically (logic parity)
- [x] Promotional grants participate in the same resolution pipeline
- [x] Trial evaluation is consistent everywhere
- [x] Device limits consume the unified resolver
- [x] Bootstrap race conditions eliminated
- [x] Subscription snapshots standardized (`EffectiveSubscription`)
- [x] Codebase prepared for Phase 16.5
- [x] `npm run build` passes
- [x] All tests pass

**Phase 16.4: COMPLETE**
