# WAKA POS — PHASE 5 HOSPITALITY FOOD PREPARATION REPORT

**Date:** 2026-09-17
**Branch:** `waka/historical-financial-correction`
**Base:** `ff0ce11` (Phase 4) + `3468dc8` (Phase 5 audit)
**Architecture rule honored:** Retail/Kiosk Duka remains the single financial source of truth. No restaurant accounting, COGS engine, payment ledger, inventory engine, financial ledger, or sale finalizer was created. All hospitality prep flows run through existing WAKA machinery (`finalizeDraftSale`, inventory movements, historical cost, audit, sync).

---

## 1. Architecture before

- Made-to-order recipe sales (Phase 4): ingredients deducted at sale time, recipe COGS frozen on the SaleLine, phantom stock movements fixed.
- **Gap:** no way to cook before sales began. The only stock-in paths were purchase/returns/voids — none express "kitchen produced N portions from raw ingredients."
- Eat-in/takeaway already operational metadata on the single Sale; drinks already pure retail.

## 2. Architecture after

- Explicit `prepMode` per finished-menu item: `"made_to_order"` (default, Phase 4 behavior frozen) or `"batch_prepared"`.
- `PrepBatch` records carried in `Product.menu.prepBatches` (JSON — syncs through the existing product channel, **zero migration**).
- `stockOnHand` on the menu product remains the authoritative physical counter (1 unit = 1 portion); `PrepBatch.remainingPortions` is provenance/allocation. Invariant maintained: `SUM(active.remainingPortions) == prepared stockOnHand`, with unbatched legacy stock blocked at sale time (never silently costed).
- Three new atomic store actions (`prepareMenuBatch`, `wastePreparedPortions`, `cancelPrepBatch`) + a stock-aware deduction branch in `finalizeDraftSale` + FIFO batch consumption + a hospitality-only provenance branch in `voidSaleLine`.

## 3. PrepBatch model

```ts
PrepBatch {
  id, menuProductId, preparedAt,
  portionsPrepared, remainingPortions,
  unitCostUgx,            // historical per-portion recipe cost at prep time — never rewritten
  status: "active" | "depleted" | "wasted" | "cancelled",
  actorUserId?, actorName?, note?,
  createdAt, updatedAt, version?, pendingSync?
}
```

## 4. Prep modes

- **Made to Order** (`prepMode: "made_to_order"`): Phase 4 behavior, unchanged — ingredients deduct at sale, recipe COGS frozen on the line. `prepareMenuBatch` refuses with `prepModeRequiresBatch`.
- **Batch Prepared** (`prepMode: "batch_prepared"`): portions are prepared ahead of sale; sales consume prepared stock at batch historical cost. Mode is explicit configuration — **never inferred from `stockOnHand > 0`** (spec correction applied; prevents ambiguous behavior when a finished_menu product has stock for another reason).

## 5. Preparation flow

One atomic store action `prepareMenuBatch({ productId, portions, note?, batchId? })`:
1. Validates `batch_prepared` mode + recipe + positive integer portions.
2. Requirement map via the existing recipe engine (recipe lines + modifier-ingredient options, ÷ `yieldQty`, × (1 + `wastePercent`)) scaled to portions.
3. `checkIngredientAvailability` gate (`ingredientShortage`).
4. Ingredients deducted via `applyRecipeStockDeduction` mechanics.
5. Audited `adjust_use` movements per ingredient (stable ids: `prep|batchId|ingredientId`).
6. Positive `adjust_use` movement for the prepared-stock increase (`prep_stock|batchId|productId`).
7. `PrepBatch` appended with `unitCostUgx = computeMenuItemFoodCostUgx` (frozen).
8. `stockOnHand += portions`; product version bumped.
9. Actor/timestamp recorded; `pendingSync` set.
10. **Idempotent**: caller-supplied `batchId`; a retry returns `ok` without double effects.
11. **No Sale is created — preparation is not revenue, not payment, not profit.**

## 6. Ingredient consumption

- At **preparation**: consumed exactly once (Invariant 3), recorded as `adjust_use` movements, idempotent by stable id.
- At **sale of a prepared portion**: nothing — Invariant 5 (no re-deduction; verified by test: chicken stays at the prep-consumed level).
- At **made-to-order sale**: unchanged Phase 4 behavior.

## 7. Prepared stock

- Physical counter: menu product `stockOnHand` (authoritative).
- Provenance: `PrepBatch.remainingPortions`, consumed FIFO by `preparedAt` at sale, waste, and cancel.
- Void of a prepared-food sale: the shared reversal restocks finished stock and credits the portions back to the newest open batch (hospitality-only branch — retail void behavior untouched), keeping stock and provenance reconciled.

## 8. Batch costing

- At prep: `unitCostUgx = recipe food cost per portion` (ingredient costs at that moment, incl. yield + waste), rounded, frozen.
- Total batch cost = `unitCostUgx × portionsPrepared` (shown in batch history).
- Later ingredient price changes never rewrite a batch (Invariant 6 — tested).

