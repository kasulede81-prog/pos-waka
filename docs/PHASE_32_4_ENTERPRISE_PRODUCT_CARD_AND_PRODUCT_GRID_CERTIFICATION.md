# Phase 32.4 — Enterprise Product Card & Product Grid Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Sell **Product Grid** + **Product Card** experience after shelf drill-down / search — geometry, hierarchy, density, sparse shelves, accessibility  
**Out of scope:** Checkout, shelf browser, payment, sync, inventory engine, barcode engine (already certified)  
**Related prior work:**  
- Phase 28.0 / 28.1 — name-first product cards, tap-to-add  
- Phase 32.2 / 32.3 — shelf packing, virtualizer, column stability  
- Phase 32.3.1 — shelf typography polish  

**Target:** Final presentation audit for the Sell module before maintenance-mode freeze.

---

## Executive Summary

Retail product cards already follow the correct enterprise hierarchy (**Name → Price → Stock → Add**). Phase 28.1 fixed the worst identification defects. The remaining cashier-speed gaps are concentrated in **sparse-shelf layout**, **desktop scan signals**, and a few **density/accessibility** leftovers — not a need to redesign the card.

**Core question:** *Can a cashier identify, scan, and add the correct product in the shortest possible time?*

| Path | Verdict |
|------|---------|
| **Dense shelves / search (≥10 SKUs)** | Strong — container-aware columns, name-first tiles, virtualized scroll |
| **Sparse shelves (1–3 SKUs)** | Weak — cards sit in narrow left tracks of a full-width multi-column grid; workspace looks unfinished |
| **Desktop scan speed** | Good hierarchy; stock signal weaker than mobile; favorite target undersized |
| **Pharmacy medicine card** | Divergent hierarchy (price last, no “+” cue, no low-stock color) |

| Dimension | Score | Verdict |
|-----------|------:|---------|
| **Product card** | **7.6 / 10** | Hierarchy correct; sparse + polish gaps remain |
| **Product grid** | **6.8 / 10** | Dense catalogs fine; sparse shelves waste workspace |
| **Typography** | **7.4 / 10** | Name-first works; compact Display Scale hurts stock |
| **Density** | **7.2 / 10** | Adaptive columns good; 1024 cart cliff residual |
| **Readability** | **7.5 / 10** | `line-clamp-3` adequate for most SKUs |
| **Accessibility** | **6.4 / 10** | Whole-card tap good; focus-visible / a11y labels weak |
| **Overall (this scope)** | **7.2 / 10** | Not fully certified; clear P0/P1 roadmap |

**Answer:** Mostly yes for dense catalogs. **No** for sparse shelves — the grid geometry still behaves as if many columns of products exist, so 1–2 cards look lost on a wide register.

**Recommended next step:** Phase 32.4.1 — Product Card & Sparse Grid Polish (presentation only) against the P0/P1 register below, then freeze Sell.

---

## Certification Methodology

1. Static forensics of `PosSellProductCard`, `PosDesktopProductCard`, `PharmacySellMedicineCard`.  
2. Grid math: `posProductGridColumns`, `useCatalogContainerWidth`, `stabilizeCatalogColumnCount`.  
3. Render paths in `PosPage` / `SellProductBrowsePanel` / `VirtualizedProductGrid`.  
4. Display Scale effective sizes via `index.css` `.pos-ds-product-*` + `scaleTokens.ts`.  
5. Sparse-shelf path when `filteredProducts.length ≤ VIRTUAL_PRODUCT_THRESHOLD (10)`.  
6. Workflow benchmark vs Square / Shopify POS / Lightspeed / Toast (density/speed only).  

**Not performed:** Live timed cashier lab; eye-tracking; OCR of a specific shop’s screenshots (screenshots informed symptoms; findings are code-evidence based).

---

# PART 1 — Product Card Architecture

### Production cards

| Band | Component | Evidence |
|------|-----------|----------|
| Mobile + compact (≤1023) | `PosSellProductCard` | `PosPage` `sellMobile` |
| Full desktop (≥1024) | `PosDesktopProductCard` | `sellDesktop` |
| Pharmacy medicine | `PharmacySellMedicineCard` | `pharmacyMedicine` |

