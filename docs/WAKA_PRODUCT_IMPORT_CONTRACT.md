# WAKA POS — Product Import Contract

**Phase:** 2 — Normalized rows + review + two templates (CSV or Excel; no OCR)  
**Date:** 2026-09-11  
**Save path (mandatory):** `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`  
**CSV / Excel detail:** `docs/WAKA_CSV_PRODUCT_IMPORT.md` · **Wizard parity:** `docs/WAKA_CSV_WIZARD_PARITY.md`

This contract is the only allowed way for CSV, Excel, and future paper/OCR adapters to create products.

---

## Normalized row shape

Type: `NormalizedProductImportRow` (`src/lib/productImport/types.ts`)

| Field | WAKA destination | Required? | Notes |
|-------|------------------|-----------|--------|
| `clientId` | Review only | Yes | Not stored on `Product` |
| `source` | Review / debug only | Yes | `manual` \| `ai` \| `csv` \| `excel` \| `paper_ocr` |
| `enabled` | Skipped if false | Yes | Review checkbox |
| `name` | `Product.name` | Yes | Same as wizard / draft |
| `categoryInput` | Resolution input | Yes to type | Leaf name, path, or `legacyShelfKey` |
| `category` | `Product.category` | After resolve | Catalog `legacyShelfKey`, not folder path |
| `baseUnit` | `Product.baseUnit` | Default `piece` | Sell unit |
| `sellingMode` | `Product.sellingMode` | Optional | Else name guess in draft |
| `packMode` | Import / review only | Yes | `"none"` (Template A) or `"packed"` (Template B). Default `"none"` for non-CSV |
| `buyingUnit` | `Product.buyingUnit` | Required if packed | Pack label |
| `conversionRate` | `Product.conversionRate` | Required > 1 if packed | Pack size (sell units per pack) |
| `openingPacks` | Derives `stockQty` | Packed template | Wizard “how many packs”; not stored on Product |
| `stockQty` | `Product.stockOnHand` | Default 0 | **Always sell units** (after packs × size when packed) |
| `sellingPriceUgx` | `Product.sellingPricePerUnitUgx` | Yes, > 0 | Integer UGX per sell unit |
| `costPricePerUnitUgx` | `Product.costPricePerUnitUgx` | Optional | Per sell unit. `null`/omit = missing (72% fallback). For packed + pack cost, derived via `unitCostFromPackTotal` |
| `buyingPackCostUgx` | `Product.buyingPackCostUgx` | Optional | Pack invoice total (Template B / wizard pack buy) |
| `sourceRowNumber` | Review only | Optional | 1-based CSV record (header = 1) |

Not on the row: SKU, id, tax, image, supplier, `openingBatch` (pharmacy wizard-only).

---

## Required vs optional

**Blocking:**

- Non-empty name  
- Selling price > 0  
- Non-negative opening quantity / opening packs  
- Packed: pack size > 1, non-empty pack label  
- No-pack rows must not carry `conversionRate > 1`  
- Non-negative cost if provided  
- Section required when catalog destinations exist  
- Ambiguous folder leaf  
- Duplicate names in this batch  
- Pharmacy: opening stock > 0 and explicit cost > 0  

**Warnings:**

- Cost missing on CSV / manual / AI → ~72% fallback (`cost_fallback`)
- Cost missing on Excel → blocking (`missing_cost_required`; no invented cost)   
- Unresolved section  
- Duplicate of existing catalog name  
- Unit cost > selling price  

---

## Validation

`evaluateNormalizedProductRows` mirrors draft rules. Commit refused while any **enabled** row has severity `error`.

`mapNormalizedRowsToBulkQuickAdd`:

- Omits `costPricePerUnitUgx` when cost missing → draft 72% fallback  
- Packed: passes `buyingUnit`, `conversionRate`, `buyingPackCostUgx`, derived unit cost  
- No-pack: never passes pack fields  

Pack sell-unit / cost derivation: `packImportSemantics.ts` (same math as `buildProductFromSimpleWizard`).

---

## Category / folder resolution

`resolveCatalogSectionInput` — unchanged (see prior contract). Never auto-pick an ambiguous leaf.

---

## Cost behavior

| Review | Draft |
|--------|--------|
| Cost provided (unit, or pack-derived unit) | Passed through |
| Cost / cost-per-pack missing (CSV / manual / AI) | Warning + 72% fallback via draft |
| Cost / cost-per-pack missing (Excel) | Blocking — operator must enter a buying price |

Do not pass `0` to mean missing. Do not put pack totals into `costPricePerUnitUgx` without deriving unit cost.

---

## Opening stock

`stockQty` (sell units) → `bulkQuickAddProducts[].stockQty` → `Product.stockOnHand`.

Packed CSV: `stockQty = openingPacks × conversionRate` before map/commit.

`commitNewProducts` emits local `opening_stock` only when stock > 0.

---

## Final save path

```
NormalizedProductImportRow[]
  → ProductImportReviewSheet
  → commitNormalizedProductImport
       evaluateNormalizedProductRows
       mapNormalizedRowsToBulkQuickAdd
       bulkQuickAddProducts(payload)
         buildQuickAddProductDraft
         commitNewProducts
```

No `public.products` writes. Permission `products.add` inside `bulkQuickAddProducts`.

---

## CSV / Excel adapter

Excel is an adapter, not a second importer. The first worksheet is projected to CSV text, then the shared parser runs with `source: "excel"`.

```
.csv bytes
  → detectCsvImportTemplate (header sets)
  → parseProductImportCsv (source: "csv", packMode set)
  → ProductImportReviewSheet
  → commitNormalizedProductImport({ bulkQuickAddProducts })

.xlsx / .xlsm / .xls / .ods bytes
  → parseProductImportWorkbook (first sheet → CSV text)
  → parseProductImportCsv (source: "excel", packMode set)
  → same review + commit
```

| Template | Headers |
|----------|---------|
| No Packs | Product name, Section, Unit, Opening quantity, Cost price, Selling price |
| With Packs | Product name, Section, Unit, Pack, Pack size, Opening packs, Cost per pack, Selling price |

Legacy mixed 7-column header → reject (not wizard-parity for packs).

Limits: 500 rows. CSV max 256 KB. Excel workbook max 5 MB.

Stock entry: **Import CSV / Excel** → two template downloads + file picker (`.csv` or workbook) → shared review.

Existing AI bulk modal is **unchanged**. Add Product wizard is **unchanged**.

---

## Extension points (do not implement here)

**Paper / OCR** → same `NormalizedProductImportRow[]` → same review → same commit. Do not add a second product creation engine.
