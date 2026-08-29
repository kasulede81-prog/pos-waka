# WAKA POS — Product Entry Audit

**Date:** 2026-08-28  
**Scope:** Inspection only. No code changes, migrations, CSV import, or OCR/AI implementation.  
**Primary path:** authenticated Stock screen → Add product → `SimpleAddProductWizard` (retail) or `PharmacyAddMedicineWizard` (pharmacy mode).

This document describes **what the current production code does**, not a proposed paper-form design.

---

## 1. USER FLOW

Primary create path is **Stock**, not Sell. `PosPage` has no add-product wizard.

### 1.1 How the user opens Add product

Step 1:  
User opens **Stock** (`/stock`). Permission `products.add` is required. The Add control is disabled when the plan product cap is reached (`validateCanAddProduct` / `freeProductLimitReached`).

Step 2:  
User taps one of:

- empty-state **Add product**
- list/toolbar **Add product** (`openAddProductSheet`)
- floating **StockFab** (phone)
- add-from-shelf (`openAddProductForShelf`) — pre-fills the current shelf/folder, starts at the name step
- deep link `/stock?add=1` (same wizard, if permitted and under cap)
- optional **AI product assist** (if `product_assistant` is enabled for the actor) — pre-fills wizard from step `stock` or name
- optional **AI bulk inventory** (if `inventory_assistant` is enabled) — separate modal, not the wizard
- session restore: if a dirty wizard draft exists in `sessionStorage`, Stock remount re-opens the wizard

Pharmacy mode (`preferences.pharmacyModeEnabled` / pharmacy business type) opens **`PharmacyAddMedicineWizard`** instead of the retail wizard.

### 1.2 Retail wizard — `SimpleAddProductWizard`

Fixed 8 steps (`RETAIL_PRODUCT_WIZARD_STEPS`): `name` → `shelf` → `sellUnit` → `pack` → `piecesPerPack` → `stock` → `sellPrice` → `buyPrice`.

Step 3 — **Name** (`simpleAddStep1Title`: “What are you adding?”):  
User types product name. Next is blocked until `name.trim().length > 0`.

Step 4 — **Shelf / folder**:  
- Hierarchy **off** (`catalogHierarchyEnabled !== true`): `CategoryShelfPicker` — pick an existing shelf string or type a new name.  
- Hierarchy **on**: `HierarchyShelfPicker` — search/select a folder; optionally create a folder (permission `shelves.customize` + shop preference persist).  
Next is blocked until a shelf is selected **or** there are zero existing shelves (`shelves.length === 0`). Empty selection is saved as the i18n **General** label.

Step 5 — **Sell unit** (“How do you sell it?”):  
User picks piece / bottle / packet / kg / litre / other. If other, a custom label is required.

Step 6 — **Pack** (“Does it come in a pack?”):  
Toggle “This product comes in crates, cartons, or packs”. If on, user picks crate/carton/box/sack/pack/tray/bale/custom. Custom pack label required when custom is selected. If off, pack type is shown as auto-configured N/A.

Step 7 — **Pieces per pack**:  
If pack is on, user enters how many sell-units are in one pack (must be > 0). If pack is off, UI shows `1` read-only.

Step 8 — **Opening quantity** (“How many do you have now?” / pack variant):  
User may enter 0 or leave blank (treated as 0). Hint: count what is on the shelf today. If pack is on, quantity is **number of packs**; UI shows total sell-units = packs × pieces.

Step 9 — **Sell price** (“How much do you sell one {unit}?”):  
Integer UGX, must be **> 0**. Label suffix is hardcoded **UGX**.

Step 10 — **Buy / cost price** (optional):  
“How much did you buy one {pack/unit}?” Integer UGX. Explicitly labeled optional. May be blank (0).

Step 11 — **Save**:  
Last-step primary button saves and closes. **Save and add another** (create only, not edit) saves, keeps the same shelf/folder, resets other fields, returns to name, flashes success ~2.2s.

Edit of an existing retail product reuses this wizard. If sell price or stock changed, an **audit reason** textarea is required on the last step.