### Geometry (coded)

| Metric | Mobile | Desktop | Pharmacy |
|--------|--------|---------|----------|
| Padding | 10px (`p-2.5`) | 8px inner (`p-2`) | 12px (`p-3`) |
| Min-height | 112px | 112px | 168px (compact prop unused) |
| Radius | `rounded-xl` (12px) | 12px | `rounded-2xl` (16px) |
| Elevation | `shadow-sm` | `shadow-sm` | `shadow-sm` + hover |
| CTA glyph | 44×44 teal | 36×36 coded → **48** with Display Scale | None |
| Content height (2-line name) | ~130–150px typical | ~120–140px typical | taller medicine stack |

**Geometry verdict:** Proportions support cashier speed for dense grids. Cards are **not** oversized. The main geometry failure mode is **external** — the grid track count does not adapt when only 1–2 products exist (Part 8).

---

# PART 2 — Information Hierarchy

### Retail (confirmed correct)

```text
Product Name   ← dominant (font-black, first, line-clamp-3)
    ↓
Price          ← secondary (tabular-nums, accent color)
    ↓
Stock          ← tertiary (smallest)
    ↓
“+” cue        ← corner affordance; whole card is the hit target
```

Phase 28.1 intent is intact. **Add does not dominate** the card — it supports tap-to-add. Name dominates.

### Pharmacy (divergent)

```text
Brand → Generic → Detail → Badges → Stock → FEFO → Price (last)
```

No “+” glyph. Price is last, not second. Low-stock color coding absent.

---

# PART 3 — Product Name Readability

| Aspect | Retail | Notes |
|--------|--------|-------|
| Font | ~14px effective @ Display Scale normal | Desktop coded 13px overridden to 14px when DS active |
| Clamp | `line-clamp-3` | Adequate for “Samsung Galaxy S24 Ultra”, “Construction Nail 3 Inch” |
| Wrap | Default `word-break: normal` | Space wraps preferred; no mid-word force |
| Long unbroken tokens | Clip via clamp | Edge case (e.g. `PENTIUM/120GB/8GB`) may truncate without mid-token break — acceptable if rare |
| Weight | `font-black` | Strong identification |

**Verdict:** Names communicate enough identity for most retail SKUs. Extreme slash-concatenated SKUs may need a soft `overflow-wrap` fallback (P2), not a hierarchy rewrite.

---

# PART 4 — Price Presentation

| Aspect | Finding |
|--------|---------|
| Format | `formatProductPriceLabel` → `N UGX` or `N UGX / unit` |
| Retail size | `text-xs` / 12px @ normal DS — scannable |
| Alignment | `tabular-nums` on retail — good |
| Color | Teal/waka accent — immediately recognizable |
| Zero / missing | Renders `"—"` with no warning style |
| Pharmacy | Larger (`text-sm`) but **no** `tabular-nums` |

**Verdict:** Prices scan instantly on retail. Pharmacy price emphasis is inconsistent with retail hierarchy.

---

# PART 5 — Stock Presentation

| Card | Presentation | Signal strength |
|------|--------------|-----------------|
| Mobile | Chip: `{label}: {formatStockLabel}` + success/danger fill | Strong |
| Desktop | Plain colored text only | Weaker |
| Pharmacy | Muted text, no low-stock color | Weakest |

`formatStockLabel` can be verbose (`"3 Boxes · 42 Pieces"`). Useful for packaging shops; can feel dense on narrow tiles when truncated.

**Verdict:** Stock is correctly tertiary. Desktop should regain a compact chip (or equivalent scan cue). Consider shorter default wording on dense desktop columns (P1).

---

# PART 6 — Add Action

| Aspect | Finding |
|--------|---------|
| Hit target | Whole card (correct for POS speed) |
| Visual “+” | Corner cue — supports, does not dominate |
| Mobile size | 44px coded / 48px DS |
| Desktop size | 36px coded / 48px DS when active |
| Pharmacy | No visual add cue |
| Favorite ★ | Separate 32px target on desktop only |

**Verdict:** Add action balance is **correct** for retail. Do not enlarge the CTA into a full-width bar (that was the Phase 28.0 anti-pattern).