## 9. FIFO

Sales consume batches oldest-first by `preparedAt`. A line spanning batches gets the weighted unit cost of the actual consumed portions, frozen on the SaleLine (Invariant 7). Tested: batch A 10 @ 2,780 + batch B 20 @ 3,280 → sell 5 (A) = 13,900; sell 10 (5A+5B) = 30,300, unit 3,030. Today's recipe cost is never substituted for an already-prepared batch.

## 10. Food sales

- **Prepared (batch_prepared):** availability check → consume prepared portion(s) → deduct finished stock unit(s) → decrement batch `remainingPortions` FIFO → COGS from batch historical cost, frozen on the line → finalize through the existing engine. **No raw ingredient deduction (no double consumption).**
- **Made-to-order:** Phase 4 flow, unchanged.
- **Unbatched stock safety:** if `stockOnHand > SUM(active remainingPortions)`, the sale is blocked with `unbatchedStock` — no silent cost invention (spec-chosen safe behavior; reconcile via count adjustment or cancel/recreate batch).

## 11. Drink sales

Unchanged retail lifecycle: one stock unit per bottle, `sale_out` movement, product cost, standard profit math. Batch logic never consults retail products (Invariant 8 — tested in combined sale).

## 12. Eat-in

Operational seating state as before: table session wraps a pending Sale; `finalizeTableBill` delegates to `finalizeDraftSale`; prepaid partials supported. Batch-prepared lines inside eat-in bills consume prepared portions exactly as in §10. No second ledger.

## 13. Takeaway

Takeaway = `/pos` retail screen; batch-prepared food lines consume prepared portions, drinks stay retail — one authoritative Sale, no table required (tested: `tableSessionId` null, single sale, totals reconcile).

## 14. Waste

`wastePreparedPortions({ batchId, portions, reason })`: prepared stock −k, batch remaining −k (status → `wasted` when it hits 0), audited movement (`adjust_damage` for spoiled/burnt/damaged, `adjust_other` for unsold/other; stable per batch-version id), audit entry. **No Sale, no revenue, no payment, no ingredient restore** (ingredients were consumed at prep).

## 15. Cancellation