### 1.3 Pharmacy wizard — `PharmacyAddMedicineWizard` (pharmacy mode only)

Three steps: `details` → `stockCost` → `selling`.

- Details: name, category/folder, strength, form (all required to advance). Optional pharmacy master fields (barcodes, generic name, etc.).
- Stock/cost: opening quantity (or packaged outer qty), total amount paid (buy cost), batch number, expiry — **required** to advance. Optional packaging hierarchy (tablet/strip/box).
- Selling: tablet (base) sell price required. Optional strip/box prices.

Save always goes through `quickAddProduct` (same store path as retail).

### 1.4 Secondary create paths (not the main wizard)

| Path | When | Store API |
|------|------|-----------|
| Quick-add sheet (`QuickAddProductFields`) | **Duplicate** action only (`openDuplicateToQuick`) | `quickAddProduct` |
| Starter pack modal on Stock | Empty-catalog helper | `bulkQuickAddProducts` |
| Shop onboarding | Builder starter lines / AI starter rows | `quickAddProduct` / `bulkQuickAddProducts` |
| AI bulk inventory modal | Feature-flagged | `bulkQuickAddProducts` |
| `duplicateProduct` | Copy SKU with suffix | `addProduct` |

---

## 2. SCREEN/FIELD INVENTORY

Retail wizard + generated fields. Pharmacy extras are in §10.

| Step | Field | Required? | User Input? | Default | Validation | Stored Where |
|------|-------|-----------|-------------|---------|------------|--------------|
| name | Product name | Yes | Yes | `""` | trim, non-empty | `Product.name` → cloud `products.name` |
| shelf | Shelf / folder | Yes if any shelves exist; else optional | Yes (pick or type) | `""` → i18n General | `canNext`: selected or `shelves.length === 0` | `Product.category` (string). Cloud `products.metadata.category`. **Not** `products.category_id` |
| sellUnit | How sold | Yes (choice) | Yes | `"piece"` | custom requires custom text | `Product.baseUnit`; `sellingMode` derived (`kg`/`litre` → `weighted`, else `unit`; name guess may override to weighted) |
| sellUnitCustom | Custom unit label | If unit = other | Yes | `""` | non-empty when custom | same `baseUnit` |
| pack toggle | Comes in pack? | No | Yes | `false` | — | drives `buyingUnit` / `conversionRate` |
| packKind | Pack type | If pack on | Yes | `"crate"` | custom requires label | `Product.buyingUnit` (lowercased pack label) when pieces > 1 |
| packCustom | Custom pack name | If pack = custom | Yes | `""` | non-empty when custom | folded into `buyingUnit` |
| piecesPerPack | Units in one pack | If pack on | Yes | `""` | integer > 0 | `Product.conversionRate` when > 1 |
| stock | Opening qty | No | Yes | `""` → 0 | ≥ 0; packs × pieces if pack | `Product.stockOnHand`; local `stockMovements` kind `opening_stock` if > 0 |
| sellPrice | Sell price UGX | Yes | Yes | `""` | integer **> 0** | `Product.sellingPricePerUnitUgx` → `selling_price_per_unit_ugx` and `price_ugx` |
| buyPrice | Buy/pack cost UGX | No | Yes | `""` | digits only | If set: `costPricePerUnitUgx` (pack ÷ pieces or unit cost); `buyingPackCostUgx` if pack. If unset: **72% of sell price** at `buildQuickAddProductDraft` |
| last (edit only) | Audit reason | If price or stock changed | Yes | `""` | `validateAuditReason` | audit log, not a product column |
| — | SKU | Auto | No (retail) | `SKU-{Date.now()}-{uuid8}` | none locally | `Product.sku` → `products.sku` (`unique (shop_id, sku)`) |
| — | id | Auto | No | `crypto.randomUUID()` | UUID | `Product.id` → `products.id` |
| — | version / updatedAt | Auto | No | `1` / ISO now | — | product + sync |
| — | minimumStockAlert | Auto | No (retail) | 5 unit / 3 weighted / 1 portion | — | `Product.minimumStockAlert` → `reorder_level` / `minimum_stock_alert` |
| — | quickPresets | Auto | No | sell price + qty 1; pack adds full-pack preset | — | `metadata.quickPresets*` |
| — | shop | Implicit at sync | No | active shop | sync requires shop ctx | `products.shop_id` |

