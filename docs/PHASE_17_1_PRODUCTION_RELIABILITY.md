# Phase 17.1 — Production Reliability & User Feedback Certification

**Date:** July 10, 2026  
**Mode:** Production hardening (no new business features, no UI redesign, no payment integration)

---

## Executive Summary

Phase 17.1 raises production readiness by eliminating silent failures, standardizing user feedback through a global toast architecture, and removing misleading placeholder behavior (notably stock transfers). Shop mutations now follow a single execution pipeline parallel to Internal Admin's `executeInternalAdminAction`.

**Target:** ~8.2–8.5/10 production readiness (from 7.3/10 enterprise baseline)

---

## 1. Enterprise Shop Action Runner

### Module

| File | Role |
|------|------|
| `src/lib/shopActionRunner.ts` | `executeShopAction()` — confirm → busy → execute → refresh → toast callbacks |
| `src/hooks/useShopAction.ts` | Wires runner to global `useToast()` |
| `src/lib/shopNotification.ts` | Standard success/error message resolution |
| `src/lib/shopActionRunner.test.ts` | Unit tests |

### Pipeline

```
UI handler
  → useShopAction().run({ lang, action, permitted, ... }, () => store mutation)
    → executeShopAction()
      → permission / confirm
      → mutation fn → { ok, errorKey?, message? }
      → onSuccess → toast.success()
      → onError → toast.error()
```

### Adopted call sites

| Surface | Action key |
|---------|------------|
| `CustomersPage` — debt payment | `customer.debt_payment` |
| `CustomersPage` — add customer | `customer.add` |
| `SuppliersTab` — supplier payment | `supplier.payment` |
| `KitchenDisplayPage` — reprint chit | `kitchen.reprint` |

---

## 2. Global Toast Architecture

### Provider

| File | Role |
|------|------|
| `src/context/ToastProvider.tsx` | Global toast viewport + `useToast()` hook |
| Mounted in | `App.tsx` → `ToastProvider lang={lang}` |

### Toast kinds

| Kind | Use |
|------|-----|
| `success` | Mutation saved |
| `warning` | Sync retry, non-fatal issues |
| `error` | Failed mutation, permission denied |
| `offline` | Offline state |
| `syncing` | Background sync in progress |

### Sync failure bridge

`reportSyncIssue()` in `monitoring.ts` dispatches `waka:sync-issue` for user-facing codes. `ToastProvider` listens and shows `notifySyncFailed` warning toasts for:

- `debt_payment_push_failed` / `debt_payment_rpc_failed`
- `cash_expense_push_failed`
- `sync_flush_error`

---

## 3. Silent Failure Fixes

| Area | Before | After |
|------|--------|-------|
| **Debt payments** (`CustomersPage`) | Failure swallowed; sheet always closed | `executeShopAction` + toast; sheet stays open on failure |
| **Add customer** (`DebtAddCustomerSheet`) | Closed unconditionally | Returns `ok`; closes only on success |
| **Supplier payments** (`SuppliersTab`) | No error UI | Toast on failure via `executeShopAction` |
| **Expense cloud sync** (`cloudSync.ts`) | Push failure silent | `reportSyncIssue("cash_expense_push_failed")` → toast |
| **Kitchen reprint** (`hardwarePrintMutations.ts`) | Always `{ ok: true }` | Validates printer + auto-print enabled; toast on failure |
| **Enterprise HQ metrics** (`EnterpriseDashboardPage`) | RPC error → zeros | Loading / error / retry via `EnterpriseAsyncShell` |
| **Enterprise audit** (`EnterpriseAuditCenterPage`) | RPC error → empty list | Error state + retry; distinct from empty |

---

## 4. Stock Transfer Safety

| Route | Change |
|-------|--------|
| `/stock/transfer` (`InventoryTransferPage`) | Replaced fake completion wizard with **Coming soon** empty state |
| `/enterprise/transfers` (`EnterpriseTransfersPage`) | Same — no fake lifecycle demo |