`cancelPrepBatch({ batchId })` reverses **only unsold** portions: restores ingredient quantities per current recipe ratios (quantities matter, not cost), positive `adjust_use` movements (stable ids `prep_cancel|batchId|ingredientId`), negative movement for the prepared-stock removal, batch → `cancelled`. Sold portions are historical and never recreated (tested: after selling 8 of 20, cancel restores exactly 12 portions' ingredients; sale line COGS unchanged).

## 16. Void behavior

Shared Phase 4 void architecture preserved (`voidSaleLine`, `planWholeBillVoid`). For prepared-food lines the restock now also credits batch provenance (newest open batch) so prepared stock and Σremaining stay equal; no raw ingredients are recreated; no double restore (tested).

## 17. Inventory movements

Ledger completeness (all kinds already exist — no new movement kinds):
- Preparation: ingredients `adjust_use` (−), prepared stock `adjust_use` (+).
- Prepared sale: `sale_out` on the finished item; **no ingredient movement**.
- Made-to-order sale: ingredients `adjust_use` (−); no finished movement.
- Waste: `adjust_damage`/`adjust_other` (−) on the finished item.
- Cancel: `adjust_use` (+) ingredients, `adjust_use` (−) finished item.
- `saleStockMovementsFromSale` and recovery synthesis updated so batch-prepared lines emit `sale_out` (not ingredient consumption); made-to-order lines unchanged from Phase 4.

## 18. Offline/sync

- Local-first: all three prep actions work fully offline; sales/batches flag `pendingSync`.
- Stable, idempotent movement ids (`prep`, `prep_stock`, `prep_waste`, `prep_cancel`, `prep_cancel_stock` reference types); idempotent `batchId` for prepare.
- Product menu JSON (incl. `prepBatches`) syncs through the existing product channel (`cloudSync.ts` pushes `menu`); stock deltas ride `pending_stock_updates` (R3 adjustment payloads). **No new synchronization subsystem.**

## 19. Financial reconciliation

- Invariants 1–2: prep creates zero revenue/payment (no Sale; shift cash unchanged — tested).
- Invariant 9: food + drink in one Sale (tested: single completed sale, totals = Σ lines, profit = total − Σ cogs).
- Invariant 10: hospitality totals reconcile with retail totals through the same engine; batch/made-to-order/drink lines coexist in one cart.
- Day-close: prep writes no revenue/payment/debt state; all prep movements are ordinary adjust kinds already understood by day-close stock expectations.

## 20. Tests

New `src/lib/hospitalityPrepBatch.test.ts` — **14 tests through the real store**, covering spec tests 1–25:

| Spec tests | Coverage | Result |
|---|---|---|
| 1 | made-to-order unchanged; prep refused | PASS |
| 2–6 | prepare 20: deduction, cost 2,780, stock, batch record, zero revenue, movements, audit | PASS |
| 7–8 | prepared sale: stock −1, batch −1, no re-deduction, batch COGS | PASS |
| 9–10 | FIFO across two batches, weighted historical cost frozen | PASS |
| 11, 8, 9, 12 | food+drink one Sale; retail drink; takeaway metadata | PASS |
| 13 | eat-in covered by existing `restaurantBilling` suites (billing delegates to `finalizeDraftSale`) | PASS (existing) |
| 14 | waste 2 → stock 18/remaining 18; full waste → `wasted`; no ingredient restore | PASS |
| 15 | full cancel restores all ingredients + stock | PASS |
| 16 | partial cancel reverses exactly the 12 unsold portions | PASS |
| 17 | void on prepared sale: restock + provenance credit, no double restore | PASS |
| 18 | insufficient ingredients → `ingredientShortage`, zero side effects | PASS |
| 19 | unbatched stock → `unbatchedStock`, sale blocked | PASS |
| 20–22 | idempotent prepare (same batchId), pendingSync flags, offline sale | PASS |
| 23–24 | `verifyInventoryIntegrity` zero mismatches; recovery reconciliation healthy | PASS |
| 25 | day-close inputs: no revenue/payment/debt/shift-cash effects | PASS |

**Verification results:** tsc clean · production build clean · Phase 4 suite (8) + Phase 5 suite (14) = 22/22 · neighboring suites (menuProduction, restaurantBilling, inventoryIntegrity, productionClosure, saleLifecycleIntegrity, recoveryInventoryReconciliation) 93/93 · full suite 5,369 passed / 42 failed across both shards — every failing file verified to fail identically on the clean tree (19 pre-existing files, incl. `immediateSync` confirmed by stash-and-replay).

## 21. Files changed

- `src/types.ts` — `PrepBatch`, `PrepBatchStatus`, `ProductMenuConfig.prepMode/prepBatches`, audit actions `hospitality_prep_batch/waste/cancel`
- `src/lib/menuModifiers.ts` — `normalizeProductMenu` carries `prepMode` + `prepBatches`
- `src/lib/recipeEngine.ts` — `productPrepMode`, `activePrepBatches`, `preparedPortionsAvailable`, `prepRequirementsForPortions`, `prepBatchUnitCostUgx`, `saleLineConsumesIngredientsAtSale`, `planPrepBatchConsumption` (FIFO)
- `src/store/usePosStore.ts` — `prepareMenuBatch`, `wastePreparedPortions`, `cancelPrepBatch`; batch-aware `finalizeDraftSale` loop (stock-aware deduction, unbatched-stock guard, FIFO write-back); hospitality-only provenance branch in `voidSaleLine`
- `src/lib/inventoryVersionProtection.ts` — stock gate applies to batch-prepared lines, still skips made-to-order
- `src/lib/inventoryIntegrity.ts` — movement synthesis: batch-prepared lines emit `sale_out`, excluded from ingredient consumption
- `src/components/hospitality/ProductMenuConfigFields.tsx` — prep mode selector, Prepare workflow (requirements preview with required/available/shortage), batch history, Waste/Cancel flows; save preserves store batch provenance
- `src/pages/TableOrderPage.tsx` — prepared-portions availability chip on batch-prepared product tiles
- `src/lib/i18n.ts` — 23 new en keys (lg/sw fall back)
- `src/lib/hospitalityPrepBatch.test.ts` — **new** test file

**Untouched (regression protection honored):** `saleFinancialEngine`, payment core, debt core, day-close core, pharmacy architecture, EFRIS, AI, authentication, staff architecture, product import, Phase 4 recipe behavior, kitchen ticket production flow. Shared changes were the minimum required and are no-ops for retail products.

## 22. Migrations

**None.** Prep batches live in the existing `products.menu` JSONB column, which already syncs end-to-end. No new tables, columns, or movement kinds. (Optional future: a server-side `prep_batches` mirror table purely for SQL analytics — out of scope.)

## 23. Known limitations

1. **Cancel restores ingredient quantities using the CURRENT recipe ratios**, not the prep-time snapshot (recipe edits between prep and cancel shift restored quantities slightly; documented behavior per spec).
2. **Void credits restocked portions to the newest open batch** (the exact source batch of a voided line isn't tracked on the SaleLine); financial history is unaffected — only future FIFO cost attribution.
3. **Unbatched legacy stock blocks batch-prepared sales** until reconciled (spec-chosen safe behavior) — reconcile via stock count or by toggling the item to made-to-order.
4. **Batch-prepared items with zero prepared stock cannot fall back to made-to-order at sale time** — the kitchen must prepare (or the mode must be switched). This is deliberate: it keeps the two modes unambiguous.
5. Cancel restores ingredient stock without a valuation movement distinction (returns enter at current cost basis — standard for returns-to-stock).
6. New i18n keys are English-only (existing `t()` fallback covers lg/sw).
