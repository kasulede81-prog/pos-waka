# WAKA POS — Final Add Product Wizard ↔ CSV Contract Audit

**Mode:** Inspection only — no product/CSV engine code changes in this phase  
**Date:** 2026-08-29  
**Sources read:** `SimpleAddProductWizard.tsx`, `simpleProductWizard.ts`, `buildQuickAddProductDraft` / `quickAddProduct` / `bulkQuickAddProducts` / `commitNewProducts` (`usePosStore.ts`), `NormalizedProductImportRow`, `parseProductImportCsv.ts`, `mapNormalizedRowsToBulkQuickAdd.ts`, `csvColumns.ts`, `csvTemplate.ts`, `catalogHierarchy.ts` (`resolveCatalogSectionInput`, `assignmentCategoryFromPickerItem`), `ShelfDestinationPicker` / `HierarchyShelfPicker`, `StockPage.saveFromSimpleWizard`, `docs/WAKA_CSV_PRODUCT_IMPORT.md`, related tests  

---

## Final verdict

```text
CSV MATCHES WIZARD
```

**Implemented in Phase 2** — see `docs/WAKA_CSV_WIZARD_PARITY.md`.

Historical inspection verdict (pre-implementation) was `CSV REQUIRES CHANGES FOR WIZARD PARITY` for the reasons below. Those gaps are closed by Template A / Template B.

---

## Historical gaps (closed)

~~**Why (exact):**~~

1. ~~**Opening quantity meaning differs when pack is on.**~~  
2. ~~**Cost meaning differs when pack is on.**~~  
3. ~~**One official template mixes packed and unpacked columns**~~  
4. ~~**Same save engine is reachable** but CSV semantics were not wizard field semantics for packed products.~~

**Why (exact) — archived for context:**

1. **Opening quantity meaning differs when pack is on.**  
   Wizard `stockCount` = **number of packs**. Stored `stockOnHand` = `stockCount × piecesPerPack`.  
   CSV `Opening quantity` maps **directly** to `stockQty` / `stockOnHand` (sell units). No pack multiplication.

2. **Cost meaning differs when pack is on.**  
   Wizard buy field = **price paid for one pack**, then `unitCostFromPackTotal(pack, pieces)` → `costPricePerUnitUgx`.  
   CSV `Cost price` maps to **`costPricePerUnitUgx` (per sell unit)**. Parser never sets `buyingPackCostUgx`.

3. **One official template mixes packed and unpacked columns** (`Pack size` always present; optional `Pack` label not in the downloaded header). Owners cannot tell whether “Opening quantity” means packs or pieces.

4. **Same save engine is reachable** (`bulkQuickAddProducts` → `buildQuickAddProductDraft` → `commitNewProducts`), but **CSV semantics are not the wizard’s field semantics** for packed products.

---

## A. Wizard steps

Retail flow (`RETAIL_PRODUCT_WIZARD_STEPS` / `SimpleAddProductWizard`):

| # | Step id | UI title (en) | Control | Required? | Local state | On save → `BuiltWizardProduct` | DB / Product field |
|---|---|---|---|---|---|---|---|
| 1 | `name` | “What are you adding?” | Text | Yes (non-empty) | `name` | `name` | `products.name` |
| 2 | `shelf` | Flat: “Which section is it in?” / Hierarchy: “Which folder is this product in?” | `ShelfDestinationPicker` | Soft: empty allowed if no shelves; otherwise section or picker | `shelf` → `shelfValue` | `category` | `products.category` (= flat section or `legacyShelfKey`) |
| 3 | `sellUnit` | “How do you sell it?” | Choice chips + custom | Custom needs text | `sellUnit`, `sellUnitCustom` | `baseUnit`, `sellingMode` | `base_unit` / selling mode |
| 4 | `pack` | Pack on: “Does it come in a pack?” / Off: “Pack Type” + N/A | Toggle + pack kind chips | Pack kind / custom if on | `hasPack`, `packKind`, `packCustom` | drives pack fields | — |
| 5 | `piecesPerPack` | Pack on: “How many {unit} are in one {pack}?” / Off: locked `1` | Numeric / read-only 1 | Pack on: > 0 | `piecesPerPack` | `conversionRate` if pack & > 1 | `conversion_rate` |
| 6 | `stock` | Pack on: “How many {pack} do you have now?” / Off: “How many do you have now?” | Numeric | Optional (0 ok) | `stockCount` | **`stockQty` = packs×pieces or loose count** | `stock_on_hand` |
| 7 | `sellPrice` | “How much do you sell one {unit}?” | UGX integer | Yes > 0 | `sellPrice` | `priceUgx` | `selling_price_per_unit_ugx` |
| 8 | `buyPrice` | Pack on: “How much did you buy one {pack}?” / Off: “How much do you buy one {unit}?” | UGX integer | **Optional** | `buyPackPrice` | pack → unit cost + `buyingPackCostUgx`; loose → unit cost | `cost_price_per_unit_ugx`, `buying_pack_cost_ugx` |

