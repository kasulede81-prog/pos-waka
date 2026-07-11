# Phase 17.2 — Enterprise Product Completion & Vertical Consolidation

**Date:** July 10, 2026  
**Mode:** Enterprise completion (no payment integration, no subscription rule changes, no core architecture redesign)

---

## Executive Summary

Phase 17.2 completes the remaining enterprise product surfaces and vertical command centers so Retail, Pharmacy, Hospitality, and Wholesale each deliver a consistent, production-ready experience. Hidden registry placeholders were eliminated, misleading enterprise workflows were replaced with honest **Coming Soon** or informative status pages, and hospitality/wholesale dashboards gained real operational widgets backed by existing store data.

**Scope excluded:** payment providers, subscription engine changes, stock transfer persistence, org-wide backup simulation.

---

## 1. Enterprise Route Audit (`/enterprise/*`)

| Route | Status | Notes |
|-------|--------|-------|
| `/enterprise` | **Production-ready** | Live org metrics via `fetchEnterpriseDashboardMetrics()`; loading/error/retry via `EnterpriseAsyncShell` (Phase 17.1) |
| `/enterprise/branches` | **Production-ready** | Branch CRUD + status via enterprise RPC |
| `/enterprise/audit` | **Production-ready** | Audit feed with error/retry (Phase 17.1) |
| `/enterprise/reports` | **Informative bridge** | Directs to shop `/reports`; export formats listed; org-wide export noted as future |
| `/enterprise/purchasing` | **Coming Soon** | `EnterpriseComingSoonPanel` + link to `/stock?tab=purchases` |
| `/enterprise/transfers` | **Coming Soon** | Empty state from Phase 17.1 — no fake transfer workflow |
| `/enterprise/backup` | **Informative status** | Explains branch-level backup; links to `/office/backup` (no simulated org backup) |
| `/enterprise/health` | **Reference budgets** | Static `ENTERPRISE_PERFORMANCE_BUDGETS` with explicit note that live org monitoring is not yet available |

**Rule applied:** No route appears functional while doing nothing.

---

## 2. Vertical Command Centers

All verticals share the **Owner Command Center** architecture (`OwnerDashboardPage` → `EnterpriseDashboardShell` → registry widgets). Pharmacy additionally uses a dedicated **Pharmacy Operations** home (`PharmacyDashboardPage`, `pharmacy-operations` surface).

### Retail

| Area | Status |
|------|--------|
| Overview / KPIs / Operations / Alerts / Quick Actions / Activity / Reports & Investigation shortcuts | **Complete** — shared retail widgets on `command-center` surface (unchanged) |

### Pharmacy

| Widget area | Implementation |
|-------------|----------------|
| Prescription queue, controlled medicines, dispensing, compliance | `pharmacyDashboardWidgets.tsx` → `PharmacyOpsDashboardSections` on `pharmacy-operations` surface |
| Command center | Shared retail header/KPIs when owner opens command center |

Pharmacy home remains the operational command center; no retail-owner widgets on pharmacy home.

### Hospitality

New real widgets in `hospitalityDashboardWidgets.tsx` (command-center + hospitality mode):

| Widget ID | Slot | Data source |
|-----------|------|-------------|
| `hospitality-kpi-strip` | kpi-grid | `hospitalityStats` + command center revenue |
| `hospitality-kitchen-queue` | live-operations | `activeProductionTickets(hospitalityFloor)` |
| `hospitality-table-time` | live-operations | `averageOpenTableMinutes()` |
| `hospitality-reservations` | attention | `activeReservationCount`, `activeWaitlistCount` |
| `hospitality-waiter-performance` | staff | `hospitalityStats.activeWaiters` |

Context wired in `OwnerDashboardPage` via `computeHospitalityDashboardStats()` and `preferences.hospitalityFloor`.

### Wholesale

New real widgets in `wholesaleDashboardWidgets.tsx`:

| Widget ID | Slot | Data source |
|-----------|------|-------------|
| `wholesale-kpi-strip` | kpi-grid | Receivables, payables, transactions, reorder counts |
| `wholesale-operations` | live-operations | Sync queue ops, quick links to stock/reports/customers |
| `wholesale-receivables` | financial | Customer credit / receivables |
| `wholesale-stock` | inventory | Low stock + out-of-stock counts |

---

## 3. Reports Registry Completion

Hidden `visible: () => false` placeholders removed. Each vertical retains one real operations overview widget:

| Vertical | Widget | Condition |
|----------|--------|-----------|
| Hospitality | `hospitality-operations-overview` | `category === "overview"` |
| Wholesale | `wholesale-operations-overview` | wholesale mode + overview |
| Pharmacy | `pharmacy-operations-overview` | pharmacy mode + overview |
| Retail | Existing retail report widgets | unchanged |

---

## 4. Investigation Registry Completion

| Vertical | Change |
|----------|--------|
| Retail | Complete (unchanged) |
| Pharmacy | Compliance extensions retained |
| Hospitality | Placeholder array emptied — uses shared retail investigation widgets |
| Wholesale | Placeholder array emptied — uses shared retail investigation widgets |

No permanent hidden investigation widgets remain.

---

## 5. Enterprise HQ — Purchasing, Transfers, Backup

