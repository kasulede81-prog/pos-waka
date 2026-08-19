# VL-2.1 — Controlled Typography Hierarchy Refinement

**Date:** 2026-08-19  
**Mode:** CONTROLLED IMPLEMENTATION — weight classes only  
**Baseline:** VL-1 (DM Sans 400/500/600/700 loaded; 900 not loaded) + `docs/VL_2_FONT_WEIGHT_HIERARCHY_FORENSIC_AUDIT.md`

Physical-device / DevTools viewport screenshots were **not** taken. Layout tokens (min-heights, gutters, region order) were not modified.

---

## Executive verdict

**GO**

Supporting Home/Settings chrome now requests **real 700** instead of unloaded 900. Transaction-critical UI still uses `font-black`. No sizes, spacing, Home density, or POS files were changed.

---

## Before / after hierarchy (intended)

| Surface | Before | After |
|---|---|---|
| Home greeting | `font-black` (synthetic 900) | `font-bold` (real 700) |
| Enterprise module **title** | `font-black` | `font-bold` |
| Module subtitle | `font-medium` (500) | Unchanged |
| Tile liveStat / badge | `font-black` | **Unchanged** (stays stronger than title) |
| Reports “view” affordance | `font-black` | `font-bold` |
| Reports KPI (`MonoNumber`) | 700 tabular | Unchanged |
| License product line | `font-black` | `font-bold` |
| Subscription headline | `font-black` | `font-bold` (status still from **color**, not weight) |
| Settings arrange titles / locked-region labels | `font-black` | `font-bold` |
| `.waka-btn-primary` | `font-black` | `font-bold` (matches `WakaButton`) |
| POS names, prices, cart, checkout, keypad | `font-black` | **Unchanged** |

---

## Files changed

| File | Exact class change |
|---|---|
| `src/pages/DesktopHomePage.tsx` | Greeting `h1`: `text-lg font-black … sm:text-xl` → `font-bold` |
| `src/components/home/LivingDashboardCard.tsx` | Enterprise title only: `text-sm font-black … sm:text-base` → `font-bold`. Badge, liveStat, legacy living appearance **left `font-black`** |
| `src/components/home/HomeReportsPreview.tsx` | View-reports affordance: `text-xs font-black` → `font-bold`. `MonoNumber` / trend unchanged |
| `src/components/home/DesktopLicenseBar.tsx` | Product line: `text-base font-black` → `font-bold`. Detail/status lines unchanged |
| `src/components/home/DesktopSubscriptionBanner.tsx` | Headline: `text-base font-black` → `font-bold`. Tone/dot/min-height unchanged |
| `src/components/home/HomeMenuArrangePanel.tsx` | Preview bg title, Sell/Reports locked labels, edit heading, panel title: `font-black` → `font-bold` |
| `src/index.css` | `.waka-btn-primary`: `font-black` → `font-bold`. Height/padding/colors/radius unchanged |
| `docs/VL_2_1_WEIGHT_HIERARCHY_REFINEMENT.md` | This document |

### Settings color swatches (intentionally not changed)

`HomeMenuArrangePanel` preset color **buttons** still use `text-xs font-black capitalize`. They are **controls** (empty swatches; selected state is border/ring). VL-2.1 forbids changing buttons/selected state.

### LivingDashboardCard leftovers (intentional)

```
badge          font-black   KEEP
liveStat value font-black tabular-nums   KEEP
legacy title   font-black   KEEP (not enterprise appearance)
legacy liveStat font-black   KEEP
```

---

## POS untouched (confirmed)

These files still contain `font-black` and were not in the VL-2.1 diff:

- `src/pages/PosPage.tsx`
- `src/components/pos/PosShelfTile.tsx`
- `src/components/pos/PosSellProductCard.tsx`
- `src/components/pos/DraftCartLineRow.tsx`
- `src/components/pos/DraftCartTotalsStack.tsx`
- `src/components/pos/PosCheckoutPanel.tsx`

Payable, change, totals, amount entry, keypad, barcode, printer, sync, auth, database: not edited.

Home density: `HOME_CONTENT_MEASURE_CLASS`, gutters, `min-h-[112px]` / `96px` / Reports `88px`, `resolveHomeRegionOrder`, packing — not edited.

---

## Tests

| Check | Result |
|---|---|
| `tsc -b` | Pass |
| `src/lib/homePresentation.test.ts` | Pass |
| `src/lib/homeTileAccent.test.ts` | Pass |
| `src/lib/launcherTiles.test.ts` | Pass |
| `src/lib/dmSansWeights.test.ts` | Pass |
| Combined | **4 files, 47 tests** |

## Build

`npm run build` — **Pass** (`✓ built in 4.03s`).

---

## Viewport check

| Viewport | Result | Basis |
|---|---|---|
| 390×844 | **CODE/BUILD VERIFIED ONLY** | Weight-only; min-heights unchanged |
| 1024×768 | **CODE/BUILD VERIFIED ONLY** | Packing code unchanged |
| 1280×720 | **CODE/BUILD VERIFIED ONLY** | Region order unchanged |

**NEEDS PHYSICAL DEVICE / DevTools:** confirm greeting and long tile titles do not wrap an extra line vs pre-VL-2.1. If wrap appears, revert the specific file — do not change layout.

---

## Rollback

Revert the listed source files (class strings only). No data, font files, or tokens to undo besides `.waka-btn-primary` weight.

```bash
git checkout -- src/pages/DesktopHomePage.tsx \
  src/components/home/LivingDashboardCard.tsx \
  src/components/home/HomeReportsPreview.tsx \
  src/components/home/DesktopLicenseBar.tsx \
  src/components/home/DesktopSubscriptionBanner.tsx \
  src/components/home/HomeMenuArrangePanel.tsx \
  src/index.css
```

---

## Remaining risks

- Synthetic 900 → real 700 can slightly change glyph width (usually narrower). Unverified wrap on long Luganda/English tile titles.
- `.waka-btn-primary` was unused in `src/**/*.tsx` at implementation time; still aligned for any leftover HTML/CSS usage.
- ~2,200 `font-black` occurrences remain by design (POS, reports values, admin, marketing).

**Not in this phase:** VL-2.2 Settings/forms, VL-2.3 Reports/owner headings, VL-2.4 POS forensic pass.