Pharmacy wizard additional rows: see §10. Those also land on `Product` / `metadata`.

---

## 3. REQUIRED VS OPTIONAL

### Required (retail create — user must satisfy before save)

- Product name (non-empty)
- Sell price > 0 UGX
- Shelf/folder **if** at least one existing shelf is in the picklist; otherwise General is applied
- Custom sell-unit text if “other”
- Pack type (and custom label if custom) if pack toggle is on
- Pieces per pack > 0 if pack toggle is on
- Permission `products.add` and plan product slot

### Optional (retail)

- Opening stock (blank = 0)
- Buy / cost price (blank → client **defaults cost to ~72% of sell price**)
- Pack tracking (default off)
- New folder name (hierarchy create)
- Save-and-add-another vs close

### Automatically generated

- `id`, `sku` (unless pharmacy `primaryBarcode` is passed), `version`, `updatedAt`
- `sellingMode` from unit (+ name inference)
- `minimumStockAlert`
- `quickPresetsMoneyUgx` / `quickPresetsQty`
- Cost if buy price omitted (`floor(price * 0.72)`, capped at sell price)
- Opening `StockMovement` if `stockOnHand > 0`

### Selected from existing WAKA data

- Existing shelves / catalog folders (`posPinnedShelfKeys`, `posShelfLayout`, `posCatalogNodes`, product categories)
- Pharmacy category presets when pharmacy mode
- AI prefill (optional features)

### May be left blank

- Opening stock
- Buy price
- Pack (leave toggle off)
- Audit reason (create only; required on edit if price/stock change)

---

## 4. PRODUCT DATABASE MAPPING

Client source of truth is the Zustand `Product` object (`src/types.ts`), persisted locally, then upserted by `productToRow` in `src/offline/cloudSync.ts`.

| User / derived field | Client `Product` | Cloud `public.products` |
|----------------------|------------------|-------------------------|
| Name | `name` | `name` |
| Shelf / folder identity | `category` (legacy shelf **string**, e.g. folder `legacyShelfKey`) | `metadata.category` only. Column `category_id` is **not written** by this client |
| Sell unit | `baseUnit` | `unit`, `base_unit` |
| Selling mode | `sellingMode` | `selling_mode` |
| Pack label | `buyingUnit` | `buying_unit` |
| Pieces per pack | `conversionRate` | `conversion_rate` |
| Sell price | `sellingPricePerUnitUgx` | `selling_price_per_unit_ugx` **and** `price_ugx` |
| Unit cost | `costPricePerUnitUgx` | `cost_price_per_unit_ugx` **and** `cost_ugx` (rounded); exact cost also in `metadata.exactCostPricePerUnitUgx` |
| Pack invoice cost | `buyingPackCostUgx` | `metadata.buyingPackCostUgx` |
| Opening qty | `stockOnHand` | `stock_on_hand` (on create upsert) |
| Min stock | `minimumStockAlert` | `reorder_level`, `minimum_stock_alert` |
| SKU / barcode substitute | `sku` | `sku` (if empty/too long, sync rewrites `waka-{id}`) |
| Pharmacy extras | `expiryDate`, `medicineStrength`, `medicineForm`, `pharmacyPackaging`, `pharmacyMaster` | `metadata.*` |
| Hospitality / menu | `hospitality`, `menu` | `metadata.hospitality`, `metadata.menu` — **not set by retail/pharmacy add wizards** |
| Shop | (preferences / sync ctx) | `shop_id` |
| Active flag | (always true on upsert) | `is_active = true` |

**Present in SQL, not populated by add-product client:**

| Column | Status |
|--------|--------|
| `products.description` | Unused by wizard / `Product` type |
| `products.tax_rate` | Unused. Default `0`. Not in `Product`. Not in `productToRow` |
| `products.barcode` | Unused by sync. Barcodes live in `sku` and/or `metadata.pharmacyMaster.barcodes` |
| `product_categories` | Table exists. Add product does **not** insert rows here |

