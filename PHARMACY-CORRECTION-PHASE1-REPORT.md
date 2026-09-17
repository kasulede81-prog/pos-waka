# PHARMACY-CORRECTION-PHASE1-REPORT

Scope: partial prescription dispensing (bug fix) + pharmacy batch quantity/cost integrity boundary (strengthening) + tests. No cloud sync, no UI redesign, no new features. The Retail/Kiosk Duka financial engine (`finalizeDraftSale`, `costPrecision.ts`, `saleFinancialEngine.ts`) was **not modified** — every pharmacy change either gates the existing engine or extends pharmacy-only logic around it.

## 1. Partial Dispensing Bug

**Confirmed bug, exactly as described in the audit.** Two independent locations in the code combined to make partial dispensing impossible to represent correctly:

1. `src/store/usePosStore.ts` (`finalizeDraftSale`, prescription-update block): `quantityDispensed: Math.max(pl.quantityDispensed, Math.floor(draft.quantity))` — used `Math.max` instead of accumulating. Dispensing 10, then 5, then 6 would leave `quantityDispensed` at 10 (the max of the three), not 21.
2. `src/lib/pharmacyPrescriptionOps.ts` (`markPrescriptionDispensed`): even if (1) were fixed, this function **unconditionally overwrote** every line's `quantityDispensed` to `l.quantityPrescribed` and forced `status: "dispensed"` — stamping the prescription fully dispensed and permanently locked (no `"partially_dispensed"` status existed, and `loadPrescriptionToDraft` refused to reload anything not `"verified"|"ready"|"dispensing"`).

## 2. Root Cause

Both bugs share one root cause: the code path that records a dispense event was written assuming **one checkout always fully satisfies the prescription** — there was no representation of "some was given, some remains." Fixing only the `Math.max` call would not have been sufficient; `markPrescriptionDispensed` would have immediately re-overwritten the correctly-accumulated value.

## 3. Fix

**New status.** `PharmacyPrescriptionStatus` gains `"partially_dispensed"` (`src/types.ts`), inserted between `"ready"` and `"dispensed"`, following the existing snake_case vocabulary. Status transitions updated so it is never a dead end: `dispensing`/`ready` → `partially_dispensed` → `dispensing`/`ready`/`dispensed`/`cancelled` (`src/lib/pharmacyPrescriptions.ts`).

**Status derivation, not assertion.** New pure helpers in `pharmacyPrescriptions.ts`: `prescriptionLineRemaining`, `prescriptionRemainingTotal`, `isPrescriptionFullyDispensed`, `isPrescriptionPartiallyDispensed`, `derivePrescriptionDispenseStatus` — all derive strictly from `quantityPrescribed` vs. `quantityDispensed`, never assume a dispense event means "done."

**`markPrescriptionDispensed`** (`pharmacyPrescriptionOps.ts`) now trusts the caller's already-computed cumulative `quantityDispensed` values instead of overwriting them, and derives status via `derivePrescriptionDispenseStatus` instead of hardcoding `"dispensed"`.

**Accumulation fix** (`usePosStore.ts`): `quantityDispensed` is now `Math.min(prescribed, dispensed + thisVisit)` — additive, clamped, never negative, never above prescribed.

**Over-dispense guard, fails safely** (`usePosStore.ts`, before any stock/COGS mutation runs): if the active prescription's line would be pushed over its prescribed quantity, `finalizeDraftSale` returns `{ ok: false, errorKey: "pharmacyRxOverDispense" }` **before creating the sale** — no partial stock deduction, no orphaned sale. The `Math.min` clamp inside the accumulation is a second, defensive line, not the primary safeguard.

**Resumability fix** (`usePosStore.ts`, `loadPrescriptionToDraft`): the reload guard now also accepts `"partially_dispensed"`, so a prescription with a remainder can always be reopened for its next visit. `prescriptionToDraftLines` (`pharmacyPrescriptionOps.ts`) was also fixed to skip lines that are already fully dispensed and to use the true remainder (`Math.max(0, ...)`) instead of the old floor of 1 unit, which would have offered a phantom extra unit on an exhausted line.