**Validation (wizard UI):** name non-empty; sell price > 0; pack pieces > 0 when pack on; buy price optional (`simpleAddStep8Optional`).  
**Save path:** `buildProductFromSimpleWizard` → `StockPage.saveFromSimpleWizard` → `quickAddProduct` → `buildQuickAddProductDraft` → `commitNewProducts`.

**SKU:** generated in `buildQuickAddProductDraft` (`SKU-{timestamp}-{uuid}`); never collected in the wizard.  
**Tax / barcode / product id:** not in the wizard.

---

## B. No-pack semantics

When `hasPack === false`:

| Wizard input | Meaning | `BuiltWizardProduct` | Draft / Product |
|---|---|---|---|
| Name | Display name | `name` | `name` |
| Section/folder | Destination | `category` (default `"General"`) | `category` |
| Sell unit | Customer unit | `baseUnit`, `sellingMode` | `baseUnit`, `sellingMode` |
| Pieces/pack | Forced 1 (UI) | no `buyingUnit` / `conversionRate` | null |
| Opening qty | **Sell units on shelf** | `stockQty = stockCount` | `stockOnHand` |
| Sell price | **Per sell unit** | `priceUgx` | `sellingPricePerUnitUgx` |
| Buy price | **Per sell unit** (optional) | `costPricePerUnitUgx = buyPackPrice` if > 0 | else draft applies **~72%** of sell |

Presets: money `[sell]`, qty `[1]`.

---

## C. Pack semantics

When `hasPack === true` and pieces > 1:

| Wizard input | Meaning | Code |
|---|---|---|
| Pack type | Label for buying unit | `buyingUnit = packKindLabel(...).toLowerCase()` |
| Pieces per pack | Sell units inside one pack | `conversionRate = piecesPerPack` |
| Opening qty | **Number of packs** | UI title `simpleAddStep6TitlePack`; summary `{packs} {pack} = {total} {unit}` |
| Stored stock | Sell units | `stockQty = stockCount * piecesPerPack` (`buildProductFromSimpleWizard`) |
| Sell price | **Per sell unit** | `priceUgx`; full-pack sell shown as `sell × pieces` |
| Buy price | **Per pack** (invoice for one pack) | `buyingPackCostUgx = buyPackPrice`; `costPricePerUnitUgx = unitCostFromPackTotal(pack, pieces)` |

If pack buy price blank: wizard leaves `costPricePerUnitUgx` undefined → `buildQuickAddProductDraft` uses `defaultWizardUnitCostUgx(sell) = floor(sell * 0.72)` (**72% fallback still exists**).

Edit prefill (`productToWizardPrefill`): stock field shows **`fullPacks`**, buy field shows **`cost × rate`** (pack total) — confirms pack-centric UX.

---

## D. Price semantics

| Mode | Selling price | Buying / cost in UI | Stored cost |
|---|---|---|---|
| No pack | Per sell unit | Per sell unit | That amount, or 72% fallback |
| Pack | Per sell unit | **Per pack** | `packCost / piecesPerPack` (+ `buyingPackCostUgx`) |

`unitCostFromPackTotal`: exact division `pack / units` (no floor of unit cost).

---

## E. Stock semantics

| Mode | Wizard quantity means | Normalized / Product |
|---|---|---|
| No pack | Sell units | `stockQty` = that number |
| Pack | **Packs** | Wizard converts to sell units before draft |

`NormalizedProductImportRow.stockQty` is documented and implemented as **opening quantity in sell units** (`types.ts`, CSV docs).

**Conclusion:** One CSV column named like the wizard’s “How many … do you have now?” **cannot** mean the same thing for both templates unless the pack template either:

- labels the column as packs and the importer multiplies by pack size (wizard-parity), or  
- labels it as sell units / pieces and accepts a deliberate UX difference from the wizard.