---

# PART 7 — Product Grid Density

### Column model (container-aware)

| Catalog width | Columns |
|--------------:|--------:|
| Phone band | 2 portrait / 3 landscape |
| 520–639 | 4 |
| 640–679 | 5 |
| 680–859 | 6 |
| 860–979 | 7 |
| 980–1159 | 8 |
| 1160–1399 | 9 |
| 1400–1899 | 10 |
| ≥1900 | 12 |

### Estimated viewport behavior

| Viewport | Empty cart | Cart open (sidebar) |
|----------|------------|---------------------|
| 320–390 | 2 | 2 (overlay) |
| 768 | ~6 | ~6 (no sidebar) |
| 1024 | ~8 | ~6 (−25%; geometry floor) |
| 1366 | ~9 | ~9 (stabilized) |
| 1920 | ~10 | ~10 |

### Catalog size scenarios

| SKUs | Behavior |
|-----:|----------|
| 1–10 | Non-virtualized CSS grid; same column count as dense |
| 11–50 | Virtualized; good throughput |
| 500+ | Virtualized + overscan; scroll owner = catalog pane |

**Verdict:** Dense browsing is enterprise-grade. Residual cliff only near **1024** when checkout mounts.

---

# PART 8 — Sparse Shelf Behaviour

**Primary finding of this audit.**

When a shelf has 1–2 products (common in screenshots):

```text
┌──────────────────────────────── Catalog ────────────────────────────────┐
│ [Card] [  empty track  ] [ empty ] [ empty ] … [ empty ]                │
│  ↑ left-aligned in column 1 of an 8–10 column grid                      │
└─────────────────────────────────────────────────────────────────────────┘
```

Evidence:

- `VIRTUAL_PRODUCT_THRESHOLD = 10` → non-virtualized path.  
- `gridTemplateColumns: repeat(${productGridCols}, minmax(0, 1fr))` always.  
- No `max-width`, no centering, no “fill available when few items” rule.

| Question | Answer |
|----------|--------|
| Does it feel unfinished? | **Yes** on wide desktops |
| Adaptive widths for sparse shelves? | **Recommended** (cap columns to `min(productGridCols, productCount)` or soft max-width) |
| Change spacing/alignment? | Yes — avoid orphan single-tile rows spanning 10 tracks |

This is the highest-impact presentation fix remaining in Sell.

---

# PART 9 — Empty Space Audit

| Region | Finding |
|--------|---------|
| Sparse product grid | **Primary waste** — unused column tracks |
| Dense product grid | Low waste; fluid `1fr` tracks |
| Card internal padding | Not excessive (8–10px) |
| Last virtualized row | Partial row leaves empty tracks (CSS Grid norm) |
| Header / drill-down | Justified context chrome (Phase 32.3) |

---

# PART 10 — Enterprise Benchmark (workflow / density)

| Practice | Square / Shopify / Lightspeed / Toast norm | WAKA today | Gap |
|----------|--------------------------------------------|------------|-----|
| Name-first tiles | Standard | Met (28.1) | Closed |
| Whole-tile tap to add | Standard | Met | Closed |
| Dense multi-column catalog | Standard | Met (container-aware) | Closed |
| Sparse results don’t look broken | Standard | **Fails** on wide registers | **Open** |
| Stable density when cart opens | Standard | Mostly met; residual @1024 | Partial |
| Consistent medicine vs retail browse cues | Standard | Pharmacy diverges | Open |
| Keyboard focus rings | Standard | Missing on cards | Open |

Do **not** copy layouts. Adopt behaviours: sparse-result packing, consistent scan cues, stable density.

---

# PART 11 — Accessibility

| Aspect | Status |
|--------|--------|
| Whole-card tap | Good |
| Touch CTA | Good when Display Scale on |
| Favorite ★ 32px | Below touch guidance |
| Focus-visible | **Missing** on product cards |
| `aria-label` | Static; ignores cart qty / lock reason |
| Barcode workflow | Out of scope (already certified) |
| Zoom 80–150% | Relies on Display Scale + layout bands from 32.1 |

---

# PART 12 — Root Cause Register

