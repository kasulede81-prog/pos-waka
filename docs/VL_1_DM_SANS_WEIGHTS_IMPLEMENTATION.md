# VL-1 — Real DM Sans Weights Implementation

**Date:** 2026-08-19  
**Mode:** CONTROLLED IMPLEMENTATION  
**Audit:** `docs/WAKA_TYPOGRAPHY_VISUAL_LANGUAGE_AUDIT.md`  
**Deployment:** NONE

Physical-device measurement was **not** performed. Viewport rows below are **CODE/BUILD VERIFIED ONLY** unless marked otherwise.

---

## Executive verdict

**GO**

WAKA still uses DM Sans as the product face. The application now loads **real** DM Sans files for 400, 500, 600, and 700 through the existing `@fontsource/dm-sans` mechanism. Weight 900 was **not** added. `font-black` class usage was **not** changed. Home ordering, POS/checkout behaviour, sizes, spacing, and family stacks are unchanged.

This phase does not make WAKA look like a different product. It backs already-requested weights with local font files instead of synthetic 500/600 rendering.

---

## Baseline

Inspected **before** the import change.

### Font entry point

`src/main.tsx` (only application font CSS entry; `index.html` has no Google Fonts link).

**Before:**

```ts
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
```

### Package

`@fontsource/dm-sans` `5.2.8` already in `package.json`. Installed files include `400.css` … `900.css` with local WOFF2 (`font-display: swap`). No new package was added.

### Family stack (unchanged)

- `src/index.css` `body`: `"DM Sans", Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
- `tailwind.config.ts` `fontFamily.sans`: DM Sans first
- `src/lib/brandTokens.ts` `WAKA_BRAND_FONT_STACK`: same
- Inter remains an **unloaded fallback name only**

### Tailwind class counts in `src/` (occurrence counts, excluding `lovable-import`)

| Class | Occurrences | Files | Maps to |
|---|---:|---:|---|
| `font-normal` | **0** | 0 | 400 (default/body still 400) |
| `font-medium` | **379** | 195 | 500 |
| `font-semibold` | **1059** | 385 | 600 |
| `font-bold` | **1354** | 395 | 700 |
| `font-black` | **2230** | 470 | 900 — **out of VL-1 scope** |
| `font-extrabold` | **0** | 0 | 800 |

Canonical roles already request 500 and 600:

- `enterpriseType.body` → `font-medium` (500)
- `enterpriseType.caption` → `font-semibold` (600)

### Numeric `font-weight` outside Tailwind (not a reason to load 900)

| Location | Weights | Notes |
|---|---|---|
| `src/components/pos/PosShelfTile.tsx` | **900**, **600** | Inline styles; 600 is live POS chrome |
| `src/lib/receiptPrint.ts` | 900, 700, 600, 500 | Print HTML; Inter named in that sheet — **not app UI** |
| `src/features/inventory/export/productLabelPrint.ts` | 800, 900 | Print labels |
| `src/lib/monthlyBusinessReport.ts` | 700 | Export HTML |
| `src/components/AppRootErrorBoundary.tsx` | 800, 700 | Isolated `system-ui` crash UI |
| `src/index.css` | none | No raw `font-weight:` rules |

---

## Decision

**Selected: B — DM Sans 400 / 500 / 600 / 700**

| Weight | Decision | Why |
|---|---|---|
| 400 | **INCLUDED** | Already loaded; body default |
| 500 | **INCLUDED** | 379 `font-medium` uses + `enterpriseType.body` |
| 600 | **INCLUDED** | 1059 `font-semibold` uses + `enterpriseType.caption` + `PosShelfTile` `fontWeight: 600`. Replacing those usages is **not** VL-1. A real 600 file is required to preserve current rendering intent. |
| 700 | **INCLUDED** | Already loaded; 1354 `font-bold` uses |
| 900 | **REJECTED** | Explicit VL-1 forbid. `font-black` remains unmodified and may still synthesize. That is VL-2, not VL-1. |

**600: INCLUDED** because current code **materially depends** on `font-semibold` / weight 600. Rejecting 600 would leave the second-most-used non-default weight synthetic.

**900: REJECTED.** Package file `900.css` exists on disk but is **not imported**.

---

## Implementation

### Files changed

| File | Change |
|---|---|
| `src/main.tsx` | Added `@fontsource/dm-sans/500.css` and `600.css` next to existing 400/700. Same import style. |
| `src/lib/dmSansWeights.test.ts` | **New.** Locks 400/500/600/700 imports, forbids DM Sans 900, forbids Google Fonts, keeps Roboto imports, asserts local `@font-face` CSS files exist. |
| `docs/VL_1_DM_SANS_WEIGHTS_IMPLEMENTATION.md` | This document |

### After (`src/main.tsx`)

```ts
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
```

No second loader. No Google Fonts. No runtime fetch. Suitable for Electron, Capacitor, and offline web (local WOFF2 via Vite).

---

## Explicitly unchanged

| Item | Status |
|---|---|
| Font family / stacks | Unchanged |
| Inter loaded | **No** (still fallback name only) |
| Roboto admin role | Unchanged (400/500/700/900 still imported) |
| `font-black` usages | Unchanged (2230 occurrences remain) |
| Font sizes, line-heights, tracking | Unchanged |
| Colors, borders, shadows, radius, spacing | Unchanged |
| Card / button / tile / touch / icon sizes | Unchanged |
| Home measure, gutters, grids, min-heights | Unchanged |
| `resolveHomeRegionOrder` / `visibleHomeRegionOrder` / `useHomeRegionLayout` | Unchanged |
| HOME-DENSITY-1.1 / 1.2 | Unchanged |
| Sell hierarchy, checkout, POS behaviour | Unchanged |
| Sync, auth, RLS, database, migrations | Untouched |
| Tailwind config | Untouched |

Note: the working tree still contains **pre-existing HOME-DENSITY-1.2** edits (`DesktopHomeTiles.tsx`, `HomeMenuArrangePanel.tsx`, `homePresentation.ts`). Those are **not** VL-1. VL-1 source change is `src/main.tsx` only, plus the new test and this doc.

---

## Verification

| Check | Result |
|---|---|
| `tsc -b` | **Pass** |
| `src/lib/dmSansWeights.test.ts` | **Pass** |
| `src/lib/enterpriseTypography.test.ts` | **Pass** |
| `src/lib/homePresentation.test.ts` | **Pass** (51 tests across the five files) |
| `src/lib/homeTileAccent.test.ts` | **Pass** |
| `src/lib/launcherTiles.test.ts` | **Pass** |
| `npm run build` | **Pass** (`✓ built in 3.92s`) |

Production bundle evidence (`dist/assets/index-*.css`):

- `@font-face` **DM Sans** weights present: **400, 500, 600, 700**
- DM Sans **900** assets: **none**
- Latin + latin-ext WOFF2 emitted for 400/500/600/700

Runtime `document.fonts` inspection in a browser was **not** performed. Code + production CSS `@font-face` is the strongest evidence available in this session.

---

## Viewport regression check

VL-1 did not change layout CSS or component classes. Glyph width for 500/600 may differ slightly from synthetic bold. That cannot be certified without rendering.

| Viewport | Result | Basis |
|---|---|---|
| 390×844 | **CODE/BUILD VERIFIED ONLY** | No layout files changed by VL-1 |
| 430×932 | **CODE/BUILD VERIFIED ONLY** | Same |
| 768×1024 | **CODE/BUILD VERIFIED ONLY** | Same |
| 1024×768 | **CODE/BUILD VERIFIED ONLY** | Same |
| 1280×720 | **CODE/BUILD VERIFIED ONLY** | Same |
| 1440×900 | **CODE/BUILD VERIFIED ONLY** | Same |
| 1920×1080 | **CODE/BUILD VERIFIED ONLY** | Same |

Focus items (unexpected wrap, clipped labels, card height, Home fold, KPI wrap, UGX, tables, Sell clip, button overflow): **not visually measured**. No compensating style changes were made.

If a real 500/600 face causes a material wrap on Home or Sell, **stop** — do not patch layout in VL-1. Report it before VL-2.

---

## Remaining physical checks

- Safari / Chrome DevTools font panel: confirm “DM Sans” used at 400/500/600/700 (not “DM Sans + synthetic”).
- Android WebView and iOS Capacitor: medium/semibold body and captions.
- Electron packaged `file://` load of the new WOFF2 assets.
- Home first-screen at 390 and 1280×720 after real 500/600 (greeting, tile subtitle, section titles).
- Sell product names / prices / keypad labels for clip after real 600 (`PosShelfTile` already requested 600).
- `font-black` (900) still synthetic — expected until VL-2.

