# WAKA POS — Hospitality / Bar & Restaurant Architecture Correction Report

**Phase:** 4 (Hospitality correction)
**Date:** 2026-09-17
**Branch:** `waka/historical-financial-correction`
**Core principle applied:** hospitality is an operational layer over the existing Retail/Kiosk Duka financial engine. No parallel accounting was built; retail sales/COGS/profit/payments/debts/returns/voids/day-close/financial-correction logic was not altered for retail products.

---

## 1. What was wrong

The audit found that the hospitality flow **already** rode on the retail engine (`finalizeDraftSale` in `usePosStore.ts`) — table billing delegates to it, recipe ingredient deduction already ran there, and bill presentation (`restaurantBilling.ts`) is pure math on top of the shared checkout totals. Three real defects remained, all in the recipe-driven `finished_menu` path:

1. **Recipe COGS was not recorded.** In `finalizeDraftSale`, a recipe-driven `finished_menu` line skipped finished-stock deduction (`shouldDeductFinishedProductStock === false`), but its `unitCostUgx`/`cogsUgx` were still computed from the finished item's own `costPricePerUnitUgx`/pack slots via `applyPackSlotCostsToSaleLine`. Since such items are produced to order and their product cost field is typically left at 0, every food sale recorded **COGS ≈ 0 and overstated profit**, violating the invariant that COGS must equal the historical cost of consumed ingredients.
2. **Unstocked menu items could be blocked at finalize.** `validateDraftSaleStockBeforeFinalize` gated every line on the product's own `stockOnHand`, even when the item is recipe-driven and its finished stock is never deducted. A correctly configured menu item with `stockOnHand = 0` could be refused with `noStock` even though ingredients were available.
3. **The movement ledger recorded phantom stock.** `saleStockMovementsFromSale` emitted a `sale_out` movement for every sale line — including recipe-driven menu items whose finished stock never moved — while the real ingredient consumption produced **no movement at all**. The inventory ledger therefore disagreed with recorded stock for every food sale (inventory-integrity mismatch), and recovery reconciliation synthesized the same phantom movements.

Additionally, the Menu Builder recipe editor could not maintain the recipe features the engine already supported: no `yieldQty` input, no per-line `wastePercent`/`prepNotes` inputs, and no live food-cost/margin panel. Worse, its line-edit handlers rebuilt `recipe: { lines }` and **silently discarded `yieldQty`** whenever a line was added or edited.

## 2. What changed

| # | Change | File |
|---|--------|------|
| 1 | Recipe-driven `finished_menu` lines now get `unitCostUgx`/`cogsUgx` from `computeMenuItemFoodCostUgx(p, products, variantId)` (recipe ingredient costs incl. `yieldQty` + `wastePercent`) at finalize time. Retail lines unchanged. | `src/store/usePosStore.ts` (`finalizeDraftSale` line loop) |
| 2 | `validateDraftSaleStockBeforeFinalize` skips the finished-stock quantity gate when `shouldDeductFinishedProductStock(product) === false`; ingredient availability is still enforced by the existing `checkIngredientAvailability` gate. | `src/lib/inventoryVersionProtection.ts` |
| 3 | `saleStockMovementsFromSale` accepts an optional `products` list: recipe-driven lines no longer emit a phantom `sale_out`; their ingredient consumption (same math as the deduction — recipes + modifier ingredient options, yield + waste) is recorded as `adjust_use` movements with stable ids. Callers pass products (`finalizeDraftSale`, recovery reconciliation). Without `products`, behavior is byte-identical to before. | `src/lib/inventoryIntegrity.ts`, `src/store/usePosStore.ts`, `src/lib/recoveryInventoryReconciliation.ts` |
| 4 | Menu Builder recipe editor: `yieldQty` and recipe `prepNotes` inputs, per-line `wastePercent` and `prepNotes` inputs, a live Food cost / Selling price / Gross profit / Margin panel computed with the same `computeMenuItemMargin` engine the sale path uses, and line handlers that preserve `yieldQty`. New i18n keys (en). | `src/components/hospitality/ProductMenuConfigFields.tsx`, `src/lib/i18n.ts` |

