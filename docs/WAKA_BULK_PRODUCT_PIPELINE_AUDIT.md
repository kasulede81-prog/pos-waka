# WAKA POS — Existing Bulk Product Creation Pipeline Audit

**Date:** 2026-08-29  
**Scope:** Inspection only. No code, CSV, OCR, or AI feature work.  
**Companion:** `docs/WAKA_PRODUCT_ENTRY_AUDIT.md` (single-product wizard).

This document describes **what already exists** that a future CSV/Excel or paper-OCR import should reuse, and what it must not bypass.

---

## 1. What exists (inventory)

| Piece | Exists? | Role |
|-------|---------|------|
| CSV/Excel file import | **No** | Catalog **export** CSV exists (`productCatalogExport.ts`); no parser/import |
| `bulkQuickAddProducts` | **Yes** | Batch commit API on the POS store |
| `quickAddProduct` | **Yes** | Single-row wrapper around the same draft + commit |
| `buildQuickAddProductDraft` | **Yes** (private in `usePosStore.ts`) | Pure draft + validation |
| `commitNewProducts` | **Yes** (private in `usePosStore.ts`) | Plan cap, catalog write, opening stock, sync, audit |
| AI bulk list | **Yes** | Edge `ai-bulk-inventory` + `BulkInventoryAiModal` + review table |
| AI onboarding starters | **Yes** | `parseAiBusinessSetup` → `bulkQuickAddProducts` |
| Stock starter pack UI | **Yes** | Canned lines → `bulkQuickAddProducts` |
| Paper OCR import UI | **No (not live)** | `ocr` feature `deployed: false`; i18n + Android plugin only |
| Shared “normalized import row” type used by CSV and AI | **No** | AI uses `AiBulkInventoryRow` / `BulkInventoryPreviewRow`; store uses a wider inline row type |

There is **no separate bulk product service**. Bulk is the same creation engine as one-at-a-time add, called in a loop then committed once.

---

## A. Existing bulk pipeline

```
Caller rows (plain objects)
  → bulkQuickAddProducts(rows)
       permission: products.add  (fail → { added: 0, skipped: rows.length })
       for each row:
         buildQuickAddProductDraft(row, prefs, actor)
           fail → skipped++
           ok    → drafts[]
       commitNewProducts(drafts)
         plan cap (accept prefix of drafts)
         set products (reversed prepend)
         fillDefaultShelfLayout from distinct categories
         opening_stock movements for stockOnHand > 0
         queueRemote("product") per accepted row
         audit product_add per row + one bulk summary audit
         flushPendingPersist()
  → { added, skipped }
```

**There is no file parsing step in this pipeline.** Input is already structured.

### Store input type (`bulkQuickAddProducts` rows)

From `usePosStore.ts`:

- **Required for a successful draft:** `name` (non-empty), `priceUgx` > 0  
- Always passed by callers: `stockQty`, `category`  
- Optional: `inferName`, `sellingMode`, `baseUnit`, `buyingUnit`, `conversionRate`, `costPricePerUnitUgx`, `buyingPackCostUgx`, pharmacy fields, `primaryBarcode`, presets  

**Not on the bulk row type:** `openingBatch` (pharmacy opening batch exists on `quickAddProduct` / `QuickAddProductDraftInput` only). Bulk cannot currently attach an opening batch in one call.

### `quickAddProduct`

Same draft + `commitNewProducts([one])`. Returns `{ ok, errorKey? }` instead of counts. Used by the retail/pharmacy wizards and onboarding single starter taps.

### `buildQuickAddProductDraft` (validation + defaults)

Private. Not imported by tests or CSV code.

Rejects:

- empty name → `invalid`
- `priceUgx` ≤ 0 → `invalid`
- pharmacy mode and stock ≤ 0 → `pharmacyOpeningStockRequired`
- pharmacy mode and missing/≤0 explicit cost → `pharmacyBuyPriceRequired`

Accepts retail stock `0`.

Defaults when omitted:

- `sellingMode` / `baseUnit` / pack guess from `inferProductGuess` unless the row supplies them
- cost: explicit cost **or** `min(price, floor(price * 0.72))`
- `sku`: `primaryBarcode` or `SKU-{Date.now()}-{uuid8}`
- `minimumStockAlert`: 5 / 3 / 1 by selling mode
- `category`: caller string (bulk falls back to **first row’s category** or `"General"`)

