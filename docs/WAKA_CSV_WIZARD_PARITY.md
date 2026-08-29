# WAKA POS — CSV ↔ Add Product Wizard Parity

**Phase:** 2 — Two official product CSV templates  
**Date:** 2026-08-29  
**Audit:** `docs/WAKA_CSV_WIZARD_PARITY_AUDIT.md`  
**Save path (unchanged):** `parseProductImportCsv` → `ProductImportReviewSheet` → `commitNormalizedProductImport` → `bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`

---

## Verdict after implementation

```text
CSV MATCHES WIZARD
```

Two header-identified templates mirror Add Product pack OFF / pack ON. Pack opening stock and pack cost use the same conversions as `buildProductFromSimpleWizard`.

---

## Template A — No Packs

**Filename:** `WAKA Product Import — No Packs.csv`

**Headers:**

```text
Product name, Section, Unit, Opening quantity, Cost price, Selling price
```

| CSV column | Wizard meaning | Normalized | Draft / Product |
|---|---|---|---|
| Product name | What are you adding? | `name` | `name` |
| Section | Section / folder | `categoryInput` → resolve | `category` |
| Unit | How do you sell it? | `baseUnit` (default `piece`) | `baseUnit` |
| Opening quantity | How many do you have now? | `stockQty` (sell units) | `stockOnHand` |
| Cost price | How much do you buy one {unit}? | `costPricePerUnitUgx` | unit cost (or 72% if blank) |
| Selling price | How much do you sell one {unit}? | `sellingPriceUgx` | `sellingPricePerUnitUgx` |

`packMode: "none"`. No pack fields on the bulk payload.

---

## Template B — With Packs

**Filename:** `WAKA Product Import — With Packs.csv`

**Headers:**

```text
Product name, Section, Unit, Pack, Pack size, Opening packs, Cost per pack, Selling price
```

| CSV column | Wizard meaning | Normalized | Draft / Product |
|---|---|---|---|
| Product name | What are you adding? | `name` | `name` |
| Section | Section / folder | `categoryInput` → resolve | `category` |
| Unit | How do you sell it? | `baseUnit` | `baseUnit` |
| Pack | Pack type | `buyingUnit` (lowercased) | `buyingUnit` |
| Pack size | Pieces in one pack | `conversionRate` (must be > 1) | `conversionRate` |
| Opening packs | How many {pack} do you have now? | `openingPacks` → `stockQty = packs × size` | `stockOnHand` |
| Cost per pack | How much did you buy one {pack}? | `buyingPackCostUgx` + derived unit cost | same |
| Selling price | How much do you sell one {unit}? | `sellingPriceUgx` | per sell unit |

`packMode: "packed"`.

### Pack conversion (wizard parity)

```text
stockOnHand = Opening packs × Pack size
costPricePerUnitUgx = Cost per pack ÷ Pack size   // unitCostFromPackTotal
buyingPackCostUgx = Cost per pack
```

### Coca Cola example

| Input | Value |
|---|---|
| Unit | Piece |
| Pack | Crate |
| Pack size | 24 |
| Opening packs | 48 |
| Cost per pack | 18000 |
| Selling price | 2000 |

**Result:** `stockOnHand = 1152`, unit cost `750`, pack cost `18000`.

---

## Template identification

Identified by **header field set**, not filename.

| Detection | Result |
|---|---|
| Has Opening packs + Cost per pack + Pack + Pack size (+ shared columns) | Template B |
| Has Opening quantity + Cost price, **no** pack-only columns | Template A |
| Old 7-col: Pack size + Opening quantity + Cost price | **Rejected** (`csvImportLegacyTemplateRejected`) |

Template A rejects packed-only columns. Template B rejects Opening quantity / Cost price columns. Missing required Template B fields (pack size ≤ 1, empty Pack label) **block** in review — never silently become unpacked.

---

## Cost missing

| Template | Blank cost | Review | Draft |
|---|---|---|---|
| A | Cost price empty | Cost missing — ~72% fallback | `defaultWizardUnitCostUgx(sell)` |
| B | Cost per pack empty | Cost per pack missing — ~72% of sell **per unit** | Same fallback; `buyingPackCostUgx` omitted |

Blank pack cost is **not** treated as a sell-unit cost value.

---

## Folder semantics

Unchanged: `resolveCatalogSectionInput`. Ambiguous leaf blocks. Unknown section warns and saves as typed name.

---

## Backward compatibility

The previous single 7-column template is **not** accepted. Silent reinterpretation of packed rows would be wrong (opening qty as pieces vs packs; cost as unit vs pack). Operators must download Template A or B and re-save.

---

## UI

Stock → **Import CSV** (`ProductCsvImportSheet`):

- Short “Which template should I use?”
- Download — No Packs
- Download — With Packs
- Choose / upload CSV → shared `ProductImportReviewSheet`

Review for packed rows shows Pack, Pack size, Opening packs, Cost per pack, and derived sell-unit stock/cost hints.

---

## Normalized contract extras

| Field | Purpose |
|---|---|
| `packMode` | `"none"` \| `"packed"` |
| `openingPacks` | Template B input; derives `stockQty` |
| `buyingPackCostUgx` | Pack invoice total |
| `stockQty` | Always sell units after conversion |
| `costPricePerUnitUgx` | Per sell unit (derived when pack-costed) |

Helpers: `src/lib/productImport/packImportSemantics.ts` (mirrors wizard math; not a second save engine).
