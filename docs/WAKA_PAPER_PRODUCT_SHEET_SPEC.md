# WAKA POS — Paper Product Sheet & OCR Design

**Phase:** 3A — Design only (no OCR, camera, AI, migrations, or product-engine changes)  
**Date:** 2026-08-29  
**Status:** Specification. Do not implement from this document until Phase 3B is explicitly started.

**Save path (mandatory, unchanged):**

```
Paper pages
  → (future) photos
  → (future) OCR/AI extraction
  → NormalizedProductImportRow[]   source: "paper_ocr"
  → ProductImportReviewSheet
  → commitNormalizedProductImport
  → bulkQuickAddProducts
  → buildQuickAddProductDraft
  → commitNewProducts
```

There is no paper-specific product save path. CSV already uses the same review and commit.

---

## A. Objective

A Ugandan shop that has **no spreadsheet** can write what is on the shelf onto a printed **WAKA Product Sheet**. A WAKA field person (or the shop) later photographs the pages. Software extracts rows, a human reviews them on the existing import screen, and only then does WAKA create products with the existing engine.

The paper sheet is optimized for:

- ballpoint handwriting
- an ordinary phone camera
- few instructions people will actually read
- 20–500 products across several pages
- correction on screen, not “AI knows better”

Audience:

- Shopkeeper filling the sheet (or dictating while staff write)
- WAKA door-to-door onboarding team (target: January)

Not in this design: pharmacy batch/expiry paper, Excel, a second catalog database, SKU stickers, EFRIS/tax.

---

## B. Existing normalized contract

Inspected in code, not only docs.

**Type:** `NormalizedProductImportRow` (`src/lib/productImport/types.ts`)

| Field | Product / engine | Paper should collect? |
|-------|------------------|------------------------|
| `clientId` | Review only | No — generated |
| `source` | Review / debug | No — adapter sets `"paper_ocr"` (already reserved) |
| `enabled` | Skip if false | No — review checkbox |
| `name` | `Product.name` | **Yes** |
| `categoryInput` | Folder resolve input | **Yes** (as Section) |
| `category` | `Product.category` / `legacyShelfKey` | No — resolver fills this |
| `baseUnit` | `Product.baseUnit` | Yes, optional (default `piece`) |
| `sellingMode` | `Product.sellingMode` | No — draft infers from unit/name |
| `buyingUnit` | Pack label | **Not on V1 paper** (CSV official template also omits it) |
| `conversionRate` | Units per pack | Yes, optional (**Pack contains**) |
| `stockQty` | `Product.stockOnHand` | Yes, optional (blank → 0) |
| `sellingPriceUgx` | `Product.sellingPricePerUnitUgx` | **Yes**, integer > 0 |
| `costPricePerUnitUgx` | Unit cost | Yes, optional (blank → existing ~72% fallback) |
| `buyingPackCostUgx` | Pack invoice total | **Not on V1 paper** |
| `sourceRowNumber` | Review only | Adapter may set (page/row). Not written by the customer as a software id |

**Not on the row (never ask on paper):** SKU, product id, `category_id`, tax, barcode, metadata, images, pharmacy `openingBatch` (bulk API does not take it).

**Retail create rules that paper must respect** (`evaluateNormalizedProductRows` + `buildQuickAddProductDraft`):

- Name non-empty; selling price > 0
- Stock ≥ 0; blank stock is 0 (retail)
- Cost omitted/`null` = missing → `defaultWizardUnitCostUgx` = `floor(sell × 0.72)` capped at sell. **`0` is a real zero, not missing**
- Pack number, if written, must be > 0. Mapper only sends `conversionRate` when **> 1**
- Section: unique match resolves; same leaf in two folders **blocks**; unknown string warns and is saved as a new section name; empty section blocks **if the shop already has folders**
- Duplicate names in the same import **block** (not merged)
- Pharmacy mode additionally requires stock > 0 and explicit cost > 0 — **out of paper V1**
- Permission remains `products.add` inside `bulkQuickAddProducts`
- Current CSV file cap is **500 rows / 256 KB**. Paper jobs should aim at the same product cap per import confirm (split shops larger than 500)

