# HOME-DENSITY-1.1 — DESKTOP / ELECTRON DENSITY IMPLEMENTATION

Date: 2026-08-19  
Baseline: `docs/HOME_DENSITY_1_0_FORENSIC_CERTIFICATION.md`

## Executive verdict

**GO** (code complete; operator click-through on Electron 1440 and a phone recommended)

Home remains the same enterprise launcher. Desktop/Electron no longer stretch short cards across 1440/1920. Module rows no longer stretch to the tallest KPI footer. The license footer follows content instead of sitting at the bottom of a manufactured empty viewport. Phone column counts, Sell hero, Reports, KPI math, Settings hide/order/accent, and 48px tile floors are unchanged.

## What changed

- `HOME_CONTENT_MEASURE_CLASS` (`max-w-7xl` / 1280px) + existing gutters on `DesktopHomePage` (HD-01).
- Module grids: `items-start` + `auto-rows-min` (HD-03 / HD-04).
- Removed `lg:min-h-[calc(100dvh-4.5rem)]` and content `flex-1` (HD-05).
- Health chips `min-h-[44px]` (audit item 6).
- KPI strip also uses `items-start` / `auto-rows-min` so a long hint does not stretch siblings.

AppShell stays `max-w-none` on `/`. The measure is Home-only inside the Outlet.

## Why max-w-7xl (1280px)

| Viewport | Previous inner width | New inner width |
|---|---:|---:|
| 390 | 358 | **358** (unchanged) |
| 768 | 704 | **704** (unchanged) |
| 1024 | 944 | **944** (unchanged) |
| 1280 | 1168 | **1168** (unchanged) |
| 1440 | 1328 | **1168** |
| 1920 | 1808 | **1168** |

`max-w-6xl` (1152) would shrink 1280 as well (inner 1040) and feel like a narrower app. `max-w-7xl` on the **same box as gutters** leaves 1280 identical and only caps 1440/1920. Four-column cards go from ~443px at 1920 to ~283px — still a comfortable POS tile, not a phone column.

## Grid stretch

`HOME_MODULE_GRID_CLASS` is shared with Settings preview. Cards keep `min-h-[112px]` (comfortable) and `min-h-[96px]` (admin). `w-full` still fills the column; height is content + min-height, not the row’s tallest sibling.

## Footer

`DesktopHomePage` is a normal column: content, then footer. AppShell `.scroll-main-chrome` remains the only scroller. `100dvh` shell and `MobileScrollTail` safe-area are untouched. Home is not viewport-locked.

## Display Scale (HD-07)

Already gated to Sell in `AppShell` (`onSellScreen ? DisplayScaleControl : null`). No further change.

## Not in this phase

- KPI + health merged onto one desktop row (would be a hierarchy redesign).
- Phone column count.
- Hero collapse / Reports merge.
- Display Scale tokens on Home cards.
- Checkout / POS / sync / auth / RLS / migrations.

## Tests

`src/lib/homePresentation.test.ts` — inner widths at 390/768/1024/1280/1440/1920; grid `items-start` + `auto-rows-min`; column counts preserved.

## Remaining risks

- Operator should confirm Electron 1440 and 1920 visually.
- A one-tile section still sits in column 1 of a 4-col grid (empty tracks, not ghost tiles).
- First-screen stack (hero + KPI + health + Reports before Primary) is unchanged (HD-02 deferred to 1.2).
