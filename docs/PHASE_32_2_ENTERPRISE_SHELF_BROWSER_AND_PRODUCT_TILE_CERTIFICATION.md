# Phase 32.2 — Enterprise Shelf Browser & Product Tile Experience Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Sell **Shelf Browser** + **Product Tile** experience only — sizing, density, typography, navigation, discoverability, empty space, responsive behaviour  
**Out of scope:** Workspace chrome (Phase 32.0/32.1), checkout/payment, barcode engine, pricing/tax/stock math, sync/offline, database  
**Related prior work:**  
- Phase 28.0 / 28.1 — Sell cashier experience & product-card hierarchy  
- Phase 32.0 / 32.1 — Sell workspace layout engine (mount, zoom, panels)  

---

## Executive Summary

The Sell catalog browse surface is **operationally capable** but **not yet optimized for maximum cashier speed** in shelf → product recognition.

**Core question:** *Can a cashier instantly recognize, scan, and sell products at maximum speed?*

| Path | Verdict |
|------|---------|
| **Barcode / search** | Strong (outside this audit’s change surface; remains the primary high-volume path) |
| **Shelf browser** | Colorful and glanceable, but desktop density stalls; scale model is inconsistent; dual browse engines drift |
| **Product tiles** | Name-first hierarchy from Phase 28.1 holds; virtualizer row estimates and cart-open column cliffs still tax speed |

**Answer:** Partially. Identification hierarchy on product cards is now correct. The biggest remaining speed losses are **shelf desktop density**, **product-grid density cliffs when checkout opens**, and **virtualizer row overflow** under longer product names — not more decoration.

| Dimension | Score | Verdict |
|-----------|------:|---------|
| **Shelf browser** | **6.1 / 10** | Glanceable color tiles; inefficient desktop packing |
| **Product tile** | **7.3 / 10** | Name-first works; density/virtualizer regressions remain |
| **Typography** | **7.0 / 10** | Shelves readable at distance; product stock/scale coupling weak |
| **Density** | **6.2 / 10** | Product grid adapts; shelf grid caps early and wastes width |
| **Readability** | **7.2 / 10** | Bold shelf titles help; product names OK; compact Display Scale hurts |
| **Responsive** | **6.4 / 10** | Product columns container-aware; shelves viewport-driven |
| **Navigation / context** | **7.0 / 10** | Clear back control on retail Sell; pharmacy path diverges |
| **Overall (this scope)** | **6.7 / 10** | Not certified for max-speed browse; clear P0 roadmap |

**Recommended next step:** **Phase 32.3 — Enterprise Shelf Browser Optimization & Unified Browse Engine** (architecture + density; not “shelf polish”). Charter appended below.

---

## Certification Methodology

1. Static forensics of shelf leaf components (`PosShelfTile`, `PosSellCatalogShelfSection`, `posShelfLayout`).  
2. Static forensics of product cards + grid (`PosSellProductCard`, `PosDesktopProductCard`, `VirtualizedProductGrid`, `posProductGridColumns`).  
3. Navigation path tracing in `PosPage` vs pharmacy `SellProductBrowsePanel` / `useSellProductBrowseEngine`.  
4. Cross-check Display Scale CSS overrides (`index.css` `.pos-ds-product-*`) against coded Tailwind sizes.  
5. Quantitative estimates at 320 / 390 / 768 / 1024 / 1366 / 1920.  
6. Workflow benchmark vs Square / Lightspeed / Shopify POS / Toast (speed/density only — no visual copying).  

**Not performed:** Live timed cashier lab; eye-tracking; screenshot OCR of a specific shop’s live catalog (screenshots informed symptoms; this doc is code-evidence based).

---

## Scorecard (detail)

### Shelf browser — 6.1 / 10

**Strengths**
- Bold gradient tiles + emoji icons communicate shelf identity at arm’s length.
- Scale slider lets operators emphasize hero shelves (2×1 / 2×2 spans).
- Sticky drill-down header on retail Sell keeps shelf name + Back visible.