**Critical semantic (import vs wizard):**

The Add Product wizard, when pack tracking is on, asks “how many **packs**” and multiplies by pieces.  
Import `stockQty` is already **how many sell units are on the shelf** (bottles, pieces, kg), not how many crates.

Paper **must** count sell units. See §I and §K.

---

## C. Recommended paper fields

Same seven columns as the live CSV template, with **paper labels** that a shopkeeper can read. Do not add an eighth data column in V1.

| # | Paper label | Normalized field | Why this label |
|---|-------------|------------------|----------------|
| 1 | **Product name** | `name` | Matches wizard examples (Coca Cola, Sugar) and CSV |
| 2 | **Section** | `categoryInput` | Wizard: “Which section is it in?” — not “folder”, not “category_id” |
| 3 | **Unit** | `baseUnit` | How one item is sold. Default piece if blank |
| 4 | **Pack contains** | `conversionRate` | Clearer than “Pack size” (size sounds like 500ml). Means how many **units inside one pack/crate** |
| 5 | **On shelf now** | `stockQty` | Wizard: “How many do you have now?” / “Count what is on your shelf today.” Better than “Opening quantity” |
| 6 | **Cost** | `costPricePerUnitUgx` | What you **paid for one unit**. Optional |
| 7 | **Sell price** | `sellingPriceUgx` | What you **charge for one unit**. Required |

Header (not product columns): shop name, date, page n of m, filled by (name).

---

## D. Required vs optional vs generated

### Must write (or the row cannot import until review fixes it)

- **Product name**
- **Sell price** (digits, greater than 0)

If the shop **already has sections/folders** in WAKA, empty Section will block in review until the operator fills it. On a **brand-new empty shop**, Section may be blank and becomes General.

### Strongly recommended

- **On shelf now** — otherwise stock starts at 0 and there is no opening movement
- **Cost** — otherwise review warns and WAKA uses ~72% of sell price
- **Section** — even on a new shop, grouping (Drinks, Groceries) makes the catalog usable on day one
- **Unit** when it is not piece (kg, litre, bottle)

### Optional (safe to leave blank)

- **Pack contains** — leave blank if they sell singles (no crate/carton tracking)
- **On shelf now** — blank = 0
- **Cost** — blank = missing (fallback), not zero
- **Unit** — blank = piece
- **Section** — only safe when the shop has no folders yet

### Never write (WAKA generated)

- SKU / barcode
- IDs
- Tax / EFRIS
- Selling mode
- Internal folder keys
- Cost when they do not know it (leave the cell **empty**; do not write 0 unless the item is truly free)

---

## E. User-facing labels

Print language: **simple English** on V1 (field team can explain). A Luganda twin sheet is V2, not required to start.

| Print this | Do not print |
|------------|----------------|
| Product name | SKU, item code |
| Section *(e.g. Drinks, Groceries)* | category, folder path, `legacyShelfKey` |
| Unit *(Piece, Bottle, Kg, Litre, Packet)* | `baseUnit`, conversionRate |
| Pack contains *(how many in 1 crate/carton — or leave empty)* | Pack size (ambiguous with 500ml) |
| On shelf now *(count bottles/pieces, not crates)* | Opening stock, SOH, `stockQty` |
| Cost *(what you paid for ONE — or leave empty)* | Buy pack total, UGX, ~72% |
| Sell price *(what you charge for ONE)* | Selling price (UGX) as a long header |

**“Pack contains” vs “Pack size”:** use **Pack contains**. Shopkeepers already put size in the **name** (Omo 1kg, Coke 500ml). Pack contains is the crate math (24), which matches `conversionRate`.

