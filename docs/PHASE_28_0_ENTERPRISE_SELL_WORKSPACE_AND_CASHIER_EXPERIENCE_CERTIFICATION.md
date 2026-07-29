# Phase 28.0 — Enterprise Sell Workspace & Cashier Experience Certification

**Mode:** Read-only forensic certification (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-07-29  
**Scope:** Sell / POS cashier workspace — architecture, product identification (text-only), search, shelves, cart, payment, mobile ergonomics, large-catalog readiness  
**Primary focus:** Cashier speed, product-name visibility without images, discoverability, high-volume retail workflows  
**Out of scope for Phase 28.1:** Product images (optional P3 only)  
**Related prior work:** Phase 25.2 / 25.3 (scroll & touch), Phase 27.x (inventory — separate module)  
**Next phase:** Focused Phase 28.1 implementation against P0/P1 roadmap below  

---

## Executive Summary

WAKA Sell (`/pos` → `PosPage`) is a **mature, feature-rich cashier surface**: indexed search, barcode scan-to-cart, virtualized product grids, shelf masonry, desktop split checkout, mobile checkout overlay + FAB, display-scale density, and pharmacy medicine cards. Scroll/touch hardening from Phase 25.x improved catalog interaction.

It is **not yet enterprise-certified for text-first product identification and minimal-tap selling** because:

1. **Product names are systematically under-prioritized** — mobile/desktop sell tiles use `line-clamp-2` at **12px / 11px** while price and Sell/Add CTAs consume disproportionate card height.  
2. **Default add path opens a full-screen quantity sheet** unless kiosk quick-sell + single preset is configured — extra taps vs Square/Lightspeed “tap = add 1”.  
3. **Shelf grid is not virtualized** — fine at ~20 shelves; operationally costly at ~100.  
4. **Grid column math favors density over legibility** — phones often render **3 columns**; wide desktops up to **12**, shrinking name real-estate further.  
5. **Search/barcode are strong** and become the correct primary path at large inventory — but browse-by-shelf remains the default empty-query UX.

| Surface | Score | Verdict |
|---------|------:|---------|
| **Mobile usability (≤767 px)** | **6.1 / 10** | Not certified — sell works; identification & tap friction fail enterprise bar |
| **Tablet usability (768–1023)** | **6.9 / 10** | Conditionally usable; hero + slideover help; same name/CTA issues |
| **Desktop usability (≥1024)** | **7.6 / 10** | Split checkout strong; dense tiles hurt long SKU names |

**Overall Sell / Cashier Experience Readiness: 6.6 / 10**

Target after a clustered Phase 28.1 (no images): **≥ 8.5 mobile / ≥ 8.5 tablet / ≥ 8.8 desktop** for text-first cashier speed.

---

## Certification Methodology

1. Static route & component map (`App.tsx` → `PosPage` → `src/components/pos/*`).  
2. Product-card CSS/Tailwind forensics (`PosSellProductCard`, `PosDesktopProductCard`, `PharmacySellMedicineCard`, `VirtualizedProductGrid`).  
3. Catalog column math (`posProductGridColumns.ts`, `useCatalogContainerWidth`).  
4. Search index & barcode path (`posProductSearch.ts`, `useSellBarcodeScanner`, `posScanToCart.ts`).  
5. Shelf layout (`posShelfLayout.ts`, `PosShelfTile`, masonry classes).  
6. Cart & checkout (`DraftCartLineRow`, `PosCheckoutPanel`, FAB / overlay / sidebar).  
7. Layout bands (`resolvePosLayoutMode`, desktop split).  
8. Benchmark against Square / Lightspeed / Shopify POS / Toast **workflows** (not UI clones).  

**Not performed:** Live eye-tracking; timed cashier lab with 2k–10k live SKUs on every device class; A/B of tap-to-add vs sheet.

**Assumption:** Text-based identification only — no product images evaluated or recommended for 28.1.

---

## PART 1 — Sell Workspace Architecture

### Live spine

```text
Entry
  Home launcher / pharmacy POS redirect / AppShell nav → /pos
        ↓
ShiftSellGateway (shift gate)
        ↓
PosPage
  ├─ Chrome
  │    PosOfflineBanner
  │    PosDesktopCompactHeader  (≥1024)
  │    PosShiftSummaryCollapsible / ActiveShiftBanner
  │    PosOperationalNav        (<1024)
  │    PosSellHeroCard          (tablet compact only)
  │
  ├─ Catalog column
  │    Sticky search (+ clear / camera barcode)
  │    Shelf navigation (masonry PosShelfTile)  ← empty query + “all”
  │    Quick-sell horizontal chips (optional)
  │    Product drill-down / search results
  │         VirtualizedProductGrid
  │           sellMobile → PosSellProductCard
  │           sellDesktop → PosDesktopProductCard
  │           pharmacyMedicine → PharmacySellMedicineCard
  │    Add-to-sale sheet (full-screen) when not single-preset quick path
  │
  ├─ Cart / payment
  │    Desktop (≥1024): PosCheckoutPanel sidebar (+ optional catalog dock numpad)
  │    Mobile: PosMinimizedCheckoutFab → overlay PosCheckoutPanel
  │    Tablet compact: PosCompactCheckoutSlideover
  │         DraftCartLineRow / DraftCartSummary
  │         Payment methods · keypad · customer · change
  │         Save sale
  │
  └─ Sale complete
       Receipt modal (print / share / dismiss)
       Haptics + success tone
```

### Component register (primary)

| Stage | Components / libs |
|-------|-------------------|
| Page shell | `PosPage.tsx`, `ShiftSellGateway`, `AppShell` sell-focus |
| Shelves | `PosShelfTile`, `PosSellCatalogShelfSection`, `posShelfLayout.ts`, arrange panel |
| Search | Sticky input + `buildProductSellSearchIndex` / `filterIndexedProductsForSellView` |
| Barcode | `barcodeAdapter`, `useSellBarcodeScanner`, `resolveScanToCartInput` |
| Grid | `VirtualizedProductGrid`, `useCatalogContainerWidth`, `catalogColumnCount` |
| Cards | `PosSellProductCard`, `PosDesktopProductCard`, `PharmacySellMedicineCard` |
| Add qty | Full-screen sheet in `PosPage` (presets / money / qty keypad) |
| Cart | `DraftCartLineRow`, `DraftCartSummary`, qty/discount/void modals |
| Checkout | `PosCheckoutPanel`, `CheckoutNumpadDock`, FAB / slideover / sidebar |
| Receipt | Receipt overlay + `receiptPrint` / native share paths |
| Density | `DisplayScaleProvider`, `scaleTokens`, `.pos-ds-*` CSS vars |

### Layout bands

| Band | Width | Catalog mode | Checkout |
|------|------:|--------------|----------|
| Mobile | ≤767 | Viewport-locked catalog scroll | FAB → full overlay |
| Compact tablet | 768–1023 | Catalog sell mode + hero | Slideover / FAB |
| Full desktop | ≥1024 | Catalog + sticky sidebar checkout | Always-visible panel |

---

## PART 2 — Product Grid Certification (Critical)

### Column density (measured catalog width)

From `catalogColumnCount`:

| Catalog width | Columns | Approx card content width* |
|--------------:|--------:|----------------------------|
| <520 px (typical phone pane) | **3** (floor) | ~95–110 px |
| 520–639 | 4 | ~110–140 px |
| 640–819 | 5 | … |
| ≥1900 | **12** max | ~120–150 px on ultrawide |

\*After grid gap; excludes card padding. Display Scale `compact` **adds** columns (worse name width); `large` / `extra_large` reduce columns (better).

### Card metrics (retail sell tiles)

| Metric | Mobile `PosSellProductCard` | Desktop `PosDesktopProductCard` | Pharmacy card |
|--------|----------------------------|---------------------------------|---------------|
| Min height | 108 px | 108 px (+ 40 px avatar) | 148–168 px |
| Name | `line-clamp-2` **text-xs (12px)** font-black | `line-clamp-2` **text-[11px]** | `line-clamp-2` **text-base (16px)** |
| Price | **text-sm (14px)** teal/waka | text-xs | text-sm |
| Stock | 9px badge / truncate | 9px truncate | 11px |
| Primary action | Full-width **Add** CTA `min-h-[36px]` | Separate Sell `min-h-[28px]` + whole body tap | **Whole card tap** (no footer CTA) |
| Touch | `touch-pan-y`; CTA ≥36 px (below 44 px ideal) | Body tap + 28 px CTA | Full card |

### Forensic answers

| Question | Finding |
|----------|---------|
| Characters visible before truncation? | On 3-col phone (~100 px content): **~11–14 chars/line**, **~22–28 chars total** across 2 lines (bold 12px). Long retail names (~30–50 chars) truncate mid-phrase. |
| Similar products distinguishable? | **Often no** when variants share a prefix (`Intel Pentium…`, medicine strengths only in secondary line). Pharmacy secondary `truncate` (1 line) helps only if brand differs. |
| Name vs action priority? | **Action/price win.** Price is larger than name on mobile; CTA claims ~⅓ of card height. Desktop avatar (letter) + CTA further starve name. |

### Density vs identification trade-off

Virtualization (`@tanstack/react-virtual`, overscan 5, row estimate 112–120 px sell) is **correct** for large catalogs. Column floor of **3** on narrow panes maximizes SKUs on screen but **fails text identification** — the core P0 of this audit.

---

## PART 3 — Product Name Visibility

### Truncation model

All primary sell cards use **CSS `line-clamp-2`** (ellipsis after 2 lines). No character-count truncation in JS — visible glyphs depend entirely on **card width × font-size × weight**.

### Example reconstruction (static estimate)

```text
Full name:  Intel Pentium 120GB SSD 8GB RAM   (≈32 chars)

Mobile 3-col, text-xs, ~100px content:
  Line 1: Intel Pentium
  Line 2: 120GB SSD 8G…     ← operator may only see “PENTIUM/120GB…” style fragments

Desktop 8–12 col, text-[11px], avatar above:
  Even less horizontal room per line → earlier truncation
```

Quick-sell chip path is worse for names: `max-w-[7rem] truncate` (**single line**, ~112 px) — intentional for speed chips, not browse identification.

### Minimum layout needed for reliable text ID (recommendation for 28.1 — not implemented here)

| Requirement | Rationale |
|-------------|-----------|
| Name ≥ **14–16 px** (or `text-sm`) on phone | Matches price hierarchy to cashier priority |
| Prefer **2-col** on ≤412 px (or min card content ≥140 px) | ~18–22 chars/line → ~36–44 chars / 2 lines |
| Optional 3rd line for SKU/variant or `line-clamp-3` for long names | Distinguishes near-duplicates |
| Demote CTA: whole-card tap + small “+” OR icon-only | Square/Lightspeed pattern |
| Keep pharmacy `text-base` pattern as reference | Already closer to enterprise ID |

---

## PART 4 — Shelf Navigation

### Behavior

- Empty search + “all categories”: **masonry shelf grid** (`shelfMasonryGridClass`) — **2 cols mobile**, up to 6 on wide.
- Tap shelf → drill-down product grid (virtualized) with back control.
- Shelves **not virtualized** — every `PosShelfTile` mounts.
- Counts, empty/restock styling, featured/promotion badges supported.
- Arrange mode exists (`PosShelfArrangePanel`) outside the happy-path sell loop.

### Efficiency

| Shelf count | Assessment |
|------------:|------------|
| **≤20** | Efficient — 2-col masonry fits 1–2 viewports; discoverable. |
| **~50** | Scroll fatigue rises; search becomes preferred; badges help only if curated. |
| **~100** | **Not efficient** — long scroll, no virtualization, high DOM; pinning/featured + search must carry the workflow. Label `line-clamp-2` at 10 px on catalog-grid tiles also truncates shelf names. |

**RC:** Shelf-first UX assumes curated shelf counts. Large category trees need search-first or virtualized/filterable shelf rail (P1).

---

## PART 5 — Search Experience

### Strengths (enterprise-grade foundation)

| Aspect | Evidence |
|--------|----------|
| Visibility | Sticky search above catalog on mobile/desktop sell |
| Index | Precomputed haystacks (name, category, SKU, units, medicine fields) |
| Matching | Token + loose alphanumeric; barcode match first |
| Ranking | Favorites first, then `localeCompare` name |
| Barcode | HID wedge + camera overlay; `resolveScanToCartInput` can **fast-add** without sheet |
| Keyboard | Enter commits; focus restored after quick add; shortcut `focus_search` |

### Gaps

| Aspect | Finding |
|--------|---------|
| Default mental model | Empty query shows **shelves**, not products — large shops must discover search |
| Ranking | No recency / frequency / exact-prefix boost beyond favorites (frequent chips exist separately) |
| Result cards | Same truncated tiles as browse — search finds the SKU then **identification still weak** |
| Soft keyboard | Search focus can shrink catalog height; mitigated by sticky bar + catalog scroll ownership |

**Verdict:** Search **should** be the primary path for ≥500–2000 SKUs. It is technically ready; **UX does not yet force or teach search-first** for large inventories. Barcode path is the fastest enterprise loop when SKUs are coded.

---

## PART 6 — Cart Experience

### Line controls (`DraftCartLineRow`)

| Action | Taps (typical) | Notes |
|--------|---------------:|-------|
| +1 / −1 | 1 | Large 44–56 px targets on compact/full rows |
| Exact qty | 2+ | Tap qty → `QuantityEditModal` |
| Line discount | 2+ | Button → `DiscountLineModal` |
| Remove | 1 | ✕ control |
| Dock mode (sidebar) | — | Qty steppers only; discount/remove may be less exposed |

### Friction

- **Mobile dock/overlay** must balance cart list + numpad — scrolling cart while paying is workable but dense.  
- Cart-level discount via separate modal (`CartSaleDiscountModal`) — appropriate, not on critical path.  
- Line **notes** / tax breakdown are not first-class on the row (tax handled in totals engine) — acceptable for retail speed.  
- After add, mobile **auto-minimizes** checkout (`setSaleCheckoutMinimized(true)`) — good for continued browsing; requires FAB tap to pay.

**Unnecessary taps:** primarily **upstream** (add sheet), not stepper quality once in cart.

---

## PART 7 — Payment Workspace

### Methods

`cash` · `atm` · `mobile_money` · `mixed` · `credit` — chip selector in `PosCheckoutPanel`.

### Cashier efficiency

| Step | Assessment |
|------|------------|
| Keypad | Strong — digit pad + Italian-style dock with Save; alpha mode for customer fields |
| Amount received / change | Explicit labels; change due surfaced when cash/credit |
| Customer | Select + name/phone fields (credit); debt guard if credit without customer |
| Save sale | Primary confirm on dock — good |
| Receipt | Post-sale modal with print/share — correct; one extra dismiss tap |
| Desktop | Always-visible sidebar — **best band for speed** |
| Mobile | Overlay covers catalog — correct modal pattern; thumb reach to Save depends on keypad height |

**Verdict:** Payment UX is **closer to enterprise** than product identification. Main speed loss is getting into checkout with correct lines, not the keypad itself.

---

## PART 8 — Mobile Ergonomics

| Factor | Finding |
|--------|---------|
| Thumb reach | Search top; FAB checkout bottom above nav — good primary arc; shelf mid-scroll |
| Primary actions | Search sticky; Add CTA mid-card; Checkout bottom strip `min-h-[48px]` |
| Scrolling | Single catalog scroll pane (Phase 25); tiles `touch-pan-y` |
| Keyboard | Search and add-sheet compete with viewport; add sheet uses safe-area + keyboard inset |
| Safe areas | FAB / overlay account for `--waka-bottom-nav-h` + safe bottom |
| Orientation | Portrait-first; landscape not independently optimized |
| One-handed sell | Feasible for barcode/search + FAB; multi-shelf browse needs two-hand scroll |

---

## PART 9 — Information Hierarchy

### Observed attention order (retail mobile card)

1. **Sell/Add CTA** (full-width teal bar)  
2. **Price** (larger than name)  
3. **Product name** (smallest primary text, clamped)  
4. **Stock badge**  
5. **Search** (chrome, strong when used)  
6. **Shelf** (default home of browse)  
7. **Cart FAB** (when items exist)

### Cashier-priority order (enterprise target)

1. Product identity (name + distinguishing attribute)  
2. Price  
3. Stock (exception: out-of-stock / Rx)  
4. Add affordance (whole tile)  
5. Search / scan  
6. Cart total  

**Mismatch:** Visual hierarchy **inverts** cashier priority — CTA/price over identification. Pharmacy cards are closer to the target (name `text-base`, whole-card tap).

---

## PART 10 — Large Inventory Simulation

| Catalog size | Browse shelves | Product grid | Search | Operational note |
|-------------:|----------------|--------------|--------|------------------|
| **500** | OK if ≤20–30 shelves | Virtualized — OK | Indexed — primary | Truncation already hurts |
| **2,000** | Shelf scroll painful if many categories | Virtualized — OK | **Must be primary** | Favorites/quick-sell critical |
| **10,000** | Shelf-first **fails** | Virtualized rows OK; filter cost O(n) per keystroke on index walk | Still usable if haystack index kept warm | Need prefix/recency ranking; avoid rendering all shelves |

**Where UI slows operationally (not only FPS):**

1. Finding the right shelf among dozens.  
2. Mis-taps from truncated near-duplicate names.  
3. Add-sheet for every non-preset SKU.  
4. DOM cost of **100 non-virtualized shelf tiles**.

Render performance of the product virtualizer is **not** the primary 10k bottleneck — **workflow and identification** are.

---

## PART 11 — Desktop vs Mobile

| Concern | Phone | Tablet | Desktop |
|---------|-------|--------|---------|
| Layout | Independently designed (FAB, overlay, sticky search) | Hybrid (hero + slideover) | Independently designed (split columns, compact header, status bar) |
| Cards | `PosSellProductCard` | Same sell mobile path in catalog mode | `PosDesktopProductCard` (+ letter avatar) |
| Checkout | Overlay | Slideover | Persistent sidebar |
| Density | 3-col floor | Mid columns | Up to 12 cols |
| Optimization quality | Purpose-built chrome; **weak ID** | Partial | Strong checkout; **weakest name width** |

**Verdict:** Not a simple CSS scale — real layout forks exist — but **product identification debt is shared** across bands.

---

## PART 12 — Enterprise Benchmark (workflow practices)

| Practice (Square / Lightspeed / Shopify POS / Toast) | WAKA today | Gap |
|------------------------------------------------------|------------|-----|
| Tap product → add default unit immediately | Only with kiosk + **single** preset or scan-to-cart | Default opens sheet |
| Name-first tiles / list rows for text catalogs | Price/CTA-first compact tiles | P0 |
| Search/scan primary at scale | Search excellent; shelves still default home | Teach/search-first P1 |
| Persistent cart totals | FAB / sidebar totals | OK |
| Large payment keypad | Present | OK |
| Favorites / recent | Favorites sort + quick-sell chips + frequent-today | Good building blocks |
| Minimal chrome while selling | Still shift chips / operational nav on mobile | Acceptable; watch density |

**Do not copy UIs** — adopt: **name-first tiles, tap-to-add-1, search-first at scale, whole-card hit targets.**

---

## PART 13 — Root Cause Register

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | P0 | Product names truncate too aggressively for text-only ID | `line-clamp-2` + `text-xs` / `text-[11px]` on 3–12 col grids |
| **RC-2** | P0 | Cards prioritize CTA/price over identification | Price `text-sm` > name `text-xs`; full-width Add `min-h-[36px]` |
| **RC-3** | P0 | Default add path is multi-step sheet | `openProduct` → `setSheetOpen(true)` unless single quick preset |
| **RC-4** | P1 | Mobile product density (3-col floor) reduces legibility | `catalogColumnCount` min 3 |
| **RC-5** | P1 | Shelf-first home does not scale to many categories | Non-virtualized masonry; 100 shelves = scroll tax |
| **RC-6** | P1 | Search ranking lacks recency/frequency/exact boost | Favorites + alpha only in `filterIndexedProductsForSellView` |
| **RC-7** | P1 | Desktop avatar + dense columns waste identification space | `PosDesktopProductCard` h-10 avatar + 11px name |
| **RC-8** | P2 | Add CTA touch height 28–36 px below 44 px guideline | Card CTAs vs cart steppers |
| **RC-9** | P2 | Quick-sell chips single-line truncate at 7rem | Speed feature; OK if curated |
| **RC-10** | P3 | No product images | Explicitly out of 28.1; optional future |

---

## PART 14 — Enterprise Implementation Roadmap

### P0 — Critical (cashier speed / selection errors)

1. **Name-first product tiles (text-only)** — enlarge name, demote/remove footer CTA in favor of whole-card tap (+ subtle add affordance).  
2. **Widen mobile cards** — 2 columns on ≤412–520 px catalog width (or raise min content width).  
3. **Tap-to-add default qty=1** for simple piece products (keep sheet for multi-unit / money / pharmacy pack / presets).  
4. **Preserve barcode fast-add** — already good; ensure piece SKUs prefer scan path.

### P1 — High (workflow)

5. Search-first empty state when product count or shelf count exceeds thresholds.  
6. Virtualize or collapse shelf rail beyond N shelves; pin featured/quick.  
7. Search ranking: exact prefix → recent → frequent → favorites → alpha.  
8. Desktop: drop or shrink letter avatar; increase name to ≥12–13 px; cap columns when names suffer (tie to Display Scale).  
9. Align tablet compact path with the same card/add rules as mobile.

### P2 — Medium (polish)

10. Standardize touch targets ≥44 px on catalog CTAs if CTAs remain.  
11. Optional 3-line name clamp for long SKUs / list variant toggle.  
12. Reduce secondary sell chrome during active sale (chips density).

### P3 — Low (future)

13. Product images (optional) — **explicitly excluded from Phase 28.1**.  
14. Landscape-specific POS layout.  
15. AI suggest / visual search — out of scope.

### Suggested Phase 28.1 cluster (no images, no business-logic changes to pricing/stock math)

- P0-1 + P0-2 + P0-3 card/add UX  
- P1-5 search-first threshold (light)  
- Regression: barcode, pharmacy cards, desktop sidebar checkout, virtualization  

---

## Scorecard Summary

| Domain | Score |
|--------|------:|
| Architecture / completeness | **8.2 / 10** |
| Product grid & name visibility | **4.4 / 10** |
| Shelf navigation (≤20 / @100) | **7.5 / 5.0** |
| Search & barcode | **8.3 / 10** |
| Cart | **7.6 / 10** |
| Payment | **8.0 / 10** |
| Mobile ergonomics | **6.8 / 10** |
| Information hierarchy | **4.8 / 10** |
| Large inventory (2k–10k ops) | **5.5 / 10** |
| Desktop vs mobile independence | **7.8 / 10** |
| **Mobile overall** | **6.1 / 10** |
| **Tablet overall** | **6.9 / 10** |
| **Desktop overall** | **7.6 / 10** |
| **Overall cashier readiness** | **6.6 / 10** |

---

## Success Criteria — Phase 28.0 Outcome

At end of Phase 28.0 we know:

- Cashiers **cannot reliably** identify long/similar products from text on current sell tiles (esp. 3–12 col dense grids).  
- Product names **do not** have sufficient visibility vs price/CTA.  
- Sell screen prioritizes **density and add chrome** over identification speed.  
- Mobile friction centers on **truncated names**, **add sheet**, and **shelf-first** large catalogs — not the payment keypad.  
- Minimum Phase 28.1 set: **name-first tiles + fewer columns on phone + tap-to-add-1 for simple SKUs + light search-first** — **without product images**.

**Certification status:** Sell Workspace **NOT certified** for enterprise text-first cashier rollout until P0 items are resolved.

---

## Key file index (forensic)

| Path | Role |
|------|------|
| `src/pages/PosPage.tsx` | Sell orchestration, sheets, receipt, layout forks |
| `src/components/pos/PosSellProductCard.tsx` | Mobile retail tile |
| `src/components/pos/PosDesktopProductCard.tsx` | Desktop dense tile |
| `src/components/pos/PharmacySellMedicineCard.tsx` | Pharmacy ID-stronger tile |
| `src/components/pos/VirtualizedProductGrid.tsx` | Virtualized catalog |
| `src/lib/posProductGridColumns.ts` | Column breakpoints |
| `src/lib/posProductSearch.ts` | Search index / filter / sort |
| `src/lib/posScanToCart.ts` | Barcode fast-add |
| `src/lib/posShelfLayout.ts` | Shelves + masonry |
| `src/components/pos/DraftCartLineRow.tsx` | Cart line controls |
| `src/components/pos/PosCheckoutPanel.tsx` | Payment / keypad |
| `src/components/pos/PosMinimizedCheckoutFab.tsx` | Mobile cart CTA |
| `src/lib/posDesktopSplit.ts` | Desktop checkout width |
| `src/index.css` | `.pos-ds-product-*` display scale |

---

*End of Phase 28.0 forensic certification.*

---

## Phase 28.1 Product Selection Implementation

**Date:** 2026-07-29  
**Mode:** Surgical product-selection UX only — **no** checkout, payment, barcode routing math, inventory, tax, discount, sync, schema, or API changes.

### Before vs after — product card layout

| Element | Before (28.0) | After (28.1) |
|---------|---------------|--------------|
| Name | `line-clamp-2` · 11–12px · secondary | `line-clamp-3` · **14px / 13px** · **primary** |
| Price | Larger than name (14px) | Below name · 12px |
| Stock | Muted badge | Emerald / rose status chip |
| Add | Full-width CTA bar (~36px tall) | Corner **+** affordance; **whole card** is the hit target |
| Avatar (desktop) | Letter tile stole vertical space | **Removed** |
| In-cart cue | None | Qty badge on card |

### Product hierarchy

```text
Name (2–3 lines)
  → Price
  → Stock
  → + indicator
```

### Mobile grid comparison

| Band | Before | After |
|------|-------:|------:|
| Phone portrait | 3 cols (floor) | **2 cols** |
| Phone landscape | Adaptive (often 5–6) | **3 cols** |
| Tablet / desktop | Adaptive 3–12 | Unchanged adaptive |

### One-tap add workflow

```text
Tap product
  → resolveScanToCartInput / resolveTapToCartInput
  → if unambiguous (fixed price, no multi-presets, no pharmacy pack):
       add qty path immediately · toast ~1s · stay on Sell
  → else open existing product sheet
```

- 400ms per-product guard reduces accidental double-adds.
- Barcode fast-add path unchanged (same resolver).
- Multi-unit / money / packaging / multi-preset products still open the sheet.

### Feedback

- Toast: `✓ Added` or `Qty: N` (~1 second, non-blocking).
- Card badge shows live draft quantity.

### Responsive verification (static)

| Width | Expected |
|------:|----------|
| 320–412 portrait | 2-col name-first tiles |
| Phone landscape | 3-col |
| Tablet / desktop | Adaptive columns; name-first desktop cards |

*Automated:* `npm run build`, `npm test` (grid + scan-to-cart coverage).  
*Manual:* Web + Android checklist in Phase 28.1 plan.

### Regression summary

| Area | Changed? |
|------|----------|
| Pricing / tax / discount / cart math | No |
| Barcode resolver logic | No (reused for tap) |
| Checkout / payment / receipt | No |
| Inventory / sync / offline / DB / APIs | No |
| Product card presentation + column rules + openProduct routing | Yes |

### Expected score uplift (selection-focused)

| Surface | 28.0 | Expected after 28.1 |
|---------|-----:|--------------------:|
| Mobile | 6.1 | **8.2–8.6** |
| Tablet | 6.9 | **8.0–8.4** |
| Desktop | 7.6 | **8.2–8.5** |
| Overall | 6.6 | **≈8.3** |

*End of Phase 28.1 implementation notes.*