Local catalog folders live in **`preferences.posCatalogNodes`** (JSON on shop preferences), not in `product_categories`.

---

## 5. OPENING STOCK

Actual behavior (`buildQuickAddProductDraft` → `commitNewProducts`):

1. Wizard stock input becomes `stockOnHand` (packs × pieces if pack tracking).
2. Product row is prepended to the in-memory catalog immediately.
3. If `stockOnHand > 0`, `openingStockMovementFromProduct` appends a **local** `StockMovement` with `kind: "opening_stock"`, `deltaBaseUnits = stock`, `refId = product.id`. If stock is 0, **no** movement is created.
4. Shop scope for the movement id is `inventoryMovementNamespace()` (current shop persistence namespace). The wizard does **not** ask the user for a shop; the signed-in shop is implicit.
5. Quantity is **not** required (retail). Pharmacy wizard **does** require opening stock > 0 (and buy cost > 0).
6. This is **not** a purchase, supplier bill, or `Purchase` record. Supplier is not attached (`supplierId: null`).
7. Cloud `public.inventory_movements` is used by **sale/return/purchase/transfer** SQL paths. Client create does **not** insert an `inventory_movements` row for opening stock. Opening qty is the product’s `stock_on_hand` on the product upsert.

Edit of stock through the same wizard uses `updateProduct` (`stock.adjust`), which is a stock change on an existing product (audit reason required), not a second opening movement from the wizard builder.

---

## 6. PRICING

| Kind | Exists? | Where | Optional? | Validation |
|------|---------|-------|-----------|------------|
| Selling (retail unit) | Yes | `sellingPricePerUnitUgx` | No (must be > 0) | integer UGX, digits only, max 10 digits in UI |
| Buying / cost | Yes | `costPricePerUnitUgx`; pack invoice `buyingPackCostUgx` | Yes in retail UI | If pack: cost = pack price ÷ pieces (`unitCostFromPackTotal`). If loose: buy field is unit cost. If omitted: **72% of sell** |
| Wholesale list price | **No** separate field | Wholesale mode only changes **placeholder copy** (`pharmacyUx` / wholesale i18n) | — | — |
| Currency | UI hardcoded **UGX** | `preferences.shopCurrency` exists but wizard does not bind it | — | — |
| Cost vs sell preview | Display only | `CostValidationPreview` | — | warning UI, does not block save |

Pharmacy: total amount paid ÷ total base units = unit cost; both paid amount and stock qty must be > 0.

---

## 7. SKU / BARCODE

**Retail wizard:** no SKU or barcode field.

**Generation:** `buildQuickAddProductDraft` sets  
`sku = primaryBarcode?.trim() || \`SKU-${Date.now()}-${crypto.randomUUID().slice(0, 8)}\``.  
Retail does not pass `primaryBarcode`. Duplicate product uses `SKU-${Date.now()}` (no uuid suffix).

**Uniqueness:**  
- Cloud: `unique (shop_id, sku)`.  
- Client: **no** duplicate-SKU check before save.  
- Sync: empty/invalid sku rewritten to `waka-{id}`.

**Pharmacy:** `PharmacyMedicineMasterFields.primaryBarcode` (and secondary) can become `sku` via `primaryBarcode` and `pharmacyMaster.barcodes`. Optional unless the user fills them.

**Scanning:** Stock page HID wedge puts the code into the **product list search** and, in pharmacy mode, may open the matching product detail (`findProductByBarcode`). It does **not** fill the add-product wizard. Sell-side barcode lookup is separate (`productBarcodeIndex`). Feature `barcode_detection` is **not live**.

**Optional:** yes for retail (always auto). Optional for pharmacy master barcodes.

---

## 8. CATEGORY / SHELF / HIERARCHY

There is **no subcategory column**. Hierarchy is a **folder tree** whose assignment identity is still a **flat string** (`Product.category` = `legacyShelfKey`).

