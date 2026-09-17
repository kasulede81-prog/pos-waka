# WAKA POS — PHASE 5 HOSPITALITY AUDIT

**Ugandan Bar & Restaurant Operational Architecture**
**Date:** 2026-09-17
**Base commit:** `ff0ce11` (Phase 4 — do not undo or rewrite)
**Status:** AUDIT ONLY. No code was modified to produce this document.

**Standing rule honored throughout:** the Retail/Kiosk Duka financial engine (`finalizeDraftSale` and its shared money/movement/audit machinery) is the single source of truth. This audit found no second engine is needed — what is missing is one operational entity (preparation batches) and the deduction-mode logic to honor it.

---

## A. Current architecture

### Type system (`src/types.ts`)

| Concept | Type | Notes |
|---|---|---|
| Product kind | `ProductKind` = `"retail" \| "finished_menu" \| "ingredient" \| "semi_finished"` (line 631) | Set per product in `Product.menu.productKind` |
| Recipe | `Recipe` (681) — `lines`, `yieldQty?`, `prepNotes?` | Yield = portions per recipe execution |
| Recipe line | `RecipeLine` (673) — `ingredientProductId`, `quantityBase`, `unitLabel?`, `wastePercent?`, `prepNotes?` | |
| Modifiers | `ModifierGroup` / `ModifierOption` | Options can themselves consume ingredients (`ingredientProductId`, `ingredientQtyBase`) |
| Variants | `ProductVariant` (own recipe + price per variant) | |
| Table session | `TableSession` (968) — `table` or `named_tab`, binds `saleId`, status `open/payment_pending/closed/cancelled/merged` | A session is a wrapper around a **pending retail Sale** |
| Floor state | `HospitalityFloorState` (998) — areas, tables, sessions, stations, kitchen tickets, reservations, waitlist, waiter sections, audit log | Lives in `preferences.hospitalityFloor`, syncs via `pending_hospitality` queue |
| Kitchen ticket | `KitchenTicket` (1034) — 9-status audited flow `queued→…→completed`, per-station (kitchen/bar/grill/…), item-level cancel with reasons | Pure production workflow; carries **no money** |
| Sale | `Sale` (1859) — `status`, `referenceLabel`, `tableSessionId?` | `tableSessionId != null` ⇒ eat-in; absent ⇒ takeaway/retail |
| Movements | `StockMovementKind` (1711) — includes `adjust_use`, `adjust_expired_writeoff` | `adjust_use` now carries recipe consumption (Phase 4) |
| Batches | `PharmacyBatchRecord` et al. (1170+) | Pharmacy-only; **no food-prep batch type exists** |

### Sale flow (verified in code)

1. **Every** hospitality order — table, named tab, or takeaway — is a pending or completed retail `Sale`. `TableOrderPage` edits the shared `draftLines` cart (`addHospitalityDraftLine`, `setDraftLineQuantity`, `removeDraftLineById`, discounts, notes, courses) bound to the session's pending sale.
2. `finalizeDraftSale` is the only finalizer. Recipe lines expand to ingredient requirements (`requirementsFromSaleLines`), are gated by `checkIngredientAvailability`, deduct ingredients (`applyRecipeStockDeduction`), skip finished-stock deduction for recipe items, and snapshot recipe-derived COGS onto the line (Phase 4).
3. `restaurantBilling.ts` is pure presentation: splits (equal/by-seat/by-item/custom), tips, service charge, framework tax — all computed on top of shared totals, then fed back through `finalizeDraftSale` via `finalizeTableBill`. Payments (`BillPaymentRecord`, prepaid partials included) and voids (`planWholeBillVoid`) are the shared retail machinery.
4. Kitchen tickets (`fireTableStationTickets`, `kitchenProduction.ts`) are fired from ordered lines, tracked through an audited station flow, and merge cross-device (`hospitalityCloudSync.ts`). No financial fields exist on tickets.
5. Movement ledger: `saleStockMovementsFromSale` (now recipe-aware, Phase 4) + recovery synthesis (`reconcileRecoveryInventoryLedger`) + integrity verification (`verifyInventoryIntegrity`).
6. Offline/sync: sales queue as `pending_sales`/`sale`; floor state as `pending_hospitality`; **products — including the full `menu` JSON — push/pull through the standard product channel** (`cloudSync.ts:290` pushes `menu`, `:350` normalizes on pull). Product-scoped JSON therefore syncs with **zero extra plumbing**.
7. Waste: `writeOffExpiredStock` writes audited `adjust_expired_writeoff` movements (batch-aware for pharmacy).

