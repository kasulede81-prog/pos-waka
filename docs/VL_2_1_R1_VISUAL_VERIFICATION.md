# VL-2.1-R1 — Typography Visual Verification Audit

**Date:** 2026-08-19  
**Mode:** FORENSIC AUDIT ONLY — no source, CSS, layout, or POS changes.  
**Baseline:** `docs/VL_2_1_WEIGHT_HIERARCHY_REFINEMENT.md`  
**Scope:** Confirm `font-black` → `font-bold` on Home/Settings informational chrome did not change layout tokens and did not touch POS.

**Physical screenshots were not captured.** Viewport rows are **CODE/BUILD VERIFIED** unless marked **NEEDS DEVICE**.

---

## Executive verdict

**CONDITIONAL GO**

VL-2.1 is **layout-clean in code**: the only class edits on the listed files are weight (`font-black` → `font-bold`). Font sizes, padding, margins, min-heights, grids, and breakpoints on those files are unchanged. POS Sell/checkout still request `font-black`. Tests and production build pass.

The remaining condition is **pixel confirmation** at 390×844, 1024×768, and 1280×720 (and Luganda on a real phone). Code analysis does **not** predict extra tile rows: enterprise tile **titles truncate**. Greeting has no truncate; 700 is not wider than synthetic 900, so wrap risk is not increased, but a long cashier name already near the fold still needs a device glance.

Do **not** start VL-2.2 until that glance, or explicitly accept code-only residual risk.

---

## 1. Changed files — forensic inspection

Git diff on VL-2.1 surfaces (weight lines only):

| File | VL-2.1 edit | Sizes / pad / min-h / grid |
|---|---|---|
| `src/pages/DesktopHomePage.tsx` | Greeting `h1`: `font-black` → `font-bold` | `text-lg` / `sm:text-xl` unchanged; `mb-3` / `sm:mb-4` unchanged |
| `src/components/home/LivingDashboardCard.tsx` | Enterprise **title** only | `min-h-[112px]` / `96px`, `p-3.5 sm:p-4` / `p-3` unchanged |
| `src/components/home/HomeReportsPreview.tsx` | View-reports label | `min-h-[88px]`, `p-3 sm:p-4` unchanged |
| `src/components/home/DesktopLicenseBar.tsx` | Product line | `min-h-[72px]`, `px-5 py-4` unchanged; **truncate** still on headline |
| `src/components/home/DesktopSubscriptionBanner.tsx` | Headline | `min-h-[52px]`, `px-4 py-3` unchanged |
| `src/components/home/HomeMenuArrangePanel.tsx` | Informational titles/labels | Color **buttons** still `font-black`; selected ring unchanged |
| `src/index.css` `.waka-btn-primary` | `font-black` → `font-bold` | `min-h-[44px]`, `px-4 py-2.5`, `rounded-xl`, `bg-waka-600` unchanged |

**Confirm:**

| Check | Result |
|---|---|
| No font sizes changed | **Pass** |
| No padding changed | **Pass** |
| No margins changed | **Pass** |
| No min-heights changed | **Pass** |
| No grid classes changed | **Pass** (`HOME_MODULE_GRID_CLASS` unused by these weight edits) |
| No responsive breakpoints changed | **Pass** |

Note: the working-tree diff of `HomeMenuArrangePanel.tsx` also contains **HOME-DENSITY-1.2** `HomeOrderedRegions` wiring. That is **not** VL-2.1. VL-2.1 on that file is weight-only on headings/labels. R1 does not re-litigate 1.2 order.

---

## 2. Hierarchy verification (code)

### Enterprise Home tile (`LivingDashboardCard`, default appearance)

| Role | Classes now | Target |
|---|---|---|
| Title | `text-sm font-bold … sm:text-base` + **`truncate`** | 700 |
| Subtitle | `text-[11px] font-medium … sm:text-xs` | 500 |
| LiveStat label | `text-[10px] font-bold uppercase` muted | quieter than value |
| LiveStat value | `text-sm font-black tabular-nums` | **Still stronger than title** |
| Badge | `text-[10px] font-black` | Unchanged |

Title is no longer the same weight as the live number. Subtitle stays 500. **Pass (code).**

### Greeting

`text-lg font-bold sm:text-xl` vs subtitle `text-sm font-medium`. Sell CTA remains `font-bold` + **primary fill** + `min-h-[48px]`. CTA emphasis is color/size, not 900. **Pass (code).**

### Reports

Title: `SectionTitle` (700). KPI: `MonoNumber`. Affordance: `text-xs font-bold` (was black). Height 88px unchanged. **Pass (code).**

### Settings arrange

Preview/section/edit/panel titles: 700. Color swatches: still `font-black` on empty buttons (weight not visible). `WakaSwitch` still `font-bold`. **Pass (code).**

No title was moved to 400/500. None of the listed CTAs lost fill or min-height.

---

## 3. Screens audited

### Home — 390×844