### Flag

`preferences.catalogHierarchyEnabled === true` → `HierarchyShelfPicker`.  
Otherwise → `CategoryShelfPicker` (existing names + “new” text).

### Hierarchy picker (`HierarchyShelfPicker`)

- Builds items from products, shelf layout, pinned keys, and `posCatalogNodes` (`buildCatalogPickerItems`).
- Search filters folders.
- Selecting a row sets `category` to `assignmentCategoryFromPickerItem` → `item.legacyShelfKey` (not the full path).
- Banner shows path text for UX only.
- **Create folder:** `createCatalogShelf({ name, parentId })` → `planCreateCatalogShelf` mutates `posCatalogNodes`, layout, pinned keys. Errors: empty name, reserved key, missing parent, name collision (`shelfRenameExists`), permission denied.
- Create requires `shelves.customize` **and** `authorizePreferencesPatch` for catalog preference keys (`canPersistCatalogShelfPreferences`). Typically owner/manager/supervisor/stock_keeper — not cashier.

### Required?

- If picklist `shelves.length > 0`, user must select (or type, in flat mode) before Next.
- If none exist, Next is allowed; save uses General.
- Save always stores a string category (`built.category || generalCategory`).

### Save-and-add-another

`retailWizardAfterSaveAndAddAnother` **keeps `shelf`**, resets name/unit/pack/stock/prices, returns to step `name`.

### `product_categories` SQL table

Not used by this UI. Folders are preference JSON, not `product_categories` rows.

---

## 9. TAX

- SQL: `products.tax_rate numeric(7,4) not null default 0`.
- TypeScript `Product` has **no** tax field.
- `productToRow` does **not** send `tax_rate`.
- Add-product wizards have **no** tax/VAT/EFRIS field.

**Conclusion:** tax on products is a **schema default (0), unused by product creation**. Do not treat it as EFRIS/VAT. EFRIS lives elsewhere in the app, not on this wizard.

---

## 10. OTHER PRODUCT FIELDS

Only fields that exist on `Product` or in a **wired** add UI.

| Field | In retail add? | In pharmacy add? | Notes |
|-------|----------------|------------------|-------|
| Unit (`baseUnit`) | Yes (sell-unit step) | Yes (tablet default / packaging) | |
| Supplier | No | No | Suppliers used on **restock/purchase**, not create |
| Image | No | No | No `image` on `Product` |
| Description | No | No | SQL column unused |
| Stock minimum | Auto only | Yes (`minAlert`, default `"10"`) | |
| Expiry | No | Yes (required in pharmacy stock step) | `expiryDate` |
| Batch | No | Yes if batch number + expiry; `openingBatch` | `pharmacyPackaging.batches` |
| Variants (`ProductVariant` on `menu`) | No | No | Hospitality menu type exists; **not** in add wizards |
| Product image | No | No | |
| Hospitality routing | No | No | Can be patched later via `updateProduct` |
| Pharmacy strength/form | No | Yes (required) | |
| Pharmacy master (generic, manufacturer, barcodes, controlled, etc.) | No | Optional extras on details | `PharmacyMedicineMasterFields` |
| Packaging strip/box | No | Optional | |
| Quick money presets | Auto | Auto | |

---

## 11. SAVE FLOW

```
UI (SimpleAddProductWizard.handleSave)
  → buildProductFromSimpleWizard (name + sell price > 0)
  → StockPage.saveFromSimpleWizard
      CREATE: quickAddProduct(...)
      EDIT:   updateProduct(..., auditReason?)
  → denyUnlessEffectivePermission("products.add")  // create
  → buildQuickAddProductDraft (name, price > 0; pharmacy extra rules)
  → commitNewProducts
      → validateCanAddProduct (plan cap)
      → set() products + opening movements
      → queueRemote("product", { id, isNew: true }) per row
      → pushAudit("product_add", ...)
      → flushPendingPersist() (IndexedDB)
  → cloudSync productToRow upsert when online
  → UI: close wizard (or add-another reset). Local commit is treated as success immediately (Phase 36.1) — no wait for cloud.
```