### Hospitality UI surface (verified routes)

| Route | Page | Role |
|---|---|---|
| `/floor` | `FloorPlanPage` | Table map, sessions, Takeaway button → `/pos` |
| `/floor/reservations` | reservations | bookings/waitlist |
| `/floor/order/:sessionId` | `TableOrderPage` | order entry on the shared cart |
| `/kitchen` | `KitchenDisplayPage` / `ProductionStationDashboard` | KDS by station |
| `/office` → menu builder | `MenuBuilderPage` | recipes, modifiers, variants, live cost panel (Phase 4) |
| `/settings/floor`, `/settings/hospitality` | settings | floor layout, service charge/tax defaults |
| `/pos` | POS | takeaway + retail |

---

## B. Answers to the 12 questions

1. **Does the recipe/yield architecture already allow a prepared batch to represent portions?**
   Yes, partially. `yieldQty` already expresses "one recipe execution produces N portions," and the cost math (`computeRecipeFoodCostUgx`) is per portion. What does **not** exist is a *prep event* that converts ingredients into portions ahead of sale. The math is ready; the entity is missing.

2. **Can a restaurant prepare 20 portions of a menu item before sales begin?**
   Not today. Nothing records production outside a sale. The only stock-in paths are purchase, returns, void restock, count adjustments, and pharmacy batch receive — none express "kitchen produced 20 plates of pilau from raw ingredients."

3. **Can prepared portions be tracked without a second inventory system?**
   Yes — by crediting the **existing** `stockOnHand` of the `finished_menu` product (one stock unit = one portion) and keeping batch provenance as JSON metadata. No new ledger, no new stock engine: the retail movement ledger already handles stock in/out for any product.

4. **How should preparation consume ingredient stock?**
   Through the existing recipe engine: `requirementsFromSaleLines`-equivalent math (recipe lines + modifier-ingredient options, ÷ `yieldQty`, × (1 + `wastePercent`)) scaled to portions prepared, deducted at prep time via `applyRecipeStockDeduction`-equivalent logic, recorded as `adjust_use` movements (stable ids, `prep` reference type) — exactly the pattern Phase 4 established for sale-time consumption.

5. **How should prepared portions be represented?**
   As a `PrepBatch` record carried in `Product.menu` (JSON, syncs with the product): `{ id, preparedAt, portions, remainingPortions, unitCostUgx (recipe food cost at prep time), note?, status: "active"|"depleted"|"wasted"|"cancelled", actor… }`. Prepared stock = `product.stockOnHand`; batch `remainingPortions` is provenance/valuation, not a second stock counter — `stockOnHand` stays the single counter.

6. **What happens when one prepared portion is sold?**
   The deduction decision becomes stock-aware: if the dish has prepared stock (`stockOnHand > 0`), the sale deducts **one finished stock unit** (like retail) at batch unit cost (moving average across active batches → COGS); ingredients are NOT re-deducted (no double consumption). If no prepared stock remains, the current made-to-order path (deduct ingredients, recipe COGS) applies unchanged. Drinks never enter this logic.

7. **What happens when prepared food is wasted?**
   Reuse the existing audited write-off path: decrement `stockOnHand` and `remainingPortions` on the batch with status → `wasted`, and record an `adjust_expired_writeoff` (or `adjust_damage`) movement with reason. COGS impact: the write-off reduces prepared-stock value; no sale is created.

8. **What happens when a sale is voided?**
   Unchanged shared logic (`voidSaleLine`, `planWholeBillVoid`): audited `VoidRecord`, totals/profit reduction, `adjust_other` movement. Known Phase 4 limitation stands: voids restock `line.productId` (correct for prep-deducted sales — the portion goes back to prepared stock; cosmetic for made-to-order items). Ingredient un-consumption on made-to-order voids remains a documented future enhancement.

9. **What happens when a preparation is cancelled?**
   Before any portion is sold from the batch: reverse it — ingredients restored (positive `adjust_use` movement, same stable-id family), batch → `cancelled`, prepared stock decremented. After portions were sold: only the remaining unsold portion count can be cancelled (sold portions are history).

10. **Can drinks continue using the normal Retail product lifecycle?**
    Yes — unchanged. Drinks are `retail` products; one stock unit per bottle; pack/conversion architecture untouched; made-to-order prep logic never consults them.

