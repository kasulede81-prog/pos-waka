# Phase 16.5 — Enterprise Subscription Engine Consolidation Report

**Date:** July 10, 2026  
**Mode:** Architecture consolidation (no UI redesign, no payment integration, no business-rule changes)

---

## Executive Summary

Phase 16.5 implements the **write side** of the Enterprise Subscription architecture introduced in Phase 16.4. Every subscription mutation in Internal Admin, Shop Console, Marketing Agent, and signup flows now routes through a single **`subscriptionEngine`** module. The engine calls existing Supabase RPCs unchanged, emits standardized audit payloads, and triggers a unified refresh pipeline.

**Verification:** `npm run build` ✅ · `npm test` ✅ (1516 passed, 4 skipped · 283 test files)

---

## 1. Engine Architecture

### Canonical module

| Layer | File | Role |
|-------|------|------|
| **Mutation engine** | `src/lib/subscriptionEngine.ts` | Single write path for all subscription mutations |
| **Read resolver** (16.4) | `src/lib/effectiveSubscription.ts` | `resolveEffectiveSubscription()` — unchanged |
| **Audit standard** (16.4) | `src/lib/subscriptionAuditPayload.ts` | `buildSubscriptionAuditPayload()` — used by every mutation |
| **Refresh dispatch** | `src/lib/internalAdminActionRunner.ts` | `notifyInternalOpsChanged()` — shared event bus |

### Engine version

```typescript
SUBSCRIPTION_ENGINE_VERSION = "16.5"
```

### Public API (`subscriptionEngine` export)

| Method | RPC / behavior | Audit action |
|--------|----------------|--------------|
| `grant()` | `admin_shop_set_subscription_plan` | `subscription.grant` |
| `renew()` | `admin_shop_set_subscription_plan` | `subscription.renew` |
| `extend()` | `admin_extend_subscription_trial` | `subscription.extend_trial` |
| `cancel()` | `admin_subscription_set_status` → `cancelled` | `subscription.cancel` |
| `pause()` | `admin_subscription_set_status` → `paused` | `subscription.pause` |
| `resume()` | `admin_subscription_set_status` → `active` | `subscription.resume` |
| `markPaid()` | `admin_subscription_mark_payment` | `subscription.mark_paid` |
| `grantPromotionalAccess()` | `admin_grant_promotional_access` | `subscription.grant_promotional` |
| `extendPromotionalAccess()` | `admin_extend_promotional_access` | `subscription.extend_promotional` |
| `revokePromotionalGrant()` | `admin_revoke_promotional_access` | `subscription.revoke_promotional` |
| `approveTrialRequest()` | `internal_ops_subscription_request_set_status` → `approved` | `subscription.approve_trial_request` |
| `rejectTrialRequest()` | `internal_ops_subscription_request_set_status` → `rejected` | `subscription.reject_trial_request` |
| `fulfillAnnualOffer()` | `internal_ops_org_billing_offer_fulfill` | `subscription.fulfill_annual_offer` |
| `agentGrantPlan()` | `marketing_agent_upgrade_referral_plan` | `subscription.agent_grant` |
| `onSignup()` | `apply_growth_campaign_grant` | `subscription.on_signup_grant` |
| `onPaymentSuccess()` | **Extension point only** | — |
| `processExpiry()` | **Extension point only** | — |

### Mutation pipeline (`runMutation`)

```
UI / hook caller
      │
      ▼
subscriptionEngine.<method>(input)
      │
      ├─► resolveEffectiveSubscriptionForShop(shopId)  ← before snapshot
      │
      ├─► existing Supabase RPC (unchanged business logic)
      │
      ├─► resolveEffectiveSubscriptionForShop(shopId)  ← after snapshot (on success)
      │
      ├─► buildSubscriptionAuditPayload({ before, after, action, source, … })
      │
      ├─► logInternalAdminAudit({ metadata: { subscriptionAudit, engineVersion } })
      │
      └─► notifySubscriptionMutationChanged()
            └─► notifyInternalOpsChanged()
                  ├─ waka:internal-ops-changed
                  └─ waka:subscription-updated
```