Pharmacy `save()` calls the same `quickAddProduct`.

Audit payload includes productId, name, category, stock, priceUgx, costUgx.

---

## 12. FAILURE BEHAVIOR

| Case | Actual behavior |
|------|-----------------|
| Required field missing | Next/Save disabled (`canNext` / `stepBlocked`). Save with invalid built product sets `saveError` to i18n `invalid` |
| Duplicate SKU/barcode | **No client check.** Cloud unique `(shop_id, sku)` can fail later on sync. UNKNOWN whether user sees a dedicated SKU-conflict toast — not handled in the wizard |
| Category/folder create fails | Inline `createError` on picker; product category unchanged |
| `quickAddProduct` / `onSave` false | Wizard `saveError`; pharmacy `save()` returns false and stays open. Plan cap: `errorKey` `planProductLimit`. Permission: deny + `auth_forbidden` audit. Pharmacy missing buy/stock: `pharmacyBuyPriceRequired` / `pharmacyOpeningStockRequired` (wizard usually blocks first) |
| Database / IDB persist fail | Local Zustand already updated; persist is async. Sync retry via queue. Wizard already closed on local ok |
| Stock movement fail | Movement is in-memory merge in the same `set()`; no separate stock service to fail independently |
| Network unavailable | Product still created locally; `queueRemote` pending. User sees success |
| User exits midway | Dirty close: `window.confirm(productEditorDiscardConfirm)`. Confirm → `clearProductWizardSessionDraft`. Cancel keeps dialog. If they leave Stock without confirming, draft remains in **sessionStorage** (`product_wizard_session_v1` scoped by shop/account) and Stock remount re-opens the wizard |
| Edit audit reason missing | `onSave` false; alert / `auditReasonRequired` |
| Free plan cap | Add buttons disabled; `onSave` returns false if still invoked |

---

## 13. PERMISSIONS

Source: `src/lib/permissions.ts` role matrix + store `denyUnlessEffectivePermission`.

| Action | Permission | Roles (default matrix) |
|--------|------------|------------------------|
| Create product | `products.add` | owner, manager, supervisor, stock_keeper. **Not** cashier, waiter, kitchen, bar |
| Edit product (name, price, stock, category, sku, …) | `stock.adjust` via `updateProduct` | owner, manager, supervisor, stock_keeper |
| Edit till presets only | `products.edit_presets` | same as add (not cashier) |
| Remove product | `products.remove` | **owner only** |
| Create/rename catalog folders | `shelves.customize` + shop preference auth | owner, manager, supervisor, stock_keeper |
| Modify prices | same as edit: `stock.adjust` | as above |
| Opening stock on **create** | `products.add` | as create |
| Opening stock on **edit** | `stock.adjust` | as edit |
| Restock / supplier stock-in | `purchases.record` | owner, manager, supervisor, stock_keeper |

Plan cap can still block create when permission is granted. Custom enterprise roles may add/remove these keys — UNKNOWN without inspecting a specific shop’s role pack. Default matrix is as above.

---

## 14. EXISTING BULK IMPORT

**No CSV/Excel product import** is wired (export exists: `buildProductCatalogCsv` in `src/features/inventory/export/productCatalogExport.ts` — export only).

What **does** exist:

1. **`bulkQuickAddProducts`** — in-app bulk create using the same draft/validation as `quickAddProduct`. Used by Stock starter pack, onboarding AI starter rows, AI bulk inventory modal.
2. **`BulkInventoryAiModal`** — Edge `ai-bulk-inventory`, user reviews rows, optional shared shelf, then `bulkQuickAddProducts`. Feature `inventory_assistant` (`deployed: true`), gated in UI.
3. **Onboarding starter products** — canned lines + optional AI setup assistant.
4. **OCR / paper scan:**  
   - Android plugin `WakaMlkitOcr` is registered.  
   - i18n strings describe “Scan stock into products”, paste-from-spreadsheet, review-before-save.  
   - Feature `ocr` is **`deployed: false`** / coming soon.  
   - **No React page** references `ocrImportTitle` (strings only).  
   So: **no live paper-OCR product import in the web/app UI.** Native OCR plumbing is incomplete relative to those strings.