11. **Can Eat-in and Takeaway be operational metadata without a second financial ledger?**
    Already true. Eat-in ⇒ `Sale.tableSessionId` set + session wrapper; takeaway ⇒ plain sale via `/pos`. Neither forks money, COGS, payments, or movements.

12. **Can tables be operational/seating state rather than financial accounts?**
    Already true. `TableSession` binds to a pending Sale; no tab balance, no account, no liability exists outside the sale itself. Opening a table creates no financial event; the pending sale is created on first order (no fake open tab).

---

## C. Missing functionality

| # | Gap | Needed for |
|---|---|---|
| 1 | **Prep batch entity** (portion-scale production ahead of sales) with per-batch unit cost | Q2/Q3/Q5 — the core of this phase |
| 2 | **Prep action** (start/confirm preparation) consuming ingredients at prep time | Q4 |
| 3 | **Stock-aware deduction mode** in `finalizeDraftSale`: prepared-stock sale deducts finished unit at batch cost; no prepared stock ⇒ current made-to-order path | Q6 — prevents double consumption |
| 4 | **Prep waste action** on a batch (reuse write-off movement kinds) | Q7 |
| 5 | **Prep cancel action** (full before sales, partial after) | Q9 |
| 6 | **Prep UI**: "Prepare" flow on the menu/product (portions → ingredient preview → confirm), batch list per dish with remaining counts, waste/cancel buttons; small prep indicator on floor/order pages | usability |
| 7 | **Menu Builder toggle** per dish: made-to-order vs batch-prep (or derived: prep batches exist ⇒ batch mode) | Q1/Q6 clarity |
| 8 | **Batch cost in COGS**: sale of prepared portion uses batch moving-average unit cost (frozen on the sale line, as today) | financial correctness |
| 9 | Optional: **service-mode label** (`eat_in`/`takeaway`) on the Sale for reporting — currently inferred from `tableSessionId`; nice-to-have, not required | reporting |
| 10 | Multi-device batch merge rules (same stable-id + version discipline as products/floor) | offline correctness |

**Explicitly NOT missing (do not rebuild):** sales finalization, payments, debts, returns/voids, day-close, COGS snapshotting, movement ledger, KDS tickets, floor/session model, menu builder engine, offline queue.

---

## D. Recommended data flow

**Made-to-order (unchanged, Phase 4 behavior):**
order line → finalize → ingredient availability gate → deduct ingredients (`adjust_use` movements) → recipe COGS on line → retail engine completes money/audit/sync.

**Batch prep (new, all inside existing machinery):**
1. Cook confirms "Prepare N portions of Dish X" (UI on menu/dish; N defaults to `yieldQty`).
2. Preview: `requirements = recipeEngine math × N/yieldQty` (with waste); availability gate reuses `checkIngredientAvailability`.
3. Confirm: ingredients deducted (same `applyRecipeStockDeduction` mechanics); `adjust_use` movements with stable ids (`prep` reference type, idempotent); `stockOnHand(X) += N`; new `PrepBatch` appended to `X.menu.prepBatches` with `unitCostUgx = computeMenuItemFoodCostUgx(X) × yieldQty / N portions` — actually per portion = recipe cost at prep time; all inside one store action, audited like other stock actions.
4. Sale of a portion: deduction resolver sees prepared stock > 0 → deducts 1 finished unit, `unitCostUgx` = moving average of active batches' unit costs (consumed from oldest batch FIFO by `preparedAt`, decrementing `remainingPortions`); ingredients untouched. No prepared stock → existing made-to-order path.
5. Waste: pick batch → `remaining/stock −k` → `adjust_expired_writeoff`/`adjust_damage` movement, batch status `wasted`, audit entry.
6. Cancel: same reversal mechanics before/after partial sales as per Q9.
7. Everything syncs: `menu` JSON rides the product channel; movements/sales ride their channels; no new sync code paths.

---

## E. Database changes required, if any

**Recommended: none for v1.** `PrepBatch[]` stored in `Product.menu.prepBatches` (JSONB `menu` column on `products`, already pushed/pulled by `cloudSync.ts:290/350`). Existing migrations `072_hospitality_mode.sql`, `074_hospitality_sync.sql`, `127/128/129_hospitality_*.sql` already carry floor/ticket sync — untouched.

**Optional later (only if multi-shop analytics need server-side prep reporting):** one migration adding a `prep_batches` table mirroring the JSON for SQL reporting, backfilled by sync — explicitly out of scope for this phase.

---

## F. Risks

