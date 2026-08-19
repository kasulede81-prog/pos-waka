# SETTINGS-DISPLAY-1.0 FORENSIC CERTIFICATION

Audit date: 2026-08-19  
Scope: Settings appearance/layout vs live production UI  
Method: repository-wide data-path trace (Settings UI → store → persistence → resolver → live page → renderer → CSS)  
Constraint honored: read-only. No source edits, migrations, schema changes, POS logic changes, commits, or deploys.

---

## Executive verdict

**NO-GO**

The Settings system is not a single visual-configuration pipeline. POS Shelves and Office Menu are largely live. Home Menu is not. Settings copy and preview tell the owner they can reorder, resize, and recolor the main screen; live Home ignores color and scale, extracts Reports into a hard-coded card, and re-buckets tiles into Primary / Secondary / Admin after the saved order.

That is an active product lie on the highest-visibility owner customization surface. Other appearance systems (theme, POS display scale, Office colors, Sell shelves on the catalog grid) are correctly wired and must not be treated as equally broken.

## Score /100

**54 / 100**

Rationale: Office, Shelves (catalog Sell), Appearance, and POS Display Scale are real. Home Menu — the flagship Settings customization — does not drive the live renderer. Electron desktop POS also discards shelf order/color/scale in the category rail. The score is a certification of the Settings↔live contract, not of POS checkout correctness.

---

## 1. Settings inventory

| Setting | Stored | Loaded | Live consumer | Actually works | Severity |
|---|---|---|---|---|---|
| Appearance Light/Dark/System | Yes — `localStorage` `waka-app-theme` | Yes — `AppThemeProvider` / `bootstrapAppThemeClass` | `html.dark`, `colorScheme`, `meta[name=theme-color]`, Tailwind tokens | Yes on this device | — |
| Theme persistence across devices | No (device-local) | N/A | N/A | Not shop-synced (copy does not claim it) | P2 |
| Display Scale Compact/Balanced/Comfortable | Yes — `localStorage` `waka-pos-display-scale-v1:{deviceId}` | Yes — `DisplayScaleProvider` | `html.pos-display-scale-active` + `--ds-*` on `/pos` only | Yes on Sell | — |
| Display Scale `extra_large` | Yes (legacy token) | Yes | CSS vars at 128% | Applied if stored; cashier UI has no fourth picker | P2 |
| Home tile order | Yes — `preferences.launcherTileOrder` | Yes | `resolveHomeMenuTiles` then `homeModuleBand` in `DesktopHomeTiles` | Partial — within-band only; Sell locked as hero | **P0** |
| Home tile hidden/visible | Yes — `launcherTileLayout[id].hidden` | Yes | `resolveHomeMenuTiles` filters hidden | Yes (hidden tiles leave live Home) | — |
| Home tile size/scale | Yes — `launcherTileLayout[id].scale` | Yes | Settings: `HomeLauncherTile`. Live: ignored | **No on live Home** | **P0** |
| Home tile preset color | Yes — `launcherTileLayout[id].color` | Yes | Settings: `HomeLauncherTile`. Live: ignored | **No on live Home** | **P0** |
| Home tile custom hex | Yes — `launcherTileLayout[id].customColor` | Yes | Settings: `launcherTileSurfaceStyle`. Live: ignored | **No on live Home** | **P0** |
| Home tile icons | Catalog only (`LAUNCHER_TILE_CATALOG`) | N/A | Live uses catalog `Icon` | Yes (not user-configurable) | — |
| Home hero/background color | Yes — `homeHeroPreviewBgColor` | Yes | `HomeBusinessHero` left strip `backgroundColor` | Partial — `sm+` strip only, hidden on smallest phones | P1 |
| Home Settings preview | Same store fields | Same resolver with `includeHidden` | `HomeLauncherTile` | Preview works; it is not the live renderer | **P0** |
| Office section order | Yes — `officeHubTileOrder` | Yes | `resolveOfficeHubSections` → `OfficeHubPage` | Yes | — |
| Office section hidden | Yes — `officeHubTileLayout[id].hidden` | Yes | resolver + arrange | Yes | — |
| Office section color / custom hex | Yes | Yes | `OfficeHubSectionTile` `launcherTileSurfaceStyle` / color classes | Yes | — |
| Office section scale | Model can store it via `normalizeLauncherTileLayout` | Loaded if present | `ResolvedOfficeHubSection` has no `scale`; no UI control | Dormant | P2 |
| Office icons | Catalog (`OFFICE_HUB_SECTIONS`) | N/A | Same tile component | Yes (not user-configurable) | — |
| POS shelf order | Yes — `posPinnedShelfKeys` / order keys | Yes | `buildPosShelfDisplayCards` → `sortShelvesForDisplay` | Yes on catalog Sell; featured pulled first; **no** on Electron category rail | P1 (desktop rail) |
| POS shelf name / icon | Yes — `posShelfLayout` | Yes | `PosShelfTile` | Yes on catalog Sell; rail shows icon+label only | P1 (desktop rail) |
| POS shelf color / custom hex | Yes | Yes | `PosShelfTile` + `shelfColorClasses` / `shelfTileColorStyle` | Yes on catalog Sell; **ignored** on Electron rail | P1 |
| POS shelf scale | Yes + shop default `posShelfDefaultScale` | Yes | `PosShelfTile` span/typo; Sell dampens via `dampenShelfScaleForDisplay` | Yes on catalog Sell | — |
| POS featured / badge | Yes | Yes | featured sort-first + bold tone + badge label | Yes (featured is not a pure visual flag; it reorders) | P2 |
| POS Quick Sell | Yes — `posQuickSellProductIds` | Yes | `buildQuickSellShelfCard` | Yes | — |
| POS default scale | Yes — `posShelfDefaultScale` | Yes | `buildPosShelfDisplayCards(..., defaultScale)` | Yes | — |

