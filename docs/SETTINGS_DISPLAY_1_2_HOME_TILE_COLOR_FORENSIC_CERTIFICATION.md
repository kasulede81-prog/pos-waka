# SETTINGS-DISPLAY-1.2 — HOME TILE COLOR FORENSIC CERTIFICATION

Audit date: 2026-08-19  
Codebase state: post SETTINGS-DISPLAY-1.1 (Home Menu honesty)  
Constraint honored: read-only. No source edits, migrations, schema changes, deploys, or commits.

---

## Executive verdict

**NO-GO** for independently colored Home tiles.

The picker is not the primary failure. Per-tile `color` / `customColor` are stored and resolved onto `ResolvedHomeTile`, then **never applied to DOM paint**. Live Home (and the 1.1 Settings preview) render module tiles as Phase 34.1 enterprise cards with hard-coded `bg-card`. All tiles therefore look like one color.

The remaining color “balls” on Home Settings are a **different setting**: global `homeHeroPreviewBgColor` for a small shop-scene strip, not per-tile Home cards.

## Score /100

**42 / 100**

Persistence and the per-tile data model are sound. Paint never consumes them on Home. Office Menu and POS Shelves prove the same color helpers can reach the DOM when the renderer calls them.

---

## 1. Current color architecture

Two independent Home color channels exist. They must not be conflated.

### Channel A — per-tile launcher color (dormant on Home paint)

```
launcherTileLayout[tileId].color        // preset: default|red|orange|blue|green|purple
launcherTileLayout[tileId].customColor  // optional #rrggbb
  → normalizeLauncherTileLayout (hydrate)
  → mergeLauncherTileLayout + resolveHomeMenuTiles
  → ResolvedHomeTile.color / .customColor
  → presentHomeMenuTiles / resolveHomePresentation  (passes tiles through; does not paint)
  → LivingDashboardCard appearance="enterprise"
  → className includes bg-card
  → DOM background = theme token --card
```

`tile.color` and `tile.customColor` are **not read** in the enterprise branch of `LivingDashboardCard`.

Helpers that **would** paint Channel A (used by Office, not live Home):

- `launcherTileColorClasses(color)` — static Tailwind gradients per preset
- `launcherTileSurfaceStyle({ customColor })` — inline `background` from `launcherBoldTileColorStyle(hex)`

### Channel B — Home hero shop-scene strip (live, global)

```
HomeMenuArrangePanel
  6 pastel swatches HOME_HERO_PREVIEW_BG_PRESETS
  + ShelfColorWheel
  → setPreferences({ homeHeroPreviewBgColor })
  → shop preferences, settings.shop
  → HomeBusinessHero
  → style={{ backgroundColor: previewBgColor }} on .home-business-hero__preview
```

This is one color for the whole Home, not per tile. The strip is `hidden` below the `sm` breakpoint.

### SETTINGS-DISPLAY-1.1 effect

Per-tile color/scale **controls were removed** from Home Settings. Copy now says size and color cannot be changed on Home. The Settings tile preview uses the same `LivingDashboardCard appearance="enterprise"` as live Home, so preview tiles are also `bg-card`.

---

## 2. Color palette inventory

### A. Hero-strip swatches (the balls currently on Home Settings)

**File/symbol:** `src/lib/shelfColor.ts` → `HOME_HERO_PREVIEW_BG_PRESETS`  
**Rendered by:** `src/components/home/HomeMenuArrangePanel.tsx` (map over presets)

| id | hex | character |
|---|---|---|
| green | `#ecfdf5` (`DEFAULT_HOME_HERO_PREVIEW_BG`) | pastel mint |
| blue | `#eff6ff` | pastel blue |
| orange | `#fff7ed` | pastel peach |
| purple | `#f5f3ff` | pastel lavender |
| red | `#fef2f2` | pastel rose |
| white | `#ffffff` | white |

Hard-coded constant. Not theme tokens. Six choices. Designed as a **light surround** behind the shop scene, not as saturated tile fills. That is why they look “limited” and similar.

Plus **`ShelfColorWheel`** on the same section: full hue, saturation 0–100, **lightness fixed at 52** (`hslToHex(..., 52)` in `src/components/pos/ShelfColorWheel.tsx`). Writes the same global `homeHeroPreviewBgColor`. Not per-tile.

### B. Per-tile preset palette (data model; no Home UI after 1.1)

