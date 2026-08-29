# WAKA POS — Product Import Contract

**Phase:** 2 — Normalized rows + review + CSV adapter (no OCR)  
**Date:** 2026-08-29  
**Save path (mandatory):** `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`

This contract is the only allowed way for CSV and future paper/OCR adapters to create products. CSV details: `docs/WAKA_CSV_PRODUCT_IMPORT.md`.

---

## Normalized row shape

Type: `NormalizedProductImportRow` (`src/lib/productImport/types.ts`)

| Field | WAKA destination | Required? | Notes |
|-------|------------------|-----------|--------|
| `clientId` | Review only | Yes | Not stored on `Product` |
| `source` | Review / debug only | Yes | `manual` \| `ai` \| `csv` \| `paper_ocr`. Does not change pricing, stock, or permissions |
| `enabled` | Skipped if false | Yes | Review checkbox |
| `name` | `Product.name` | Yes | Same as wizard / draft |
| `categoryInput` | Resolution input | Yes to type | Leaf name, path, or `legacyShelfKey` |
| `category` | `Product.category` | After resolve | Catalog `legacyShelfKey`, not folder path |
| `baseUnit` | `Product.baseUnit` | Default `piece` | Sell unit |
| `sellingMode` | `Product.sellingMode` | Optional | Else name guess in draft |
| `buyingUnit` | `Product.buyingUnit` | Optional | Pack label |
| `conversionRate` | `Product.conversionRate` | Optional | Pack size (units per pack), must be > 0 if set |
| `stockQty` | `Product.stockOnHand` | Default 0 | Opening qty in sell units |
| `sellingPriceUgx` | `Product.sellingPricePerUnitUgx` | Yes, > 0 | Integer UGX |
| `costPricePerUnitUgx` | `Product.costPricePerUnitUgx` | Optional | `null`/omit = **missing** (72% fallback). `0` is explicit zero |
| `buyingPackCostUgx` | `Product.buyingPackCostUgx` | Optional | Pack invoice total |
| `sourceRowNumber` | Review only | Optional | 1-based CSV record (header = 1). Not stored on `Product` |

Not on the row (WAKA generates or ignores on create): SKU, id, tax, image, supplier, `openingBatch` (pharmacy wizard-only; bulk API does not take it).

---

## Required vs optional

**Blocking (must fix or uncheck before import):**

- Non-empty name  
- Selling price > 0  
- Non-negative opening quantity  
- Pack size > 0 if provided  
- Non-negative cost if provided  
- Section required when catalog picker destinations exist (same idea as wizard Next)  
- Ambiguous folder leaf (multiple `legacyShelfKey`s)  
- Duplicate names in this batch  
- Pharmacy mode: opening stock > 0 and explicit cost > 0  

**Warnings (import still allowed after confirm):**

- Cost missing → existing ~72% fallback (`cost_fallback`)  
- Unresolved section string (new shelf name)  
- Duplicate of an existing catalog product name  
- Cost > selling price  

---

## Validation

`evaluateNormalizedProductRows` mirrors `buildQuickAddProductDraft` rules (name, price, pharmacy stock/cost, pack numeric). It does **not** insert products.

Commit is refused while any **enabled** row has severity `error`.

Then `mapNormalizedRowsToBulkQuickAdd` omits `costPricePerUnitUgx` when cost is missing so the draft applies `defaultWizardUnitCostUgx` (same 72% as `quickAddProduct`).

---

## Category / folder resolution

`resolveCatalogSectionInput` (`catalogHierarchy.ts`):

| Input | Result |
|-------|--------|
| Empty, destinations exist | `missing_category` (block) |
| Empty, no destinations | Maps to General |
| Unique `legacyShelfKey`, unique path, or unique leaf | `resolved` → that key |
| Same leaf name, two+ different keys | `ambiguous` (block) — operator must type the path or exact key |
| No match | `unresolved` — typed string saved as `Product.category` (current bulk behavior), warning only |

Never pick an arbitrary match when the leaf is ambiguous.

---

## Cost behavior

| Review | Draft |
|--------|--------|
| Cost provided | Passed through; `importCostProvidedHint` |
| Cost missing | Warning + placeholder showing `defaultWizardUnitCostUgx(sell)`. Confirm dialog if any selected row is missing cost. Field omitted on bulk payload → **unchanged** 72% fallback |

Do not pass `0` to mean missing.

---

## Opening stock

`stockQty` maps to `bulkQuickAddProducts[].stockQty` → `Product.stockOnHand`.

`commitNewProducts` still emits local `opening_stock` movements only when stock > 0. No new movement kind.

---

## Final save path

```
NormalizedProductImportRow[]
  → ProductImportReviewSheet (operator)
  → commitNormalizedProductImport
       evaluateNormalizedProductRows (block errors)
       mapNormalizedRowsToBulkQuickAdd
       bulkQuickAddProducts(payload)   // existing store API
         buildQuickAddProductDraft
         commitNewProducts
```

No `public.products` writes. Permission remains `products.add` inside `bulkQuickAddProducts`.

---

## Permissions

Same as today: `products.add`. Folder create in a future review picker still uses `shelves.customize`. No new permission.

CSV/OCR **generate** steps must not grant extra create rights. AI generate gates stay on AI features only.

---

## Error behavior

| Case | Result |
|------|--------|
| Blocking issues | `{ blocked: true, added: 0 }` — bulk **not** called |
| Empty enabled set | Blocked |
| Plan cap / invalid drafts | Store `{ added, skipped }` as today |
| Offline | Local commit + sync queue, same as wizard |
| Duplicate SKU | Not checked here (SKU auto-generated) |

---

## Source metadata

`source` is stored on the review row only. Adapters set:

- CSV adapter: `"csv"` (`parseProductImportCsv`)
- Paper/OCR adapter (later): `"paper_ocr"`
- AI list (optional later): `"ai"`
- Manual paste: `"manual"`

---

## CSV adapter (Phase 2)

```
.csv bytes
  → parseProductImportCsv (source: "csv")
  → ProductImportReviewSheet
  → commitNormalizedProductImport({ bulkQuickAddProducts })
```

Official headers: Product name, Section, Unit, Pack size, Opening quantity, Cost price, Selling price.

The parser does **not** invent cost. Blank cost stays missing until the existing draft 72% fallback.

Limits: 500 rows, 256 KB. Excel workbooks are not parsed.

Stock entry: **Import CSV** (permission `products.add`) → template download + file picker → shared review sheet.

Existing AI bulk modal is **unchanged**.

---

## Extension points (do not implement in this phase)

**Paper / OCR**

```
image → (future OCR) → NormalizedProductImportRow[]  source: "paper_ocr"
  → ProductImportReviewSheet
  → commitNormalizedProductImport({ bulkQuickAddProducts })
```

Do not add a second product creation engine.