---

## F. Folder / section semantics

| Surface | What is stored |
|---|---|
| Flat picker | Section / shelf string → `Product.category` |
| Hierarchy picker | `assignmentCategoryFromPickerItem` → **`legacyShelfKey`** (not display path) |
| Display path | `selectedCatalogDestinationPath` — display only; “Never write this string to Product.category” |
| CSV `Section` | → `categoryInput` → `resolveCatalogSectionInput` (leaf name, key, or path) |

Ambiguous leaf (two folders, same name): blocking in review.  
Unknown string: unresolved → saved as new section name via bulk (current behavior).

**CSV guidance:** Prefer unique folder **path** or exact **legacy key** when hierarchy is on; leaf-only names are unsafe when duplicates exist. Do not invent a new hierarchy model.

---

## G. Template A — NO PACK (recommended)

Owner-facing columns that mirror the wizard when pack is off:

| CSV column | Wizard label | Required? | Meaning | Normalized field | Draft field |
|---|---|---|---|---|---|
| Product name | What are you adding? | Yes | Name | `name` | `name` |
| Section | Which section/folder? | When shop has folders | Destination | `categoryInput` → `category` | `category` |
| Unit | How do you sell it? | No (default `piece`) | Sell unit | `baseUnit` | `baseUnit` |
| Opening quantity | How many do you have now? | No (empty = 0) | **Sell units** | `stockQty` | `stockOnHand` |
| Cost price | How much do you buy one {unit}? | No | **Per sell unit** | `costPricePerUnitUgx` | `costPricePerUnitUgx` (or 72% if blank) |
| Selling price | How much do you sell one {unit}? | Yes > 0 | **Per sell unit** | `sellingPriceUgx` | `sellingPricePerUnitUgx` |

**Omit:** Pack size, Pack label, SKU, tax, product id, barcode, metadata.

---

## H. Template B — WITH PACK (recommended)

| CSV column | Wizard label | Required? | Meaning | Normalized field | Draft field |
|---|---|---|---|---|---|
| Product name | What are you adding? | Yes | Name | `name` | `name` |
| Section | Which section/folder? | When shop has folders | Destination | `categoryInput` → `category` | `category` |
| Unit | How do you sell it? | No (default `piece`) | Sell unit | `baseUnit` | `baseUnit` |
| Pack | Pack type (crate/carton/…) | Yes for clear pack UX | Pack label | `buyingUnit` | `buyingUnit` |
| Pack size | How many {unit} in one {pack}? | Yes (> 1) | Pieces per pack | `conversionRate` | `conversionRate` |
| Opening packs | How many {pack} do you have now? | No | **Packs** (wizard meaning) | *(needs mapping)* → `stockQty = packs × pack size` | `stockOnHand` |
| Cost per pack | How much did you buy one {pack}? | No | **Per pack** | `buyingPackCostUgx` + derived unit cost | `buyingPackCostUgx`, `costPricePerUnitUgx` |
| Selling price | How much do you sell one {unit}? | Yes > 0 | **Per sell unit** | `sellingPriceUgx` | `sellingPriceUgx` |

**Omit:** SKU, tax, ids, barcode, metadata. Do **not** put a “cost per piece” column if the wizard asks for pack cost.

---

## I. CSV mapping (current implementation)

Official downloaded headers today (`officialCsvImportHeaders`):

`Product name, Section, Unit, Pack size, Opening quantity, Cost price, Selling price`

| Current CSV | Maps to | Wizard parity? |
|---|---|---|
| Product name | `name` | Yes |
| Section | `categoryInput` | Yes (same resolver) |
| Unit | `baseUnit` | Yes |
| Pack size | `conversionRate` | Yes as pieces/pack |
| Opening quantity | `stockQty` **sell units** | **No for pack-on wizard** |
| Cost price | `costPricePerUnitUgx` | **No for pack-on wizard** (wizard = pack cost) |
| Selling price | `sellingPriceUgx` | Yes |
| Pack (optional, not in template) | `buyingUnit` | Partial — missing from official file |
| — | `buyingPackCostUgx` | **Never set by CSV parser** |

Packed vs non-packed distinction today: **implicit** — `conversionRate > 1` after map. No separate templates.

---

## J. Differences (wizard vs CSV)