**File/symbol:** `PRESET_SHELF_HEX` in `src/lib/shelfColor.ts`  
Same six ids as shelves/office:

| id | hex |
|---|---|
| default | `#78716c` |
| red | `#e11d48` |
| orange | `#ea580c` |
| blue | `#0284c7` |
| green | `#059669` |
| purple | `#7c3aed` |

Hard-coded. Shared with Office Menu and POS Shelves. Intentionally a small branded set, not a full spectrum. Arbitrary hex is `customColor` via the same wheel (Office/Shelves still expose this per item).

### C. Legacy living-card gradients (unused on live Home)

**File/symbol:** `src/config/homeDashboardTheme.ts` → `THEME[tileId].gradient`  
Per-tile-id Tailwind `from-*/via-*/to-*` strings. Used only if `LivingDashboardCard` `appearance="living"`. Live and Settings pass `appearance="enterprise"`. In enterprise mode `homeDashboardTheme` is used **only for `subtitleKey`**.

---

## 3. Per-tile vs global color

**Storage is per-tile** for Channel A:

```
preferences.launcherTileLayout: Record<tileId, LauncherTileConfig>
```

`updateLauncherTileLayout(layout, selectedId, patch)` patches **one id**. Defaults in `DEFAULT_LAUNCHER_TILE_LAYOUT` already differ by tile (e.g. inventory `#db2777`, reports `#0d9488`).

**Paint is not per-tile.** The live renderer applies one `bg-card` to every module card.

**The only Home Settings color UI still present is global** (`homeHeroPreviewBgColor`). Selecting a ball does not write `launcherTileLayout[id]`.

So:

| Layer | Independent per tile? |
|---|---|
| JSON `launcherTileLayout[id].color` | Yes |
| JSON `customColor` | Yes |
| Settings UI after 1.1 | No tile color UI; hero strip is global |
| Live module card background | No — all `bg-card` |

---

## 4. Settings → persistence trace

### Hero strip (Channel B) — still wired

```
HomeMenuArrangePanel
  onClick preset → setPreferences({ homeHeroPreviewBgColor: preset.hex })
  ShelfColorWheel onChange → setPreferences({ homeHeroPreviewBgColor: hex ?? null })
→ usePosStore.setPreferences
→ authorizePreferencesPatch → settings.shop (SHOP_PREFERENCE_KEYS includes homeHeroPreviewBgColor)
→ hydrate: normalizeShelfHex (usePosStore ~7665)
```

### Per-tile color (Channel A) — persistable, not editable on Home Settings

```
patchSelected({ hidden })  // ONLY mutation from selected-tile panel after 1.1
```

There is **no** Home Settings control that calls `patchSelected({ color })` or `{ customColor }`. Existing JSON values survive because `normalizeLauncherTileLayout` still reads `color`, `customColor`, `scale`, `hidden`.

---

## 5. Resolver trace

```
resolveHomeMenuTiles
  mergeLauncherTileLayout(saved)
  resolveOne:
    color: cfg?.color ?? "default"
    customColor: cfg?.customColor ?? null
    scale: launcherScaleFromConfig(cfg)
    hidden: Boolean(cfg?.hidden)

presentHomeMenuTiles / resolveHomePresentation
  splits hero / reports / primary / secondary / admin
  does not drop color fields
  HomePresentationStructure snapshots ids only — color is unused there
```

Resolver **keeps** color. It does not apply CSS.

Classification of the break: **D + B**, not resolver drop.

---

## 6. Live Home renderer trace

| Tile | Renderer | Background source | Reads saved tile color? |
|---|---|---|---|
| Sell | `HomeBusinessHero` | Section: `border-border bg-card`. CTA: `bg-primary`. Strip: `homeHeroPreviewBgColor` inline | No (`launcherTileLayout.sell` unused). Strip uses Channel B |
| Reports | `HomeReportsPreview` → `EnterpriseCard` (`themeUi.surface` = `bg-card`) + icon well `bg-teal-700` | Hard-coded teal well + card token | No. Props are `lang`, `liveStat`, `onOpen` only |
| Inventory, Cash, Cash position, Dashboard | `LivingDashboardCard` `appearance="enterprise"` | `border-border bg-card`; icon well `bg-muted` | No. `tile.color` / `customColor` ignored |
| Debts, Sales history, Shop, Profit | same | same | No |
| Settings, Investigation, Command Center, Agent | same (`density="compact"` for admin) | same | No |
| Settings preview of those module tiles | same `LivingDashboardCard` enterprise | same | No |