Two i18n keys added (`src/lib/i18n.ts`, both locales): `pharmacyRxOverDispense`, `pharmacyRxStatusPartiallyDispensed`.

**Deliberately not touched this phase**: `PharmacyRxActionBar.tsx`'s `canBegin` condition does not yet include `"partially_dispensed"`, so its "begin dispensing" affordance won't show for a partially-filled rx in that specific bar — the underlying store action (`loadPrescriptionToDraft`) already supports it correctly; this is a one-line UI follow-up, deferred per "do not redesign the Pharmacy UI." Documented for Phase 2.

## 4. Batch Integrity Issue

Confirmed from the audit: `PharmacyBatchRecord` carries its own `quantityRemaining` and `unitCostUgx`, nested in `Product.pharmacyPackaging.batches[]`. `computeBatchIntegrity()` already existed and already never auto-repaired — it was the right detector, just needed a companion reconciliation path and stronger test coverage (task item 5).

## 5. Responsibility Boundary (established, not redesigned)

Documented directly in code (`pharmacyBatches.ts` doc comments) and enforced by what each function is allowed to touch:

| | Authoritative for | Batch data may only |
|---|---|---|
| **Core `Product` fields** (`stockOnHand`, `costPricePerUnitUgx`, `packCostUnitsDepleted`) | Total stock, stock movements, inventory valuation, sale COGS, historical cost | — |
| **`PharmacyBatchRecord[]`** | — | Identify lot/expiry/provenance, drive FEFO selection, give operational visibility |

New: `reconcileBatchQuantitiesToStock(product, opts)` (`pharmacyBatches.ts`) — the "safe reconciliation path" the task required. It:
- Never touches `stockOnHand`, `costPricePerUnitUgx`, `packCostUnitsDepleted`, or any `Sale`/financial record — verified by a dedicated test.
- Never auto-runs — not called from any sale/purchase/write-off store action; must be invoked explicitly (e.g., a future manager action — not wired into any UI this phase, per "no new features").
- Is fully audited: every adjustment appends a normal `"adjusted"` batch timeline event.
- Shortfall (stock ahead of batches): credits the missing units to the batch with the **furthest** expiry, so FEFO ordering of the already-correct batches is undisturbed.
- Surplus (batches ahead of stock): removes the excess FEFO-first (earliest-expiring batches first), consistent with real dispense ordering.

`computeBatchIntegrity()` itself is unchanged in behavior (still detection-only, still never repairs) — "strengthened" via a doc comment cross-referencing the new reconciliation function and by the new, more thorough test matrix (both drift directions, the not-batch-tracked case, and the already-synced case).

## 6. Batch Cost — Verified Compliant, No Change Needed

Traced `lineCostForProductQuantity`/`applyPackSlotCostsToSaleLine` (`costPrecision.ts`, the actual sale-COGS engine `finalizeDraftSale` calls): they read only the product's own `costPricePerUnitUgx`/`buyingPackCostUgx`/`packCostUnitsDepleted` — **never** `PharmacyBatchRecord.unitCostUgx`, even when FEFO explicitly selects a specific batch for a sale. This was already true before this phase; a new regression test (`pharmacyBatches.test.ts`, "batch cost never creates a second COGS ledger") locks it in: a batch costed at 999/unit contributes exactly the product's own 200/unit to sale COGS, not 999. No second COGS calculation exists or was added.

## 7. FEFO — Preserved, One Gap Documented for Phase 2

`sortBatchesFefo`/`allocateFefo` (unchanged) correctly select the earliest-expiring batch(es) first, confirmed against the exact worked example in the task. **Documented gap, not fixed this phase** (explicitly out of scope — "do not implement a large new FEFO subsystem"): the expired-sale gate (`gateExpiredMedicineSale` / `pharmacySaleGuard.ts`) is called only from `PosPage.tsx` (UI layer) — it is **not** enforced inside `finalizeDraftSale` itself. A caller that reaches finalize by another path would not be blocked at the store layer. Recommended for Phase 2: move (or duplicate) the expired-sale check into `finalizeDraftSale` so it is enforced at the authoritative layer, not just advisory in one UI screen.