Ranked by impact on **identify → select → add** speed.

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | P0 | Sparse shelves (1–few products) left-align in a full multi-column grid — looks unfinished; wastes scan space | `PosPage` `repeat(productGridCols, 1fr)` when `length ≤ 10` |
| **RC-2** | P1 | Desktop stock loses mobile chip fill — weaker success/danger scan cue | `PosDesktopProductCard` vs `PosSellProductCard` |
| **RC-3** | P1 | Residual ~25% column drop at ~1024 when checkout mounts (1366+ stabilized in 32.3) | `stabilizeCatalogColumnCount` + checkout width |
| **RC-4** | P1 | Display Scale `compact` shrinks stock (~7.9px) **and** adds +2 columns | `scaleTokens` + `catalogColumnDeltaForScale` |
| **RC-5** | P1 | Pharmacy medicine card: price last, no “+” cue, no low-stock color; `compact` prop dead | `PharmacySellMedicineCard` / virtualizer call site |
| **RC-6** | P1 | Stock wording can be verbose on narrow tiles (`Boxes · Pieces`) | `formatStockLabel` + truncate |
| **RC-7** | P2 | Badge corner flips mobile (right) vs desktop (left) | Both retail cards |
| **RC-8** | P2 | Favorite star 32px isolated target | `PosDesktopProductCard` |
| **RC-9** | P2 | No focus-visible styling on product cards | Card components |
| **RC-10** | P2 | `aria-label` omits cart qty / lock reason | Retail cards |
| **RC-11** | P3 | Unreachable virtualizer `"default"` variant | `VirtualizedProductGrid` |
| **RC-12** | P3 | Rare unbroken long-token names have no soft wrap fallback | Retail name classes |

### Already closed (do not re-litigate)

- Name-first hierarchy / `line-clamp-3` (28.1)  
- Corner “+” vs full-width Add bar (28.1)  
- Phone 2-col portrait (28.1)  
- Virtualizer estimates + `measureElement` (32.3)  
- Shelf packing / soft shelf colors (32.3 / 32.3.1)  

---

# PART 13 — Enterprise Improvement Roadmap

### P0 — Cashier speed (Phase 32.4.1 candidate)

1. **Sparse-shelf packing** — when product count is low, reduce effective columns (e.g. `min(cols, max(productCount, 2–3))`) and/or apply a max card width so 1–2 products don’t look abandoned on ultrawide.  
2. Keep product hierarchy unchanged (name → price → stock → +).

### P1 — Visual polish / scan cues

3. Restore compact stock chip (or equivalent) on desktop.  
4. Soften Display Scale `compact` stacking (font shrink + column +delta).  
5. Align pharmacy medicine card cues with retail (price position / add affordance / low-stock color) without changing clinical business rules.  
6. Optional denser stock label for narrow columns.  
7. Residual 1024 cart-density tweak if still noticeable after sparse fix.

### P2 — Micro-interactions / a11y cleanup

8. Focus-visible rings on product cards.  
9. Grow favorite hit target; unify badge corners.  
10. Richer `aria-label` (qty / locked).  
11. Soft wrap fallback for slash-concatenated SKUs.  
12. Delete unreachable `"default"` card variant.

### Explicit non-goals

- No checkout / pricing / barcode / inventory / sync / DB changes  
- No product-card hierarchy rewrite  
- No product images requirement  
- No visual cloning of Square / Toast / Shopify layouts  
- No shelf-browser rework (complete as of 32.3.1)

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Do cards maximize recognition speed? | **Yes for dense shelves**; sparse shelves undermine confidence. |
| Change proportions for desktop/laptop? | **Slightly** — prefer sparse packing / max-width, not taller/wider cards by default. |
| Do names communicate enough before truncation? | **Usually yes** with `line-clamp-3`; rare SKU tokens are P2. |
| Is Add correctly balanced? | **Yes** on retail — keep corner cue + whole-card tap. |
| How should sparse shelves behave? | Fewer columns / bounded card width / intentional alignment — not 1 card in a 10-track row. |
| Biggest gains without business-logic changes? | **Sparse packing (P0)** + desktop stock cue + pharmacy cue parity. |

---

## Appendix A — Evidence index