Exact enterprise class string (`LivingDashboardCard.tsx`):

```
border border-border bg-card text-left shadow-sm
```

Icon well:

```
rounded-xl bg-muted text-foreground
```

If `color = purple` on Reports or Inventory, the DOM still gets `bg-card` / `bg-teal-700` / `bg-muted`.

---

## 7. CSS/Tailwind analysis

Live Home **does not** use `bg-${color}` for module tiles. It uses the static, safelisted class `bg-card`.

Channel A helpers:

- Presets: **static** class names inside `launcherTileColorClasses` (`from-rose-500`, `from-waka-500`, …). Tailwind can generate those because they appear as full string literals.
- Custom hex: **inline styles** via `launcherTileSurfaceStyle` → `launcherBoldTileColorStyle`. No Tailwind arbitrary-class problem.

**F is not the live-Home failure.** The live renderer never attempts to apply Channel A.

If 1.3 applied custom hex, inline `style` or a CSS variable would be required (the Office/Shelf path already does this). Dynamic `bg-${hex}` would fail Tailwind.

Hero strip already uses `style={{ backgroundColor: previewBgColor }}` — proof arbitrary hex can reach the DOM when the component assigns it.

---

## 8. Dark mode analysis

`--card` light: `30 20% 99%`  
`--card` dark (`.dark`): `24 12% 13%`  
`.dark .bg-card { background-color: hsl(var(--card)); }` (`src/index.css`)

All enterprise Home tiles follow `--card`. They change together with Light/Dark/System. They do not independently follow `customColor`.

Text/icons on enterprise cards: `text-foreground`, `text-muted-foreground`, `bg-muted` — token contrast, not derived from a tile hex.

`launcherBoldTileColorStyle` (unused on live Home) forces `color: "#ffffff"` on saturated fills. `shelfTileColorStyle` (shelves) mixes dark text onto a pastel wash. Neither is applied to live Home module cards.

Dark mode does **not** override a custom tile background, because none is set. **G is not the root cause.**

---

## 9. Responsive analysis

```
HomePage → always DesktopHomePage → DesktopHomeTiles
```

Same renderer on desktop, tablet, mobile browser, Capacitor Android/iOS, Electron.

No viewport CSS recolors module tiles. Hero strip color **is** responsive: class `hidden … sm:block` — phones do not show Channel B at all.

Display Scale (`html.pos-display-scale-active`) applies only on `/pos`. Independent of Home tile color. Does not change Home backgrounds.

---

## 10. Settings preview vs live Home

After 1.1 they share structure **and** paint for module tiles:

| Surface | Component | Reads `tile.color` / `customColor`? |
|---|---|---|
| Settings preview modules | `LivingDashboardCard` enterprise | No |
| Live Home modules | `LivingDashboardCard` enterprise | No |
| Settings / live Reports | `HomeReportsPreview` | No |
| Settings / live Sell | `HomeBusinessHero` | Strip only (`homeHeroPreviewBgColor`) |

This is **not** “preview reads color, live ignores it” anymore. **Both ignore per-tile color.** Preview vs live mismatch for **color balls** is: Settings still shows Channel B swatches; live tiles do not use them.

---

## 11. Persistence/hydration

| Field | Scope | Save | Hydrate | Logout / other device / shop |
|---|---|---|---|---|
| `launcherTileLayout[id].color` / `customColor` | Shop preferences | Yes if mutated | `normalizeLauncherTileLayout` | Follows shop cloud prefs; not device-local |
| `homeHeroPreviewBgColor` | Shop preferences | Yes from Home Settings | `normalizeShelfHex` | Same |

**Problem class: D** — hydrates and resolver keeps it; **renderer ignores it.**  
Not A (unsaved), B (not loaded), C (resolver drop), or I (lost on refresh) for Channel A.

Channel B saves and paints the strip (on `sm+` only).

---

## 12. Existing color-picker components

No `ColorPicker`, `HexColorPicker`, or `input type="color"` in `src/`.

**Reusable, already in-app:**

| Component | Path | Capability |
|---|---|---|
| `ShelfColorWheel` | `src/components/pos/ShelfColorWheel.tsx` | Full hue wheel, sat 0–100, **L=52 fixed**, center reset → `null` |
| Preset swatches | `PRESET_SHELF_HEX` + local `COLORS` arrays | 6 branded hexes, inline `backgroundColor` |
| `HOME_HERO_PREVIEW_BG_PRESETS` | `src/lib/shelfColor.ts` | 6 pastel washes (hero strip only) |