## 8. Returns/Voids — Unchanged, Verified Undisturbed

Not touched. `recordControlledReturn` (compliance/stock-only, no `Sale`/refund math) and `voidSaleLine` + `reduceSaleTotalsByAmount` (shared financial reversal) are exactly as documented in the audit. No pharmacy-specific duplicate stock, COGS reversal, or revenue reversal was introduced or found.

## 9. Tests

| Task item | Test(s) | File |
|---|---|---|
| A — first partial dispense (10/21, remaining 11, `partially_dispensed`) | ✅ | `pharmacyPartialDispense.test.ts` |
| B — second partial dispense (+5 → 15/21, remaining 6) | ✅ | same |
| C — final dispense (+6 → 21/21, remaining 0, `dispensed`) | ✅ | same |
| D — over-dispensing blocked (22/21 fails safely, no sale created) | ✅ (+ D2: a second visit that would overshoot is also rejected) | same |
| E — multiple dispensing records accumulate correctly | ✅ | same |
| F — prescription stays financially independent (no money fields) | ✅ | same |
| G — dispensing links to the authoritative Sale (`saleId`/`prescriptionId`) | ✅ | same |
| H — batch quantity integrity (synced case reports ok) | ✅ | `pharmacyBatches.test.ts` |
| I — batch quantity mismatch detection (both shortfall and surplus directions) | ✅ | same |
| J — batch cost does not create a second COGS ledger | ✅ | same |
| K — historical SaleLine cost remains immutable after a later cost edit | ✅ | `pharmacyPartialDispense.test.ts` |

Plus: unit-level status-derivation tests (`pharmacyPrescriptions.test.ts`, 7 new), `markPrescriptionDispensed`/`prescriptionToDraftLines` unit tests (new file `pharmacyPrescriptionOps.test.ts`, 7 tests), and reconciliation-path tests (`pharmacyBatches.test.ts`, 8 new: does-nothing-when-synced, shortfall, surplus, never-touches-financial-fields).

**Total new/extended test count this phase: 41 tests, all passing.**

## 10. Financial-Source-of-Truth Verification

- `finalizeDraftSale`, `costPrecision.ts`, `saleFinancialEngine.ts`: **zero lines changed**.
- Full financial certification suite (`financialCertification.test.ts`, cross-module parity for revenue/COGS/profit/inventory across every reporting surface): **17/17 pass, unchanged**.
- `saleFinancialEngine.test.ts`, `saleLifecycleIntegrity.test.ts`, `reportingConsistency.test.ts`: **68/68 pass, unchanged**.
- New test K directly proves a pharmacy dispense's `SaleLine.cogsUgx` is immutable after a later product-cost edit (mirrors the existing retail-side "historical price edit does not change snapshotted profit" invariant).
- New test J directly proves batch cost never leaks into sale COGS.
- The over-dispense guard and the `quantityDispensed` accumulation fix both live entirely inside the `if (state.activePharmacyPrescriptionId) { ... }` branch of `finalizeDraftSale` — a null/absent value (every retail and hospitality sale) takes none of this code, confirmed by zero new failures anywhere outside the pharmacy domain across the full suite.

## 11. Files Changed