| Claim | Location |
|-------|----------|
| Mobile card | `src/components/pos/PosSellProductCard.tsx` |
| Desktop card | `src/components/pos/PosDesktopProductCard.tsx` |
| Pharmacy card | `src/components/pos/PharmacySellMedicineCard.tsx` |
| Virtualizer | `src/components/pos/VirtualizedProductGrid.tsx` |
| Column math | `src/lib/posProductGridColumns.ts` |
| Density stabilize | `stabilizeCatalogColumnCount` + `posCatalogDensity.test.ts` |
| Sparse grid path | `src/pages/PosPage.tsx` `VIRTUAL_PRODUCT_THRESHOLD` |
| Display Scale product CSS | `src/index.css` `.pos-ds-product-*` |
| Price format | `formatProductPriceLabel` in `usePosStore` |
| Stock format | `formatStockLabel` in `sellingEngine.ts` |
| Prior hierarchy cert | `docs/PHASE_28_0_…CERTIFICATION.md` |
| Prior shelf/grid cert | `docs/PHASE_32_2_…CERTIFICATION.md` |

## Appendix B — What this audit is not

- Not a shelf-browser re-audit (32.2–32.3.1 complete)  
- Not a workspace mount/zoom re-audit (32.0–32.1 complete)  
- Not permission to introduce product images  
- Not a redesign of tap-to-add / barcode / cart math  

---

**Certified by:** Phase 32.4 Enterprise Product Card & Product Grid read-only forensic audit — 2026-08-03  

**Decision:** Product **hierarchy is certified**. Product **grid packing for sparse shelves is not**. Fix sparse packing + scan-cue polish, then freeze Sell presentation.

---

## Phase 32.4.1 — Product Grid Density & Sparse Shelf Optimization

**Mode:** Surgical implementation (grid presentation + scan cues; retail hierarchy unchanged)  
**Date:** 2026-08-03  

### Before / after sparse shelf layouts

#### Before (32.4)

```text
Dense column count from container width only (e.g. 10 @ 1920)
1 product  → card in column 1 of 10  → huge empty canvas
3 products → three tiny cards, seven empty tracks
```

#### After (32.4.1)

```text
sparseAwareCatalogColumnCount(denseCols, productCount)
1 product  → 3 cols (wide intentional card) on desktop; 1 col on phone
3 products → 3 cols (full balanced row)
5 products → 5 cols
≥8 products → unchanged dense enterprise grid
```

### Adaptive column logic

| Piece | Location |
|-------|----------|
| `sparseAwareCatalogColumnCount` | `src/lib/posProductGridColumns.ts` |
| Floor (≥8 = dense) | `POS_SPARSE_PRODUCT_FLOOR` |
| Virtualizer | applies sparse internally |
| Non-virtual PosPage grids | `catalogColsFor(n)` |
| Pharmacy browse | same via `VirtualizedProductGrid` |

### Desktop scan improvements

- Desktop stock cue restored to compact success/danger **chip** (parity with mobile).  
- Display Scale `compact` column delta **+2 → +1** (less stacking vs smaller type).  
- Pharmacy medicine card hierarchy aligned: **Name → Price → Stock → +** (clinical badges secondary); `compact` prop wired from mobile band.

### Responsive verification (implementation)

| Width | Sparse 1 SKU | Dense 50 SKUs |
|------:|--------------|---------------|
| 320–390 | 1 col (full width) | 2-col phone band |
| 768 | 2 cols | Adaptive ~6 |
| 1024–1366 | 2–3 cols | Dense 6–9 |
| 1920 / ultrawide | 3 cols | Dense 10–12 |

### Regression summary

| Area | Changed? |
|------|----------|
| Retail product hierarchy (name→price→stock→+) | No |
| Checkout / pricing / barcode / inventory / sync / DB | No |
| Sparse packing, desktop stock chip, pharmacy cue parity, compact Δ | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Sparse shelves no longer leave huge unused desktop areas | **Met** |
| Cards expand for few products; dense shelves unchanged | **Met** |
| Desktop scan rhythm intentional | **Met** |
| Pharmacy shares product-grid presentation model | **Met** |
| Sell presentation ready to freeze | **Met** |