**Weaknesses**
- Column count hard-capped at **6** (`2xl`), viewport-driven — unlike product grid (up to **12**, container-measured).
- Sell always uses “mobile hero” row tracks (`7.5rem` / `5.75rem`) even on 1920px desktops.
- Typography floor (`Math.max(scale, 58)`) + orphan scale bands make Arrange preview unreliable.
- Duplicate browse engines (PosPage vs pharmacy panel) with divergent Back UI and persistence.

### Product tile — 7.3 / 10

**Strengths**
- Name → price → stock → corner “+” hierarchy matches Phase 28.1 intent.
- Whole-card tap; no full-width Add bar stealing height.
- Container-width column math scales SKU throughput on wide screens.

**Weaknesses**
- Virtualizer estimates (128 / 120px) undershoot 2–3 line names → overlap risk.
- First cart line on 1024–1366 collapses columns ~33–38%.
- Display Scale `compact` shrinks fonts **and** adds columns simultaneously.
- Full desktop lacks quick-sell / recents chip rails that mobile/compact get.

### Typography — 7.0 / 10

| Surface | Size band (effective) | Hierarchy |
|---------|----------------------|-----------|
| Shelf title (Sell, floor ≥58) | ≥ ~1.53rem (~24.5px) → ~1.97rem | Strong — distance readable |
| Shelf count | ~0.74–0.86rem | Secondary — OK |
| Product name | 14px @ normal Display Scale | Dominant — correct |
| Product price | 12px | Secondary — correct |
| Product stock | 9px @ normal; ~7.9px @ compact | Too small at compact |
| Shelf section heading | `text-[10px]` uppercase | Weak chrome, not cashier-critical |

### Density — 6.2 / 10

- **Shelves:** At 1920px, ~305px-wide × 92px-tall 1×1 tiles leave large unused horizontal gutters inside each card. Cap never rises past 6 columns.  
- **Products:** Adaptive columns keep per-card name width roughly stable (~140–150px) while increasing SKU count — correct pattern. Density cliffs on checkout mount undo that stability on common laptops.  
- **Verdict:** Standardize shelf **minimum tile footprint** via container-aware columns; keep optional per-shelf emphasis spans. Product cards are not “too padded” — they are content-height driven.

### Readability — 7.2 / 10

Shelves: yes for bold colored tiles from several feet (title weight 900, large rem sizes).  
Products: yes at normal scale; degraded under Display Scale compact + extra columns.  
Empty-shelf badge reuses “low stock” danger copy — semantic noise.

### Responsive — 6.4 / 10

| Width | Shelf cols | Product cols (empty cart, est.) | Risk |
|------:|----------:|--------------------------------:|------|
| 320 | 2 | 2 (phoneBand) | OK |
| 390 | 2 | 2 | OK |
| 768 | 4 | ~5 | OK |
| 1024 | 4 | ~8 → **~5** with sidebar | Column cliff |
| 1366 | 5 | ~9 → **~6** with sidebar | Column cliff |
| 1920 | 6 (cap) | ~10 | Shelf tiles widen without text growth |

---

# PART 1 — Shelf Browser Certification

### Runtime path

```text
Empty search + category = ALL
  → PosSellCatalogShelfSection
       → shelfMasonryGridClass(true)   // always sell-focus row tracks
       → PosShelfTile (mode=sell, sellFocus)
Tap shelf
  → setSellCategoryFilter(key)  // persisted preference on retail Sell
  → sticky Back + shelf label + VirtualizedProductGrid
```

Pharmacy uses a parallel path: `SellProductBrowsePanel` + `useSellProductBrowseEngine` (ephemeral category; different Back chrome).

### Measured dimensions (Sell path)

| Metric | Value | Source |
|--------|------:|--------|
| Row track &lt;640 | `7.5rem` (120px) | `posShelfLayout.ts` `shelfMasonryGridClass(true)` |
| Row track ≥640 | `5.75rem` (92px) | same |
| Gap &lt;640 / ≥640 | 12px / 8px | `gap-3` / `sm:gap-2` |
| Columns | 2 → 3 → 4 → 4 → 5 → **6 max** | Tailwind `sm/md/lg/xl/2xl` |
| Width | Fluid `1fr` | no min/max on tile |
| Height | Grid row track × row-span | `shelfMinHeightClass` is a no-op (`h-full`) |
| Scale → span | &lt;45: 1×1; 45–77: 2×1; ≥78: 2×2 | `shelfGridSpanFromScale` |
| Title typography | `0.92 + t·1.05` rem; Sell floors scale at **58** | `shelfTypographyFromScale` + `PosShelfTile` |
| Title weight | 900, line-height 1.08 | `PosShelfTile` |
| Count | truncate, opacity 0.78 | `PosShelfTile` |