| File | Nature of change |
|---|---|
| `src/types.ts` | +1 line: `"partially_dispensed"` added to `PharmacyPrescriptionStatus`. |
| `src/lib/pharmacyPrescriptions.ts` | Status list/transitions extended; added `prescriptionLineRemaining`, `prescriptionRemainingTotal`, `isPrescriptionFullyDispensed`, `isPrescriptionPartiallyDispensed`, `derivePrescriptionDispenseStatus`; `activePrescriptionQueue` and `prescriptionStatusLabelKey` updated. |
| `src/lib/pharmacyPrescriptionOps.ts` | `markPrescriptionDispensed` no longer overwrites/forces full dispense; `prescriptionToDraftLines` skips fully-dispensed lines and uses the true remainder. |
| `src/store/usePosStore.ts` | Over-dispense guard added before stock mutation; `quantityDispensed` accumulation fixed (additive + clamped); `loadPrescriptionToDraft` reload guard accepts `partially_dispensed`. |
| `src/lib/pharmacyBatches.ts` | `computeBatchIntegrity` doc-comment strengthened (boundary documented); new `reconcileBatchQuantitiesToStock` (safe, audited, never touches financial fields, never auto-runs). |
| `src/lib/i18n.ts` | +2 keys × 2 locales (`pharmacyRxOverDispense`, `pharmacyRxStatusPartiallyDispensed`). |
| `scripts/test-domains.json` | Registered the 2 new pharmacy test files in the `pharmacy` domain list (an explicit allowlist, not a glob — required for the new tests to run under `npm run test:pharmacy`). |
| `src/lib/pharmacyPrescriptions.test.ts` | +7 tests (status derivation, transitions, queue). |
| `src/lib/pharmacyPrescriptionOps.test.ts` | **New file**, 7 tests (`markPrescriptionDispensed`, `prescriptionToDraftLines`). |
| `src/lib/pharmacyBatches.test.ts` | +8 tests (integrity both directions, reconciliation, batch-cost boundary); 2 pre-existing `let`→`const` lint errors in this file fixed in passing (unrelated to this phase's logic, required for a clean lint run). |
| `src/lib/pharmacyPartialDispense.test.ts` | **New file**, 9 store-level tests (A–G, K) exercising the real `finalizeDraftSale`. |

**Not part of this diff** (pre-existing uncommitted work from earlier, unrelated sessions in this same working tree, left untouched): `src/lib/costPrecision.test.ts`, `src/lib/inventoryInsightsExactCost.sql.integration.test.ts`.

## 9. Database Migrations

**None.** Everything in this phase is client-side TypeScript/React-adjacent logic. No Supabase migration was created or needed — pharmacy data (prescriptions, batches) has no dedicated SQL table (confirmed in the prior audit) and this phase did not change that.

## 10. Remaining Phase 2 Work

1. `PharmacyRxActionBar.tsx`'s `canBegin` should include `"partially_dispensed"` (one-line UI follow-up).
2. Expired-sale blocking (`gateExpiredMedicineSale`) is UI-advisory only (`PosPage.tsx`) — not enforced inside `finalizeDraftSale`. Move/duplicate the check into the authoritative store layer.
3. `reconcileBatchQuantitiesToStock` exists but is not wired into any UI — a manager-facing action/screen to invoke it is Phase 2 (or later) work, not done here per "no new features."
4. Cloud sync for `pharmacyPrescriptions`/`pharmacyDoctors`/`pharmacyControlledRegister` (currently local-IndexedDB-only, per the prior audit) — explicitly out of scope this phase.
5. Batch cost is currently informational-only (never feeds sale COGS, verified in §6) — this is a deliberate architectural choice, not a bug, but worth an explicit product decision if lot-specific COGS is ever desired (would require extending `lineCostForProductQuantity`'s existing `unitCostOverride` parameter, not a new COGS engine).

## Verification Summary

| Check | Result |
|---|---|
| `npx tsc -b` | Clean, zero errors |
| `eslint` (all changed files) | Clean, zero errors (2 pre-existing errors fixed in passing) |
| `npm run test:pharmacy` | 14/14 files, 105/105 tests pass |
| `npm run test:inventory` | 6/6 files, 103/103 tests pass |
| Sale-lifecycle/financial spot-check (`saleLifecycleIntegrity`, `financialCertification`, `saleFinancialEngine`, `reportingConsistency`) | 4/4 files, 68/68 tests pass |
| Full non-offline suite | 652/668 files, 5229/5264 tests — same 16 pre-existing, unrelated failures as every prior baseline run this session (remoteSupport, trial-tier date logic, a stale test mock, staff V2 domains) |
| Full offline suite | 19/19 files, 184/184 tests, unchanged |
| Production build (`npm run build`) | Succeeds, 41.75s, zero errors |
| `git diff` scope | Only pharmacy files + 2 necessary shared registries (`i18n.ts`, `test-domains.json`) + narrowly-scoped, prescription-gated hunks in the two shared files (`types.ts`, `usePosStore.ts`) |

**GREEN — safe to commit and push.**
