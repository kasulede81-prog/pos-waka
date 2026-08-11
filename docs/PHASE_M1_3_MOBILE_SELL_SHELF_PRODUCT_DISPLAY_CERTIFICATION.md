# Phase M1.3 — Mobile Sell Shelf & Product Display Certification

**Date:** 2026-08-10  
**Mode:** Presentation-only Sell catalog polish  
**Production target:** WAKA Mobile — Android + iOS  
**Checkout:** Untouched (M1.1-R5 remains authoritative)

---

## Final verdict

### **CONDITIONAL GO**

Short shelves (1–3 products) no longer end in a giant empty void. Secondary catalog content uses **existing** popular-today / other-shelf data only; otherwise a compact end-of-shelf + Back to shelves cue.

> Automated verification passed; real-device visual certification remains OPEN.

---

## Problem

Shelf drill-down with 2–3 products showed large cards at the top and a huge unused gray/white region below — unfinished retail feel. Stretching cards was rejected.

---

## Implementation

| Change | Detail |
|--------|--------|
| Natural-height pane | `pos-catalog-scroll-pane--natural` + stronger phone CSS so Tailwind `flex-1`/`h-0` cannot force an empty flex void |
| Short-shelf continue | `PosMobileShelfContinue` after product grid when `isMobileShortShelf(count)` on mobile |
| Popular | Sold-today products **outside** the open shelf (real `soldTodayByProduct` only) |
| Other shelves | Existing `catalogShelfCards` excluding current, count > 0 |
| Fallback | Compact “End of shelf” + Back to shelves (no giant illustration, no fake data) |
| Header | Tighter mobile chrome via className on `PosShelfDrillDownHeader` |
| Cards | Density tokens preserved; phone Comfortable min-height still capped at 108px |

**Long catalogs:** unchanged virtualization / scroll when count > short threshold or > virtualization threshold. Secondary block is **not** attached for 4+ product shelves.

---

## Files

- `src/components/pos/PosMobileShelfContinue.tsx` (new)
- `src/lib/posMobileShortShelf.ts` + test
- `src/pages/PosPage.tsx` (mobile drill-down only)
- `src/index.css` (natural pane + flex override)
- `src/lib/i18n.ts` (`posSellOtherShelves`, `posSellEndOfShelf`)

**Not changed:** checkout, cart engine, pricing, inventory math, barcode, payment, desktop/tablet Sell paths beyond shared CSS phone rules.

---

## Manual QA (OPEN)

| Case | Status |
|------|--------|
| 1 / 2 / 3 product shelf — no giant void | ☐ |
| Other shelves / Popular appear only with real data | ☐ |
| 10 / 50+ shelves still virtualize & scroll | ☐ |
| Compact / Balanced / Comfortable | ☐ |
| Search / back to shelves / add to cart | ☐ |
| Android + iOS phone classes | ☐ |

---

## Automated

| Check | Result |
|-------|--------|
| `npm run build` | **Pass** (2026-08-10) |
| `posMobileShortShelf.test.ts` | **Pass** |
| Checkout behavior | Not changed in M1.3 (R5 full-screen workspace remains) |

*End of Phase M1.3.*