### Communication efficiency

Shelves **do** communicate identity efficiently via color + icon + short label. They **do not** communicate density efficiently on wide desktops — information per pixel drops as tiles widen without more columns or content.

---

# PART 2 — Shelf Density

| Issue | Evidence |
|-------|----------|
| Hard column cap at 6 | `shelfMasonryGridClass` ends at `2xl:grid-cols-6` |
| Viewport vs container | Columns from viewport breakpoints; product grid uses measured catalog width |
| Display Scale ignored | No `catalogColumnDeltaForScale` equivalent for shelves |
| Fixed row tracks on desktop | Sell always passes `sellFocusedMobile=true` → taller rows even on desktop |
| Unbounded tile width | 1920 → ~305px tiles; 4K → ~600px+ at same 92px height |
| Masonry rhythm | Per-shelf scale 25–100 + `grid-flow-dense` → irregular visual rhythm when many hero shelves |

**Conclusion:** Shelves should become **container-aware** (like products) with a **standardized minimum tile width**, plus optional emphasis spans — not fixed viewport tiers capped at 6.

---

# PART 3 — Shelf Readability

| Question | Answer |
|----------|--------|
| Identifiable from several feet? | **Yes** for bold colored tiles with ≥~24px titles (Sell floor). |
| Product count visible? | Yes, but secondary (~11–14px) and truncates on narrow 1-col tiles. |
| Status chips? | Featured / fast-moving / promo at 9–10px; empty shelf shows **low-stock** danger styling — misleading. |
| Capitalization | Labels as stored (not forced title-case); section chrome is uppercase 10px. |
| Hierarchy | Title ≫ icon ≫ count — correct for launcher tiles. |

**Arrange vs Sell mismatch:** Arrange preview uses `shelfMasonryGridClass()` (5.5rem rows) without typography floor; Sell uses taller rows + floor 58 — operators cannot trust the slider preview.

---

# PART 4 — Product Tile Certification

### Hierarchy (confirmed)

```text
Name  (largest, first, font-black, line-clamp-3)
  ↓
Price (tabular, teal accent, smaller)
  ↓
Stock (badge/text, smallest)
  ↓
“+” affordance (corner; whole card is the hit target)
```

Phase 28.0’s “price/CTA dominate name” defect is **resolved** in current code. Hierarchy supports fast retail operation.

### Dual renderers

| Band | Card |
|------|------|
| Mobile + compact (≤1023) | `PosSellProductCard` (`sellMobile`) |
| Full desktop (≥1024) | `PosDesktopProductCard` (`sellDesktop`) |
| Pharmacy medicine | `PharmacySellMedicineCard` |
| `"default"` variant in virtualizer | **Unreachable** |

### Effective typography note

On `/pos`, Display Scale is on by default. `.pos-ds-product-*` rules override many Tailwind sizes. At **normal**: name 14px, price 12px, stock **9px**, CTA **48px**. Desktop’s coded `text-[13px]` / `h-9` are often not what renders.

---

# PART 5 — Product Density

| Metric | Mobile | Desktop |
|--------|--------|---------|
| Padding | `p-2.5` (10px) | inner `p-2` (8px) |
| Coded min-h | 112px (content usually taller) | 112px |
| Gap | 8px | 6px |
| Aspect ratio | None — content-driven height | None |
| Avatar / image | Removed (28.1) | Removed |

**Desktop is not wasting space via oversized padding.** Extra viewport width buys **more columns**, not larger names. That is the correct enterprise density pattern — except:

1. Column cliff when checkout sidebar mounts (1024–1366).  
2. Virtualizer underestimates height → visual collision / wasted correction scrolling.  
3. Quick/recents chips withheld from full desktop despite available chrome space.

---

# PART 6 — Typography Audit

