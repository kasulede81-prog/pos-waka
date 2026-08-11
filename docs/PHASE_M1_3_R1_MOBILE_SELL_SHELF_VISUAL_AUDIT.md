# Phase M1.3-R1 — Mobile Sell Shelf Visual & Density Audit

**Date:** 2026-08-11  
**Mode:** READ-ONLY forensic audit (no code changes)  
**Production target:** WAKA Mobile — Android + iOS  
**Prerequisites verified:** M1.1-R5 (full-screen checkout) · M1.3 (short-shelf continue)

---

## Executive verdict

### **CONDITIONAL GO**

M1.3 **did** remove the old forced empty flex void for 1–3 product shelves. The architecture (natural-height pane + real-data secondary content + compact end state) is correct and matches the certification.

Remaining issues are **polish / hierarchy**, not broken rendering:

1. **Popular Today uses full product cards** (up to 4 × ~96–108px min-height) and can visually dominate a 1–2 product shelf.  
2. **4-product shelves** get no continue block — residual empty viewport below content is softer than the old void, but still sparse on tall phones.  
3. **Back to shelves** always appears (even when Other Shelves chips exist), adding redundant chrome.

No P0 cashier blockers found. Checkout remains M1.1-R5 full-screen and was not regressed by M1.3.

---

## Implementation verified (code vs certification)

| Claim (M1.3 cert) | Code reality |
|-------------------|--------------|
| Natural-height pane | ✅ `pos-catalog-scroll-pane--natural` + phone `flex: 0 1 auto !important` |
| Short shelf ≤3 | ✅ `isMobileShortShelf` / `MOBILE_SHORT_SHELF_MAX_PRODUCTS = 3` |
| Popular = sold today outside shelf | ✅ `popularOutsideOpenShelf` filters `!productMatchesCategoryFilter` + `soldTodayByProduct > 0` |
| Other shelves exclude current, count > 0 | ✅ filter + `slice(0, 6)` |
| No fake data | ✅ sections omitted when empty; else compact End of shelf |
| No continue for 4+ | ✅ gated on `isMobileShortShelf` |
| Phone Comfortable card cap 108px | ✅ `min-height: min(var(--ds-product-card-min-h), 108px)` |
| Checkout untouched in M1.3 intent | ✅ R5 workspace still `pos-mobile-checkout-workspace` / `100dvh` in `PosPage` |

Certification is **accurate**; visual quality still needs judgment below.

---

## Case findings

### CASE A — 1 product

| Aspect | Assessment |
|--------|------------|
| Card size | Appropriate (min ~96–108px; not stretched to fill viewport) |
| Natural pane | Content-sized — no forced flex void inside the scroll pane |
| Secondary | If Popular has 2–4 full cards, **secondary can outweigh the shelf** |
| Empty fallback | Compact End of shelf + Back — intentional when no data |

**Answer:** Better than pre-M1.3, but can still feel **top-light / bottom-heavy** when Popular renders full cards. Not “broken empty,” not yet “finished retail.”

### CASE B — 2 products

| Aspect | Assessment |
|--------|------------|
| Grid | Phone 2-col; sparse max-width packing preserved |
| Balance | Improved; Other Shelves chip rail is the strongest part of M1.3 |
| Risk | Popular full-card grid may become visually dominant |

**Answer:** Feels closer to a real POS catalog when Other Shelves is present and Popular is absent or small.

### CASE C — 3 products

| Aspect | Assessment |
|--------|------------|
| Grid | 2-col with wrap — readable |
| Busy vs empty | Can tip **busy** if Popular (4 cards) + Other Shelves + Back all show |

**Answer:** Acceptable; watch secondary density when sold-today is rich.

### CASE D — 4 products

| Aspect | Assessment |
|--------|------------|
| Continue block | Intentionally **absent** |
| Empty pane | Old **forced** void is gone; residual page chrome below content-sized pane can still look sparse on tall phones |

**Answer:** Does **not** fully reintroduce the M1.0/M1.1 flex void, but lacks an intentional end cue. **P2**.

### CASE E / F — 10+ / 50+

| Aspect | Assessment |
|--------|------------|
| Virtualization | Still at `VIRTUAL_PRODUCT_THRESHOLD = 10` |
| Secondary | Not attached — correct for performance |
| Risk | No M1.3-specific performance regression identified from code |

---

## Popular Today

| Check | Result |
|-------|--------|
| Real `soldTodayByProduct` only | ✅ |
| Excludes current shelf | ✅ via category filter |
| Hidden when no data | ✅ |
| Invented popularity | ❌ not present |
| Visual weight | ⚠️ **P1** — full `PosSellProductCard` grid up to 4 items |

---

## Other Shelves

| Check | Result |
|-------|--------|
| Current excluded | ✅ |
| count > 0 only | ✅ |
| Compact chips ≥44px | ✅ |
| Tap → `handleCatalogShelfTap` | ✅ |
| Back via header / continue | ✅ |

Best-executed part of M1.3.

---

## Empty state

When neither Popular nor Other Shelves has data: compact “End of shelf” + Back button.  
**Does not** create a giant empty panel. ✅

---

## Product card & density

| Mode | Phone card min-height (approx) | Notes |
|------|----------------------------------|-------|
| Compact | ~95–96px (token / base) | Readable |
| Balanced | 108px | Default |
| Comfortable | capped **108px** on phone | Cap works — not “massive” via token alone |

`PosSellProductCard`: Name → Price → Stock; whole-card tap; `line-clamp-3`; no forced vertical stretch.  
Density architecture (`--ds-*` / `pos-ds-*`) intact; no CSS zoom.