**Accurate statement:** there is no spreadsheet file importer. There **is** AI bulk list generation and multi-row `quickAdd`. Paper OCR is **not** a live product-entry path.

---

## 15. RECOMMENDED PAPER FORM FIELDS

Based **only** on current retail create rules (pharmacy shops need a different sheet).

### MUST WRITE

- Product name  
- Selling price (UGX per sell unit)  
- Where it lives (shelf / folder name) — if the shop already has sections; otherwise WAKA will store General  

### SHOULD WRITE

- How it is sold (piece, bottle, packet, kg, litre, or write a unit)  
- Opening quantity on the shelf **today** (0 is valid)  
- Whether it arrives in a pack/crate and **how many sell-units per pack**  
- What they paid (per pack or per unit) — optional in software but needed for real cost/profit  

### OPTIONAL

- Pack type name (crate, carton, …)  
- Buy price if unknown (WAKA will invent ~72% of sell — poor for paper onboarding accuracy)  
- Pharmacy-only: strength, form, expiry, batch, barcode, generic name  

### DO NOT WRITE — WAKA CAN GENERATE/DETERMINE IT

- SKU / internal id  
- Selling mode (derived from unit)  
- Minimum stock alert  
- Quick-sell preset amounts  
- Tax / VAT / EFRIS  
- Supplier (not part of create)  
- Image  
- Currency (UI is UGX)  
- Folder UUID / catalog node id (write the **folder name** humans use)  

Keep the paper sheet to: **name, section, unit, qty, sell price, optional pack size, optional cost**.

---

## 16. FUTURE IMPORT PIPELINE

Do not implement now. Recommended shape so it **cannot bypass** current rules:

```
Paper sheet
  → Scan (camera / ML Kit / existing WakaMlkitOcr)
  → OCR/AI extraction (structured candidates only)
  → Structured rows: name, category/legacyShelfKey, baseUnit, hasPack, piecesPerPack, stockQty, sellPriceUgx, buyPackPriceUgx?
  → Same validators as today:
       buildProductFromSimpleWizard  and/or  buildQuickAddProductDraft
       products.add + validateCanAddProduct
  → Human review UI (same idea as BulkInventoryAiModal / unfinished OCR review copy)
  → Existing import service: bulkQuickAddProducts / quickAddProduct
  → Existing persist + queueRemote("product") + opening_stock movements
```

Do **not** insert into `products` SQL directly, skip cost defaults, or skip plan/permission checks. Folder names must resolve to `legacyShelfKey` (create folder via `createCatalogShelf` if missing, with `shelves.customize`).

Pharmacy rows should use the pharmacy draft fields (cost, stock, batch, barcode), not the retail 72% cost default.

---

## 17. UNKNOWNS

- Exact user-visible error when cloud `unique (shop_id, sku)` rejects a sync — **UNKNOWN — REQUIRES CODE REVIEW** of sync error surfacing.
- Whether custom enterprise roles in a given shop diverge from the default permission matrix — shop-specific.
- Whether `product_categories` is written by any unused/admin path not reached from Add product — not used by inspected create flow.
- Live Android OCR end-to-end — plugin exists; UI feature frozen. **Android/iOS OCR NOT LIVE VERIFIED.**

---

## FINAL REPORT

### A. Files inspected