---

## Phase 32.4.2 — Product Card Proportion & Shelf Title Readability

**Mode:** Surgical presentation polish (regressions from 32.4.1)  
**Date:** 2026-08-03  

### Before / after shelf title readability

| Issue | Before | After |
|-------|--------|-------|
| Ellipsis on “Analgesics” | Title shrink + short row track | Full enterprise title size; taller row (`9.25` / `7.5` rem) |
| Mid-word / awkward breaks | Over-constrained wrap | Space-first wrap; `overflow-wrap: break-word` last resort only |
| `Surface GO` | Preserved ALL-CAPS fragment | Display `Surface Go` |
| Product count | Competed with title | Lower opacity / secondary rhythm |

### Product card proportion improvements

| Sparse shelves | Before 32.4.2 | After |
|----------------|---------------|-------|
| Layout | `1fr` tracks → form-like wide cards | `minmax(0, 228px)` + `justify-content: center` |
| 1–7 SKUs | Stretched | Balanced vertical cards, centered |
| ≥8 SKUs | Dense `1fr` | Unchanged |

Helper: `catalogProductGridStyle()` in `posProductGridColumns.ts` (`POS_PRODUCT_CARD_MAX_WIDTH_PX = 228`).

### Sparse shelf balancing

| Products | Behaviour |
|----------|-----------|
| 1 | Centered card(s) under 3-col sparse cap, max 228px |
| 2–7 | Centered adaptive row, max card width |
| ≥8 | Existing dense fluid grid |

Phone band stays fluid full-width (no max-width stretch).

### Responsive verification

Verified via column + style helpers for 320–1920 / ultrawide — dense path untouched; sparse path capped + centered.

### Regression summary

| Area | Changed? |
|------|----------|
| Adaptive sparse packing / virtualizer / pharmacy parity | Preserved (style layer only) |
| Checkout / pricing / barcode / sync / DB | No |
| Shelf row height, title wrap, card max-width centering | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Shelf names readable without unnecessary truncation | **Met** |
| Product cards balanced (not form-wide) | **Met** |
| Sparse intentional; dense unchanged | **Met** |
| Sell visual quality ready for maintenance freeze | **Met** |

---

## Phase 32.4.3 — Direct Product Selection

**Mode:** Surgical presentation / interaction polish (Sell Mode only)  
**Date:** 2026-08-03  

### Before / after interaction model

| Before | After |
|--------|-------|
| Floating **+** glyph competed with product identity | No **+** on Sell cards |
| Cue implied “manage / add control” | Cue is the **whole card** = sell this product |
| Extra vertical space reserved for CTA | Reclaimed for name / price / stock rhythm |

### Full-card activation

- Mobile, desktop, and pharmacy Sell cards: `onPick` on the card (or primary button filling the card).  
- Business logic unchanged: one-tap add, variant sheets, barcode, pharmacy dispense.  
- Press feedback: ~150ms `active:scale-[0.985]` + teal highlight flash; existing toast / cart qty badge retained.  
- Desktop favorite ★ remains a separate control (`stopPropagation`).

### Sell vs Inventory distinction

| Surface | Interaction |
|---------|-------------|
| **Sell** | Whole-card selection; no floating + |
| **Inventory** | Unchanged management actions / buttons |

### Accessibility verification

- Cards remain `<button>` (or primary button) with `aria-label` including add intent + product name.  
- `focus-visible` teal outline on Sell cards.  
- Keyboard activation via native button semantics.  
- Locked state stays `disabled` with visual dimming.

### Regression summary

| Area | Changed? |
|------|----------|
| Add-to-cart / barcode / variants / pharmacy flows | No (same `onPick`) |
| Checkout / pricing / sync / DB / virtualizer | No |
| Product hierarchy (name → price → stock) | No |
| Floating + on Sell cards; spacing / press feedback | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Sell no longer resembles inventory management | **Met** |
| Whole card is the natural action target | **Met** |
| Cleaner product information | **Met** |
| Inventory workflows unchanged | **Met** |
| Sell ready for long-term maintenance | **Met** |

**Recommended next step:** Freeze Sell architecture; features / ops only. Compact List View remains an optional deferred preference.