1. **Double consumption** — the single biggest risk: if sale-time deduction doesn't know about prepared stock, one portion costs both the prep ingredients and the finished unit. Mitigated by the stock-aware deduction resolver + tests (prep 20 → sell 5 → ingredients move once, finished −5).
2. **Cost drift** — batch unit cost is a prep-time snapshot; ingredient price rises between prep and sale make batch COGS stale-by-design (moving-average is the accepted convention; document it).
3. **Sync races** — two devices preparing the same dish concurrently: resolved by product version discipline (products already carry `version`; bump on prep like other stock mutations) and stable batch ids.
4. **Legacy dishes with ad-hoc finished stock** — some owners may already stock finished_menu items manually; the resolver must handle "stock but no batch" (fallback: current made-to-order? or retail-style deduction at product cost?). Decision needed: treat unbatched finished stock as unavailable for prep-mode deduction (safest) — flagged for the build phase.
5. **Void-after-prep-sale** — restocks the finished unit but not the batch provenance (which batch?). Acceptable: restock increments `stockOnHand`; new prep or count adjustment re-establishes provenance. Document.
6. **Day-close interplay** — prep movements must be included in day-close stock expectations; they are ordinary movements, so existing machinery covers them; verify in tests.

---

## G. Exact files expected to change (build phase — not yet)

- `src/types.ts` — `PrepBatch` type; `ProductMenuConfig.prepBatches?`; optional `prepMode`
- `src/lib/recipeEngine.ts` — prep-requirement scaling; deduction-mode resolver (`resolveDeductionMode(product)` / cost resolver); FIFO batch consumption helper
- `src/store/usePosStore.ts` — `finalizeDraftSale` loop honors the resolver; new actions `prepareMenuBatch`, `wastePreparedPortions`, `cancelPrepBatch` (audited, movement-writing, version-bumping)
- `src/lib/inventoryIntegrity.ts` — `saleStockMovementsFromSale` + recovery synthesis honor prep-mode deduction (finished `sale_out` when prep-deducted; no `adjust_use` ingredients for that line)
- `src/components/hospitality/ProductMenuConfigFields.tsx` / `src/pages/MenuBuilderPage.tsx` — prep mode toggle, batch list, Prepare/Waste/Cancel UI
- `src/pages/TableOrderPage.tsx` + floor components — small "prepared portions available" indicator (optional)
- `src/lib/i18n.ts` — new keys (en; lg/sw fall back)
- `src/lib/hospitalityPrepBatch.test.ts` — new invariant tests (prep consumes once; sale from batch; no double consumption; waste; cancel; sync/pendingSync; ledger integrity)
- `PHASE5-HOSPITALITY-PREP-REPORT.md` — final report

## H. Exact files that must remain untouched

- `src/lib/saleFinancialEngine.ts` and all retail money math (`lineCostUgx`, `lineProfitUgx`, `saleEstimatedProfitUgx`, pack-slot cost functions) — retail semantics frozen
- `src/store/usePosStore.ts` — retail-only paths of `finalizeDraftSale` (non-recipe lines), payments, debts, returns, voids cores, day-close, FEFO
- `src/lib/restaurantBilling.ts` — presentation layer is complete
- `src/lib/dayClose*.ts`, `src/lib/sequentialBusinessDays.ts`, `src/lib/financialMetrics.ts`
- Kitchen ticket production flow (`src/lib/kitchenProduction.ts`, KDS pages) — no money there, nothing to add
- Pharmacy batch subsystem (`pharmacyBatch*`) — unrelated
- All of Phase 4's hospitality fixes — behavior locked by tests

## I. Proposed implementation phases

1. **P5.1 — Core entity & prep action:** types, recipeEngine scaling helpers, `prepareMenuBatch` store action (ingredient deduction + `adjust_use` movements + batch record + audit), tests A–D.
2. **P5.2 — Stock-aware sale deduction:** resolver in `finalizeDraftSale`, FIFO batch consumption, batch moving-average COGS frozen on line, movement-ledger update + recovery synthesis parity, tests E–H (incl. no-double-consumption and ledger integrity).
3. **P5.3 — Waste & cancel:** `wastePreparedPortions`, `cancelPrepBatch` with reversal movements, tests I–K.
4. **P5.4 — UI:** Menu Builder prep toggle + Prepare/Waste/Cancel flows with ingredient preview and live batch cost; floor/order prep indicators; i18n.
5. **P5.5 — Hardening & report:** sync/version race tests, day-close interplay test, full suite, `PHASE5-HOSPITALITY-PREP-REPORT.md`, commit & push.

**Audit complete. Stopping here as instructed — no code written.**