| Element | Coded / formula | Effective notes |
|---------|-----------------|-----------------|
| Shelf name | scale formula, weight 900 | Floor 58 on Sell; Arrange preview does not match |
| Shelf count | scale formula, weight 700 | Truncates |
| Shelf badges | 9–10px uppercase | OK as accents |
| Product name | `text-sm` / `text-[13px]` | DS → 14px normal |
| Product price | `text-xs` | DS → 12px |
| Product stock | `text-[10px]` | DS → 9px; compact → ~8px |
| Product “+” | 44 / 36 coded | DS → 48 both |
| Favorite ★ (desktop) | 32px fixed | **Not** Display-Scale wired |

**Enterprise hierarchy fit:** Product name > price > stock is correct. Shelf title > count is correct. Weakest link: stock at compact Display Scale + column delta.

---

# PART 7 — Navigation Flow

```text
Shelf grid
   ↓ tap
Products (filtered) + sticky Back + shelf label
   ↓ Back
Shelf grid
```

| Criterion | Retail Sell (`PosPage`) | Pharmacy browse panel |
|-----------|-------------------------|------------------------|
| Back control | Filled `bg-waka-600` pill, 48px min height | Inline teal text link |
| Shelf context while drilled | Sticky header with icon + name | Label on back row |
| Persistence | Category filter **persisted** in preferences | Ephemeral local state |
| Breadcrumb depth | Single level (correct — flat shelves) | Single level |
| Search vs shelf | Search results replace shelf grid | Same pattern |

**Orientation:** Cashier does not lose shelf context on retail Sell while drilled in. Cross-surface inconsistency (retail vs pharmacy) is the main navigation debt.

---

# PART 8 — Empty Space Audit

| Region | Finding |
|--------|---------|
| Shelf grid (desktop wide) | **Primary waste** — columns capped; tile width absorbs space |
| Shelf tile interior | Horizontal flex leaves unused width in wide 1×1 cells |
| Product grid | Low waste; content-driven cards |
| Product card padding | Not excessive |
| Section header (“Categories” + count chip) | Minimal chrome |
| Between shelf → product | Sticky header is justified context, not waste |
| Last masonry row | Partial rows leave empty tracks (CSS Grid limitation) |

---

# PART 9 — Responsive Behaviour

### Verified risk matrix

| Width | Oversized shelves? | Oversized cards? | Clipping / wrap |
|------:|--------------------|------------------|-----------------|
| 320 | No — 2-col hero | No — 2-col forced | Title clamp OK |
| 390 | No | No | OK |
| 768 | Moderate | Dense but OK | Compact uses mobile card |
| 1024 | Acceptable empty cart | Cards tight | **Column cliff** when cart opens |
| 1366 | Growing width | Good throughput | Same cliff |
| 1920 | **Yes — wide flat tiles** | Good (≤10–12 cols) | Shelf text doesn’t scale with width |

### Landscape phones

Intended 3-col phone landscape (`POS_PHONE_LANDSCAPE_COLUMNS`) is often **unreachable** because landscape CSS width exceeds the 767 mobile band → promotes to compact adaptive columns.

---

# PART 10 — Enterprise Benchmark (workflow / density)

| Practice | Square / Lightspeed / Shopify POS / Toast norm | WAKA today | Gap |
|----------|------------------------------------------------|------------|-----|
| Category/shelf tiles as large, glanceable launchers | Common | Strong color + icon tiles | Closed |
| Stable product density when cart opens | Density stays predictable | Columns drop 33–38% at 1024–1366 | **Open** |
| Name-first SKU tiles | Standard | Met (28.1) | Closed |
| Quick/favorites always available on desktop register | Standard | Gated off full desktop | **Open** |
| Category grid grows with register width | Standard | Cap 6 cols | **Open** |
| Predictable virtualized row heights | Standard | Estimates lag `line-clamp-3` | **Open** |
| One browse engine across modes | Standard | Retail vs pharmacy diverge | **Open** |

Do **not** copy layouts. Adopt the **behaviours**: stable density, glanceable categories, name-first SKUs, persistent speed affordances on the largest screens.

---

# PART 11 — Root Cause Register