| Page | Before | After |
|------|--------|-------|
| **Purchasing** | Stub workflow | `EnterpriseComingSoonPanel` + shop purchases link |
| **Transfers** | Fake demo (17.1) | Coming Soon empty state (unchanged safety) |
| **Backup** | Misleading org backup UI | Informative status + navigate to shop backup |
| **Reports** | Partial stub | Bridge to shop reports + export format reference |
| **Health** | Implied live monitoring | Reference budgets + explicit future-work note |

---

## 6. Registry Cleanup

| Item | Action |
|------|--------|
| `visible: () => false` dashboard/report/investigation widgets | Removed or implemented |
| `dashboardWidgetLoader.ts` | Already removed (Phase 17.1) |
| `reportWidgetLoader.ts` | Already removed (Phase 17.1) |
| `investigationWidgetLoader.ts` | Already removed (Phase 17.1) |
| `DashboardPage.tsx` | Already removed (Phase 17.1) |

Every registered widget either renders real data or is intentionally deferred at the route level (Coming Soon pages).

---

## 7. Dashboard Consistency (Part 9)

Shared architecture across verticals:

```
OwnerDashboardPage
  └── EnterpriseDashboardShell
        └── enterpriseDashboardRegistry
              ├── RETAIL_DASHBOARD_WIDGETS (all modes, command-center)
              ├── PHARMACY_DASHBOARD_WIDGETS (pharmacy-operations surface only)
              ├── HOSPITALITY_DASHBOARD_WIDGETS (command-center + hospitality mode)
              └── WHOLESALE_DASHBOARD_WIDGETS (command-center + wholesale mode)
```

Each command center includes: **Overview, KPIs, Operations, Alerts, Quick Actions, Recent Activity**, plus navigation to **Reports** and **Investigation** via existing shell chrome.

---

## 8. New / Modified Files

### Created

| File | Purpose |
|------|---------|
| `src/components/enterprise/EnterpriseComingSoonPanel.tsx` | Reusable Coming Soon panel |
| `src/components/command-center/VerticalDashboardCard.tsx` | Shared KPI/panel cards for vertical widgets |
| `src/lib/hospitalityStats.test.ts` | Unit tests for reservation/waitlist/table-time helpers |

### Key modifications

| File | Change |
|------|--------|
| `hospitalityDashboardWidgets.tsx` | 5 real hospitality widgets |
| `wholesaleDashboardWidgets.tsx` | 4 real wholesale widgets |
| `hospitalityStats.ts` | `averageOpenTableMinutes`, `activeReservationCount`, `activeWaitlistCount` |
| `OwnerDashboardPage.tsx` | Hospitality context + `resolveDashboardMode` |
| `dashboardWidgetTypes.ts` | `hospitalityStats`, `hospitalityFloor` on context |
| `hospitalityReportWidgets.tsx` | Single operations overview |
| `wholesaleReportWidgets.tsx` | Single operations overview |
| `pharmacyReportWidgets.tsx` | Single operations overview |
| `hospitalityWidgets.ts` / `wholesaleWidgets.ts` | Empty placeholder arrays |
| Enterprise HQ pages | Purchasing, backup, reports, health honesty updates |
| `i18n.ts` | EN + LG strings for enterprise and vertical dashboard copy |

---

## 9. Placeholder Removal Summary

| Misleading behavior | Resolution |
|--------------------|------------|
| Hidden dashboard widgets (`visible: false`) | Implemented with real data or removed from registry |
| Enterprise purchasing stub | Coming Soon + shop link |
| Enterprise backup fake ops | Status page only |
| Enterprise health implied telemetry | Reference budgets + disclaimer |
| Wholesale/hospitality report placeholders | Removed; one real overview widget each |
| Hospitality/wholesale investigation stubs | Removed; retail shared widgets used |

---

## 10. Verification Results

```bash
npm run build   # ✓ passed
npm test        # ✓ 1525 passed | 4 skipped (285 files)
```

New/updated tests:

- `src/lib/hospitalityStats.test.ts` (3 tests)
- `src/components/command-center/registry/dashboardRegistry.test.ts` — hospitality + wholesale injection tests

---

## 11. Success Criteria Checklist

| Criterion | Met |
|-----------|-----|
| Every `/enterprise/*` route production-ready or clearly Coming Soon / informative | ✓ |
| Retail, Pharmacy, Hospitality, Wholesale complete command centers | ✓ |
| No hidden registry placeholders | ✓ |
| Reports & investigation registries consistent | ✓ |
| Shared dashboard architecture | ✓ |
| No misleading placeholder behavior | ✓ |
| `npm run build` passes | ✓ |
| `npm test` passes | ✓ |
| No payment integration | ✓ |
| No subscription logic changes | ✓ |

---

## 12. Roadmap — Next Phases

| Phase | Focus |
|-------|-------|
| **17.3** | Performance & Scalability |
| **17.4** | Payments & Subscription Automation (Flutterwave, MTN MoMo, Stripe, Airtel Money, daily expiry, trial switch) |
| **17.5** | Final Enterprise Production Certification (target ≥9/10) |

Waka POS is now positioned for enterprise deployments and payment integration without further structural refactoring of command centers or registries.
