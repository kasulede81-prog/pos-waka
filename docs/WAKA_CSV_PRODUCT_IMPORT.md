# WAKA POS — CSV Product Import

**Phase:** 2 — CSV adapter into the normalized import foundation  
**Date:** 2026-08-29  
**Save path (mandatory):** `parseProductImportCsv` → `ProductImportReviewSheet` → `commitNormalizedProductImport` → `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`

CSV never writes `public.products` itself. Permission remains `products.add`.

---

## Who this is for

- Shopkeepers who already have a product list in a spreadsheet
- WAKA field staff using the **WAKA Product Import Template** on a phone or laptop while onboarding a shop

Paper / photo / OCR is **not** in this phase. That adapter will emit the same `NormalizedProductImportRow[]` later.

---

## Template

Download from Stock → **Import CSV** → **Download WAKA Product Import Template**.

Filename: `waka-product-import-template.csv`

Official columns (user-facing WAKA terms — not database names):

| Column | Normalized field | Required? |
|--------|------------------|-----------|
| Product name | `name` | Yes |
| Section | `categoryInput` | When the shop already has folders |
| Unit | `baseUnit` (default `piece`) | No |
| Pack size | `conversionRate` (units per pack) | No |
| Opening quantity | `stockQty` | No (empty = 0) |
| Cost price | `costPricePerUnitUgx` | No |
| Selling price | `sellingPriceUgx` | Yes, > 0 UGX |

Optional extra column (not in the downloaded template): **Pack** → pack label (`buyingUnit`).

Never required / ignored if present: `product_id`, `category_id`, `metadata`, `SKU`, `tax_rate`, barcode.

---

## Example

```csv
Product name,Section,Unit,Pack size,Opening quantity,Cost price,Selling price
Sugar 1kg,Groceries,kg,,10,2800,3500
Soda,Drinks,bottle,24,48,,1500
"Cooking oil, 1L",Groceries,bottle,,6,4200,5500
```

- Sugar: cost provided, opening stock 10
- Soda: cost blank → review warns **Cost missing — ~72% fallback**; pack size 24
- Cooking oil: quoted name with a comma

---

## Cost

| CSV | Parser | Review | Draft |
|-----|--------|--------|-------|
| Number present | Passed through | “Cost provided” | Stored as given |
| Blank | `null` (missing) — **not** invented | “Cost missing — ~72% fallback” | Existing `defaultWizardUnitCostUgx` (~72% of sell) |
| Invalid text | Row kept; blocking `invalid_cost` | Must fix or uncheck | Bulk not called for that enabled row |

Do not pass `0` to mean missing. Explicit `0` is a real zero cost.

---

## Opening stock

Opening quantity maps to `stockQty` → `Product.stockOnHand`.

`commitNewProducts` still emits a local `opening_stock` movement only when qty > 0. No new movement kind. No direct inventory-table writes.

---

## Section / folder

Uses `resolveCatalogSectionInput` (same as Phase 1):

- Unique key / path / leaf → resolve
- Same leaf, two folders → blocking ambiguous
- Empty section while destinations exist → must choose
- Unknown string → warning; saved as a new section name (current bulk behavior)

Never auto-pick between two folders with the same leaf name.

---

## Duplicates

Identical product names in the same file are a **blocking** review error (`duplicate_name`). Rows are not merged. The operator unchecks or renames before import.

Names that already exist in the catalog are a **warning** (`duplicate_existing`).

---

## Validation

Shared with every import source: `evaluateNormalizedProductRows`. There is no weaker CSV-only validator.

Blocking errors prevent `bulkQuickAddProducts`. Warnings can be confirmed (including the cost fallback dialog).

---

## Review

Every parsed row opens **`ProductImportReviewSheet`** (not a second CSV table).

Before confirm the sheet shows:

- Products detected
- Ready to import
- Warnings
- Errors

Row-level issues include the CSV row number when known.

---

## Import limits

| Limit | Value |
|-------|-------|
| Max products per file | 500 |
| Max file size | 256 KB |

These are shown in the Import CSV sheet. Split larger lists. Excel `.xlsx` is rejected — save as CSV.

---

## Permissions

Same as Add product: **`products.add`**. Cashiers cannot import. Shop A cannot import into shop B; create still goes through the signed-in shop store + existing RLS on sync.

---

## Errors

The file picker names the problem instead of “Import failed”:

- Missing required column
- Unclosed quote (with row)
- Invalid selling price / quantity / cost / pack size (with row)
- Empty file / no data rows
- Too many rows / file too large
- Excel workbook uploaded

After a successful parse, remaining problems are the shared review issues (name, price, ambiguous folder, duplicates, …).

---

## Success

After `bulkQuickAddProducts` returns:

- Successfully imported: X
- Failed: Y (plan cap or drafts the engine skipped)

Success is not shown until the existing create engine reports `added`.

---

## Code map

| Step | Module |
|------|--------|
| Template | `src/lib/productImport/csvTemplate.ts` |
| RFC CSV split | `src/lib/productImport/parseCsvText.ts` |
| Adapter | `src/lib/productImport/parseProductImportCsv.ts` |
| Stock entry | `ProductCsvImportSheet` → `ProductImportReviewSheet` |
| Commit | `commitNormalizedProductImport` |

AI bulk inventory is unchanged and still has its own preview modal.