Ranked by impact on **cashier speed** (identify → select → sell).

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | P0 | Shelf grid column count hard-capped at 6, viewport-driven; ignores catalog container width and Display Scale → wasted desktop width | `posShelfLayout.ts` `shelfMasonryGridClass`; contrast `posProductGridColumns.ts` |
| **RC-2** | P0 | Product virtualizer row estimates (128 mobile / 120 desktop) undershoot 2–3 line names after Phase 28.1 → overlap / scroll jank | `VirtualizedProductGrid.tsx` `ROW_ESTIMATE_*`, no `measureElement` |
| **RC-3** | P0 | Starting a sale on 1024–1366 collapses product columns ~33–38% (sidebar width vs coarse breakpoints) | `posDesktopSplit.ts` + `catalogColumnCount` breakpoints |
| **RC-4** | P0 | Duplicate shelf-browse engines (PosPage vs `useSellProductBrowseEngine`) with divergent Back UI and persistence | `PosPage.tsx` drill-down vs `SellProductBrowsePanel.tsx` |
| **RC-5** | P1 | Orphan scale bands: body “large” at ≥72 vs row-span-2 at ≥78; medium body ≥42 vs col-span-2 ≥45 | `scaleToShelfSize` vs `shelfGridSpanFromScale` |
| **RC-6** | P1 | Sell typography floor `Math.max(scale, 58)` + forced sell-focus row tracks not mirrored in Arrange / scale-slider preview | `PosShelfTile.tsx`, `PosSellCatalogShelfSection.tsx`, `PosShelfArrangePanel.tsx` |
| **RC-7** | P1 | Display Scale `compact` shrinks product fonts **and** adds +2 columns — compounding legibility loss | `scaleTokens.ts` + `catalogColumnDeltaForScale` |
| **RC-8** | P1 | Full desktop withholds quick-sell / recents / favorites chip rails despite having the most space | `PosPage.tsx` `isFullDesktopPos` gates |
| **RC-9** | P1 | Empty-shelf badge reuses low-stock danger styling/copy | `PosShelfTile.tsx` `lowStockTitleFriendly` |
| **RC-10** | P2 | Dead shelf paths: `sellCatalogGrid` branch, unused class helpers, deprecated `desktop` prop | `PosShelfTile.tsx`, `posShelfLayout.ts`, `PosSellCatalogShelfSection.tsx` |
| **RC-11** | P2 | Unreachable `VirtualizedProductGrid` `"default"` variant | `VirtualizedProductGrid.tsx` |
| **RC-12** | P2 | Favorite star 32px not Display-Scale wired; badge corner flips mobile vs desktop | `PosDesktopProductCard.tsx` / `PosSellProductCard.tsx` |
| **RC-13** | P2 | Phone landscape 3-col path rarely reachable on modern devices | `phoneBand` + 767 band |
| **RC-14** | P2 | Custom hex shelf colors bypass curated shadow depth → uneven tile weight in one grid | `shelfColor.ts` vs `shelfColorClasses` |
| **RC-15** | P1 | Shelf tiles use full-saturation bold gradients (`*-500→*-700` + strong glow) for **every** shelf at once — when many shelves are visible they compete with product focus; no “soft grid / strong selected” mode | `shelfColorClasses` in `posShelfLayout.ts`; `launcherBoldTileColorStyle` in `shelfColor.ts` |

---

# PART 12 — Improvement Roadmap

## Phase 32.3 — Enterprise Shelf Browser Optimization & Unified Browse Engine

**Mode (when implemented):** Surgical presentation / browse-architecture only  
**Not:** “Shelf polish” — this phase fixes packing architecture + shared browse runtime.

### Guiding sizing rule (locked)

```text
❌ Do NOT size shelf tiles by name length (unstable grid)
✅ Keep a consistent minimum tile footprint
✅ Increase column count from measured catalog container width
```

Same pattern as modern enterprise dashboards and the existing product grid.

### P0 — Architecture & cashier speed

1. **Remove 6-column ceiling** — container-aware shelf columns; tiles stay roughly the same size; more columns on 27″ / ultrawide.  
2. **Fix virtualizer estimates** (and/or `measureElement`) so `line-clamp-3` never overlaps rows.  
3. **Unify shelf browse engine** — one shared runtime for Retail + Pharmacy (Back chrome, persistence policy, drill-down).  
4. **Stabilize product columns when checkout mounts** (keep from original P0 — still a density cliff on 1024–1366).