---

## 2. Home Menu audit

### Settings copy (what the owner is told)

- Hub: `settingsHubHomeMenuSub` = “Reorder tiles, adjust size, and choose colors on the main screen” (`src/lib/i18n.ts`)
- Arrange: `homeMenuArrangeSub` = “Drag to reorder. Tap a tile to change size and color. The Sell button stays orange.”

### Data flow — Settings (works)

```
src/pages/SettingsHomeMenuPage.tsx
  RoleProtectedRoute + page gate: settings.shop
  → HomeMenuArrangePanel
     reads/writes usePosStore.preferences:
       launcherTileOrder
       launcherTileLayout
       homeHeroPreviewBgColor
     setPreferences → settingsAuthorization SHOP_PREFERENCE_KEYS → settings.shop
  → resolveHomeMenuTiles({ includeHidden: true, ... })
  → HomeLauncherTile (color, customColor, scale, hidden, masonry span)
```

`HomeLauncherTile` consumes:

- `tile.color` via `launcherTileColorClasses`
- `tile.customColor` via `launcherTileSurfaceStyle`
- `tile.scale` via `shelfTypographyFromScale` + `shelfGridSpanStyle`
- `tile.hidden` as arrange opacity

Import graph: `HomeLauncherTile` is imported **only** by `HomeMenuArrangePanel`. It is not used on live Home.

### Data flow — live Home (different renderer)

```
src/pages/HomePage.tsx
  comment: “Unified terminal launcher on every screen size”
  → always DesktopHomePage (no separate mobile Home renderer)
    → DesktopHomeTiles
       same store: launcherTileOrder, launcherTileLayout
       same resolver: resolveHomeMenuTiles (hidden honored)
       then:
         Sell hero → HomeBusinessHero (not HomeLauncherTile)
         Reports pulled out of module grid → HomeReportsPreview
           hard-coded teal icon well (bg-teal-700)
           does not read tile.color / customColor / scale
         remaining tiles → LivingDashboardCard appearance="enterprise"
           border-border bg-card
           ignores tile.color, customColor, scale
           homeDashboardTheme(tile.id) used only for subtitle copy
         then homeModuleBand() re-buckets into Primary / Secondary / Admin
         Admin band forces density="compact"
```

Legacy `LivingDashboardCard` `appearance="living"` still exists (gradients from `homeDashboardTheme`) and is **never** passed from live Home. Live always passes `appearance="enterprise"`.