**“Section” vs “Shelf/Section”:** use **Section**. “Shelf” sounds like the physical board in the shop; WAKA sections are Drinks / Groceries. Wizard copy already says section.

Short footer line (one sentence):

> Write one product per line. Prices in numbers only (5000 not UGX 5,000). Empty cost is OK.

---

## F. Paper layout / wireframe

**Recommended: A4 portrait**, 20–25 mm margins, heavy black grid (0.5–0.7 pt) so phone photos still show cell edges.

- Portrait matches how people hold a phone.
- Seven columns fit if **Product name** is widest and number columns stay narrow.
- Target **16 product rows** per page after the header band (100 products ≈ 7 pages; 300 ≈ 19 pages; 500 ≈ 32 pages). Prefer more pages over cramped handwriting.

Do **not** generate a PDF in this phase. Print specification for a later Phase 3B artifact.

```
┌─────────────────────────────────────────────────────────────────┐
│  WAKA PRODUCT SHEET                                             │
│  Write the products on your shelf. One line = one product.      │
│                                                                 │
│  Shop: ________________________  Date: __________               │
│  Page: ____ of ____              Written by: ______________     │
│                                                                 │
│  How to write   Name as sold (include size: Coke 500ml).        │
│  (tiny)         Numbers only. Empty Cost is OK.                 │
│                 On shelf now = pieces/bottles, not crates.      │
├────────────┬──────────┬──────┬────────┬────────┬────────┬───────┤
│ Product    │ Section  │ Unit │ Pack   │ On     │ Cost   │ Sell  │
│ name       │          │      │contains│ shelf  │        │ price │
│            │          │      │        │ now    │        │       │
├────────────┼──────────┼──────┼────────┼────────┼────────┼───────┤
│            │          │      │        │        │        │       │  ← row ~11mm
├────────────┼──────────┼──────┼────────┼────────┼────────┼───────┤
│   … 16 rows …                                                   │
├────────────┴──────────┴──────┴────────┴────────┴────────┴───────┤
│  WAKA — do not write SKU or barcodes here. Staff will photo     │
│  this page. Nothing is saved until someone checks the list.     │
└─────────────────────────────────────────────────────────────────┘
```

Suggested column widths (A4 ~170 mm usable):

| Column | Width | Handwriting |
|--------|-------|-------------|
| Product name | ~52 mm | Longest text |
| Section | ~26 mm | One word |
| Unit | ~16 mm | Piece / Kg |
| Pack contains | ~16 mm | 24 |
| On shelf now | ~16 mm | 48 |
| Cost | ~22 mm | 2800 |
| Sell price | ~22 mm | 3500 |

Row height ≥ 10–12 mm. Number columns may use a light **digit underline** (four or five ticks) — optional print detail, not a new field.

**Landscape A4** is better for writing but worse for rushed phone photos (must rotate). Keep as a V2 print option, not V1 default.

Example filled lines (for the instruction poster / staff card, not pre-printed on every sheet):

| Product name | Section | Unit | Pack contains | On shelf now | Cost | Sell price |
|--------------|---------|------|---------------|--------------|------|------------|
| Coca Cola 500ml | Drinks | Bottle | 24 | 48 | 1200 | 1500 |
| Sugar 1kg | Groceries | Kg | | 10 | 2800 | 3500 |
| Airtel Airtime 5000 | Airtime | Piece | | 20 | | 5000 |
| Bread Large | Bakery | Piece | | 8 | 3500 | 4500 |

---

## G. Handwriting instructions

Keep to **five rules** on the sheet itself. Extra rules go on a one-page staff card.

**On the sheet (customers will skip anything longer):**

1. One product per line. Do not squeeze two items into one box.
2. Write the name as you sell it, including size (500ml, 1kg).
3. Stay inside the boxes.
4. Prices and counts: **digits only** (5000). No UGX, no commas.
5. If you do not know cost, **leave it empty** (do not write 0).

**Staff card (useful, not on every page):**

