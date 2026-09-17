# PHASE 5.1 FINAL REPORT

**Hospitality Prep Provenance Hardening** — branch `waka/historical-financial-correction`
Base commit: `fd127b9` (Phase 5 prep batches). Scope: exactly the three provenance fixes from the Phase 5.1 spec. No new features, no financial-engine changes.

---

## Changes

| File | Change |
|---|---|
| `src/types.ts` | Added `PrepRecipeSnapshot` (`yieldQty` + `lines`). `PrepBatch.recipeSnapshot?: PrepRecipeSnapshot \| null`. `SaleLine.prepAllocation?: Array<{ batchId, portions }> \| null`. Both new fields are optional — old data loads unchanged. |
| `src/lib/recipeEngine.ts` | `planPrepBatchConsumption` now also returns the exact FIFO `allocation` it computed. New `prepSnapshotRequirements(snapshot, portions)` — per-portion ingredient requirements from a frozen snapshot (with yield and waste). New `creditPrepAllocation(product, allocation, at)` — credits each named batch exactly, skipping cancelled/wasted and unmatched batches. |
| `src/store/usePosStore.ts` | `prepareMenuBatch` freezes an immutable `recipeSnapshot` (deep-copied lines) on every new batch. `cancelPrepBatch` restores quantities from the snapshot when present, falling back to the current recipe only for legacy batches. `finalizeDraftSale` persists the plan's `allocation` onto the `SaleLine` (`prepAllocation`). `voidSaleLine` hospitality branch credits the frozen `prepAllocation` per batch; the old newest-batch logic remains only as the legacy fallback for pre-5.1 sales. |
| `src/lib/hospitalityPrepProvenance.test.ts` | **New** — 8 tests covering spec matrix A–Q. |

No migrations. No schema break. No UI change. Net +137/−22 lines.

## Recipe Snapshot

- Every `prepareMenuBatch` call deep-copies the effective recipe (`yieldQty` + lines) into `PrepBatch.recipeSnapshot` at preparation time.
- `cancelPrepBatch` reverses **unsold** portions only, using `prepSnapshotRequirements` — so a later recipe edit never changes what a cancellation returns.
- **Spec example verified by test A–D:** prep 20 (A 40 / B 20), recipe changed to A 60 / B 20, sell 8, cancel 12 → ingredients restored as A 24 / B 12 (snapshot), not A 36 / B 12 (current recipe). Final stock A 84 / B 92.
- Legacy batches without a snapshot (pre-5.1 test fixtures or old data) fall back to current-recipe restore — documented behavior, unchanged from Phase 5.

## Batch Provenance

- `planPrepBatchConsumption` already computed FIFO batch splitting; 5.1 **persists** that exact split on the `SaleLine` at finalize time (`prepAllocation: [{batchId, portions}, …]`).
- **Test E–F:** batches A (7 portions @ 2,500) and B (20 @ 2,520); sale of 10 → allocation frozen as A:7 + B:3, line `cogsUgx` = 7×2,500 + 3×2,520 = **25,060** (weighted across batches), A depleted, B remaining 17.
- `prepAllocation` is non-financial provenance: it never participates in revenue, COGS, or payment computation — it is set from the plan the engine already used.
- Retail lines never carry an allocation (`prepAllocation` stays `null`) — test P–Q.

## Void Behavior

- A void of a hospitality `SaleLine` now credits **each originating batch by its exact consumed quantity** via `creditPrepAllocation`:
  - cancelled/wasted batches and unknown batch ids are skipped (allocation from an older state can outlive a batch's later cancellation);
  - restored batches flip back to `status: "active"` (except those cancelled/wasted);
  - finished prepared stock is restored exactly once by the shared restock path (no double restore — batch provenance and product stock stay reconciled);
  - **raw ingredients are NOT restored** on void — they were legitimately consumed at preparation time (tests G–J, I).
- **Test G–J:** void of the A:7 + B:3 sale → A remaining 7, B remaining 20, dish stock 27, ingredients untouched at prep-consumed levels, historical `cogsUgx` still 25,060, exactly **one** new inventory movement (the shared void movement), no provenance duplicates.
- Repeated void of the same line is refused by the shared guard — no double restoration (test L).
- Legacy sales without `prepAllocation` keep the Phase 5 newest-batch credit as fallback.

## Financial Integrity

- **Revenue duplication: NONE.** `finalizeDraftSale`, totals, and `saleFinancialEngine` untouched. One sale = one revenue record, before and after this change. Combined food+drink remains a single WAKA Sale (test P–Q).
- **COGS duplication: NONE.** Hospitality COGS still computed once at finalize from the batch-weighted cost; voids do not recompute or re-add historical COGS — the frozen `cogsUgx` stands (test J).
- **Inventory duplication: NONE.** Ingredient consumption still happens exactly once, at `prepareMenuBatch`. Voids restore finished portions only; the single shared void movement is the only ledger entry (test J). `verifyInventoryIntegrity` and `reconcileRecoveryInventoryLedger` remain clean (test N–O). Recovery replay synthesizes zero sale movements and zero duplicate provenance — stable ids make it idempotent (test M).
- **Historical cost mutation: NONE.** `PrepBatch.unitCostUgx` is frozen at preparation and never re-derived; later changes to ingredient costs, recipe, product cost, or selling price do not touch existing batches (test K). A new batch reflects the new world; old batches stand.

## Tests

- **New** `src/lib/hospitalityPrepProvenance.test.ts` — 8/8 pass (matrix A–Q: snapshot cancel, multi-batch allocation + weighted COGS, exact void restore, cost immutability, void-refusal, recovery replay idempotency, integrity suites, retail unchanged).
- Phase 5 suites: `hospitalityPrepBatch.test.ts` 14/14, `hospitalityRecipeSale.test.ts` 8/8 — 30/30 combined.
- Neighbor suites: `menuProduction`, `restaurantBilling`, `inventoryIntegrity`, `productionClosure`, `saleLifecycleIntegrity`, `recoveryInventoryReconciliation` — 93/93 pass.
- `tsc -b --force` — clean (exit 0).
- `vite build --mode production` — success (PWA emitted).
- Full suite, both shards: **5,377 passed** (2,685 + 2,692). Failing files identical to the pre-5.1 verified baseline (20 files: enterprise roles/permissions, staff V2/V3, remote-support transport, pharmacy hydration, day-close draft, stock transfer, MB-1 partition, P0 verification, OBS-1, product wizard, stale-resurrection, recovery-integrity) — **no new failures; zero regressions**.

## Remaining Limitations

1. **Legacy void provenance:** sales finalized before 5.1 have no `prepAllocation`; their voids still credit the newest open batch (Phase 5 behavior). Only sales finalized after this change restore exact batches. No data migration was requested or built.
2. **Opening-balance synthesis:** on a device whose stock predates movement records, the first recovery reconciliation freezes implied opening balances as `adjust_other` movements (pre-existing recovery design, unrelated to 5.1). Replay is idempotent — verified by test M.
3. Sale cloud-sync payloads carry whole sale objects, so `prepAllocation` travels with the sale; the push path itself was not modified in this phase.

## Financial Core Status

**GREEN.** The Retail/Kiosk Duka financial engine remains the single source of truth: finalize, COGS, payments, debt, voids, day-close untouched. All 5.1 additions are optional, non-financial provenance fields with exact-restore semantics, fully covered by 131 hospitality + integrity tests and the full 5,377-pass suite with no new failures.