### Concrete question: “Reports → Purple → Large”

| Surface | Result |
|---|---|
| Settings preview | Reports tile becomes purple and large (`HomeLauncherTile`) |
| Live Home | Reports is `HomeReportsPreview`: teal icon, enterprise card, fixed min-height. Not purple. Not large. Position is a dedicated block above Primary, not the drag index. |

**Two independent renderers. This is a P0 finding.**

### Ordering authority — answer B

`resolveHomeMenuTiles` / `effectiveLauncherTileOrder` **does** honor saved order among secondary IDs.

`DesktopHomeTiles` **then** splits:

- PRIMARY (`src/lib/homeModulePriority.ts`): inventory, cash, cashPosition, reports, dashboard
- SECONDARY: debts, salesHistory, shop, profit
- ADMIN: everything else (settings, investigation, commandCenter, …)

Reports is removed from those grids before banding. Sell is always `group: "primary"` and is the hero, not reorderable.

The owner cannot place any tile anywhere. They can reorder **inside** a band (relative order preserved by `filter`). Settings wording implies arbitrary order.

Sell cannot be hidden (`hideable: false`). Hidden for other tiles **does** affect live Home.

### Home hero background

`homeHeroPreviewBgColor` is shop-persisted and loaded. Live consumer is `HomeBusinessHero`: a left identity strip (`hidden` below `sm`, width 88–112px). It is not a full Home background. On a phone-width Home screen the strip is not shown at all.

---

## 3. Office Menu audit

### Copy (honest)

- Hub: “Reorder and choose colors for back office sections”
- Arrange: “Drag to reorder. Tap a section to change its color.” — no size promise

### Data flow (same component preview and live)

```
src/pages/SettingsOfficeMenuPage.tsx  (settings.shop)
  → OfficeHubArrangePanel
     officeHubTileOrder / officeHubTileLayout
  → resolveOfficeHubSections (mergeOfficeHubTileLayout + order + hidden)

src/pages/OfficeHubPage.tsx
  → resolveOfficeHubSections
  → OfficeHubSectionTile mode="live"
```

`OfficeHubArrangePanel` uses the same `OfficeHubSectionTile` with `mode="arrange"`.

### Fields consumed

| Field | In model | In resolver output | Live CSS |
|---|---|---|---|
| order | yes | yes | yes |
| hidden | yes | yes | yes (omitted when `includeHidden` false) |
| color | yes | yes | `launcherTileColorClasses` |
| customColor | yes | yes | `launcherTileSurfaceStyle` inline |
| scale | stored if present via `normalizeLauncherTileLayout` | **not on `ResolvedOfficeHubSection`** | unused |
| icons | catalog | catalog | catalog |

Office is the correct architecture: one model, one resolver, one tile component. Scale is a dormant shared-model field, not a Settings lie.

---

## 4. POS Shelves audit

### Copy

Hub: “Default size, colors, order, and layout for category tiles on Sell”

### Data flow (gold standard on catalog Sell)

```
src/pages/SettingsShelvesPage.tsx
  UI: settings.shop AND shelves.customize
  Route: settings.shop only
  → PosShelfArrangePanel
     posPinnedShelfKeys, posShelfLayout, posQuickSellProductIds, posShelfDefaultScale
  → buildPosShelfDisplayCards / buildQuickSellShelfCard
  → PosShelfTile

src/hooks/useSellProductBrowseEngine.ts
  → buildPosShelfDisplayCards(...)
  → PosPage catalogShelfCards
  → PosSellCatalogShelfSection → PosShelfTile
```

Live on catalog Sell: order, displayName, icon, color, customColor, scale (dampened on Sell by display scale), featured (sorted first, then remaining order), badge, Quick Sell, default scale.

Why this system is more reliable than Home: **the arrange panel and the Sell catalog grid share `PosShelfTile` and `buildPosShelfDisplayCards`.** There is no second “enterprise” renderer that throws the layout away.

Caveats (not Home-level):