### P1 — Predictability & calm focus

5. Shelf typography / spacing / capitalization consistency (incl. Arrange preview sync).  
6. Better Back navigation context (one pattern both surfaces).  
7. **Shelf color competition (RC-15):** prefer slightly softer unselected tiles; reserve strongest saturation for featured and/or currently selected shelf so products remain the focus after drill-down.  
8. Distinct empty-shelf vs low-stock semantics; soften Display Scale `compact` column+font stacking if still in scope.

### P2 — Micro-interactions

9. Hover polish (desktop).  
10. Keyboard shelf navigation.  
11. Smooth shelf ↔ product transitions.  
12. Dead-code cleanup (`sellCatalogGrid`, unused helpers, unreachable `"default"` card).

### Explicit non-goals for 32.3

- No pricing / tax / discount / stock engine changes  
- No barcode engine changes  
- No workspace remount architecture (done in 32.1)  
- No product-card hierarchy rewrite (28.1 is correct — leave it)  
- No product images requirement  
- No visual cloning of Square / Toast / Shopify layouts  
- **No content-aware tile heights from shelf name length**

### Deferred (post–Sell freeze candidate)

**Desktop browse mode toggle (optional Phase 32.4 / operator preference):**

| Mode | Audience |
|------|----------|
| **Shelf View** | Current colorful category-first experience — touchscreens, new cashiers |
| **Compact List View** | Dense searchable catalog — experienced mouse/keyboard cashiers |

Does **not** replace Shelf View; additive preference for shops that want list density on desktop only.

### Target scores after 32.3 (operator estimate)

| Area | Current (32.2) | Expected after 32.3 |
|------|---------------:|--------------------:|
| Shelf Browser | 6.1 | ~9.2 |
| Product Tile | 7.3 | ~9.3 |
| Typography | 7.0 | ~9.2 |
| Density | 6.2 | ~9.4 |
| Readability | 7.2 | ~9.3 |
| Responsive | 6.4 | ~9.2 |
| **Overall** | **6.7** | **~9.3–9.5** |

After 32.3, freeze Sell architecture the same way Inventory was frozen — features/ops only thereafter.

---

### Color finding (RC-15) — quick answer

**Yes — saturation competition is real and code-backed.**

Every non-default shelf renders a full bold launcher treatment:

- Presets: `from-*-500 to-*-700` + ~38% colored box-shadow glow (`shelfColorClasses`).  
- Custom hex: `launcherBoldTileColorStyle` (white text + heavy glow).  
- Featured gets an extra inset ring — but **unselected non-featured shelves stay equally loud**.

**Recommended direction for 32.3 P1 (not content-sized tiles):**

1. Soften the **browse-grid default** (muted tint / lighter gradient / quieter shadow).  
2. Keep **strong color** for featured shelves and/or the **selected** shelf in drill-down chrome.  
3. Once inside a shelf, product tiles remain the visual focus — shelf chrome should not outshout SKUs.

Prefer soft-default + strong-accent over “only selected is colored, everything else grey” (grey grids hurt glanceable category picking on touch).

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Does the shelf browser maximize cashier speed? | **Not on wide desktop** — glanceable, but packing wastes register width. Mobile/tablet acceptable. |
| Content-aware vs standardized sizing? | **Both:** standardize **min tile footprint** via container-aware columns; keep optional emphasis spans for hero shelves. |
| Do product cards communicate the right hierarchy? | **Yes** (name → price → stock → add). Preserve this; fix density/virtualizer around it. |
| Where does empty space reduce efficiency? | Primarily **wide shelf tiles** after the 6-column cap; secondarily catalog reflow when checkout opens. |
| Biggest usability gains without business-logic changes? | Shelf column engine, virtualizer height correctness, cart-open column stability, unified browse navigation. |

---

## Appendix A — Evidence index