The engine **does not** duplicate resolver logic. Before/after snapshots use Phase 16.4 `resolveEffectiveSubscription()`.

---

## 2. Before / After Call Graph

### Before (Phase 16.4 and earlier)

```
EnterpriseShopConsolePage ──► adminShopSetSubscriptionPlan() ──► RPC
                            ──► adminExtendSubscriptionTrial() ──► RPC
                            ──► adminSubscriptionSetStatus() ──► RPC
                            ──► adminSubscriptionMarkPayment() ──► RPC

PromotionalAccessPanel ──► adminGrantPromotionalAccess() ──► RPC
                       ──► adminExtendPromotionalAccess() ──► RPC
                       ──► adminRevokePromotionalAccess() ──► RPC

InternalOpsQueuePanels ──► internalOpsSetSubscriptionRequestStatus() ──► RPC
                       ──► internalOpsOrgBillingOfferFulfill() ──► RPC

MarketingAgentPage ──► marketingAgentUpgradeReferralPlan() ──► RPC

useAuth ──► applyGrowthCampaignGrantForSession() ──► RPC
         (manual refresh / inconsistent audit)
```

Each path had its own TS wrapper, inconsistent audit metadata, and ad-hoc refresh calls.

### After (Phase 16.5)

```
EnterpriseShopConsolePage ──► subscriptionEngine.grant / extend / pause / resume / cancel / markPaid

PromotionalAccessPanel ──► subscriptionEngine.grantPromotionalAccess / extendPromotionalAccess / revokePromotionalGrant

InternalOpsQueuePanels ──► subscriptionEngine.approveTrialRequest / rejectTrialRequest / fulfillAnnualOffer

MarketingAgentPage ──► subscriptionEngine.agentGrantPlan

useAuth ──► subscriptionEngine.onSignup

                    ┌──────────────────────────────────────┐
                    │     subscriptionEngine.runMutation    │
                    │  RPC → audit payload → refresh events │
                    └──────────────────────────────────────┘
```

**Zero** UI → RPC subscription mutation paths remain outside the engine in `src/`.

---

## 3. Mutation Routing Map

| Surface | File | Engine method(s) |
|---------|------|------------------|
| Shop Console — plan grant | `EnterpriseShopConsolePage.tsx` | `grant()` |
| Shop Console — extend trial | `EnterpriseShopConsolePage.tsx` | `extend()` |
| Shop Console — pause / resume / cancel | `EnterpriseShopConsolePage.tsx` | `pause()`, `resume()`, `cancel()` |
| Shop Console — mark payment | `EnterpriseShopConsolePage.tsx` | `markPaid()` |
| Promotional Access panel | `PromotionalAccessPanel.tsx` | `grantPromotionalAccess()`, `extendPromotionalAccess()`, `revokePromotionalGrant()` |
| Trial Queue — approve / reject | `InternalOpsQueuePanels.tsx` | `approveTrialRequest()`, `rejectTrialRequest()` |
| Billing — annual offer fulfill | `InternalOpsQueuePanels.tsx` | `fulfillAnnualOffer()` |
| Marketing Agent upgrades | `MarketingAgentPage.tsx` | `agentGrantPlan()` |
| Signup growth grant | `useAuth.ts` | `onSignup()` |

### Intentionally outside engine (not subscription mutations)

| Action | File | Reason |
|--------|------|--------|
| Annual offer **send** | `InternalOpsQueuePanels.tsx` → `internalOpsOrgBillingOfferSend()` | Creates billing ticket only; no subscription row change |
| Dashboard / queue **reads** | `wakaInternalAdmin.ts` | Read-only RPCs (`internal_ops_subscription_requests_pending`, etc.) |
| Growth campaign **CRUD** | `growthCampaignsAdmin.ts` | Campaign configuration, not subscription mutation |

---

## 4. Removed Duplicate Paths

The following TypeScript wrappers were **removed**. Underlying Supabase RPCs are **unchanged**.