Used live today:

- `PosShelfArrangePanel` — per-shelf presets + wheel → `posShelfLayout[key]`
- `OfficeHubArrangePanel` — per-section presets + wheel → `officeHubTileLayout[id]`
- `HomeMenuArrangePanel` — **hero strip only** (pastel presets + wheel → `homeHeroPreviewBgColor`)

Do not install a new dependency. 1.3 should reuse `ShelfColorWheel` + `PRESET_SHELF_HEX` the way Office does, **per tile id**, if product wants tile color at all.

---

## 13. Office/POS Shelf comparison

| | Home | Office | POS Shelves |
|---|---|---|---|
| Settings UI per item color | Removed in 1.1 | 6 presets + wheel | 6 round swatches + wheel |
| Store | `launcherTileLayout[id]` | `officeHubTileLayout[id]` | `posShelfLayout[key]` |
| Resolver keeps color | Yes | Yes | Yes |
| Live component | `LivingDashboardCard` enterprise | `OfficeHubSectionTile` | `PosShelfTile` |
| Paint | `bg-card` | `launcherTileColorClasses` / `launcherTileSurfaceStyle` | `shelfColorClasses` / `shelfTileColorStyle` |
| Result | All same card color | Independent section colors | Independent shelf colors (catalog Sell) |

Home differs because Phase 34.1 chose calm enterprise surfaces and **stopped calling** the shared color helpers. Data and helpers remain. Office is the correct reuse target for a future 1.3 (same `LauncherTileConfig` + `launcherTileSurfaceStyle`), not the hero-strip pastel set.

---

## 14. Root cause

**Primary: B + C + D + H (post-1.1 both surfaces).**

- **B** — Per-tile color is stored; live renderer ignores it.  
- **C** — `bg-card` / `bg-muted` / Reports `bg-teal-700` are the visible backgrounds.  
- **D** — `customColor` never reaches Home DOM.  
- **H** — Settings preview uses the same enterprise renderer, so it also ignores tile color. Remaining color balls are Channel B.

**Secondary (why balls look limited): A, applied to the wrong channel.**

- The visible Home Settings swatches are six **pastel** hero-strip hexes, not the six saturated `PRESET_SHELF_HEX` tile colors.  
- The wheel exists but writes **global** hero background, lightness locked at 52.

**Not:**

- **E** for the JSON model (per-tile). **E is true of the remaining Settings color UI** (one `homeHeroPreviewBgColor`).  
- **F** Tailwind dynamic class failure on live Home (no attempt).  
- **G** dark-mode override of custom tile color.  
- **I** persistence loss.

**J (context):** SETTINGS-DISPLAY-1.1 deliberately removed per-tile color controls so Settings would not promise paint the live renderer does not do. The lock the user sees on live Home is the Phase 34.1 enterprise card, not a broken picker.

---

## 15. Findings