### `commitNewProducts`

- `validateCanAddProduct` per draft against current count + already accepted (plan SKU cap)
- If none fit: `{ ok: false, errorKey: planProductLimit, added: 0 }`
- If some fit: accepts a **prefix**, remainder counted as skipped by the bulk wrapper
- Opening movements: `openingStockMovementFromProduct` — **null when stock ≤ 0**
- One Zustand `set` for the whole batch (Phase 36.1: one catalog revision)

---

## B. Existing AI pipeline

Two live AI features produce product **lists**. Neither writes SQL directly.

### B1. Inventory assistant (Stock → Import)

```
User (products.add + useAiFeatureGate("inventory_assistant"))
  → BulkInventoryAiModal
  → shop description textarea (prefilled: "{shopName} — {businessType}")
  → generateBulkInventoryWithAi
       invokeSupabaseEdgeFunction("ai-bulk-inventory")
         Auth JWT
         assertAiFeatureAllowed(FEATURE = "inventory_assistant")
         DeepSeek JSON (BULK_INVENTORY_SYSTEM_PROMPT)
         parseAiBulkInventory  (max 100 names; Edge requires ≥ 5 or throws)
  → BulkInventoryPreviewRow[]
       enabled: true
       priceUgx: suggestedPriceUgx
       stockQty: 0          ← AI schema has NO stock field
  → Human review table (name, category, price, stock, checkbox)
  → optional shared folder (hierarchy ON only): applySharedCategoryToRows
  → mapBulkRowsToQuickAdd
       drop disabled, empty name, priceUgx ≤ 0
       map: name, priceUgx, stockQty, category, inferName, sellingMode, baseUnit
       DOES NOT map: cost, pack, barcode, pharmacy
  → slice(0, productSlotsLeft)
  → bulkQuickAddProducts(payload)
```

**AI JSON schema (actual):** `name`, `category`, `unit`, `sellingMode`, `suggestedPriceUgx`.  
No cost, no quantity, no barcode, no pack, no SKU.

Prompt: 50–80 Uganda products, no duplicate **names** in the model output. Client does **not** enforce unique names on import.

### B2. Business setup assistant (onboarding)

```
parseAiBusinessSetup
  → AiStarterProductRow (includes suggestedStockQty, default 10 if missing)
  → addAiStarterProducts
       bulkQuickAddProducts({ name, price, stockQty, category, sellingMode, baseUnit })
```

Still no cost → **72% default**. Stock **is** passed (unlike inventory assistant’s initial `stockQty: 0`).

### B3. Single-product AI (not bulk)

`product_assistant` prefills `SimpleAddProductWizard` via `mapAiSuggestionToWizardPrefill`. That path is wizard `quickAddProduct`, not `bulkQuickAddProducts`.

---

## C. Reusable components

Safe to reuse for CSV and paper OCR **if** they feed the same commit API.

| Component | Reuse for CSV? | Reuse for OCR/AI extract? | Notes |
|-----------|----------------|---------------------------|--------|
| `bulkQuickAddProducts` | **Yes — required** | **Yes — required** | Only supported multi-create that applies plan cap, opening stock, sync, audit |
| `quickAddProduct` | Possible for 1 row | Same | Prefer bulk for many rows (one persist) |
| `buildQuickAddProductDraft` / `commitNewProducts` | Indirectly only | Indirectly only | **Not exported.** Do not duplicate; call store methods |
| `parseAiBulkInventory` / `parseAiBusinessSetup` | **No** (AI JSON, not CSV/OCR) | Partial: extraction output could be coerced into the same row shape | Caps, unit/price clamps are useful patterns |
| `mapBulkRowsToQuickAdd` | Pattern only | Pattern only | Drops invalid rows; too narrow (no cost/pack) for a full importer |
| `BulkInventoryAiModal` review table | **UX pattern** | **UX pattern** | Not a generic importer; hardcoded generate-from-description |
| `applySharedCategoryToRows` | Yes | Yes | Overwrites `category` strings; does not create `posCatalogNodes` |
| `ShelfDestinationPicker` / `HierarchyShelfPicker` | Yes (review UI) | Yes | Folder create still needs `shelves.customize` |
| `openingStockMovementFromProduct` | Via commit only | Via commit only | |
| `productCatalogExport` CSV | Inverse of import | No | Column names could inform a future CSV **template**, not an importer |
| `WakaMlkitOcr` / `ocr` feature | No | Future scan source only | Not wired to product create |