### From `src/lib/wakaInternalAdmin.ts`

| Removed wrapper | Replaced by |
|-----------------|-------------|
| `adminExtendSubscriptionTrial()` | `subscriptionEngine.extend()` |
| `adminShopSetSubscriptionPlan()` | `subscriptionEngine.grant()` / `renew()` |
| `adminSubscriptionSetStatus()` | `subscriptionEngine.pause()` / `resume()` / `cancel()` |
| `adminSubscriptionMarkPayment()` | `subscriptionEngine.markPaid()` |
| `internalOpsSetSubscriptionRequestStatus()` | `subscriptionEngine.approveTrialRequest()` / `rejectTrialRequest()` |
| `internalOpsOrgBillingOfferFulfill()` | `subscriptionEngine.fulfillAnnualOffer()` |

Re-export preserved for convenience:

```typescript
export { ADMIN_PLAN_CODES, type AdminPlanCode } from "./subscriptionEngine";
```

### From `src/lib/growthCampaignsAdmin.ts`

| Removed wrapper | Replaced by |
|-----------------|-------------|
| `adminGrantPromotionalAccess()` | `subscriptionEngine.grantPromotionalAccess()` |
| `adminExtendPromotionalAccess()` | `subscriptionEngine.extendPromotionalAccess()` |
| `adminRevokePromotionalAccess()` | `subscriptionEngine.revokePromotionalGrant()` |
| `applyGrowthCampaignGrantForSession()` | `subscriptionEngine.onSignup()` |

### From `src/lib/referralAgents.ts`

| Removed wrapper | Replaced by |
|-----------------|-------------|
| `marketingAgentUpgradeReferralPlan()` | `subscriptionEngine.agentGrantPlan()` |

**Grep certification:** zero remaining references to removed wrapper names in `src/`.

---

## 5. Audit Standard

Every engine mutation uses `buildSubscriptionAuditPayload()` from Phase 16.4. No caller manually constructs audit objects.

### Payload shape

```typescript
SubscriptionAuditPayload {
  action, before, after, reason, source, actorId,
  durationDays, billingCycle, subscriptionType, timestamp
}
```

### Persistence

```typescript
await logInternalAdminAudit({
  shopId,
  action: ctx.action,
  result: "ok" | "failed",
  reason,
  metadata: {
    subscriptionAudit: audit,
    engineVersion: "16.5",
  },
});
```

### Action naming convention

All engine actions use the `subscription.*` namespace (e.g. `subscription.grant`, `subscription.fulfill_annual_offer`).

**Test:** `subscriptionEngine.test.ts` verifies action names integrate with `buildSubscriptionAuditPayload()`.

---

## 6. Refresh Pipeline

### Single dispatch entry

```typescript
// subscriptionEngine.ts
export function notifySubscriptionMutationChanged(): void {
  notifyInternalOpsChanged();
}
```

### Events dispatched (unchanged from 16.4)

| Event | Listeners |
|-------|-----------|
| `waka:internal-ops-changed` | `useInternalOpsData` — Shop Console, Internal Admin dashboard, queue panels |
| `waka:subscription-updated` | `SubscriptionContext`, `UpgradePage`, `useInternalOpsData` |

### Flow after successful mutation

1. Engine RPC succeeds
2. `notifySubscriptionMutationChanged()` fires both events
3. `SubscriptionContext` refetches effective subscription
4. Internal Admin hooks reload dashboard metrics, queues, shop detail
5. Shop Console panels refresh via `useInternalOpsData`

Duplicate per-caller refresh dispatches for subscription mutations were removed. One exception remains: **annual offer send** (non-mutation) still dispatches `waka:subscription-updated` locally after `internalOpsOrgBillingOfferSend()` to refresh the billing queue UI.

---

## 7. Extension Points (Phase 17.4+)

Documented stubs — **no implementation** in 16.5.