| Topic | Wizard | Current CSV |
|---|---|---|
| Pack toggle | Explicit step | Implicit via pack size |
| Opening qty (packed) | Packs | Sell units |
| Cost (packed) | Per pack → divide | Already per unit |
| Pack label | Always when pack on | Optional column not in template |
| `buyingPackCostUgx` | Set when pack priced | Not populated |
| Cost blank | 72% fallback | Same fallback (aligned) |
| SKU | Auto | Ignored / not imported |
| Save engine | `quickAddProduct` | `bulkQuickAddProducts` → same draft/commit |

---

## K. Required implementation changes (recommendations only — not done here)

Minimal changes for true wizard parity:

1. **Ship two official templates** (A / B) with different headers and examples.  
2. **Pack template:** map “Opening packs” → `stockQty = packs × packSize` before bulk.  
3. **Pack template:** map “Cost per pack” → `buyingPackCostUgx` + compute `costPricePerUnitUgx` via `unitCostFromPackTotal` (same as `buildProductFromSimpleWizard`).  
4. Include **Pack** label column in Template B.  
5. Keep Template A without pack columns.  
6. Review UI copy must state pack vs piece / pack vs unit cost so owners do not reuse the old single-template meaning.  
7. Update `docs/WAKA_CSV_PRODUCT_IMPORT.md` and example rows after the importer changes.

Do **not** change `commitNewProducts` / inventory accounting / product schema for this parity work.

---

## L. Risks

| Risk | Severity | Note |
|---|---|---|
| Shopkeepers reuse old “Opening quantity = pieces” files with a pack-aware importer | High | Need clear template names + review warnings |
| Treating CSV cost as pack cost without labeling | High | Would 24× understate COGS if still unit-cost files |
| Leaf-only Section with duplicate folder names | Medium | Already blocking when ambiguous |
| Leaving one mixed template | Medium | Continues the current confusion |

---

## M. Final recommendation

### Template A — Products WITHOUT packs

```text
Product name, Section, Unit, Opening quantity, Cost price, Selling price
```

### Template B — Products WITH packs

```text
Product name, Section, Unit, Pack, Pack size, Opening packs, Cost per pack, Selling price
```

**Why:** Matches the wizard’s questions and the real conversions in `buildProductFromSimpleWizard`. Keeps packed vs unpacked fields out of each other’s files. Still targets the same draft/commit engine once mapping is corrected.

### Coca Cola 500ml example (wizard code, not assumption)

Inputs as a shopkeeper would enter them in the **wizard**:

| Field | Value | Meaning in code |
|---|---|---|
| Sell unit | Piece | `baseUnit = piece` |
| Pack | e.g. crate | `buyingUnit` |
| Pieces per pack | 24 | `conversionRate = 24` |
| Opening quantity | 48 | **48 packs** → `stockOnHand = 48 × 24 = 1152` pieces |
| Cost | 18000 | **18000 per pack** → `costPricePerUnitUgx = 18000/24 = 750` |
| Selling price | 2000 | **2000 per piece** |

If the **current CSV** were filled with the same numbers:

| Field | Current CSV effect |
|---|---|
| Pack size 24 | `conversionRate = 24` |
| Opening quantity 48 | `stockOnHand = 48` pieces (**2 packs**, not 48) |
| Cost 18000 | `costPricePerUnitUgx = 18000` per piece (**not** 750) |
| Selling 2000 | OK |

That is why the verdict is **CSV REQUIRES CHANGES FOR WIZARD PARITY**.

---

## Evidence index

| Symbol | File (approx.) |
|---|---|
| Wizard steps / UI | `src/components/stock/SimpleAddProductWizard.tsx` |
| Pack stock math / cost | `src/lib/simpleProductWizard.ts` (`buildProductFromSimpleWizard`, `defaultWizardUnitCostUgx`) |
| Draft + SKU + 72% | `src/store/usePosStore.ts` (`buildQuickAddProductDraft`) |
| Commit | `commitNewProducts` in `usePosStore.ts` |
| Wizard → quickAdd | `StockPage.saveFromSimpleWizard` |
| Normalized row | `src/lib/productImport/types.ts` |
| CSV parse | `src/lib/productImport/parseProductImportCsv.ts` |
| Map to bulk | `src/lib/productImport/mapNormalizedRowsToBulkQuickAdd.ts` |
| Headers | `src/lib/productImport/csvColumns.ts` |
| Folder resolve | `src/lib/catalogHierarchy.ts` |
| Existing docs | `docs/WAKA_CSV_PRODUCT_IMPORT.md` |
