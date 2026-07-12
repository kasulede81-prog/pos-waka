# Phase 21.6 — Enterprise Shift Recovery & Cash Drawer Reliability

Production fix for the P0 blocker certified in Phase 21.3: historical pending shifts block business operations because only the original cashier can run a cash-count close.

**Scope:** Shift lifecycle and recovery only. Accounting calculations, sales, payments, permissions schema, and shift database schema are unchanged.

---

## Before vs after lifecycle

### Before

```
Cashier opens shift → Cashier leaves → Shift still open
Manager signs in → closeShiftWithCashCount()
  → find open shift where actorUserId === current actor
  → not found → errorKey: "invalid"
Manager force-close → endAt set WITHOUT countedCashUgx
Day close blocked → stale shifts accumulate
```

### After

```
Cashier opens shift → Cashier leaves → Shift still open
Manager/owner signs in → Open Shifts → Recover
  → Review → Reason → Cash count → Variance recorded → Closed
Original operator retained · Recovery operator audited
Manager can begin own shift while other shifts await recovery
```

Standard lifecycle:

```
Open → Working → Pending Close → Cash Count → Reconciled → Closed → Archived
```

---

## Recovery flow

```
Pending shift list (Open Shifts page)
  ↓
Recover / Continue
  ↓
Review (operator, opened, expected cash)
  ↓
Recovery reason (+ optional notes) when cross-user
  ↓
Cash count + handoff (formula v2)
  ↓
Variance calculated (existing rules)
  ↓
shift_recovery_close audit + shift row updated
```

Force close remains available for stale emergencies only — it skips reconciliation and is de-emphasized in the UI.

---

## Permission matrix

| Role | Own shift close | Recover another operator's shift |
|------|-----------------|----------------------------------|
| Owner | Yes (`shift.close`) | Yes (always) |
| Manager / Supervisor | Yes (`shift.close`) | Yes (`day.close`) |
| Cashier | Yes (`shift.close`) | No (`shiftRecoverDenied`) |

Permissions use existing server-verified effective permission checks — no new permission types added.

---

## Reconciliation workflow

Recovery uses the **same** cash reconciliation path as normal close:

- `shiftExpectedCash()` for expected amount
- Physical count entered by recovering manager
- `cashDifferenceUgx = counted − expected`
- Handoff float recorded (formula v2)
- Tolerance rules unchanged (applied at day close / float verify — not bypassed)

Recovery metadata on shift row (local JSON, synced in existing `shift` payload):

- `recoveredByUserId`, `recoveredByLabel`, `recoveredAt`
- `recoveryReason`, `recoveryNotes`
- Original `actorUserId` / `actorName` preserved

---

## Diagnostics

```
[waka-shift] recovering_shift {
  shiftId,
  operatorUserId,
  recoveredByUserId,
  varianceUgx
}
```

Audit actions:

- `shift_recovery_close` — cross-user recovery with cash count
- `shift_close_count` — normal own-operator close (unchanged)

---

## Implementation map

| File | Role |
|------|------|
| `src/lib/shiftRecoveryOps.ts` | Authorization, target resolution, close patch builder |
| `src/store/usePosStore.ts` | `closeShiftWithCashCount` accepts optional `shiftId` + recovery meta |
| `src/store/dayDrawerOpenMutations.ts` | `closeShiftWithHandoff` recovery path (formula v2) |
| `src/components/pos/ShiftRecoveryWizard.tsx` | Enterprise recovery wizard |
| `src/pages/OpenShiftsPage.tsx` | Pending shifts banner + recover actions |
| `src/lib/shiftRecoveryOps.test.ts` | Regression scenarios 1–6 |

---

## Regression matrix

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Cashier opens → manager closes | Recovery authorized, cash count recorded |
| 2 | Historical pending shift | Recover → count → close with audit |
| 3 | Three pending shifts | Each recoverable independently by shift ID |
| 4 | Cash variance | `cashDifferenceUgx` preserved |
| 5 | Cashier recover other | `shiftRecoverDenied` |
| 6 | Recovery audit | Original operator + recovery operator on row/audit |

---

## Verification checklist

- [ ] Manager recovers abandoned cashier shift with full cash count
- [ ] Day close unblocks after recovery close (not force close)
- [ ] Cashier cannot recover another operator's shift
- [ ] Multiple open shifts listed; recover one without affecting others
- [ ] `[waka-shift] recovering_shift` logged on recovery
- [ ] `npm test` passes
- [ ] `npm run build` passes

---

## Related

- Phase 21.3 Issue D: `docs/PHASE_21_3_ENTERPRISE_PRODUCTION_STABILITY_CERTIFICATION.md`
- Root cause: actor-scoped `closeShiftWithCashCount` in `usePosStore.ts` / `dayDrawerOpenMutations.ts`