---

## Checkout regression

| Check | Result |
|-------|--------|
| Full-screen workspace | ✅ `pos-mobile-checkout-workspace` / `100dvh` |
| Zoned cart / totals / payment / action | ✅ |
| Accidental M1.3 checkout edits | ❌ none required for this audit; R5 path still present |

---

## Scoring

| Dimension | Score | Notes |
|-----------|------:|-------|
| 1. Shelf visual hierarchy | **7.0** | Header + products OK; Popular can invert hierarchy |
| 2. Product card density | **8.0** | Cap + no stretch |
| 3. Empty-space management | **7.5** | Void fixed for ≤3; 4+ residual sparse |
| 4. Secondary catalog content | **6.5** | Other Shelves strong; Popular too heavy |
| 5. Navigation | **8.0** | Works; slight Back redundancy |
| 6. Compact / Balanced / Comfortable | **8.0** | Phone Comfortable capped |
| 7. Small-screen usability | **7.5** | Secondary stack can push shelf products up |
| 8. Android readiness | **7.5** | Shared path; lab OPEN |
| 9. iOS readiness | **7.5** | Shared path; lab OPEN |
| 10. Performance | **8.5** | Short-shelf only; virtualization preserved |
| **Overall** | **7.6 / 10** | |

---

## Findings table

| ID | Sev | Finding |
|----|-----|---------|
| SH-1 | **P1** | Popular Today renders full product cards (up to 4) — secondary can dominate 1–2 product shelves |
| SH-2 | **P2** | 4-product shelves have no end cue; tall phones may still feel sparse below the grid |
| SH-3 | **P2** | Always-on “Back to shelves” duplicates header navigation when Other Shelves exists |
| SH-4 | **P3** | Sticky drill-down header still relatively heavy (48px primary back) despite tighter class |
| SH-5 | **P3** | When Popular + Other Shelves both rich, short-shelf page can feel long/busy |

No P0.

---

## Design question (based on current UI)

| Option | Verdict |
|--------|---------|
| A. Secondary content below short shelves | **Right direction** — keep |
| B. Compact horizontal rail for More / Popular | **Preferred refinement for Popular** |
| C. Different compact shelf layout | Not required now |
| D. Deliberate end-of-shelf state | Keep as fallback |
| E. Current M1.3 already good | **Not yet** — hierarchy polish needed |

**Chosen path:** **A + B hybrid** — keep M1.3 continuation; demote Popular (and optionally tighten Back) into a compact rail/chips so the open shelf’s products remain the visual hero.

---

## Android / iOS

Shared React + CSS path. No iPhone-only branch. Severity of SH-1/SH-2 scales with phone height and sold-today richness — validate on mid-range Android (primary market) and iPhone classes before M1.2 freeze.

---

## Recommended next phase

### **M1.4 — Mobile short-shelf secondary polish** (presentation only)

Scoped:

1. Render Popular as compact chips/rail (not full product cards), still real sold-today data.  
2. Optional light end cue for 4–6 product shelves (no giant void, no fake data).  
3. Reduce redundant Back when Other Shelves already provides navigation.  
4. Do **not** touch checkout / engines.

After M1.4 visual check → resume **M1.2 Cross-Platform Mobile Sell Production Certification**.

*Do not jump to M1.2 yet if Popular full-cards still invert hierarchy on device.*

---

## Final statement

> M1.3 fixed the structural empty-pane failure. The shelf is **conditionally acceptable**, not production-finished.  
> **Verdict: CONDITIONAL GO.**  
> **Next: M1.4** (compact secondary rail) before M1.2 certification.

*End of Phase M1.3-R1 — read-only audit. No code was modified.*

---

### Phase M1.4 — Mobile Short-Shelf Secondary Polish

**Date:** 2026-08-11  
**Mode:** Scoped presentation-only implementation  
**Checkout:** Untouched (M1.1-R5)

#### Changes

| Finding | Fix |
|---------|-----|
| SH-1 Popular full cards | **Popular Today** → compact horizontal rail (name + price chips, ≥44px, real sold-today only) |
| SH-2 4-product sparse | Tiny **End of shelf** + ← Shelves cue for **4–6** products only |
| SH-3 Redundant Back | Full Back button only when no Popular and no Other Shelves |
| SH-4 Heavy header | `PosShelfDrillDownHeader` `compact` on phone (≥44px, less padding) |
| SH-5 Busy stack | Both secondary sections are rails; open-shelf product grid remains hero |

#### Architecture

- Open shelf products: unchanged `PosSellProductCard` grid (hero)
- Popular: horizontal discovery rail (max 6), excludes open-shelf products
- Other Shelves: horizontal chip rail (max 6)
- Density tokens / phone Comfortable 108px cap: unchanged
- Virtualization for 10+: unchanged; no secondary rails on 7+

#### Regression

- Checkout workspace / keypad / Complete Sale: not modified
- Cart / pricing / inventory / barcode: not modified

#### Verification

| Check | Result |
|-------|--------|
| `tsc` + `vite build` | Pass |
| `verify-seo-assets` | Pass |
| `posMobileShortShelf.test.ts` + density tokens | 12/12 pass |
| Checkout / `PosCheckoutPanel` | Unchanged in M1.4 diff |
| Visual QA | OPEN — Simulator hierarchy check required |

#### M1.4 verdict

**CONDITIONAL GO** — hierarchy matches audit recommendation; confirm on Simulator that open-shelf cards dominate and Popular is a secondary rail.

*End of Phase M1.4 notes.*