- Capital letters help but are not required; neat lowercase is fine.
- Cross out a whole row with one line if it is a mistake; do not scribble over digits.
- Same product twice (two sizes) = two lines: `Omo 500g` and `Omo 1kg`.
- Abbreviations are OK if the shop uses them (`Coke 500`, `BB 500g`) — **do not expand in OCR**; the reviewer may tidy names.
- Similar names (`Coke 300ml` vs `Coke 500ml`) must stay different lines. Duplicate **identical** names on the same job will block import until renamed or unchecked.
- Blank Pack contains and blank On shelf now are OK.
- Do not write outside the grid (arrows, “see over”, prices in the margin).

**What is not useful:** forcing block capitals for every shop; requiring ticks for empty cells (empty already means empty); teaching `conversionRate`.

---

## H. Price instructions

**Write:** `5000`  
**Do not write:** `UGX 5,000`, `5,000/=`, `5k`, `5.000` (European thousands).

| Topic | Rule |
|-------|------|
| Currency | Printed once in the header: “Prices in Uganda shillings”. Not in every cell |
| Commas | **Forbidden on paper.** OCR reads `5,000` as two numbers or as 5 |
| Decimals | Retail import is **integer UGX**. No cents |
| Cost vs sell | Both are **per one unit** (one bottle, one kg), not per crate |
| Crate invoice | If they only know “crate is 24,000”, they should leave Cost empty **or** staff divide (24000÷24) before writing. Do not put 24000 in Cost next to Sell 1500 |
| Blank cost | Missing → review shows **Cost missing — ~72% fallback** (`floor(sell × 0.72)`). Confirm dialog already exists |
| Written 0 | Explicit zero cost (almost never wanted). Instruct: empty, not zero |
| Unreadable price | Future OCR must **not invent** a sell price. Leave invalid/empty → review blocks until a human types it |

Airtime (`Airtel Airtime 5,000`): the **5,000 belongs in the name**. Sell price is still `5000` in the price column.

---

## I. Stock instructions

**Paper column: On shelf now**  
**Meaning:** count of **sell units** on the shelf today → `stockQty` → `stockOnHand`. If > 0, existing create still writes a local `opening_stock` movement. No new movement type.

| Avoid printing | Why |
|----------------|-----|
| Opening Qty | Accounting language |
| Stock | Sounds like “the stock room” |
| Quantity | Quantity of what? |
| Current stock | Close, but “on shelf now” matches wizard hint |

**How to count:**

- Bottles of soda: number of bottles you can sell, not crates.
- If Pack contains = 24 and they have 2 full crates, write **On shelf now = 48**, not 2.
- Kg/litre: the number they would type in the wizard (e.g. 10 for 10 kg of sugar).
- Blank = 0. Do not invent a count in OCR.
- Do not write “full”, “many”, or “ok”.

Pharmacy shops: paper V1 is **not** the pharmacy wizard (batches/expiry). Field team should use CSV or the in-app wizard for medicines until a separate sheet exists.

---

## J. Section / category instructions

Paper captures a **plain word or short phrase**, same as CSV `Section` → `categoryInput`.

Examples to print in tiny type under the header: `Drinks, Groceries, Airtime, Soap`.

| Shopkeeper writes | Engine (already built) |
|-------------------|------------------------|
| `Drinks` and that leaf is unique | Resolve to that folder key |
| `Soda` but two folders named Soda | Review **blocks** (ambiguous). Operator types the full path or key. OCR must **not** pick one |
| `BrandNew` matching nothing | Warning; saved as a new section name (current bulk behavior) |
| Empty, shop already has folders | Review blocks until filled |
| Empty, new empty shop | General |

Do not print folder trees or ask for “level 2”. Do not invent a new hierarchy. Staff who know the shop’s WAKA folders can write the same names the POS already uses.

---

## K. Unit / pack instructions

**Unit** = how you sell **one** (wizard: Piece, Bottle, Packet, Kg, Litre, or a short custom word).