1. `sortShelvesForDisplay` pulls `featured` cards to the front. Featured is a layout override, not only a badge.
2. Electron desktop POS uses `DesktopCategoryRail`, which:
   - types shelves as `PosShelfCard` (label/icon/count only)
   - **re-sorts alphabetically** (`localeCompare`)
   - renders `DesktopPosButton` with no color, scale, featured, or badge
   - so Settings shelf customization does **not** drive the desktop category rail, even though `catalogShelfCards` still carries the full layout

---

## 5. Display Scale audit

Display Scale is **not** a shop Settings appearance page. It is a cashier Sell control plus an internal-admin kill switch.

| Layer | Values |
|---|---|
| Internal enum | `compact`, `normal`, `large`, `extra_large` (`DISPLAY_SCALE_LEVELS`) |
| Cashier UI | Compact / Balanced / Comfortable (`CASHIER_DENSITY_LEVELS` = compact/normal/large) |
| Percents | 88 / 100 / 112 / 128 |
| CSS | `--ds-*` on `html.pos-display-scale-active` (`src/index.css`, `displayScaleCssVars`) |
| Persistence | device-local `waka-pos-display-scale-v1:{deviceId}` — survives logout; not cloud |
| Apply scope | `/pos` and `/pos/*` only (`DisplayScaleProvider.onPosRoute`) |
| Platform | `fetchPlatformDisplayScaleSettings` can disable the feature for all shops |

`extra_large` remains a valid stored token and **does** apply 128% CSS if already stored. Cashier stepper maps it to Comfortable (`toCashierDensityLevel` → `large`) so the user cannot pick a fourth mode. This is documented as Phase M1.1 in `scaleTokens.ts`, not a Settings-hub 4-vs-3 lie.

Mismatch: `AdminPosDisplayScalePage` copy says “Cashiers pick one of four densities.” Cashiers pick three. That is an internal-admin terminology issue (P2), not an owner Settings page.

Density precedence on Sell (`densityPrecedence.ts`): Display Scale owns typography/gaps/touch; shelf scale may only nudge tile emphasis (dampened). Intentional.

---

## 6. Appearance/theme audit

```
src/pages/SettingsAppearancePage.tsx
  UI + route: settings.view (weaker than settings.shop)
  → useAppTheme().setPreference
  → persistAppTheme → localStorage waka-app-theme
  → applyAppThemeClass
     html.dark
     html.marketing-theme-dark
     root.style.colorScheme
     meta[name=theme-color] (#0B0F19 / #fafaf9)
```

Bootstrap before React paint: `bootstrapAppThemeClass`. Legacy key `waka-marketing-theme` is read then migrated.

Live: global CSS variables / Tailwind `dark:` variants. **Separate system from tile hex colors.** Theme is device-local. Another device, or a second browser profile, does not inherit it. Logout does not clear it (same device). Shop switch does not change it.

This works. It is not shop-wide branding.

---

## 7. Color-system audit

Three separate mechanisms:

1. **Application theme** — Light/Dark/System → `html.dark` + design tokens. Device-local.
2. **Launcher / office / shelf tile colors** — preset ids (`default|orange|blue|green|red|purple|…`) plus optional custom hex via `normalizeShelfHex` / `launcherTileSurfaceStyle` / `shelfTileColorStyle`. Shop preferences.
3. **Home hero preview strip** — `homeHeroPreviewBgColor` hex on a small `HomeBusinessHero` pane.

They do not accidentally share storage keys. They **do** collide on live Home because live Home refuses mechanism (2):

- `LivingDashboardCard` enterprise path hard-codes `border-border bg-card` and `bg-muted` icon wells.
- `HomeReportsPreview` hard-codes `bg-teal-700`.
- `homeDashboardTheme()` is a fourth, unused-for-paint map (gradients/glow) except subtitle keys in enterprise mode.

Dark mode does not “eat” shelf or office custom hex; those are inline styles / dedicated classes. Home never applies those styles, so dark mode is irrelevant to the Home color bug.

POS catalog shelves use a **soft** default tone so they do not shout over product cards; featured/selected bump to bold. Settings arrange typically shows the configured color more strongly. That is a calibrated Sell difference, not a dead setting.

---

## 8. Responsive / device audit