**Deliberately not changed:** retail sale math, payments, debts, day-close, returns/voids cores, FEFO, pack/conversion architecture, table-session flow, billing presentation. The smallest safe shared-function changes were made only where the recipe path provably required them (#2 and #3 are no-ops for retail products).

## 3. Which retail functions are reused

Hospitality sales execute inside the single retail function `finalizeDraftSale` and reuse, without modification (unless noted above):

- `requirementsFromSaleLines` + `checkIngredientAvailability` — ingredient requirement computation and shortage gate
- `applyRecipeStockDeduction` — ingredient stock deduction at sale time
- `shouldDeductFinishedProductStock` — decides finished vs ingredient deduction
- `ensureMoneySaleQuantity`, `normalizeSaleLine`, `lineCostUgx`, `lineProfitUgx`, `saleEstimatedProfitUgx`, `applyCartDiscountSnapshot` — line money math
- `applyPackSlotCostsToSaleLine`, `resolvePackCostUnitsDepleted`, `advancePackCostUnitsDepleted` — pack cost allocation (retail lines; still the fallback for non-recipe menu items)
- `detectSaleStockConflict`, FEFO batch deduction, receipt sequencing (`mintLocalReceiptIdentity`), shift/cash-drawer updates, audit log, sync outbox enqueueing
- `restaurantBilling.ts` / `computeDraftCheckoutTotals` — bill presentation only (splits, tips, service charge, framework tax); `finalizeTableBill` delegates to `finalizeDraftSale`; whole-bill voids use the shared `planWholeBillVoid`
- `saleStockMovementsFromSale` / `verifyInventoryIntegrity` / `reconcileRecoveryInventoryLedger` — the single movement ledger

## 4. Food sale mechanics

1. Cashier/t waiter adds a menu item to a table session or the POS cart.
2. At finalize, `requirementsFromSaleLines` expands the line's recipe (variant recipe if `variantId` set, else product recipe) into base-unit ingredient quantities: `perLine = quantityBase × qty / yieldQty × (1 + wastePercent/100)`; modifier options with `ingredientProductId` add their own quantities.
3. `checkIngredientAvailability` blocks the sale if any ingredient is short (`ingredientShortage`).
4. `shouldDeductFinishedProductStock` returns `false` for recipe-driven items, so finished stock is untouched; `applyRecipeStockDeduction` deducts each ingredient (clamped at on-hand, floored at 0).
5. The line's `unitCostUgx` is `computeMenuItemFoodCostUgx` — `Σ ingredient costPricePerUnitUgx × qtyBase / yieldQty × (1 + waste/100)`, rounded — and `cogsUgx = unitCost × quantity`. Both are **snapshotted on the sale line at sale time** (historical record).
6. The sale's `estimatedProfitUgx = totalUgx − Σ cogsUgx` via the shared engine; a sale-level cart discount is distributed by the existing `applyCartDiscountSnapshot`.

## 5. Drink sale mechanics

Drinks are ordinary retail products (`productKind` absent or `"retail"`). One stock unit per bottle/can — the pack/conversion architecture is untouched. A drink line goes through the unchanged retail path: stock gate on the product's own `stockOnHand`, `sale_out` movement of −qty, `unitCostUgx` from `costPricePerUnitUgx`/pack slots, standard profit math. Recipes are never consulted.

## 6. Eat-in

Eat-in orders are created as table floor sessions around a **pending** Sale. Ordering starts the pending sale (no fake open tab is created on seat; occupancy is driven by actual orders). Bill presentation (split, tip, service charge, framework tax) is computed by `restaurantBilling.ts` on top of the shared `computeDraftCheckoutTotals`. `finalizeTableBill` delegates to `finalizeDraftSale`, so payments, COGS, movements, and audit are identical to retail. **Prepaid eat-in** is supported: payments are recorded against the bill (`recordTableBillPayment`) and the final settle runs through the same `finalizeDraftSale` with the remaining balance (possibly 0).

## 7. Takeaway

Takeaway is the existing `/pos` retail sell screen — the Floor Plan page's "Takeaway" button simply navigates there. A takeaway food order is therefore a normal `finalizeDraftSale` with recipe deduction (§4); a takeaway drink is §5. No separate takeaway ledger exists.

## 8. Tables

Tables are floor-plan positions whose sessions bind to a pending Sale. Opening a table without ordering does **not** create a financial tab (no liability, no stock effect); the pending Sale is created when the first order is placed. Settling uses the shared engine; whole-bill voids use the shared `planWholeBillVoid`; voids of settled bills require the same authorization path as retail voids.

## 9. Inventory consumption

- **Drinks/retail:** product stock −qty; one `sale_out` movement per product per sale (stable id).
- **Recipe food:** finished stock unchanged; each ingredient −requirement; one `adjust_use` ("Recipe consumption") movement per ingredient per sale with a stable id (`recipe` reference type) so multi-device merge and recovery synthesis stay idempotent.
- **Reconciliation:** `verifyInventoryIntegrity` now holds for all products after a mixed cart (test M/N). `reconcileRecoveryInventoryLedger` synthesizes the same recipe-aware movements, so post-restore healing agrees with live recording. Legacy phantom `sale_out` movements from sales recorded before this fix are absorbed by the existing recovery-opening healing pass.

## 10. COGS / profit calculation

- Line COGS: retail → pack-slot cost (unchanged); recipe `finished_menu` → recipe food cost (§4); non-recipe menu items → their own product cost (unchanged fallback).
- Sale profit: `estimatedProfitUgx = totalUgx − Σ line cogsUgx` (existing `saleEstimatedProfitUgx`).
- Historical preservation: because cost is snapshotted onto the sale line at finalize time, later supplier price changes never rewrite completed sales (test K).

## 11. Returns and voids

Unchanged shared logic: `voidSaleLine` writes a `VoidRecord`, marks the line voided, reduces sale totals and profit, adjusts cash/debt via the shared helpers, and records an `adjust_other` movement; `returnProduct` validates against `validateReturnAgainstSale` / `remainingVoidableLine` and restocks per `returnRestocksInventory`. Recipe sale lines participate fully in this audit trail (test L). **Known limitation:** voiding a recipe line restocks the finished item (which was never deducted — cosmetic, since recipe items ignore finished stock) and does **not** return ingredients to stock; see §15.

## 12. Tests added and results

New file `src/lib/hospitalityRecipeSale.test.ts` — 8 tests driving the **real store** (`usePosStore.finalizeDraftSale`), not mocks:

| Spec test | Coverage | Result |
|---|---|---|
| A (direct drink sale) + G (takeaway) | drink stock −1, product cost, `sale_out` movement, profit 800 | PASS |
| B/C (recipe sale, ingredient deduction) | 2 burgers: bun −2, chicken −0.3 kg, finished stock untouched, burger `stockOnHand = 0` accepted | PASS |
| D/J (food cost, reconciliation) | line cogs 3,400 (1,700/plate); `sale.totalUgx = Σ line totals`; profit = total − Σ cogs | PASS |
| E (yield) | 10 kg rice / yield 20 plates, sell 4 → rice −2 kg, cogs 8,000 | PASS |
| F (waste %) | 10% waste on chicken: −0.33 kg for 2 plates, cogs 3,640 | PASS |
| H (prepaid eat-in) | covered by existing `restaurantBilling.test.ts` (billing mutations delegate to `finalizeDraftSale`) | PASS (existing) |
| K (historical COGS) | ingredient cost changed after finalize; sale line cogs/profit unchanged | PASS |
| L (returns/voids on recipe sales) | void ok, VoidRecord written, line voided, totals → 0 | PASS |
| M (offline/sync) | sale `pendingSync = true`, sync outbox enqueued | PASS |
| N (inventory reconciliation) | `verifyInventoryIntegrity` zero mismatches for drink + recipe cart | PASS |

Results: **8/8 new tests pass.** Neighboring suites re-run together: `menuProduction`, `restaurantBilling`, `inventoryIntegrity`, `productionClosure`, `saleLifecycleIntegrity` — **88/88 pass**. `tsc -b --force` clean. `vite build --mode production` clean. Full suite (2 shards): 5,356 passed / 41 failed — every failing file verified to fail **identically on the clean tree** (12 files in shard 1, 7 in shard 2 stashed-and-reproduced), i.e. all pre-existing and unrelated.

## 13. Files changed

- `src/store/usePosStore.ts` — recipe-COGS in `finalizeDraftSale`; pass `products` to `saleStockMovementsFromSale`; import `computeMenuItemFoodCostUgx`, `effectiveRecipe`
- `src/lib/inventoryVersionProtection.ts` — skip finished-stock gate for non-deducted (recipe) items
- `src/lib/inventoryIntegrity.ts` — recipe-aware movement generation in `saleStockMovementsFromSale` (optional `products` param, backward compatible)
- `src/lib/recoveryInventoryReconciliation.ts` — pass products into synthesis
- `src/components/hospitality/ProductMenuConfigFields.tsx` — yield/waste/notes inputs, live cost panel, yield-preserving handlers
- `src/lib/i18n.ts` — 9 new en keys (`menuRecipeYield`, `menuRecipePrepNotes`, `menuWastePercent`, `menuLineNotes`, `menuCostPanelTitle`, `menuCostFoodCost`, `menuCostSellPrice`, `menuCostProfit`, `menuCostMargin`)
- `src/lib/hospitalityRecipeSale.test.ts` — **new** test file

## 14. Migrations

**None required.** No new tables or columns: recipes, yield, waste, prep notes all live in the existing `Product.menu` JSON column, whose `Recipe`/`RecipeLine` types already carried `yieldQty`, `wastePercent`, and `prepNotes`. Movement-kind `adjust_use` already exists in `StockMovementKind`. Existing sales are immutable and unaffected; the recovery reconciliation pass self-heals pre-fix phantom movements.

## 15. Limitations

1. **Void of a recipe line does not return ingredients** to stock (shared void logic restocks `line.productId` only). The financial audit trail is correct; the ingredient restock is a future enhancement, deliberately out of scope to avoid touching shared void cores.
2. **Modifier-ingredient costs are not included in line COGS** (they are included in the deduction quantity and in movements). Modifier price deltas do add to revenue, so modifier-heavy lines slightly understate COGS.
3. Recipe food cost uses **current ingredient `costPricePerUnitUgx`** at sale time (standard moving-cost snapshot); weighted-average costing is not implemented.
4. Menu Builder live-cost panel resolves ingredient costs from the ingredient list passed by the page; a recipe line pointing at a product outside that list contributes 0 to the panel (same behavior as `computeMenuItemMargin` elsewhere).
5. New i18n keys are English-only; Luganda/Swahili fall back to English via the existing `t()` fallback.