| Write | Maps toward |
|-------|-------------|
| Piece, Pc, Pcs | `piece` |
| Bottle, Btl | `bottle` |
| Packet, Pack (as sell unit) | `packet` |
| Kg, Kilo | `kg` (draft may use weighted mode) |
| Litre, Ltr, L | `litre` |
| Blank | `piece` |

Do not add units the wizard does not have (dozen, pair) as first-class V1 types; if written, pass through as custom `baseUnit` text like the wizard “other” box.

**Pack contains** = how many **units in one outer pack** (crate 24, carton 12). Blank if they do not track packs. This is `conversionRate`, only sent to bulk when > 1.

V1 does **not** ask pack *name* (crate/carton). That is `buyingUnit` / CSV optional “Pack”. Skipping it keeps seven columns; the engine can run without a pack label.

**Do not** treat “Box” in Unit as pack tracking unless Pack contains is a number > 1.

---

## L. Multi-page design

Required on **every** page (OCR will mix shops if this is missing):

- **Shop:** name as the customer says it (not a database id in V1)
- **Page:** `3 of 12` (total pages filled when the last page is known; if unknown, `3 of __` is still useful)
- **Date**
- **Written by** (shop person or WAKA staff)

Page number is for **humans and the future uploader** (order photos, retake page 4). It is not a database key and needs **no migration**.

Processing: one onboarding job = one shop = many images → one `NormalizedProductImportRow[]` → **one** review confirm (or split at 500). Sequential `sourceRowNumber` across pages (page 1 rows 1–16, page 2 rows 17–32, …) is enough for “Row 42” in review.

100 products ≈ 7 pages; 300 ≈ 19; 500 ≈ 32. That is acceptable for January if photos are taken in page order. Shops above 500: second import after the first confirm.

---

## M. Future image capture requirements

Design only — no camera code in 3A.

**Accept:**

- Whole page in frame, including the WAKA header and all grid lines
- Phone parallel to the page; fill the screen
- Bright, even light (daylight or a shop lamp). Avoid a hard shadow across the grid
- Flattened page (no folded gutter through the table)
- One page per photo
- JPEG/HEIC from a normal smartphone; roughly **≥ 2 megapixels on the page** (today’s phones exceed this if the page fills the frame)

**Reject or ask for a retake (do not extract confidently):**

- Blur (motion or out of focus)
- Cut-off columns or last rows
- Extreme angle (strong trapezoid)
- Dark / flashlight hotspot wiping out digits
- Two pages in one shot
- Photo of a photo / screen
- Thumb covering cells

**Orientation:** portrait sheet → portrait photo. If the app is built later, auto-rotate using the header “WAKA PRODUCT SHEET” as an upright cue.

**Cropping:** optional auto-crop to the outer grid; if crop confidence is low, show the photo and ask to retake rather than guessing cells.

**Multiple pages:** capture in order 1…N; allow add/retake per page before extraction.

**Quality checks (future, before OCR):** blur score, brightness, quad detection of the table. Fail closed: **retake**, do not invent rows.

---

## N. Future OCR extraction contract

Do not implement. Target mapping:

```
images[]
  → extractPaperProductSheet(images)
  → PaperExtractionJob
       pages: { pageIndex, imageRef, quality }
       candidates: PaperExtractedRow[]
  → map to NormalizedProductImportRow[]  source: "paper_ocr"
  → ProductImportReviewSheet
```

**Suggested intermediate row** (not a Product, not a second save type):

| Field | Role |
|-------|------|
| `pageIndex` / `rowOnPage` | Traceability |
| `rawText` per column | What OCR saw |
| `value` per column | Parsed candidate |
| `confidence` 0–1 per column | Below threshold → treat as empty/invalid, never as a guessed price |
| `warnings[]` | e.g. `low_confidence`, `ambiguous_digit` |

Then map into `NormalizedProductImportRow` with the **same rules as CSV**:

- Blank cost → `null` (missing), not 0, not 72% in the adapter
- Bad sell price → 0 or non-finite so existing `invalid_price` blocks
- `source: "paper_ocr"`
- `sourceRowNumber`: 1-based index in the job (header rows on paper are not products)

**Normalization allowed:** trim space; strip `UGX` if someone wrote it; parse `5000`.  
**Normalization not allowed:** renaming “Coke” to “Coca-Cola”; picking a folder when two match; filling sell price or qty from “similar” products.

If an intermediate type is skipped, the adapter may emit normalized rows directly **only if** low-confidence fields are left missing/invalid. Do not emit high-confidence invented numbers.

CSV cap (500) is a reasonable **confirm** cap for a paper job too.

---

## O. Human review requirements

`ProductImportReviewSheet` / `ProductImportReviewTable` stay **authoritative**. No auto-import.

The operator already sees: name, section, unit, pack, qty, cost (with **Cost provided** vs **Cost missing — ~72% fallback**), sell price, blocking errors, warnings, summary counts (detected / ready / warnings / errors).

Paper/OCR V1 should reuse that. Extra signals can ride on existing issues:

| Situation | Existing mechanism |
|-----------|-------------------|
| Unreadable sell price | `invalid_price` / empty name |
| Unreadable qty | `invalid_stock` |
| Unreadable cost | `invalid_cost` (do not coerce to missing fallback if the cell had scribbles) |
| Blank cost | `cost_fallback` warning + confirm dialog |
| Ambiguous section | `ambiguous_category` |
| Same name twice | `duplicate_name` |
| Low OCR confidence on a field | Leave field empty or invalid so it **cannot** silently pass |

V2 (nice): badge “uncertain handwriting” using extraction confidence without new save logic — still the same table.

Nothing from OCR becomes a product until **Import selected products** runs `commitNormalizedProductImport`. Success text must still wait for `bulkQuickAddProducts` `{ added, skipped }`.

---

## P. AI safety rules

**Allowed**

- Read handwriting inside the grid
- Copy product names as written (including spelling mistakes)
- Extract digits for prices, qty, pack contains
- Strip `UGX` / spaces from numbers
- Map Piece/Bottle/Kg/Litre synonyms to existing units
- Suggest a section **only as the typed string** the human wrote (or leave blank)
- Flag low confidence / unreadable cells
- Refuse the whole page when quality checks fail

**Not allowed**

- Invent missing sell prices, costs, or quantities
- Fill cost with 72% in the extractor (that is the **draft** layer after a visible warning)
- Silently “correct” product names or brands
- Choose one folder when the leaf is ambiguous
- Bypass `evaluateNormalizedProductRows`
- Call `commitNewProducts` / write `public.products` / skip `products.add`
- Import without the review confirm
- Merge duplicate lines
- Treat `0` cost as missing

The ~72% fallback remains **visible on review**, same as CSV.

---

## Q. CSV compatibility

| | CSV (live) | Paper (future) |
|--|------------|----------------|
| Columns | Same seven fields | Same seven fields (labels may differ on paper) |
| Adapter output | `NormalizedProductImportRow[]` `source: "csv"` | `source: "paper_ocr"` |
| Cost blank | `null` | `null` |
| Review | `ProductImportReviewSheet` | **Same component** |
| Commit | `commitNormalizedProductImport` → `bulkQuickAddProducts` | **Same** |

A shop with Excel uses CSV. A shop with a book uses paper. Field staff may **type** the paper into the CSV template instead of OCR — that is already a valid January fallback and needs no new engine.

Do not add a paper-only validator or a paper-only insert.

---

## R. January field-operation considerations

Not a field-ops product yet. Requirements only.

| Shop size | Paper | Photos | Practical path |
|-----------|-------|--------|----------------|
| 1 shop, ~20 products | 2 pages | 2 photos | OCR **or** staff types CSV the same day |
| ~100 | ~7 pages | ~7 photos | OCR job + one review |
| ~300 | ~19 pages | ~19 photos | Same; allow 20–40 min review |
| ~500 | ~32 pages | ~32 photos | At CSV/paper cap; split if more |
| Mixed digital + paper | CSV for Excel list + paper for the rest | Two reviews | Still one engine |