**Do not reuse** a new path that upserts `public.products` or skips `products.add`.

---

## D. Required fields — bulk vs wizard

Retail wizard (`SimpleAddProductWizard` → `buildProductFromSimpleWizard` → `quickAddProduct`):

| Field | Wizard | `bulkQuickAddProducts` / AI mapper |
|-------|--------|-------------------------------------|
| Name | Required | Required (else skip) |
| Sell price > 0 | Required | Required (AI mapper drops 0; draft rejects ≤ 0) |
| Shelf/folder | Required if any shelves exist | **Not required.** Empty → first row category or `"General"` |
| Sell unit | Required step (default piece) | Optional; else name guess / `"ea"` |
| Pack / pieces per pack | Wizard steps | Optional on store type; **AI does not send** |
| Opening qty | Optional (0 OK) | Optional; **AI inventory starts at 0** |
| Buy/cost | Optional (72% if omitted) | Same default; **AI does not send cost** |
| SKU/barcode | Auto | Auto unless `primaryBarcode` |
| Audit reason | Edit only | N/A on create |

Pharmacy wizard extra required fields (stock, cost, batch, expiry) are **not** in the AI bulk mapper. Starter pack **does** pass pharmacy cost/expiry when `pharmacyMode`. Bulk API can take pharmacy master/packaging but **not** `openingBatch`.

**Implication:** today’s AI bulk is a **subset** of wizard create (name + price + loose category + unit). A paper/CSV importer that only uses `mapBulkRowsToQuickAdd` would also omit cost and pack.

---

## E. Opening stock

`commitNewProducts` uses the **same** helper as single create:

```
openingStockMovementFromProduct(shopKey, product, product.updatedAt)
```

- `stockOnHand > 0` → local `StockMovement` `kind: "opening_stock"`, `deltaBaseUnits = stock`, `refId = product.id`
- `stockOnHand === 0` → **no** movement

Verified in catalog-destination tests via `quickAddProduct` (not a dedicated bulk movement test). Bulk uses the same `commitNewProducts`, so behavior matches **if** `stockQty > 0` is on the row.

**AI inventory assistant:** generated rows have `stockQty: 0` until the user edits the review table. Default import therefore **usually creates products with zero opening stock and zero opening movements**.

**Starter pack / onboarding AI:** typically pass non-zero `stockQty` → opening movements **do** fire.

Shop is implicit (`inventoryMovementNamespace()`), same as the wizard. Not a purchase. Not `public.inventory_movements`.

---

## F. Cost (including ~72% default)

Identical formula in `buildQuickAddProductDraft`:

```
cost = explicit costPricePerUnitUgx
     ?? min(price, max(0, floor(price * 0.72)))
```

Same as wizard path when buy price is omitted (`defaultWizardUnitCostUgx` in `simpleProductWizard.ts` is the same 72% rule for **edits** that drop pack cost).

| Caller | Passes cost? | Result |
|--------|----------------|--------|
| Retail wizard | If user entered buy price | Pack÷pieces or unit cost; else 72% |
| AI bulk (`mapBulkRowsToQuickAdd`) | **No** | **Always 72%** |
| Onboarding AI starters | **No** | **Always 72%** |
| Stock starter pack | Pharmacy: `defaultCostUgx`; retail: often omitted | Pharmacy explicit; retail 72% |
| Future CSV/OCR | Must pass `costPricePerUnitUgx` / pack cost if the sheet has it | Otherwise 72% |

Pharmacy bulk rows **without** cost are skipped (`pharmacyBuyPriceRequired`), not defaulted to 72%.

---

## G. Category / shelf / hierarchy

Bulk writes `Product.category` as a **string** (legacy shelf key), same as the wizard.

After commit, `preferencesWithDefaultShelfLayout` / `fillDefaultShelfLayout` adds missing category strings to `posShelfLayout` so Sell/Stock shelves appear. It does **not** insert `posCatalogNodes` folder records.

AI review:

- Per-row category is a **text input**, not `HierarchyShelfPicker`
- If `catalogHierarchyEnabled`, a **shared** `ShelfDestinationPicker` can stamp all rows via `applySharedCategoryToRows`
- Creating a new folder in that picker uses existing `createCatalogShelf` (permission `shelves.customize`)
- Hierarchy **off:** no shared picker; categories stay as AI/user-typed strings