---

## Font loading verdict

| Weight | Real DM Sans file loaded? |
|---|---|
| 400 | **Yes** (`400.css` → latin + latin-ext WOFF2) |
| 500 | **Yes** (new) |
| 600 | **Yes** (new) |
| 700 | **Yes** |
| 900 | **No** (forbidden; `font-black` still may synthesize) |

Offline / Electron / Capacitor: same local `@fontsource` model as before. Two additional static weights (~14 kB latin WOFF2 each, plus latin-ext).

---

## Home compatibility

HOME-DENSITY-1.1 and 1.2 **not modified by VL-1**.

- Content measure remains `HOME_CONTENT_MEASURE_CLASS` (`max-w-7xl`).
- Tile min-heights remain 112 / 96; Reports 88.
- Small: Greeting → Sell → Primary → Reports → KPI → Health → Operations → Admin (`HOME_REGION_ORDER_SMALL` after greeting on `DesktopHomePage`).
- `lg+`: Greeting → Sell → KPI → Health → Primary → Reports → Operations → Admin.
- 1024–1279 `packExecutiveScan` unchanged.
- Reports remains `HomeReportsPreview`.
- Shared order authority remains `homePresentation.ts` + `useHomeRegionLayout()`.
- No CSS `order` introduced by VL-1.

---

## POS compatibility

No Sell/checkout files edited. Product selection, cart, totals, keypad, payment, barcode, keyboard shortcuts, and checkout state are unchanged. `PosShelfTile` still requests `fontWeight: 600` and `900`; 600 now has a real face; 900 does not.

---

## Next phase boundary

**VL-2 = FONT-WEIGHT HIERARCHY AUDIT / CONTROLLED REFINEMENT**

That is where `font-black` (900) can be reduced toward `font-bold` (700) **without redesigning WAKA**, after screenshot sign-off.

**DO NOT implement VL-2 in this phase.**
