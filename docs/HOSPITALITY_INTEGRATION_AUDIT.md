# Hospitality integration audit

Hospitality runs on the shared Kiosk Duka state: one `products`/`stockMovements`
ledger, one `sales` table, one `usePosStore`, one offline queue and one cloud
sync. This audit traces the actual UI → store → persistence/sync → reporting
path. It records what already works, what was broken, and what remains.

## Implemented in this phase

- **Hospitality item setup in Inventory.** `/stock` still uses the shared
  Kiosk Duka product/stock model, but in Hospitality its add buttons and the
  `?add=1` workspace deep link open `HospitalityAddItemSheet` instead of the
  retail pack wizard. It supports:
  - **Ingredient** — zero selling price, stock unit, optional buying unit /
    conversion / pack price, cost per stock unit, opening stock, low-stock alert,
    `menu.productKind = "ingredient"`.
  - **Drink / retail item** — selling price, cost, stock unit and optional pack
    conversion, `menu.productKind = "retail"`.
  - **Prepared dish** — selling price, menu section, made-to-order or
    batch-prepared, recipe lines in ingredient base units, batch yield, and
    zero opening stock. Batch-prepared stock is created only by prep batches.
- **Shared store path.** `quickAddProduct` accepts an optional `menu` config and
  a zero-price allowance restricted to ingredients; it still goes through
  `commitNewProducts`, product persistence, audit and the shared sync queue.
  Retail price behavior is unchanged.
- **Menu Builder safety.** A product with no menu now seeds as `retail` rather
  than `finished_menu`, so opening/saving Menu Builder no longer reclassifies a
  drink/ingredient as an uncosted dish. Recipe ingredient and combo product
  pickers are separate; recipes no longer fall back to every product. Failed
  `updateProduct` saves are surfaced instead of silently ignored.
- **Batch-managed stock UI.** Restock and quick stock adjustments are blocked for
  batch-prepared dishes with a clear instruction to prepare/waste/cancel a batch.
- **Floor navigation permissions.** Takeaway (`pos.sell`), Documents
  (`pending_sales.manage`) and Stats (`owner.dashboard`) are only shown when the
  destination's own route guard allows them.
- **Sync safety.** Hospitality pull cursors are per shop, and
  `pending_hospitality` is now included in the stale-reset outbox guard.
- **Terminology.** Pending Hospitality bills are titled “Open bill”; Hospitality
  reports use a Hospitality page title.

## Audit matrix

