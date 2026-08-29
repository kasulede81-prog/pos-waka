# WAKA POS — CSV Product Import

**Phase:** 2 — Two wizard-parity templates  
**Date:** 2026-08-29  
**Parity detail:** `docs/WAKA_CSV_WIZARD_PARITY.md`  
**Save path (mandatory):** `parseProductImportCsv` → `ProductImportReviewSheet` → `commitNormalizedProductImport` → `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`

CSV never writes `public.products` itself. Permission remains `products.add`.

---

## Who this is for

- Shopkeepers with a product list in a spreadsheet
- Field staff onboarding a shop with the official WAKA templates

Paper / photo / OCR is **not** in this phase.

---

## Which template?

| Template | When to use | Download name |
|----------|-------------|---------------|
| **No Packs** | Stocked and bought individually (wizard pack OFF) | `WAKA Product Import — No Packs.csv` |
| **With Packs** | Bought in packs/crates/boxes, sold by unit (wizard pack ON) | `WAKA Product Import — With Packs.csv` |

Stock → **Import CSV** explains this briefly and offers both downloads.

Templates are identified by **exact header columns**, not by filename.

---

## Template A — No Packs

```csv
Product name,Section,Unit,Opening quantity,Cost price,Selling price
Sugar 1kg,Groceries,kg,10,2800,3500
Soap,Household,piece,1,,2000
"Cooking oil, 1L",Groceries,bottle,6,4200,5500
```

| Column | Meaning |
|--------|---------|
| Opening quantity | Sell units on hand |
| Cost price | Cost per sell unit (blank → ~72% fallback) |
| Selling price | Per sell unit |

Do not include Pack / Pack size / Opening packs / Cost per pack.

---

## Template B — With Packs

```csv
Product name,Section,Unit,Pack,Pack size,Opening packs,Cost per pack,Selling price
Coca Cola 500ml,Drinks,Piece,Crate,24,48,18000,2000
Soda,Drinks,bottle,crate,24,2,,1500
```

| Column | Meaning |
|--------|---------|
| Pack | Pack label (crate, carton, …) → `buyingUnit` |
| Pack size | Sell units inside one pack (> 1) |
| Opening packs | Number of packs on hand → `stockOnHand = packs × size` |
| Cost per pack | Invoice for one pack → unit cost = pack ÷ size |
| Selling price | Per sell unit |

Coca Cola row → `stockOnHand = 1152`, unit cost `750`, pack cost `18000`.

---

## Cost

| Case | Review | Draft |
|------|--------|-------|
| Number present | Cost provided | Stored (unit cost; pack template also stores pack cost) |
| Blank | Cost missing — ~72% fallback | `defaultWizardUnitCostUgx` |
| Invalid | Blocking | Must fix or uncheck |

Explicit `0` is a real zero cost, not missing.

---

## Opening stock

- **No Packs:** Opening quantity → `stockQty` → `stockOnHand`
- **With Packs:** Opening packs × Pack size → `stockQty` → `stockOnHand`

`commitNewProducts` still emits local `opening_stock` only when qty > 0. No new movement kind.

---

## Section / folder

Uses `resolveCatalogSectionInput` (unchanged):

- Unique key / path / leaf → resolve  
- Same leaf, two folders → blocking ambiguous  
- Empty while destinations exist → must choose  
- Unknown string → warning; saved as new section name  

---

## Duplicates

Identical names in the same file → blocking (`duplicate_name`). Not merged.  
Names already in catalog → warning (`duplicate_existing`).

---

## Legacy template

The old single file with columns:

`Product name, Section, Unit, Pack size, Opening quantity, Cost price, Selling price`

is **rejected**. It mixed pack size with “opening quantity” that meant sell units, which does not match the wizard for packed products. Download Template A or B and re-save.

---

## Validation & review

Shared: `evaluateNormalizedProductRows`. Blocking errors prevent `bulkQuickAddProducts`.  
Every parse opens **`ProductImportReviewSheet`** (one review UI). Packed rows show pack fields and derived sell-unit stock/cost.

---

## Import limits

| Limit | Value |
|-------|-------|
| Max products per file | 500 |
| Max file size | 256 KB |

Excel `.xlsx` is rejected — save as CSV.

---

## Permissions

Same as Add product: **`products.add`**.

---

## Code map

| Step | Module |
|------|--------|
| Headers / detect | `src/lib/productImport/csvColumns.ts` |
| Templates | `src/lib/productImport/csvTemplate.ts` |
| Pack math | `src/lib/productImport/packImportSemantics.ts` |
| Adapter | `src/lib/productImport/parseProductImportCsv.ts` |
| Stock entry | `ProductCsvImportSheet` → `ProductImportReviewSheet` |
| Commit | `commitNormalizedProductImport` |

AI bulk inventory is unchanged.
