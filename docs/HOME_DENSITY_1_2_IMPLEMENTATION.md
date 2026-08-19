# HOME-DENSITY-1.2 — FIRST-SCREEN HIERARCHY IMPLEMENTATION

Date: 2026-08-19  
Baseline: HOME-DENSITY-1.2 forensic certification

## Executive verdict

**GO** (code complete; physical-device fold not measured in this session)

## Shared authority

`resolveHomeRegionOrder(largeScreen)` in `homePresentation.ts` is the only region sequence.

- Live Home: `visibleHomeRegionOrder(...)` + `useHomeRegionLayout()` (`lg` = 1024px).
- Settings: same function with `hasKpis: false`, `hasHealth: false` (preview has no KPI/Health chrome).

DOM is rendered in that array order via `HomeOrderedRegions`. **No CSS `order`.**

## Orders

**Below `lg`:** Greeting (page) → Sell → Primary → Reports → KPI → Health → Operations → Admin  

**`lg+`:** Greeting → Sell → KPI → Health → Primary → Reports → Operations → Admin  

## Reports

Still `HomeReportsPreview`, after the Primary section, not a grid tile.

## 1024×768 packing

**Implemented** for `1024 ≤ width < 1280` only: consecutive KPI + Health render as a 2-column `executive-scan`.

Evidence (CSS-derived, post-reorder): at 1024×768, 3-col KPI is two rows. Stacked KPI+Health+Primary ≈ 716px vs ~714px scrollport — Primary row would clip. Side-by-side recovers ~Health height. At `xl` (1280+) packing is **off** (720p already fits after Reports moved).

Not used on phone. Settings preview does not include KPI/Health.

## Accessibility

Keyboard/tab order follows DOM = `resolveHomeRegionOrder`. Viewport change re-renders the array (no visual/tab mismatch from `order`).