- `src/components/stock/SimpleAddProductWizard.tsx`
- `src/components/stock/HierarchyShelfPicker.tsx`
- `src/components/stock/ShelfDestinationPicker.tsx`
- `src/components/stock/CategoryShelfPicker.tsx`
- `src/components/stock/PharmacyAddMedicineWizard.tsx`
- `src/components/stock/QuickAddProductFields.tsx`
- `src/components/stock/BulkInventoryAiModal.tsx`
- `src/components/stock/wizard/ProductWizardShell.tsx`
- `src/components/stock/wizard/WizardFooter.tsx`
- `src/components/pharmacy/PharmacyMedicineMasterFields.tsx`
- `src/lib/simpleProductWizard.ts`
- `src/lib/productWizardSteps.ts`
- `src/lib/productWizardSessionDraft.ts`
- `src/lib/quickAddProductForm.ts`
- `src/lib/catalogHierarchy.ts`
- `src/lib/inventoryIntegrity.ts` (`openingStockMovementFromProduct`)
- `src/lib/permissions.ts`
- `src/lib/settingsAuthorization.ts`
- `src/lib/productPlanEnforcement.ts`
- `src/lib/ai/bulkInventoryAi.ts`
- `src/lib/ai/mapAiSuggestionToWizard.ts`
- `src/lib/ai/aiFeatures.ts`
- `src/offline/cloudSync.ts` (`productToRow`)
- `src/store/usePosStore.ts` (`buildQuickAddProductDraft`, `commitNewProducts`, `quickAddProduct`, `bulkQuickAddProducts`, `addProduct`, `updateProduct`, `createCatalogShelf`)
- `src/pages/StockPage.tsx`
- `src/pages/ShopOnboardingPage.tsx`
- `src/types.ts` (`Product`)
- `supabase/migrations/004_product_catalog_inventory.sql`
- `src/features/inventory/export/productCatalogExport.ts`
- `android/app/src/main/java/ug/waka/pos/WakaMlkitOcrPlugin.java`

### B. Exact product-add steps

Stock → Add product → (retail) name → shelf/folder → sell unit → pack? → pieces/pack → opening qty → sell price UGX → optional buy price → Save or Save and add another. Pharmacy mode: details → stock/cost/batch → selling prices → Save. Same store commit: `quickAddProduct`.

### C. Complete field inventory

See §2 table. Pharmacy extras in §10.

### D. Required vs optional

See §3. Retail must-haves: **name + sell price > 0** (+ shelf if shelves exist). Stock and buy price optional. SKU auto.

### E. Database mapping

See §4. Client `Product` → `public.products` columns + `metadata` JSON. Category is **metadata string**, not `category_id`.

### F. Opening-stock behavior

Sets `stockOnHand` immediately. If > 0, local `opening_stock` movement. Not a purchase. Shop implicit. Qty optional (retail). Cloud opening ledger row is **not** written; stock travels on the product row.

### G. Pricing behavior

Sell required (UGX). Buy optional; default cost **72% of sell**. Pack buy price allocated per unit. No wholesale price column. Currency label UGX.

### H. SKU/barcode behavior

Auto `SKU-{time}-{uuid}`. Optional pharmacy barcodes. No uniqueness check in the wizard. Scan on Stock is **search**, not create.

### I. Category/shelf behavior

Flat string `Product.category`. Optional folder tree in preferences. Create folder is a separate permissioned action. Save-and-add-another keeps the folder.

### J. Tax behavior

`tax_rate` exists in SQL, default 0, **unused** by product entry. Not EFRIS/VAT.

### K. Permissions

Create: `products.add`. Edit price/stock: `stock.adjust`. Folders: `shelves.customize`. Remove: owner `products.remove`. Cashiers cannot add products.

### L. Existing bulk-import capability

No CSV/Excel import. Yes: `bulkQuickAddProducts`, AI bulk inventory, onboarding starters. OCR paper import: **not live** (strings + Android plugin; feature `ocr` not deployed).

### M. Recommended paper-form fields

See §15. Minimum: name, section, unit, quantity, sell price; pack size and cost strongly recommended.

### N. Recommended future import architecture

See §16. Review UI → **existing** `buildQuickAddProductDraft` / `bulkQuickAddProducts`. Do not bypass validation.

### O. Risks / unknowns

- Silent 72% cost if paper omits buy price.  
- SKU collisions only fail at cloud unique index.  
- Hierarchy assignment is a **leaf string**, not a path — OCR must match `legacyShelfKey`.  
- Dual wizards (retail vs pharmacy) — one paper sheet cannot cover both.  
- Opening stock not mirrored to `inventory_movements`.  
- Sync SKU conflict UX: UNKNOWN — REQUIRES CODE REVIEW.