| ID | Severity | Finding | Evidence | Exact file/symbol |
|---|---|---|---|---|
| HC-01 | **P1** | Live Home module tiles are locked to `--card` (`bg-card`). Saved `tile.color` / `customColor` never style the DOM. | Enterprise branch classes; no `launcherTileSurfaceStyle` | `LivingDashboardCard` (`appearance="enterprise"`); `DesktopHomeTiles.renderCard` |
| HC-02 | **P1** | Reports is a dedicated card with hard-coded `bg-teal-700` icon well; ignores layout color. | Props have no color | `HomeReportsPreview` |
| HC-03 | **P1** | Sell hero body is `bg-card` / `bg-primary`; not `launcherTileLayout.sell`. | `HomeBusinessHero` | `HomeBusinessHero` |
| HC-04 | **P1** | After 1.1, Settings preview module tiles also use enterprise `bg-card`. Color balls cannot preview per-tile color. | `renderArrangeCard` → `LivingDashboardCard` enterprise | `HomeMenuArrangePanel` |
| HC-05 | **P1** | Remaining Home Settings color UI writes **global** `homeHeroPreviewBgColor`, not `launcherTileLayout[id]`. | `setPreferences({ homeHeroPreviewBgColor })` | `HomeMenuArrangePanel`; `HOME_HERO_PREVIEW_BG_PRESETS` |
| HC-06 | P2 | Those six balls are pastel washes (`#ecfdf5` …), so they look like “one pale color family,” not a full tile palette. | Constant table | `src/lib/shelfColor.ts` `HOME_HERO_PREVIEW_BG_PRESETS` |
| HC-07 | P2 | `ShelfColorWheel` is a full-hue picker but L is fixed at 52; on Home it still only sets the hero strip. | `hslToHex(..., 52)` | `ShelfColorWheel.pickHex` |
| HC-08 | P2 | Per-tile color UI was removed in 1.1; JSON still holds color/customColor/scale. Dormant capability. | `patchSelected` only `{ hidden }` | `HomeMenuArrangePanel`; `normalizeLauncherTileLayout` |
| HC-09 | P2 | `homeDashboardTheme` gradients exist per tile id but are unused for paint in enterprise mode (subtitle only). | `theme.subtitleKey` vs unused `theme.gradient` | `homeDashboardTheme`; `LivingDashboardCard` |
| HC-10 | P2 | Arbitrary HEX on a future enterprise card would need a contrast strategy; bold helper forces white text, shelf helper pastels+dark text. Neither is designed for `bg-card` + colored accent. | `launcherBoldTileColorStyle` vs `shelfTileColorStyle` | `src/lib/shelfColor.ts` |
| HC-11 | P3 | `HomePresentationStructure` omits color, which is fine for 1.1 structure tests but would not catch paint regressions. | ids-only snapshot | `homePresentation.ts` |

---

## 16. What already works

- Per-tile `color` / `customColor` **save, hydrate, and appear on `ResolvedHomeTile`**.
- `normalizeLauncherTileLayout` keeps unused color/scale across hide/unhide (proven in `homePresentation.test.ts`).
- Office Menu and POS Shelves apply the same model to the live DOM via `launcherTileSurfaceStyle` / shelf color helpers.
- `ShelfColorWheel` already provides arbitrary hue without a new dependency.
- Hero strip color (Channel B) does paint via inline `backgroundColor` on tablet+.
- Appearance Light/Dark correctly retints `--card` for the enterprise Home (all tiles together).
- Display Scale does not interfere with Home color.
- One Home renderer on all devices.

---

## 17. Recommended implementation

Do **not** “just add a color picker” on Home Settings. The picker is not what locks live tiles. A picker without paint would recreate the SETTINGS-DISPLAY-1.0 lie.

### SETTINGS-DISPLAY-1.3 — Home tile color as enterprise accents (smallest safe if product wants color)

Scope if product **wants** independently colored Home tiles:

1. **Paint first on live `LivingDashboardCard` enterprise mode** — consume `tile.customColor ?? PRESET_SHELF_HEX[tile.color]` as a **limited accent** (icon well and/or 4px left rail), using **inline `style`**, not `bg-${color}`. Do not restore `appearance="living"` gradients or `HomeLauncherTile`.
2. **Do not recolor the full card to a saturated fill** unless contrast for title, subtitle, live stats, and badges is specified. Prefer the shelf **soft** mixing approach (`shelfTileColorStyle`) or a new accent-only helper so `text-foreground` can stay.
3. **Reports:** either a matching accent on `HomeReportsPreview` or an explicit exception in copy (“Reports stays teal”).
4. **Sell:** leave as hero; do not map Channel B (hero strip) onto module tiles.
5. **Then** restore per-tile Settings controls by **copying Office’s pattern**: `PRESET_SHELF_HEX` six swatches + `ShelfColorWheel` → `updateLauncherTileLayout(layout, tileId, { color, customColor })`. Keep Channel B as a separate “shop scene strip” control.
6. No migration. Existing `launcherTileLayout` colors become visible as accents.
7. Tests: given `inventory.customColor = #7c3aed`, live card accent style includes that hex; `bg-card` remains the card fill unless product explicitly chooses otherwise.
8. Do not change checkout, shelves, Office (except reuse), auth, sync, RLS.

If product **does not** want colored Home tiles: skip 1.3 paint; optionally move Channel B off the Home Menu page or keep it clearly labeled (already “shop scene strip”). The locked `bg-card` look is then intentional.

**Do not** wire the six pastel hero balls to `launcherTileLayout`. That would still not produce independent saturated tiles.

Highest-priority finding: **HC-01** (renderer ignores stored per-tile color).

---

SOURCE MODIFIED: NO  
MIGRATIONS CREATED: NO  
DEPLOYMENT: NONE