Empty category on a bulk row: `row.category || cat` where `cat = rows[0]?.category ?? "General"`.

Wizard blocks Next if shelves exist and none selected. **Bulk does not.** A CSV row with a blank section still commits (General / first-row category).

`public.product_categories` / `category_id` still unused.

---

## H. Validation already available (reuse)

Must stay in front of any importer:

1. **Draft:** name, price > 0, pharmacy stock/cost rules, cost normalize, SKU generate  
2. **Plan:** `validateCanAddProduct` inside `commitNewProducts`  
3. **Auth:** `products.add`  
4. **AI pre-filter (optional pattern):** `mapBulkRowsToQuickAdd` enabled + name + price > 0  
5. **AI parse clamps:** unit aliases, price/stock floors, max 100 bulk rows / 60 starters  
6. **Slot cap in UI:** `BulkInventoryAiModal` slices to `productSlotsLeft` **before** commit (store also caps)

**Not validated today (gaps for CSV/OCR):**

- Duplicate **name** (AI prompt asks the model not to duplicate; client does not check)
- Duplicate **SKU/barcode** (cloud unique `(shop_id, sku)` only)
- Folder must exist in hierarchy (unknown strings still save as `category`)
- Pack/cost consistency (wizard `CostValidationPreview` is display-only and not on bulk)
- Per-row error messages: bulk only returns `{ added, skipped }` — **no errorKey per row**

---

## I. Security / authorization

**Create (all bulk callers):** `products.add`  
Roles (default matrix): owner, manager, supervisor, stock_keeper. Not cashier.

Denied: `{ added: 0, skipped: rows.length }` plus store `auth_forbidden` audit. Action name logged as `quickAddProduct`.

**AI generate (not commit):** additional `inventory_assistant` / `business_setup_assistant` gates (`useAiFeatureGate`, Edge `assertAiFeatureAllowed`, JWT). CSV/OCR should **not** require those AI gates if they only call `bulkQuickAddProducts`.

**Folder create during review:** `shelves.customize` + preference persist.

**Plan product limit:** enforced in commit even if UI slice is wrong.

**Do not** use service role to insert products from an importer.

---

## J. Recommendation (do not implement)

**Choose 3: a shared normalized import layer that feeds `bulkQuickAddProducts`.**

Do **not** (1) bolt CSV/OCR onto `BulkInventoryAiModal` as the core pipeline — that modal is generate-from-shop-description plus a thin review table.  
Do **not** (2) add a second commit path (direct SQL, `addProduct` loop without `commitNewProducts`, or skipping draft validation).

Recommended future shape (matches the requested architecture):

```
CSV/Excel parser          Paper image → OCR/AI
        \                    /
         v                  v
    Normalized Product Rows   (one TypeScript type, superset of bulkQuickAddProducts row
                               + optional cost, pack, barcode, stock)
         v
    Validation + Review       (reuse draft rules; show per-row errors;
                               optional ShelfDestinationPicker / applySharedCategoryToRows)
         v
    bulkQuickAddProducts(rows)
         v
    buildQuickAddProductDraft → commitNewProducts
         (opening_stock, 72% cost if omitted, plan cap, products.add, sync)
```

Optional: export `buildQuickAddProductDraft` later for **preview-without-commit**. Today preview would have to duplicate rules or dry-run is impossible without adding products.

AI bulk list can remain one **source** that emits the same normalized rows (today it emits a poorer subset).

---

## 2. Existing bulk UI

| UI | Entry | Commit |
|----|--------|--------|
| `BulkInventoryAiModal` | Stock toolbar Import when `inventory_assistant` + `products.add` | `handleBulkAiImport` → `bulkQuickAddProducts` |
| Stock starter pack `ModalSheet` | Empty-state starter | `applyStarter` → `bulkQuickAddProducts` |
| Shop onboarding AI starters | Builder | `addAiStarterProducts` → `bulkQuickAddProducts` |
| Shop onboarding canned line | Per-item tap | `quickAddProduct` (not bulk) |
| Duplicate sheet | `QuickAddProductFields` | `quickAddProduct` |

No file picker. No paste-spreadsheet UI in Stock (OCR paste strings are unused).

---

## 3. Existing tests

