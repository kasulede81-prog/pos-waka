# SETTINGS-DISPLAY-1.3 — HOME TILE COLOR IMPLEMENTATION

Date: 2026-08-19  
Prerequisite: SETTINGS-DISPLAY-1.2 forensic certification

## Executive verdict

**GO**

Per-tile Home color is stored in the existing `launcherTileLayout[id]` contract, resolved by one helper (`resolveHomeTileAccent`), and painted on **live Home and Settings preview** as an icon-well + left-rail accent. The enterprise card fill remains `bg-card`. Sell stays the locked hero and is not colored by this system. `homeHeroPreviewBgColor` remains a separate shop-scene strip.

This is not a preview-only change: `DesktopHomeTiles` → `LivingDashboardCard appearance="enterprise"` and `HomeReportsPreview` both apply `resolveHomeTileAccent` inline styles on the icon well and left rail.

## What changed

- Added `src/lib/homeTileAccent.ts` — shared accent resolver + contrast helper.
- Added `src/components/home/HomeTileAccentWell.tsx` — shared icon well.
- `LivingDashboardCard` enterprise mode applies accent rail + well; card stays `bg-card`.
- `HomeReportsPreview` takes `tile` and uses the same resolver (hard-coded `bg-teal-700` removed).
- `HomeMenuArrangePanel` restores per-tile preset swatches (`PRESET_SHELF_HEX`) + `ShelfColorWheel`.
- Copy (EN/LG) describes icon accent color; size still cannot be changed.
- Tests in `src/lib/homeTileAccent.test.ts`.

No migration. No new dependency. No checkout/POS/sync/auth/RLS changes.

## Color architecture

```
launcherTileLayout[id].color | customColor
  → resolveHomeMenuTiles (unchanged contract)
  → resolveHomeTileAccent(tile)
       customColor hex if valid, else PRESET_SHELF_HEX[color ?? "default"]
       iconHex = readableOnHex (white vs #1c1917, better contrast)
  → wellStyle / railStyle (inline backgroundColor)
  → LivingDashboardCard | HomeReportsPreview
```

Preset select: `{ color, customColor: null }` (Office/Shelf contract).  
Custom wheel: `{ customColor: hex }`. Wheel reset: `{ customColor: undefined, color: "default" }`.

## Settings UI

Tap a tile (including Reports) → hide switch (if hideable) + six `PRESET_SHELF_HEX` swatches + `ShelfColorWheel`.

Hero pastel balls (`HOME_HERO_PREVIEW_BG_PRESETS`) still only write `homeHeroPreviewBgColor`.

## Live Home renderer

`DesktopHomeTiles` still uses `LivingDashboardCard appearance="enterprise"` and `HomeReportsPreview`. Both call `resolveHomeTileAccent`. Main surface: `bg-card`. Accent: 4px left rail + icon well. Grid sizing unchanged.

## Reports

Still `HomeReportsPreview` (not a generic dashboard card). KPI/content unchanged. Icon well and rail use saved Reports color. Default layout already has `reports.customColor = "#0d9488"` (teal), so shops without a custom pick keep a teal accent without re-saving.

## Sell

**Not** in the per-tile accent system. `HomeBusinessHero` is unchanged. Saved `launcherTileLayout.sell` color is ignored for paint. Sell remains locked, not draggable, primary CTA `bg-primary`. Documented as intentional.

## Persistence

Unchanged shop `setPreferences` / `settings.shop` / `normalizeLauncherTileLayout`. Existing saved colors display without re-saving (defaults merged under saved layout).

## Dark mode

Accent is inline `backgroundColor` on the well/rail. `.dark .bg-card` retints the card only; it does not override the accent hex. Icon color is computed from the accent hex, not from `--card`.

## Accessibility

`readableOnHex` picks `#ffffff` or `#1c1917` by WCAG contrast. Light yellow → dark icon; dark blue → white icon. Card title/subtitle remain `text-foreground` / `text-muted-foreground`.

## Responsive behavior

Same `DesktopHomeTiles` on all viewports. Rail is `w-1` (4px); well stays `h-9 w-9` (Reports `h-12 w-12`). No grid class changes. Hero strip still `sm+` only.

## Tests

`src/lib/homeTileAccent.test.ts` (A–J): preset, custom HEX, live=preview resolver, independent tiles, existing saved color, accent independent of `--card`, light/dark fill contrast, hero strip not mixed in, Sell locked.

Relevant Home tests (`homeTileAccent` + `homePresentation` + `launcherTiles`): **29 passed**.

`npm run test:sync`: **73 passed**.

## Build

`npm run build`: **passed** (exit 0, `tsc -b` + Vite production + SEO assets). Existing Vite `INEFFECTIVE_DYNAMIC_IMPORT` warnings only; unrelated to this phase.

## Full suite

`npm test`: **2 files / 4 tests failed**, **391 files / 2209 tests passed**, 4 skipped.

Unrelated to this phase (not modified):

- `src/lib/p0Verification.test.ts` — P0-3 trial gates expected `business`, received `free`.
- `src/lib/pharmacyPatientProfile.test.ts` — DOB age expected 26, received 25 (date-sensitive).

## Manual verification

Not executed as a live click-through in this session. Recommended operator pass:

1. Settings → Home Menu → Reports → purple → save → Home: Reports accent is purple.
2. Products/inventory → blue; Customers/debts → green; Home shows independent colors.
3. Custom wheel color → refresh → color remains.
4. Light/Dark: accent remains; card stays `bg-card`.
5. Repeat at phone width.

## Production deployment

NONE (not deployed).

## Remaining risks

- Operator click-through (Settings → Home, Light/Dark, mobile) was not run in this session; live Home is wired to the same resolver as the preview.
- Default merged `customColor` values (e.g. inventory `#db2777`) will show immediately as accents for shops that never picked a color — that is existing saved/default data, not a migration.
- Wheel lightness is still fixed at 52 (existing `ShelfColorWheel`). Very light/dark fills still get a readable icon via `readableOnHex`.
- Sell color in JSON remains unused for paint.
- Contrast for mid-gray presets vs icon is adequate for UI icons; title contrast is unchanged (theme tokens).