```typescript
SUBSCRIPTION_ENGINE_EXTENSION_POINTS = {
  onPaymentSuccess: "subscriptionEngine.onPaymentSuccess",
  processExpiry: "subscriptionEngine.processExpiry",
  platformTrialSwitch: "platform_subscription_settings (Phase 16.6+)",
}
```

| Hook | Intended caller | Input type |
|------|-----------------|------------|
| `onPaymentSuccess()` | Flutterwave, Stripe, MTN MoMo, Airtel Money webhooks | `PaymentSuccessInput` |
| `processExpiry()` | Daily cron / edge function | `ProcessExpiryInput` |
| Platform trial switch | Admin settings UI (future) | Reads platform settings, delegates to `onSignup()` |

Both extension methods currently return `{ ok: false, message: "…not implemented…" }`.

---

## 8. Business Rules — Unchanged

| Area | Status |
|------|--------|
| Pricing / plan amounts | ✅ Unchanged |
| Trial duration defaults | ✅ Unchanged |
| Promotional grant rules | ✅ Unchanged (RPC logic) |
| Subscription plan catalog | ✅ Unchanged |
| Audit schema | ✅ Unchanged (standardized in 16.4, consumed in 16.5) |
| Database schema | ✅ No migrations |
| Permissions / RBAC | ✅ Unchanged |
| Customer-facing UI | ✅ Unchanged |
| Internal Admin UI layout | ✅ Unchanged |

---

## 9. Test Results

```
npm run build   ✅  tsc -b && vite build --mode production
npm test        ✅  283 test files · 1516 passed · 4 skipped
```

### New tests

- `src/lib/subscriptionEngine.test.ts`
  - Engine version export
  - Extension points return not-implemented
  - `notifySubscriptionMutationChanged` dispatches both refresh events
  - Audit payload integration with engine action names

### Existing suites (no regression)

- `effectiveSubscription.test.ts`
- `subscriptionAuditPayload.test.ts`
- `subscriptionEnforcement.test.ts`
- `internalAdminActionRunner.test.ts`
- Full certification suite (1516 tests)

---

## 10. Success Criteria Checklist

- [x] Every subscription mutation flows through `subscriptionEngine`
- [x] Zero direct UI → RPC subscription mutations in `src/`
- [x] One audit payload standard (`buildSubscriptionAuditPayload`) used for all mutations
- [x] One refresh pipeline (`notifySubscriptionMutationChanged` → `notifyInternalOpsChanged`)
- [x] Existing UI unchanged
- [x] Existing behavior unchanged (RPCs untouched)
- [x] `npm run build` passes
- [x] `npm test` passes

**Phase 16.5: COMPLETE**

---

## 11. Files Changed

### New

- `src/lib/subscriptionEngine.ts`
- `src/lib/subscriptionEngine.test.ts`
- `docs/PHASE_16_5_ENTERPRISE_SUBSCRIPTION_ENGINE.md`

### Modified (callers migrated)

- `src/pages/EnterpriseShopConsolePage.tsx`
- `src/components/internal-admin/v2/PromotionalAccessPanel.tsx`
- `src/components/internal-admin/InternalOpsQueuePanels.tsx`
- `src/pages/MarketingAgentPage.tsx`
- `src/hooks/useAuth.ts`
- `src/components/internal-admin/v2/shop-console/tabs/ShopConsoleSubscriptionsTab.tsx`

### Modified (duplicate wrappers removed)

- `src/lib/wakaInternalAdmin.ts`
- `src/lib/growthCampaignsAdmin.ts`
- `src/lib/referralAgents.ts`

---

## 12. Recommended Next Phases

Per revised roadmap:

1. **Phase 17.1** — Critical production fixes (silent failures, global toasts, stock transfer, dead code)
2. **Phase 17.2** — Enterprise consolidation
3. **Phase 17.3** — Performance optimization
4. **Phase 17.4** — Payment integration readiness (implement `onPaymentSuccess`, webhook routing)
5. **Phase 17.5** — Final enterprise production certification

Phase 16.5 completes the subscription read/write architectural foundation. Payment providers and daily expiry should plug into the documented extension points in 17.4+.