| Journey / screen | Current behavior and source | Shared with Kiosk Duka? | Gap and impact | Priority / action |
|---|---|---|---|---|
| Hospitality home, Tools, guards | `/hospitality`, `/hospitality/tools`; `hospitalityNav.ts`, `HospitalityBusinessToolsPage`, `AnyPermissionRoute` | Yes — shared launcher catalog and home-menu order | Works; tools are permission-filtered | None |
| Inventory add | `StockPage`, `HospitalityAddItemSheet`, `quickAddProduct` | Yes — shared product/stock/persistence/queue | Retail-only wizard previously; ingredients required a selling price; dishes had no recipe path | **Fixed** |
| Product edit | `StockPage` reuses `SimpleAddProductWizard` | Shared product fields | No recipe/menu fields in the edit sheet; Menu Builder remains the recipe editor | Medium: add menu links/entry from detail |
| Restock / receive | `RestockPage`, `recordPurchase` | Yes — shared purchases/stock ledger | Retail pack model works for ingredients/drinks; batch-prepared dishes must not be restocked directly | **Fixed UI guard**; store-level guard/count exclusion remains |
| Units / conversions | `Product.conversionRate`, `SimpleAddProductWizard` | Yes | Buying-unit → base-unit only; recipes are always in ingredient base units | Medium: allow pack/crate entry in recipes |
| Low stock | `isLowStock`, `minimumStockAlert` | Yes | Hospitality ingredient-policy threshold setting is not applied | Medium: apply per-ingredient policy or remove the dead setting |
| Stock valuation | `inventoryValueAtCostUgx`, `costPrecision` | Yes — batch portions use frozen batch cost | Works | None |
| Menu builder | `MenuBuilderPage`, `ProductMenuConfigFields` | Yes — same products/recipes | Silent reclassification and silent save failure fixed; menu sections are not editable | **Fixed critical**; section editor low |
| Batch costing / prep | `prepareMenuBatch`, prep batches on product menu | Yes — shared products and prep-batch events | Prep UI is only `/settings/menu`, which requires `settings.shop`; managers with `stock.adjust` cannot prepare batches | High: extract/share the prep form in Inventory |
| Table service / kitchen / expo | `FloorPlanPage`, `TableOrderPage`, `KitchenDisplayPage`, `ExpoDisplayPage` | Yes — sessions/tickets + shared sales | Works; kitchen-only and bar permission paths are distinct | None |
| Takeaway / bar POS | `PosPage` with Hospitality terms | Yes — shared sale/cash engine | Works | None |
| Settlement / payments | `RestaurantBillSheet`, `restaurantBillingMutations` | Yes — shared finalize/tender/stock/cash | Works | None |
| Receipts | Settlement uses restaurant receipt; `/receipts` reprint uses retail receipt | Shared sale data | Historical Hospitality receipts lose table/waiter/service charge/tax lines | High: use `printRestaurantReceiptForSale` for Hospitality reprints; restaurant PDF pending |
| Voids / returns | shared void/return engines + prep-batch reversal | Yes | Works | None |
| Cash drawer / day close | shared drawer, shifts, `CloseDayPage` | Yes | Hospitality open sessions block day close | None |
| Reports / exports | shared `EnterpriseReportsShell` + Hospitality widgets | Yes — one sales/product/cash source | Hospitality page title fixed; report depth is shared | None |
| Offline / sync | `usePosStore`, `pending_sales`, `pending_hospitality`, `pending_prep_batches` | Yes — one queue/engine | Per-shop pull cursor and stale-reset guard fixed | **Fixed** |
| Mobile/desktop navigation | Hospitality nav + floor bar + `/hospitality/tools` | Yes | Dead-end permission links fixed | **Fixed** |

## Remaining gaps (not implemented here)

1. **Receipt history parity** — `/receipts` reprints/PDF still use the retail
   receipt builder. The thermal reprint should call
   `printRestaurantReceiptForSale`; a restaurant PDF/export builder is still
   needed for parity.
2. **Prep-batch UI for non-owners** — batch prep/waste mutations require
   `stock.adjust`, but the only UI is `settings.shop`-gated Menu Builder. A
   shared prep-batch sheet reachable from Inventory would close this.
3. **Store-level batch-stock enforcement** — direct `recordPurchase`,
   `adjustStock`, and stock-count apply paths can still change a batch-prepared
   dish's `stockOnHand` outside prep batches. The Inventory row actions are
   guarded; the remaining callers need an explicit policy.
4. **Low-stock policy** — `hospitalityIngredientPolicy.lowStockThreshold` is
   saved but not read by low-stock calculations.
5. **Recipe units** — recipe lines accept only ingredient base units; buying
   packs/crates cannot be selected directly.
6. **Menu sections** — fixed default list; no add/rename/deactivate editor.
7. **Count roles** — stock keeper/cashier can count but cannot submit/apply;
   manager can approve but not apply. This is the existing role matrix, not a
   Hospitality-specific fork.

## Pending sale

The remaining pending sale is a sync-state issue, not a Hospitality report
issue. The deployed build must include the safe sync diagnostics from the
previous phase. The minimum safe check is: open System Health on the updated
build, press **Run sync now** once, and read the post-run pending/backing-off/
failed counts and the safe message under “Sales that need uploading.” Do not
repeatedly retry. Do not treat the sale as uploaded until the existing sync path
receives a confirmed cloud acknowledgement.