**Suggested physical loop (people, not software):**

1. Leave 10–40 blank sheets + a pen (or fill together at the counter)
2. Collect completed sheets; check shop name and page numbers
3. Photograph in order, one page per shot, whole grid visible
4. (Future) upload to the signed-in **that shop** WAKA account
5. Review extracted rows; fix names, sections, prices; confirm cost-fallback if any
6. Import → existing bulk create

Until OCR ships: **staff transcribe sheets into the CSV template** on a phone. Same review. That is the January safety net.

Staff must sign in as that shop (or owner). No cross-shop import. Same `products.add` rule as Add product.

---

## S. V1 vs V2 vs future

### V1 must have (next implementation phase after this spec)

- Printable A4 portrait **WAKA Product Sheet** (PDF) with the seven columns and short rules
- Field-team instruction card (count sell units, empty cost, digits only)
- OCR/image adapter later: images → `NormalizedProductImportRow[]` `paper_ocr` → **existing** review → **existing** commit
- Fail closed on bad photos; do not guess prices
- No new product engine, no new permission, no pharmacy paper

### V2 nice to have

- In-app camera with blur/crop checks and page retake
- Confidence badges on the existing review table
- Luganda (and maybe Runyankole) print variants
- Landscape print option
- Optional eighth column Pack (crate/carton label → `buyingUnit`)
- “Uncertain” issue kind if existing errors are not enough
- Helper: “2 crates × 24” calculated **in review by a human**, not silent OCR math

### Future (do not plan as V1)

- Handwriting model trained on Ugandan receipts
- Automatic brand canonicalization
- Photo of a stock **book** that is not the WAKA sheet
- Pharmacy batch/expiry paper
- Offline field-ops app, shop QR on the page, printed SKUs
- Auto-create catalog folders during OCR

---

## T. Risks and unresolved questions

**Risks**

1. **Crates vs bottles** — highest chance of wrong stock. Mitigate with the On shelf now label and staff card; review should still show qty.
2. **Cost written as crate total** — triggers cost > sell warning; good, but staff must know to divide or leave cost empty.
3. **Commas in prices and airtime names** — forbid commas in number columns; keep amounts in the name.
4. **Ambiguous “Soda”** — already blocking; OCR must not auto-pick.
5. **32 pages for 500 SKUs** — photo fatigue; CSV remains better when Excel exists.
6. **Pharmacy** — paper V1 will fail pharmacy required cost/stock rules if used there.
7. **Stale bulk-pipeline audit** (dated before CSV shipped) — follow the **contract + CSV docs + this spec**, not the “CSV does not exist” line in the older bulk audit.
8. **Empty cells vs “0”** — OCR must distinguish; prefer empty.

**Unresolved (decide in 3B, not here)**

- Exact PDF grid (mm) and whether digit ticks are printed
- OCR vendor vs in-house vs on-device
- Whether one confirm can exceed 500 rows (today CSV cannot)
- Whether `sourceRowNumber` is job-global or `page * 100 + row` (type is a number; either works)
- Bilingual sheet vs English-only V1
- Whether field staff photograph on a personal phone and AirDrop/WhatsApp images into a laptop for V1 OCR (ops), vs in-app upload (product)

---

## Recommended next implementation phase

**Phase 3B (when explicitly started):** generate the printable PDF from this layout only (still no OCR).  

**Phase 3C:** image quality gate + OCR adapter that **only** emits `NormalizedProductImportRow[]` and opens `ProductImportReviewSheet`. Stop there. Do not touch `bulkQuickAddProducts` beyond calling it through `commitNormalizedProductImport`.

January can start with **printed sheets + CSV transcription** before 3C is ready.