| Claim | Location |
|-------|----------|
| Shelf masonry / columns | `src/lib/posShelfLayout.ts` `shelfMasonryGridClass` |
| Scale → span / typography | `src/lib/posShelfLayout.ts` `shelfGridSpanFromScale`, `shelfTypographyFromScale` |
| Sell shelf section | `src/components/pos/PosSellCatalogShelfSection.tsx` |
| Shelf tile | `src/components/pos/PosShelfTile.tsx` |
| Product mobile card | `src/components/pos/PosSellProductCard.tsx` |
| Product desktop card | `src/components/pos/PosDesktopProductCard.tsx` |
| Virtualizer | `src/components/pos/VirtualizedProductGrid.tsx` |
| Product columns | `src/lib/posProductGridColumns.ts` |
| Display Scale product overrides | `src/index.css` `.pos-ds-product-*` |
| Display Scale tokens | `src/lib/displayScale/scaleTokens.ts` |
| Retail drill-down | `src/pages/PosPage.tsx` catalog shelf / back header |
| Pharmacy browse | `src/components/pos/SellProductBrowsePanel.tsx`, `src/hooks/useSellProductBrowseEngine.ts` |
| Prior product-card cert | `docs/PHASE_28_0_ENTERPRISE_SELL_WORKSPACE_AND_CASHIER_EXPERIENCE_CERTIFICATION.md` |
| Prior workspace cert | `docs/PHASE_32_0_ENTERPRISE_SELL_WORKSPACE_LAYOUT_SCALING_AND_INTERACTION_CERTIFICATION.md` |

## Appendix B — What this audit is not

- Not a re-audit of Sell workspace mount/zoom/panels (32.0 / 32.1)  
- Not permission to redesign brand chrome or copy competitor pixels  
- Not a mandate for product images  
- Not a change to tap-to-add / barcode / cart math (verify only as context)  

---

**Certified by:** Phase 32.2 Enterprise Shelf Browser & Product Tile Experience read-only forensic audit — 2026-08-03  

**Decision:** Product-card hierarchy is largely **fixed**. Remaining cashier-speed debt is concentrated in **shelf packing**, **virtualizer geometry**, **cart-open density stability**, and **browse-engine unification**.

---

## Phase 32.3 — Shelf Browser Optimization & Unified Browse Engine

**Mode:** Surgical implementation (presentation / browse architecture only)  
**Date:** 2026-08-03  

### Before / after grid allocation

#### Before (32.2)

```text
Viewport Tailwind tiers → max 6 shelf columns (2xl)
Tiles widen on 27″ / ultrawide → large empty interiors
Product virtualizer estimate 128/120 vs line-clamp-3 cards
Cart open @1024–1366 → sharp product column cliff
Retail PosPage browse ≠ Pharmacy SellProductBrowsePanel
Bold saturated shelves compete with SKUs
```

#### After (32.3)

```text
Measured catalog width → shelfColumnCount (min tile ~168px, max 12)
Equal tile footprint; more columns as space grows
Virtualizer estimates 168/148 + measureElement
stabilizeCatalogColumnCount + denser mid breakpoints + leaner laptop checkout share
useSellProductBrowseEngine + PosShelfDrillDownHeader shared by Retail + Pharmacy
Soft browse-grid colors; featured/selected stay bold
```

### Container-aware shelf columns

| Piece | Location |
|-------|----------|
| `shelfColumnCount` / `shelfGridTemplateColumns` | `src/lib/posShelfGridColumns.ts` |
| `useShelfGridColumns` | `src/hooks/useShelfGridColumns.ts` |
| Sell + Arrange grids | `PosSellCatalogShelfSection`, `PosShelfArrangePanel` |
| Masonry class (row tracks only; no viewport col classes) | `shelfMasonryGridClass` |

**Rule locked:** tile width does **not** depend on shelf name length.

### Unified browse engine

| Surface | Engine |
|---------|--------|
| Retail `PosPage` | `useSellProductBrowseEngine` (controlled search) |
| Pharmacy `SellProductBrowsePanel` | same hook, **persisted** category filter (ephemeral removed) |
| Drill-down chrome | `PosShelfDrillDownHeader` — `← Shelves` + name + product count |

### Virtualizer improvements

- Row estimates raised for `line-clamp-3` cards (`168` mobile / `148` desktop).  
- `measureElement` wired (non-Firefox) so live row height matches content.  
- Absolute row height no longer forced from stale estimates alone.