| Surface | Renderer | Same saved config? |
|---|---|---|
| Home desktop / tablet / mobile browser / Capacitor | **Same** `HomePage` → `DesktopHomePage` → `DesktopHomeTiles` | Yes — and therefore all devices share the Home preview/live mismatch |
| Office | Same `OfficeHubPage` / `OfficeHubSectionTile` | Yes — colors/order/hidden live everywhere |
| Sell catalog grid (web, Capacitor) | `PosShelfTile` | Yes |
| Electron desktop POS category rail | `DesktopCategoryRail` (alpha sort, no color/scale) | **No** — same `catalogShelfCards` input, different presentation that drops layout |
| Display Scale | CSS on `/pos` only | Device-local; same tokens on any viewport once on Sell |
| Theme | `html.dark` everywhere | Device-local |

There is no separate “mobile Home” that still uses `HomeLauncherTile`. Capacitor Android/iOS get the enterprise Home. Settings preview is the only place colorful/scaled Home tiles appear.

Hero background strip is `hidden` below the `sm` breakpoint, so phone Home does not show `homeHeroPreviewBgColor` at all.

---

## 9. Persistence / hydration audit

| Setting | Where stored | Load | Logout | Other device | Refresh | Shop change | Scope |
|---|---|---|---|---|---|---|---|
| Home / Office / Shelves layout | `ShopPreferences` in `usePosStore` (normalized ~store 7641+) | Shop hydrate / sync | Reloads with shop | Follows shop if cloud prefs sync | Survives | Shop-specific | Shop |
| Appearance | `localStorage` `waka-app-theme` | Bootstrap + provider | Survives | Independent | Survives | Unchanged | Device |
| Display Scale | `localStorage` `waka-pos-display-scale-v1:{deviceId}` | Provider init | Survives | Independent | Survives | Unchanged | Device |
| Display Scale enable flag | Platform fetch | Provider | N/A | Platform-wide | Re-fetched | N/A | Platform |

No evidence that Home layout saves under one key and live reads another. Live **does** read `launcherTileLayout`. It then **does not paint** color/scale. Persistence is not the bug; the live renderer is.

`setPreferences` for launcher/office/shelf keys is gated `settings.shop` (`src/lib/settingsAuthorization.ts`, `src/lib/storeAuthorization.ts` `setPreferences`). Theme `setPreference` is not a store mutation.

---

## 10. Authorization audit

| Surface | UI gate | Store / action gate | Who |
|---|---|---|---|
| Home Menu | Route + page `settings.shop` | `setPreferences` → `settings.shop` | Owner only (manager has `settings.view`, **not** `settings.shop`) |
| Office Menu | same | same | Owner |
| POS Shelves | Route `settings.shop`; **page also** `shelves.customize` | `settings.shop` for `posShelfLayout` keys | Owner (manager has `shelves.customize` but cannot reach the page without `settings.shop`, and cannot mutate prefs) |
| Appearance | Route + page `settings.view` | none (localStorage) | Owner, manager, supervisor — **this device only** |
| Display Scale | POS control; no shop permission | none | Any Sell user on that device; platform admin can disable |

Hiding the Settings hub cards is not the only control. Home/Office/Shelves mutations go through `authorizePreferencesPatch`. Appearance does not; that is acceptable for a device theme, but it is a weaker boundary than shop layout.

Manager cannot change Home/Office/Shelves through the store even if they forged a UI. Cashier has neither `settings.view` nor `settings.shop`.

---

## 11. Preview vs live renderer comparison

| Area | Preview | Live | Same model? | Same resolver? | Same component? | Same CSS? |
|---|---|---|---|---|---|---|
| Home Menu | `HomeLauncherTile` | `HomeBusinessHero` + `HomeReportsPreview` + `LivingDashboardCard` enterprise | Partial (`ResolvedHomeTile`) | Same `resolveHomeMenuTiles`, then live re-bands | **No** | **No** |
| Office Menu | `OfficeHubSectionTile` arrange | `OfficeHubSectionTile` live | Yes | Yes | Yes | Yes |
| POS Shelves (catalog) | `PosShelfTile` | `PosShelfTile` | Yes | Yes | Yes | Sell may dampen scale / soften color |
| POS Shelves (Electron rail) | `PosShelfTile` | `DesktopCategoryRail` / `DesktopPosButton` | Preview full card; rail subset | Resolver yes; rail re-sorts | **No** | **No** |
| Appearance | Settings buttons | Global `html.dark` | Yes | Yes | N/A | Yes |
| Display Scale | Admin token chips / POS control | `--ds-*` on Sell | Yes | Yes | N/A | Yes |