| File | What it covers | Gaps |
|------|----------------|------|
| `src/lib/bulkQuickAddProducts.test.ts` | 25-row commit, reverse order, unique SKUs, added/skipped 0 | No permission deny, plan cap, skip-invalid, cost 72%, opening_stock, pharmacy |
| `src/lib/ai/aiBusinessSchemas.test.ts` | parse setup, parse bulk, `mapBulkRowsToQuickAdd` filters | No Edge/DeepSeek, no store commit |
| `src/lib/catalogHierarchy.test.ts` | `applySharedCategoryToRows` | |
| `src/lib/addProductCatalogDestination.test.ts` | `quickAddProduct` opening_stock; category change ≠ movement | Not `bulkQuickAddProducts` |
| `src/lib/productionClosure.test.ts` | `openingStockMovementFromProduct` helper | Not store bulk |
| `src/lib/ai/aiFreeze1.test.ts` | `inventory_assistant` live; `ocr` not live | |

**No test** asserts bulk + `stockQty > 0` ⇒ `opening_stock` count, or bulk omitted cost ⇒ 72%. Those follow from shared `commitNewProducts` / draft, but are unverified on the bulk wrapper.

---

## 4. Error handling (bulk vs wizard)

| Event | Wizard | Bulk API | AI modal |
|-------|--------|----------|----------|
| Invalid row | Stay open, `saveError` | Row skipped; no message | Pre-filter; “need prices” if none importable |
| Permission | Save false | `{ added: 0, skipped: n }` | Button gated by `canAdd` |
| Plan cap | Add disabled / save false | Partial add + extra skipped | Slice then commit |
| Network | Local success | Local success | Generate fails with AI error; import still local |
| Duplicate name | Allowed | Allowed | Allowed |

---

## 5. Duplicate handling

- **Names:** allowed. AI prompt says “No duplicate names”; client does not check existing catalog or within the batch.
- **SKUs:** each draft gets a new `SKU-…-uuid`. Collision with existing catalog is unlikely; not checked.
- **Barcodes:** only if `primaryBarcode` set; uniqueness not checked client-side.

A CSV/OCR importer that uses user barcodes **must** add a review-time uniqueness check; the bulk API will not.

---

## 6. Risks if a new importer bypasses this pipeline

- Missing opening_stock  
- Missing 72% vs explicit cost  
- Missing plan cap / `products.add`  
- Category not filling shelf layout  
- Pharmacy without required cost/stock  
- No sync queue  

---

## FINAL CHECKLIST

| Question | Answer |
|----------|--------|
| CSV import exists? | **No** |
| Reusable commit? | **`bulkQuickAddProducts` → draft → `commitNewProducts`** |
| AI reaches WAKA how? | Edge JSON → parse → review → `mapBulkRowsToQuickAdd` → `bulkQuickAddProducts` |
| Opening stock on bulk? | **Yes, same helper, only if `stockQty > 0`.** AI bulk defaults stock to 0 |
| Cost 72% on bulk? | **Yes, when cost omitted.** AI bulk always omits cost |
| Category? | String `Product.category`; layout filled; folders not auto-created |
| Recommendation | **Shared normalized rows + review → existing `bulkQuickAddProducts`.** Do not create a parallel create engine |

### Files inspected

- `src/store/usePosStore.ts` (`QuickAddProductDraftInput`, `buildQuickAddProductDraft`, `commitNewProducts`, `quickAddProduct`, `bulkQuickAddProducts`)
- `src/lib/ai/aiBusinessSchemas.ts` / `supabase/functions/_shared/aiBusinessSchemas.ts`
- `src/lib/ai/bulkInventoryAi.ts`
- `src/components/stock/BulkInventoryAiModal.tsx`
- `src/pages/StockPage.tsx` (starter + AI import)
- `src/pages/ShopOnboardingPage.tsx`
- `supabase/functions/ai-bulk-inventory/index.ts`
- `supabase/functions/_shared/deepseekClient.ts`
- `src/lib/catalogHierarchy.ts` (`applySharedCategoryToRows`)
- `src/lib/inventoryIntegrity.ts` (`openingStockMovementFromProduct`)
- `src/lib/bulkQuickAddProducts.test.ts`
- `src/lib/ai/aiBusinessSchemas.test.ts`
- `src/lib/ai/aiFeatures.ts`
- `src/lib/permissions.ts` / `src/lib/storeAuthorization.ts`
- `src/features/inventory/export/productCatalogExport.ts` (export only)