### Cart density improvements

- Mid catalog breakpoints: 680→6, 860→7 columns.  
- `stabilizeCatalogColumnCount` keeps prior density until min-tile (~100px) geometry requires a drop.  
- Laptop checkout share eased (`~24%` / `26%` cap under 1440) so catalog retains width.

### Shelf visual hierarchy & typography

- Soft pastel gradients for default browse tiles; featured/selected remain bold.  
- Slightly larger shelf titles; display-only capitalization via `formatShelfDisplayLabel`.  
- Title↔count spacing increased; empty-shelf badge no longer reuses low-stock copy.  
- Scale body bands aligned with grid spans (medium≥45, large≥78).

### Responsive verification (implementation)

| Width | Shelf behavior | Product behavior |
|------:|----------------|------------------|
| 320–390 | 2-col phone band | 2-col phone band |
| 768 | Container-aware (≥4) | Adaptive |
| 1024–1366 | Grows with catalog; cart open less cliffy | Stabilized columns |
| 1440–1920 | 8–11 shelf cols typical | Up to 10 product cols |
| Ultrawide | Up to 12 shelf cols | Up to 12 product cols |

### Regression summary

| Area | Changed? |
|------|----------|
| Pricing / tax / discount / cart math | No |
| Barcode / scan-to-cart | No |
| Stock / sync / offline / DB / APIs | No |
| Checkout payment finalize | No (panel width share only) |
| Product card hierarchy (name→price→stock) | No |
| Shelf packing, virtualizer, browse engine, soft colors | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Efficient desktop shelf packing without enlarging tiles | **Met** |
| Retail + Pharmacy one browse engine / nav / persistence | **Met** |
| Stable virtualization for current card height | **Met** |
| Cart open without disproportionate density loss | **Met** |
| Soft shelves; products remain focus after drill-down | **Met** |
| Sell browse architecture ready for freeze | **Met** |

**Deferred:** Desktop Compact List View preference (optional post-freeze).  

---

## Phase 32.3.1 — Shelf Typography & Visual Polish

**Mode:** Surgical presentation polish only  
**Date:** 2026-08-03  

### Before / after typography

| Element | Before (32.3) | After (32.3.1) |
|---------|---------------|----------------|
| Title wrap | `break-words` mid-word splits | Space-first wrap; `word-break: normal`; `hyphens: none`; 2-line clamp |
| Title size | Scale formula | Slightly larger base; long names scale down ~5–10% |
| Line height | 1.08 | 1.18 |
| Count | Heavy / tight | Weight 600, more opacity ease, `mt-1.5` under title |
| Icon | Competing size | Smaller `iconRem`; lower opacity; supports title |
| Row track | 7.5 / 5.75 rem | 8.25 / 6.5 rem (~+10–12px breathing room) |
| Display case | First letter only | Title case for lowercase multi-word (`surface go` → `Surface Go`) |
| Count grammar | `N products` always | `1 Product` / `N Products` |

### Word wrapping

- Removed aggressive `break-words` on shelf titles.  
- Parent `overflow-hidden` + `line-clamp-2` handles overflow without splitting “Analgesics” into “Analgesi / cs”.  
- Long names prefer natural space wraps, then slight size reduction, then clamp.

### Visual rhythm

Consistent compact tile stack: **icon → title → count** with stable gaps (`gap-2` / `mt-1.5`).  
Large tiles: centered column with the same order (icon supports, title dominates).

### Responsive verification (polish)

Verified via row-track + wrap CSS for 320 / 390 / 768 / 1024 / 1366 / 1920 — tile height stable; column engine untouched.

### Regression summary

| Area | Changed? |
|------|----------|
| Container-aware columns / browse engine / virtualizer | No |
| Product cards / checkout / inventory / pricing / sync / DB | No |
| Shelf tile typography, wrap, height, display labels, count grammar | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Natural word wrapping | **Met** |
| Name-primary hierarchy | **Met** |
| Balanced spacing / quieter icons | **Met** |
| Correct singular/plural counts | **Met** |
| Shelf Browser visually complete for freeze | **Met** |

**Recommended next step:** Freeze Sell architecture; features/ops only.