Home Settings preview is a **mock of a previous Home**, not a preview of production Home.

---

## 12. Findings

| ID | Severity | Finding | Evidence | Exact files |
|---|---|---|---|---|
| SD-01 | **P0** | Settings Home Menu promises size and color on the main screen; live Home ignores `tile.color`, `customColor`, and `scale`. | Live always `appearance="enterprise"` (`border/bg-card`). Preview uses `HomeLauncherTile` color/scale helpers. `HomeLauncherTile` imported only by arrange panel. | `src/lib/i18n.ts` (`settingsHubHomeMenuSub`, `homeMenuArrangeSub`); `src/pages/SettingsHomeMenuPage.tsx`; `src/components/home/HomeMenuArrangePanel.tsx`; `src/components/home/HomeLauncherTile.tsx`; `src/pages/HomePage.tsx`; `src/components/home/DesktopHomeTiles.tsx` (`renderCard`); `src/components/home/LivingDashboardCard.tsx` |
| SD-02 | **P0** | “Reports → Purple → Large” does not change live Reports. | Reports extracted to `HomeReportsPreview` with hard-coded `bg-teal-700`. Props are `lang`, `liveStat`, `onOpen` only. | `src/components/home/DesktopHomeTiles.tsx` (reportsTile); `src/components/home/HomeReportsPreview.tsx` |
| SD-03 | **P0** | Reorder is not arbitrary. Live re-groups by `homeModuleBand` after saved order. Sell is locked as hero. | PRIMARY/SECONDARY/ADMIN sets in `homeModulePriority.ts`; `DesktopHomeTiles` filters into three sections; admin forces `density="compact"`. | `src/lib/homeModulePriority.ts`; `src/components/home/DesktopHomeTiles.tsx`; `src/lib/launcherTiles.ts` (`group: "primary"` on sell) |
| SD-04 | P1 | `homeHeroPreviewBgColor` is not a Home background. | Applied only to `home-business-hero__preview` strip; `hidden` below `sm`. | `src/components/home/HomeBusinessHero.tsx`; `src/components/home/HomeMenuArrangePanel.tsx` |
| SD-05 | P1 | Electron desktop POS category rail ignores shelf order, color, scale, featured, badge. | `DesktopCategoryRail` sorts by `label.localeCompare`; renders `DesktopPosButton`; types `PosShelfCard`. | `src/components/pos/desktop/DesktopCategoryRail.tsx`; `src/pages/PosPage.tsx` (`categoryRail={... catalogShelfCards}`) |
| SD-06 | P2 | Office `scale` can exist on `LauncherTileConfig` but is dropped by `resolveOfficeHubSections` and has no arrange slider. Copy does not promise size. | `ResolvedOfficeHubSection` = color, customColor, hidden only. | `src/lib/officeHubSections.ts`; `src/components/office/OfficeHubArrangePanel.tsx`; `src/components/office/OfficeHubSectionTile.tsx` |
| SD-07 | P2 | Internal admin Display Scale page says four cashier densities; cashier UI exposes three. `extra_large` still applies if already stored. | `CASHIER_DENSITY_LEVELS` length 3; admin maps all `DISPLAY_SCALE_LEVELS`. | `src/lib/displayScale/scaleTokens.ts`; `src/components/pos/DisplayScaleControl.tsx`; `src/components/internal-admin/v2/pages/AdminPosDisplayScalePage.tsx` |
| SD-08 | P2 | Appearance is device-local; Home/Office/Shelves are shop-level. Easy to assume “Settings” is one persistence domain. | Theme: `APP_THEME_STORAGE_KEY`. Layout: `SHOP_PREFERENCE_KEYS`. | `src/lib/appTheme.ts`; `src/lib/settingsAuthorization.ts` |
| SD-09 | P2 | Featured shelves jump to the front of Sell, so “reorder” is not fully arbitrary even on the gold-standard path. | `sortShelvesForDisplay`: featured then rest. | `src/lib/posShelfLayout.ts` |
| SD-10 | P3 | Shelves route guard is `settings.shop` only; page adds `shelves.customize`. Store still requires `settings.shop`. Dead extra page check for current role matrix (only owner has both). | `src/App.tsx` vs `SettingsShelvesPage.tsx` | `src/App.tsx`; `src/pages/SettingsShelvesPage.tsx` |

