# Phase 21.8 — Enterprise Drawer Tolerance & Cash Variance Experience

UX-only completion of the cash drawer experience. **No accounting formulas, variance calculations, schema, or reconciliation algorithms were changed.**

Phase 21.3 (Issue F) certified the tolerance engine works at shift open and day close, but operators expected the same transparency at shift close and recovery — making tolerance feel broken.

---

## Before vs after UX

### Before

```
Shift close     → over/short banner only (emerald/amber/rose), no tolerance band
Recovery        → same modal, no tolerance context
Day close       → diff + "Manager approval required" (minimal)
Drawer hub      → expected / counted / variance, no tolerance row
Settings        → "Day-close variance flags" (misleading scope)
Errors          → generic "Invalid" swallowed in shift close modal
```

### After

```
Every cash workflow shows:
  Expected → Counted → Variance → Tolerance → Decision

Unified CashVarianceSummary component with enterprise status tokens:
  Within tolerance | Minor variance | Outside tolerance | Critical variance

Shift close + recovery → same reconciliation preview
Day close → full summary before PIN
Cash Management + Cash Position → tolerance + variance state on dashboard
Closed shifts today → audit timeline (expected, counted, variance, tolerance, recovered by, closed)
Settings → scope hint explaining all enforcement points
Diagnostics → [waka-drawer] expected → counted → variance → tolerance → decision
```

---

## Reconciliation flow

```
Shift open (v2)
  floatVerificationWithinTolerance() — blocks + manager override (unchanged)

Shift close / Recovery
  computeShiftCloseAmounts() — records cashDifferenceUgx (unchanged)
  CashVarianceSummary — informational tolerance + decision (NEW, non-blocking)

Day close
  dayCloseVarianceIsFlagged() — blocks until manager PIN (unchanged)
  CashVarianceSummary — explains why PIN is required (NEW)

Cash Management hub
  Live drawer state + tolerance + open/recovery shift counts (NEW)
```

---

## Tolerance visualization

Threshold formula (unchanged, from `dayDrawerOpen.ts` / `dayCloseApprovals.ts`):

```
threshold = max(pct% × max(1, expected), fixedUgx)
flagged   = |variance| > threshold
```

Enterprise states (`classifyCashVariance`):

| State | Condition | Token |
|-------|-----------|-------|
| Within tolerance | variance === 0 | success |
| Minor variance | variance ≠ 0, not flagged | warning |
| Outside tolerance | flagged, ≤ 2× threshold | danger |
| Critical variance | flagged, > 2× threshold | danger |

---

## Recovery consistency

`ShiftRecoveryWizard` review step shows expected cash + tolerance band, then embeds the same `ShiftCloseModal` with `context="shift_recovery"` — identical `CashVarianceSummary` as normal shift close.

---

## Audit timeline

`ShiftCashAuditTimeline` on Cash Management (closed shifts today):

```
Expected → Counted → Variance → Tolerance → Recovered by (if applicable) → Closed
```

Built from existing `ShiftRecord` fields — no schema changes.

---

## Diagnostics

```
[waka-drawer] shift_close_preview { expected, counted, variance, tolerance, state, decision, context }
[waka-drawer] day_close_preview   { ... }
```

Never logs credentials or secrets beyond reconciliation amounts already in UI.

---

## New modules

| File | Role |
|------|------|
| `cashVarianceExperience.ts` | Classification, threshold helper, timeline builder, diagnostics |
| `CashVarianceSummary.tsx` | Unified Expected → Decision UI |
| `ShiftCashAuditTimeline.tsx` | Closed shift audit strip |

---

## Regression checklist

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Within tolerance | Shift closes; decision says OK |
| 2 | Outside tolerance | Manager approval explained at shift close; day close blocked |
| 3 | Recovered shift | Same tolerance logic as normal close |
| 4 | Day close | Tolerance + flagged state displayed |
| 5 | Shift close | Full tolerance explanation before confirm |
| 6 | Audit timeline | Expected, counted, variance, tolerance present |

Tests: `cashVarianceExperience.test.ts`

---

## Verification matrix

| Area | Verified | Notes |
|------|----------|-------|
| Unified variance UI | ✅ | `CashVarianceSummary` |
| Shift close | ✅ | `ShiftCloseModal` |
| Recovery | ✅ | `ShiftRecoveryWizard` + shared modal |
| Day close | ✅ | `CloseDayPage` |
| Drawer dashboard | ✅ | `CashManagementPage`, `CashPositionDrawerStatus` |
| Settings scope copy | ✅ | `SettingsCashDrawerPage` |
| No formula changes | ✅ | Reuses `dayCloseVarianceIsFlagged` |
| Build | Run `npm run build` | |
| Tests | Run `npm test` | |

---

## Explicit non-goals (unchanged)

- Accounting formulas and variance calculations
- Sales, payments, expenses, inventory
- Shift schema and cash reconciliation algorithms
- Permissions, device management, authentication

---

## Next step — Phase 22.0

After Phase 21.8, **freeze feature work** and run **Phase 22.0 — Enterprise Production Regression Certification**: a comprehensive read-only audit of every major subsystem (authentication, offline sync, inventory, POS, staff, subscriptions, devices, shifts, reports, hospitality, pharmacy, wholesale, AI, performance, UI) before wider deployment.