Message: *"Stock transfers are not yet available. Your inventory was not changed."*

No fake success. No persistence until Phase 17.2+.

---

## 5. Dead Code Removed

| Removed | Reason |
|---------|--------|
| `DashboardPage.tsx` | Unrouted; `HomePage` is `/` |
| `PurchasesPage.tsx` | Redirect → `/stock?tab=purchases` |
| `SuppliersPage.tsx` | Redirect → `/stock?tab=suppliers` |
| `StaffActivityPage.tsx` | Stub; `/office/audit-center` used |
| `ConnectedDevicesPage.tsx` | `/settings/devices` → `DeviceManagementPage` |
| `MonthlyReportsPage.tsx` | Redirect; `MonthlyReportsPanel` kept |
| `SettingsPage.tsx` | Redirect → `SettingsHubPage` |
| `BiometricAuthModal.tsx` | Superseded by `EnterpriseSecurityDialog` |
| `dashboardWidgetLoader.ts` | Unused; registries use inline `lazy()` |
| `reportWidgetLoader.ts` | Unused |
| `investigationWidgetLoader.ts` | Unused |

**Not removed:** Migrations, RPCs, compatibility redirects.

---

## 6. Upgrade Flow Consistency

`UpgradePage` now aligns with bootstrap Business trial (30-day trial from `bootstrap_owner_workspace`):

- Shows **Business trial active** copy when `resolveEffectiveSubscription().isTrial && planCode === "business"`
- Trial countdown via `upgradeTrialBusinessEnds`
- `upgradeNoTrial` ("Free plan is active") shown only for effective **free** plan

No subscription logic changes — messaging only.

---

## 7. Enterprise Error Boundary Primitives

| New component | Role |
|---------------|------|
| `EnterpriseErrorState` | Error banner + optional retry |
| `EnterpriseAsyncShell` | Loading → Empty → Error → Content |

Applied to Enterprise HQ dashboard and audit center pages.

---

## 8. Notification Standard

New i18n keys (`notify*` namespace):

- `notifySuccessSaved`, `notifyErrorGeneric`, `notifyPermissionDenied`
- `notifyOffline`, `notifySyncing`, `notifySyncFailed`
- `notifyCustomerSaved`, `notifyDebtPaymentFailed`, `notifySupplierPaymentFailed`
- `notifyKitchenReprintOk`, `notifyKitchenPrintFailed`
- `notifyComingSoonTransfers`, `notifyEnterpriseLoadFailed`
- `upgradeTrialBusinessActive`, `upgradeTrialBusinessEnds`

English + Luganda (`lg`) parity.

---

## 9. Verification

```
npm run build   ✅
npm test        ✅  284 test files · 1520 passed · 4 skipped
```

### New tests

- `shopActionRunner.test.ts` — permission, success, failure, thrown errors

---

## 10. Success Criteria Checklist

- [x] Shop action runner exists (`executeShopAction`)
- [x] Global toast provider exists (`ToastProvider` + `useToast`)
- [x] Critical silent failures fixed (customers, suppliers, expenses sync, kitchen print, enterprise HQ)
- [x] Stock transfer cannot mislead operators
- [x] Confirmed dead code removed
- [x] Upgrade page reflects Business trial bootstrap
- [x] Enterprise async loading/error/retry on HQ pages
- [x] No business logic changes
- [x] No payment integration
- [x] Build passes
- [x] Tests pass

**Phase 17.1: COMPLETE**

---

## 11. Recommended Next Phases

1. **Phase 17.2** — Enterprise HQ & vertical consolidation (wire stock transfer persistence, hospitality/wholesale/pharmacy dashboards)
2. **Phase 17.3** — Performance & scalability
3. **Phase 17.4** — Payments & subscription automation
4. **Phase 17.5** — Final enterprise production certification (≥9/10)