---

## 13. What is already correct

- **Office Menu** preview and live share `OfficeHubSectionTile` and `resolveOfficeHubSections`. Order, hidden, preset color, and custom hex change Back Office.
- **POS Shelves on catalog Sell** (web, tablet, Capacitor) share `PosShelfTile` and `buildPosShelfDisplayCards`. Name, icon, color, custom color, scale, default scale, Quick Sell, and badges are live. This is the reference architecture.
- **Home hidden/visible** is live: `resolveHomeMenuTiles` filters `hidden` on both arrange (`includeHidden`) and live.
- **Home within-band order** is live: `filter` preserves `resolveHomeMenuTiles` order inside each band.
- **Appearance Light/Dark/System** applies globally via `html.dark`, `color-scheme`, and theme-color meta. No evidence of a dead theme toggle.
- **POS Display Scale** Compact/Balanced/Comfortable applies `--ds-*` on Sell, is device-local by design, and is correctly scoped off Home/Office.
- **Authorization for shop layout** is not UI-only: `setPreferences` requires `settings.shop`. Managers cannot mutate Home/Office/Shelves through the store.
- **Home is one live renderer across phone and desktop.** There is not a second mobile Home that “still uses the old tiles.” Capacitor and Electron Home share `DesktopHomeTiles` (and therefore share SD-01–SD-03).
- **Color systems are separated in storage.** Theme tokens are not overwriting `posShelfLayout` hex values.

---

## 14. Recommended first implementation

### SETTINGS-DISPLAY-1.1 — Home Menu honesty (smallest safe repair)

Do **not** redesign Home. Do **not** restore shouting gradient tiles against Phase 34.1. Do **not** touch checkout, payments, inventory, sync, auth, or RLS.

**Goal:** Settings Home Menu must describe and preview the same UI the owner sees on `/`.

**Scope (tight):**

1. Change Settings Home preview to compose the live pieces:
   - `HomeBusinessHero` (or a thin arrange wrapper around it)
   - `HomeReportsPreview` for Reports
   - `LivingDashboardCard appearance="enterprise"` for module tiles
   - the same Primary / Secondary / Admin banding as `DesktopHomeTiles`
2. Stop exposing size and color controls that live Home does not consume (or disable them with explicit copy: not applied on Home).
3. Change hub/arrange strings so they match behavior: hide tiles, reorder **within** Primary / Secondary / Admin, Sell stays the hero. Remove “adjust size and choose colors on the main screen.”
4. Keep `launcherTileLayout` persistence as-is (no migration). Hidden remains authoritative. Color/scale may remain in JSON unused until a later opt-in accent phase.

**Out of scope for 1.1:** applying purple/large to live Reports; Electron category rail; Office scale; Display Scale `extra_large`; theme cloud sync.

**Follow-on (not 1.1):**

- **1.2** — `DesktopCategoryRail` consume `catalogShelfCards` order and at least icon/label without alpha-sort (color optional).
- **1.3** — optional enterprise accents from `launcherTileLayout.color` on live Home, only if product still wants owner color after 1.1 honesty.

Highest-priority finding repaired by 1.1: **SD-01 / SD-02 / SD-03** (Settings actively misleads).

---

SOURCE MODIFIED: NO  
MIGRATIONS CREATED: NO  
DEPLOYMENT: NONE

Recommended next phase: **SETTINGS-DISPLAY-1.1 — Home Menu honesty** (preview + copy aligned to `DesktopHomeTiles` / `LivingDashboardCard` / `HomeReportsPreview` / `homeModuleBand`; remove dead size/color controls).