| Element | Code finding | Visual |
|---|---|---|
| Greeting | Weight only; **no truncate**. Long `{name}` can wrap at any weight. 700 is not wider than synthetic 900 | **NEEDS DEVICE** |
| Sell hero | **Not edited.** Shop `truncate` + `font-bold`; CTA 48px `font-bold` | CODE OK |
| Primary tiles | Title **truncate** → extra title line **cannot** raise card above content; `min-h-[112px]` unchanged | CODE OK for height; **NEEDS DEVICE** for ellipsis vs prior |
| Reports | 88px min; KPI `MonoNumber` unchanged | CODE OK |
| KPI / Health | Not in VL-2.1 file list; packing in `homePresentation.ts` unchanged | CODE OK |
| Luganda wrapping | Tile titles e.g. `Emirimu egy'enjawulo`, `Embeera y'ensimbi` are **truncated**. Greeting LG keys are still English `"Good morning, {name}"` (pre-existing i18n, not VL-2.1). Subscription LG can be long; banner has no truncate — **same as before**, 700 not wider | **NEEDS DEVICE** for banner |

**Scroll / first-screen:** region order still `hero → primary → reports → kpi → health` below `lg`. VL-2.1 cannot reorder. Extra scroll only if greeting wraps an extra line (name-length, not weight).

### Home — 1024×768

| Check | Code finding | Visual |
|---|---|---|
| KPI packing | `packExecutiveScan` true for 1024–1279; VL-2.1 did not touch it | CODE OK |
| Primary visibility | Large order still greeting → sell → kpi → health → **primary** → reports | CODE OK |
| Tile wrapping | Titles truncate; grid still 3-col at `lg` | CODE OK / **NEEDS DEVICE** for ellipsis |

### Home — 1280×720

| Check | Code finding | Visual |
|---|---|---|
| First-screen hierarchy | `HOME_REGION_ORDER_LARGE` unchanged; `packExecutiveScan` false at 1280 | CODE OK |
| Tile widths | `max-w-7xl` + gutters unchanged; 4-col at `xl` | CODE OK |
| Reports position | After Primary on large | CODE OK |
| Home density 1.1 | Measure/gutters/min-heights unchanged | CODE OK |

### Settings — Home Menu

| Check | Code finding | Visual |
|---|---|---|
| Preview headings | 700 | CODE OK |
| Arrange labels | Sell/Reports locked labels 700 | CODE OK |
| Color picker | Swatch **buttons** still `font-black`; selection = ring | CODE OK |
| Controls | Switch, drag chrome, permissions not weight-edited | CODE OK |
| Honesty | Same `LivingDashboardCard` / `HomeReportsPreview` as live Home | CODE OK |

---

## 4. Explicitly unchanged (POS / money)

Verified still `font-black` (or equivalent) in current source; **not** in the VL-2.1 weight diff:

| Surface | Evidence |
|---|---|
| POS product name/price | `PosSellProductCard.tsx` `font-black` |
| Cart / qty / line UGX | `DraftCartLineRow.tsx` `font-black` |
| Payable / change | `DraftCartTotalsStack.tsx` `font-black tabular-nums` |
| Checkout / pay / keypad | `PosCheckoutPanel.tsx` many `font-black` |
| Shelf | `PosShelfTile.tsx` `font-black` |
| Printer receipts | `src/lib/receiptPrint.ts` not in VL-2.1 |

Sell hero CTA: still `font-bold` + primary (pre-VL-2.1). **Not weakened.**

`.waka-btn-primary` is 700 to match `WakaButton`; min-height 44px kept. Unused in `src/**/*.tsx` at VL-2.1 time.

---

## 5. Regression findings

| ID | Severity | Finding | Action |
|---|---|---|---|
| R1-01 | None (code) | No size/pad/min-h/grid/breakpoint edits on VL-2.1 files | — |
| R1-02 | Residual | Greeting and subscription headline are **not** truncated; wrap possible for long names / LG expiry copy | Device check; **do not** add truncate in this audit |
| R1-03 | Residual | Tile titles may **ellipsis** more if 700 is slightly narrower — height still floored | Device glance |
| R1-04 | Info | LG greeting strings are still English | Pre-existing; not a VL-2.1 regression |
| R1-05 | None | LiveStat remains `font-black`; hierarchy intent held | — |
| R1-06 | None | POS/checkout/receipts untouched | — |

**No code-level Home density or scroll regression identified.** No fix implemented (audit-only).

---

## 6. Tests

| Check | Result |
|---|---|
| `tsc -b` | **Pass** |
| `src/lib/homePresentation.test.ts` | **Pass** (includes 390 pack off, 1024 pack on, 1280 pack off, small/large region order) |
| `src/lib/homeTileAccent.test.ts` | **Pass** |
| `src/lib/launcherTiles.test.ts` | **Pass** |
| `src/lib/dmSansWeights.test.ts` | **Pass** (400/500/600/700; no DM Sans 900) |
| Combined | **4 files, 47 tests** |

## 7. Build

`npm run build` — **Pass** (`✓ built in 4.31s`).

---

## Remaining risks

1. **No screenshot / Capacitor / Electron visual session** at 390, 1024×768, 1280×720.  
2. Long **greeting names** on 390 (center-aligned).  
3. Luganda **subscription** sentence wrapping on the banner.  
4. Android WebView 700 vs previous synthetic 900 (usually cleaner, not taller).  
5. VL-2.2+ still must not batch-replace remaining ~2,200 `font-black` uses.

**Recommended before VL-2.2:** 60-second Home pass on a phone at 390 (EN + LG if used) and Electron 1280×720. If a title looks too light, that is a **taste** issue for a later phase — not a density bug, unless wrap is observed.

---

## Next phase boundary

- **VL-2.2** Settings/forms typography — only after R1 residual glance, or with eyes-open code-only risk.  
- Do not open POS/checkout weight in that phase.
