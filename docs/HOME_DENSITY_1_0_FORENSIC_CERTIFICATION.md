# HOME-DENSITY-1.0 FORENSIC CERTIFICATION

Date: 2026-08-19  
Mode: **FORENSIC AUDIT ONLY** (no source, CSS, Settings, resolver, sync, checkout, POS, reports, auth, or database changes)  
Repository: WAKA POS  
Related: Phase 34.0 Home certification, Phase 34.1 enterprise Home, SETTINGS-DISPLAY-1.1 / 1.3

**Physical-device verification was not performed in this session.** Viewport tables below are derived from Tailwind classes and component structure. Rows marked **inferred** are arithmetic from those classes. Rows marked **device** require iPhone Safari / Android Chrome / Capacitor WebView confirmation.

---

## 1. Executive verdict

**NO-GO as “efficient screen use” on desktop / Electron / landscape tablet.**  
**CONDITIONAL GO on phone portrait for touch usability** (2-column tiles, 48px Sell CTA, no bottom-nav collision).

Home is **one shared responsive layout** (`HomePage` → `DesktopHomePage` → `DesktopHomeTiles`) on browser, Capacitor, and Electron. There is no separate mobile Home. The screenshot’s unused space is **not a single padding bug** and **not Display Scale**.

The unused area comes from four stacked causes:

1. **Phase 34.1 executive chrome is intentionally above the fold** — greeting, Sell hero, KPI strip, Business health, then Reports — before Primary work tiles. That stack is content-bearing, but it is tall. On 1280×720 / 1440×900 it consumes most of the first screen.
2. **Home is full-bleed (`max-w-none`) with no content measure.** At Electron’s default 1440×900 (and at 1920×1080) enterprise cards stretch to ~400px+ wide while their content is a 36px icon + two text lines. The empty region is **inside the cards**, horizontally.
3. **CSS Grid default `align-items: stretch` + `min-h-[112px]`** makes an entire row as tall as the tallest tile (usually the one with a live KPI footer). Neighbors gain empty interior, not extra information.
4. **`lg:min-h-[calc(100dvh-4.5rem)]` + `flex-1`** on `DesktopHomePage` fills the viewport and parks the license footer at the bottom. When module tiles do not fill the remaining height, a large empty band appears **between the last section and the footer**.

Display Scale Compact / Balanced / Comfortable **does not change Home**. The density control is still rendered on the Home header. Compact cannot make Home denser.

The objective is not “make Home smaller.” Touch targets on tiles and the Sell CTA are already POS-appropriate and must be preserved. The next phase should **use width and above-the-fold hierarchy more intelligently**, especially on desktop/Electron, without collapsing the executive scan or restoring gradient tiles.

---

## 2. Score /100

| Category | Score | Notes |
|---|---:|---|
| Desktop density | **42** | Full-bleed short cards; executive stack + footer gap |
| Mobile density | **68** | 2-col is usable; too much chrome before Primary tiles |
| Tablet density | **55** | Portrait stays 2-col until 1024px; landscape is vertically tight |
| Responsive consistency | **74** | One layout (good); `md` unused; `2xl` unused |
| Touch usability | **78** | Tile/CTA ≥48px; health chips 40px |
| Accessibility | **71** | Focus + reduced motion; health chips undersized; heading OK |
| Settings integration | **88** | Hide/order/accent work; hidden tiles leave no empty slots |
| Localization | **58** | `line-clamp` contains overflow; many Luganda keys fall back to EN |
| Dark mode | **82** | `bg-card` tokens; accents are inline HEX |
| Display Scale | **35** | Sell-only tokens; control still shown on Home |
| Performance | **70** | Metrics hook is real work; enterprise cards skip Lottie |
| Visual hierarchy | **76** | Phase 34.1 scan path is clear; cost is first-screen height |
| **OVERALL** | **62 / 100** | **Not certified for efficient multi-device density** |

---

## 3. Architecture map

```
/  → ProtectedRoute → … → AppShell
       └── HomePage
             └── resolveTerminalHomePath
                   ├─ hospitality + floor perm → /floor (Home not shown)
                   └─ else DesktopHomePage
                        ├── page column  lg:min-h-[calc(100dvh-4.5rem)]
                        ├── greeting header
                        └── DesktopHomeTiles
                              ├── HomeBusinessHero          (Sell locked)
                              ├── HomeExecutiveKpiStrip     (null if no KPIs)
                              ├── HomeBusinessHealthSection
                              ├── HomeReportsPreview        (if reports visible)
                              ├── Primary grid              LivingDashboardCard enterprise
                              ├── Operations grid           LivingDashboardCard enterprise
                              └── Admin grid                LivingDashboardCard compact
                        └── footer DesktopLicenseBar
```

Wrappers **above** the page (AppShell):

```
html/body/#root     height/max-height: 100dvh; overflow: hidden
.app-shell-root     h-dvh max-h-dvh overflow-hidden  + app-shell--launcher
  PwaUpdateBanner   in-flow, only when a PWA update exists
  <header>          shrink-0, safe-area-top, NOT sticky
  <main>            max-w-none px-0 py-0  (Home only)
    .scroll-main-chrome  overflow-y-auto   ← PRIMARY SCROLL
      Outlet = DesktopHomePage
      MobileScrollTail   md:hidden  h-[calc(safe-bottom+0.75rem)]
  EnterpriseScrollControls  fixed FABs (not in document flow)
  (no bottom nav on /)
StabilityDiagnosticsOverlay  fixed, sibling of routes, z-9999
```

### A–K owners (layout questions)

| | Question | Owner | Tokens |
|---|---|---|---|
| A | Page width | AppShell `<main>` `max-w-none` + `DesktopHomePage` / `DesktopHomeTiles` `max-w-none` | No `max-w-*` on Home content |
| B | Vertical spacing | `DesktopHomePage` `py-4 sm:py-6` + `HOME_MODULE_SECTION_SPACING` + per-section `mb-*` | `mb-3/4/5`, `gap-2.5/3` |
| C | Card height | `LivingDashboardCard` `min-h-[112px]` / compact `min-h-[96px]` + grid stretch | Default `align-items: stretch` |
| D | Hero height | Content column (copy + `min-h-[48px]` CTA). Preview `hidden` below `sm` | Preview width `88px` / `sm:w-[112px]` |
| E | Section spacing | `HOME_MODULE_SECTION_SPACING` | `standard: mb-4 sm:mb-5`, `admin: mb-2` |
| F | Columns | `HOME_MODULE_GRID_CLASS` | 2 → `lg:` 3 or 4 → `xl:` 4 or 5 |
| G | Mobile stacking | Same component; `grid-cols-2`; hero CTA `w-full` until `sm` | No second Home tree |
| H | Scrolling | AppShell `.scroll-main-chrome overflow-y-auto` | Home is **not** viewport-locked |
| I | Hidden sections | Conditional render `length > 0`; live filter removes hidden tiles | No empty grid cells |
| J | Display Scale | `DisplayScaleProvider` only on `/pos` | `--ds-*` cleared on Home |
| K | Platform CSS | `index.html` `viewport-fit=cover`; Capacitor SystemBars `insetsHandling: "css"`; `100dvh` lock | No Electron-specific Home CSS |

Tailwind breakpoints used by Home (default config): `sm` 640px, `lg` 1024px, `xl` 1280px. **`md` (768) and `2xl` (1536) are not used by Home components.**

---

## 4. Desktop audit

Electron default window is **1440×900** (`electron/main.cjs`), min **1120×720**. Browser Home is the same React tree (`HashRouter` only).

At `xl` (≥1280):

- Page pad `xl:px-14` (56px each side) — **measured from CSS**.
- Primary/Operations: `xl:grid-cols-4`, `sm:gap-3` (12px).
- Admin: `xl:grid-cols-5`.
- KPI strip: `xl:grid-cols-6`.
- Cards: `min-h-[112px]`, `p-3.5 sm:p-4`.

**Inferred at 1440×900:** content width ≈ 1440 − 112 = 1328px. Four-column card ≈ (1328 − 36) / 4 ≈ **323px × ≥112px**. Content is a 36×36 well + title/subtitle. Most of the card face is unused.

**Inferred at 1920×1080:** content width ≈ 1808px; four-column card ≈ **443px × ≥112px**. Worse horizontal emptiness. No `2xl` cap.

`lg:min-h-[calc(100dvh-4.5rem)]` forces the page column to fill the shell. Combined with inner `flex-1`, the license footer sits at the bottom of a tall screen even when Admin has already ended. That empty band is **layout**, not a hidden widget.

Desktop also shows the **hero preview pane** (`hidden sm:block`). It is 112px wide and does not, by itself, inflate hero height: `BusinessBuilderScene` is `aspect-[400/280] w-full` (~78px tall at 112px width). A leftover rule at `min-width: 1024px` sets `.home-business-hero__preview .builder-scene-root { max-height: 220px }` — a **cap**, not a min; currently ineffective as a height driver (P3 leftover).

---

## 5. Mobile audit

Single layout; below 640px:

- Hero preview **`hidden`** (`display: none`) — **does not reserve space**.
- Hero CTA is `w-full min-h-[48px]` (stacked under copy).
- Tiles: `grid-cols-2 gap-2.5`.
- KPI: `grid-cols-2`.
- Health: `grid-cols-2`.
- Page pad `px-4 py-4`.
- No Home bottom navigation (`resolveModuleExit("/")` → `null`; `--waka-bottom-nav-h: 0px`).
- `MobileScrollTail` adds `calc(var(--waka-safe-bottom) + 0.75rem)` (`md:hidden`).
- Scroll FABs are `fixed` bottom-right; they overlay, they do not push layout.

**Inferred at 390×844:** content ≈ 358px; two-column card ≈ **174px × ≥112px**. That is a reasonable POS tile. Vertical problem is **order**, not tile size: greeting + hero + KPI + health + Reports typically fill the first screen, so **Primary work starts at or below the fold** (inferred; **device** confirm).

No duplicated mobile Home. `HomeLauncherTile` is gone.

---

## 6. Tablet audit

| Viewport | Home grid | Notes |
|---|---|---|
| 768×1024 portrait | still `grid-cols-2` (`lg` not reached) | `sm` padding/gaps apply; cards ~half of ~704px content — wide for a tile |
| 1024×768 landscape | `lg:grid-cols-3` primary; `lg:grid-cols-4` admin | Short 768px-tall viewport vs tall executive stack — **device** |

There is **no tablet-specific Home layout**. 768px is treated like a large phone (2 columns) until 1024px.

---

## 7. iOS audit

| Topic | Finding | Evidence vs device |
|---|---|---|
| Safari viewport | Shell uses `h-dvh` / `100dvh`, not `100vh` | CSS measured |
| `viewport-fit=cover` | Present on `index.html` | measured |
| Safe-area | Header `pt-[max(0.5rem,env(safe-area-inset-top))]`; tail uses `--waka-safe-bottom` | measured |
| Notch / Dynamic Island | Consumed as safe-top on header, not on Home cards | inferred |
| Home indicator | Scroll tail + FAB offset; no fixed Home tab bar | measured |
| Keyboard | Capacitor `Keyboard.resize: "body"`; Home has no text fields | inferred; **device** if a search is added later |
| Zoom | Home labels use `text-[10px]`/`[11px]` on **non-inputs**; iOS 16px auto-zoom rule is for focused controls | measured |
| `touch-action: manipulation` | `.app-shell-root button, a` | measured |
| Sticky header | AppShell header is **not** sticky | measured |
| Double-tap | Display Scale double-tap-to-reset lives on the **header control**, which is visible on Home but does not restyle Home | measured |
| Content behind chrome | Possible if safe-area env is 0 in Safari vs Capacitor — **device** | device |

---

## 8. Android audit

| Topic | Finding |
|---|---|
| Chrome viewport | Same `100dvh` lock as iOS |
| Navigation / status bar | `MainActivity` `EdgeToEdge.enable`; Capacitor SystemBars `insetsHandling: "css"` |
| Keyboard | `resize: "body"` globally; Home has no inputs |
| Back | Standard WebView history; no Home-specific handler |
| Landscape | No Home orientation CSS; same grid breakpoints |
| Touch | `touch-manipulation` on tiles |

Do **not** assume Android Chrome and Capacitor WebView insets match. **Device** required for gesture nav vs 3-button nav.

---

## 9. Capacitor audit

Shared WebView of the same Home tree.

- iOS `contentInset: "automatic"` (`capacitor.config.ts`).
- Android 15 edge-to-edge delegated to CSS `env(safe-area-inset-*)`.
- No Capacitor-only Home component.
- Keyboard resize can shrink `100dvh` body; with no Home inputs this is rarely hit.

**Risk:** if `env(safe-area-inset-*)` is 0 in a WebView build, header/content can sit under the status bar. That is an inset bug, not density. Classify as **device**.

---

## 10. Electron audit

| Item | Value |
|---|---|
| Default size | 1440×900 |
| Min size | 1120×720 |
| Router | `HashRouter` |
| Home CSS | **None** (same AppShell / `index.css`) |
| Width behavior | `xl` rules apply; cards ~323px wide (inferred) |

Electron is the **worst case for HD-01** (horizontal emptiness) because operators typically run the default 1440 window, not a phone.

Ultra-wide / 1920: same `xl` grid, no `2xl` measure — emptiness scales with width.

---

## 11. Vertical whitespace analysis

Stack as rendered for an owner with default tiles (live Home, hidden tiles omitted). Heights are **CSS-derived approximations**, not screenshots.

| Region | Approx height / source | Why it exists | Potential waste | Severity |
|---|---|---|---|---|
| AppShell header | `safe-top + pb-2 + min-h-[38px]` controls ≈ 56–88px | Brand, sync, density, theme, account | Density control does not affect Home | P2 |
| Page pad top | `py-4` / `sm:py-6` = 16 / 24px | Breathing room | Mild | P3 |
| Greeting | `text-lg/xl` + `mb-3 sm:mb-4` | Identity | Appropriate | — |
| Hero | Content + `min-h-[48px]` CTA; `mb-3 sm:mb-4` | Primary Sell action | Preview is decorative on `sm+`; hidden on phone | P3 |
| KPI strip | Title + caption + `min-h-[72px]` cards + `mb-4 sm:mb-5` | Phase 34.1 executive scan | Duplicates tile `liveStat` | P2 |
| Health | Card title/sub + `min-h-[40px]` chips + `mb-4 sm:mb-5` | Phase 34.1 health above the fold | Overlaps KPI/stock/sync | P2 |
| Reports | `min-h-[88px]` button + `mb-4 sm:mb-5` | Dedicated Reports card (intentional) | Extra vertical if `liveStat` present | P3 |
| Primary | Title `mb-2` + `min-h-[112px]` grid + section `mb-4 sm:mb-5` | Core POS modules | Grid stretch; wide cards | P1 desktop |
| Operations | Title + caption `mb-2` + same grid + section margin | Day-to-day tools | Caption adds ~20–32px | P3 |
| Admin | Title + `min-h-[96px]` compact grid + `mb-2` | Settings / investigation | 1–2 tiles look stranded on wide screens | P2 |
| Flex leftover | `flex-1` inside `lg:min-h-[calc(100dvh-4.5rem)]` | Fill viewport | Empty band above footer when content is short | P2 |
| License footer | `py-3` + link `min-h-[72px]` | Plan / sync | Always present; not hidden | P3 |
| Mobile scroll tail | `safe-bottom + 0.75rem` | Clickable last pixels on iOS | Necessary | — |

**Not found:** hidden DOM that still occupies space on live Home; `space-between` on the tile grid; `100vh` on Home; a second mobile layout.

KPI strip and health **unmount** when they have no items (`kpis.length === 0` → `null`; health always has at least connectivity/sync/subscription). They do not leave reserved empty sections.

---

## 12. Horizontal whitespace analysis

This is the **primary desktop finding**.

| Cause | Mechanism | Result |
|---|---|---|
| No max-width | `max-w-none` on AppShell main, page, tiles | Cards grow with the window |
| Short enterprise content | Icon well 36px + truncated title + 2-line subtitle | Wide empty `bg-card` face |
| Incomplete grid rows | 4-col / 5-col / 6-col with 1–3 items | Empty columns on the right (not ghost tiles) |
| Page pad | `xl:px-14` | 112px chrome; secondary to card stretch |
| KPI `xl:grid-cols-6` | Cashier may have 1–2 KPIs | Two small cards + four empty columns |

Hidden tiles **do not** leave ghost cells (`resolveHomeMenuTiles` filters `hidden` unless `includeHidden`). A one-tile section still uses the full grid template, so one card sits in column 1 of 4 — that **looks** like unused space but is empty template tracks, not a reserved hidden tile.

---

## 13. Hero analysis

`HomeBusinessHero` is **content-bearing**: shop name, open badge, live sell stat, primary Sell/Dispense CTA (`min-h-[48px]`).

The **scene** (`BusinessBuilderScene`) is decorative identity. It is `hidden` below `sm`. `homeHeroPreviewBgColor` only tints that pane — **it does not affect phone Home** and does not change tile accents (SETTINGS-DISPLAY-1.3).

Hero is **not** viewport-proportional (`h-screen` / `%` of `dvh` unused). Height is content-driven.

On phones the CTA stacks (`w-full`), so the hero is a bit taller than desktop but still compact. It does **not** need removal. It may stay as-is on mobile; on desktop the preview pane is optional polish, not the main whitespace source.

**Recommendation:** retain. Do not collapse on small screens in the first implementation phase. Do not paint the whole hero with `homeHeroPreviewBgColor`.

---

## 14. Reports analysis

`HomeReportsPreview` remains a dedicated card (not `LivingDashboardCard`).

- Wrapper: `mb-4 sm:mb-5`.
- Button: `min-h-[88px]`, `p-3 sm:p-4`, `items-stretch`.
- No extra `min-h` on the `EnterpriseCard` (`!p-0`).
- Height grows when `liveStat` is passed (label + `MonoNumber`).
- Same structure on all breakpoints; full width.

Current height is **justified** as a featured module. Empty-looking area on desktop is the same full-bleed issue as other cards (wide row, short content), not a Reports-only min-height bug.

**Do not merge Reports into the Primary grid.**

---

## 15. Tile / grid analysis

`LivingDashboardCard` `appearance="enterprise"` (live Home default):

| Density | min-height | padding | Used by |
|---|---|---|---|
| comfortable | 112px | 14px / `sm` 16px | Primary, Operations |
| compact | 96px | 12px | Admin |

- Icon well 36×36 (`HomeTileAccentWell` md); accent rail `w-1`.
- Title `truncate`; subtitle `line-clamp-2`.
- Optional `liveStat` in a `mt-auto` footer — **this is the row-height driver**.
- `tile.scale` from `launcherTileLayout` is **not applied** on enterprise cards.
- Legacy `appearance="living"` (`min-h-[140px]`, gradients) is **not** used on live Home.

Grid classes (`homePresentation.ts`):

```
comfortable: grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4
compact:     grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4 xl:grid-cols-5
```

No `items-start`, `auto-rows-min`, `grid-auto-rows`, or row spanning. **Default stretch is on.** One tall tile (KPI footer, or two-line Luganda subtitle) stretches the whole row.

---

## 16. Display Scale analysis

| Mode | Home effect |
|---|---|
| Compact | **None** |
| Balanced | **None** |
| Comfortable | **None** |
| stored `extra_large` | **None** on Home (cashier UI maps it to Comfortable on Sell) |

`DisplayScaleProvider` applies `--ds-*` and `html.pos-display-scale-active` **only** when `pathname` is `/pos` or `/pos/...`. On `/` vars are cleared.

Home typography is Tailwind rem (`text-sm`, `text-base`, `text-[11px]`) and **fixed px min-heights**. Browser zoom scales rem; Display Scale does not.

`DisplayScaleControl` is still mounted in the AppShell header on Home (`AppShell.tsx`). Copy says it is Sell density. Changing it on Home **does nothing until the user opens Sell**. This can be misread as “Compact should tighten Home.”

**Do not** wire Display Scale into Home in the first density phase. That would mix a Sell-only token system with the launcher.

---

## 17. Settings integration

SETTINGS-DISPLAY-1.1 / 1.3 still hold:

| Behavior | Live Home | Notes |
|---|---|---|
| Hide/show | Hidden tiles omitted | No empty slots |
| Hide all secondary | Safety fallback shows all | Intentional |
| Within-section order | `effectiveLauncherTileOrder` then `presentHomeMenuTiles` bands | Cross-band drag impossible |
| Reports dedicated | Extracted before banding | Same on Settings preview |
| Sell locked | Hero; not in grids | Color in JSON not painted |
| Per-tile accent | `resolveHomeTileAccent` on well + rail | Settings preview uses same components |
| `homeHeroPreviewBgColor` | Hero preview pane only (`sm+`) | Separate from tiles |
| Auth | `settings.shop` page + `setPreferences` | Unchanged |

Mobile order **equals** desktop order (same `presentHomeMenuTiles`). Bands always stack Primary → Operations → Admin.

A section with **one** tile still renders a full-width section title + a 2/3/4-column grid with one cell filled. That is awkward on desktop, not a hide-bug.

---

## 18. Localization

- Titles `truncate`; subtitles `line-clamp-2` — overflow is clipped, cards can still grow one extra line vs English.
- Several Luganda keys **fall back to English**: Reports, Settings, Investigation, Command center, Agent, many `homeModules*` / `homeHealth*` / `builderHome*` strings exist only in `en`.
- Inventory subtitle is long in both languages (“Stock levels, products and warehouse shelves”) — two-line clamp is likely.

A layout that “works in English” will mostly **clip** Luganda rather than explode, except where a two-line subtitle + `liveStat` stretches a grid row (HD-03).

---

## 19. Accessibility

| Check | Status |
|---|---|
| Tile / Reports / Sell / license targets | ≥48px min-height |
| Health chips | **`min-h-[40px]` — below 44/48** |
| Keyboard | Native `<button>` / `<Link>`; `enterpriseMotion.focus` |
| Accent contrast | `readableOnHex` on icon wells |
| Dark mode | Card tokens; accents not overwritten by `--card` |
| Reduced motion | `data-home-anim-paused`; `motion-reduce:active:scale-100` |
| SR | `role="navigation"` + `desktopHomeNavLabel`; greeting `h1`; sections `h2` |
| Do not shrink tiles to “fix” density | **Constraint for next phase** |

---

## 20. Performance

- `useHomeDashboardMetrics` filters reporting sales/returns and builds executive + per-tile stats (intentional Phase 24/34 work). Denser CSS will not remove that cost.
- Enterprise cards do **not** mount Lottie; living appearance is unused on live Home.
- `HomeBusinessHero` still mounts `BusinessBuilderScene` from `sm` up (decorative).
- Stability overlay (dev) polls IDB every 2s — not production-default.
- Layout shift: KPI/health appear when metrics resolve; no skeleton on the strip (`null` until length > 0). Mild possible shift — P3.

Making Home denser (fewer columns of empty card chrome) should **not** slow it. Collapsing KPI math would.

---

## 21. Debug / stability overlay

Source: `StabilityDiagnosticsOverlay` (“Waka stability”).

| Env | Shown? |
|---|---|
| `import.meta.env.DEV` | **Always** |
| Production | Only if `localStorage["waka-diag"] === "1"` |

Position: `fixed bottom-2 left-2 z-[9999] pointer-events-none`. **Does not occupy layout.** It overlays the bottom-left of Home (and every other route). Screenshots from local `npm run dev` will show it; production customers will not, unless diagnostics were enabled.

**Not a P0 for production.** P3 for dev screenshot confusion. If `waka-diag` is left on a shop device, it is a support/footgun, not a density bug.

---

## 22. Findings table

| ID | Sev | Finding |
|---|---|---|
| **HD-01** | **P1** | Home has no content `max-width`. Desktop/Electron/ultra-wide stretch short enterprise cards across the window. This is the main “unused whitespace” in a 1440 screenshot. |
| **HD-02** | **P1** | Greeting + hero + KPI + health + Reports consume the first viewport before Primary work, especially at 1280×720 / 1440×900 / phone portrait. Hierarchy is intentional; first-screen **module access** suffers. |
| **HD-03** | **P2** | Grid `align-items: stretch` + `liveStat` footer makes whole rows as tall as the tallest card. Empty interior is not information. |
| **HD-04** | **P2** | `min-h-[112px]` (96px admin) with no KPI leaves a reserved empty band inside the card. Do not drop this below ~48px touch; the waste is the stretch + width, not the floor itself. |
| **HD-05** | **P2** | `lg:min-h-[calc(100dvh-4.5rem)]` + `flex-1` parks `DesktopLicenseBar` at the bottom and can create a large empty region when few tiles are visible. |
| **HD-06** | **P2** | KPI `xl:grid-cols-6` and health `lg:grid-cols-6` leave empty columns when the role has few metrics. |
| **HD-07** | **P2** | Display Scale control is visible on Home but only restyles `/pos`. Compact cannot densify Home. |
| **HD-08** | **P2** | Health chips `min-h-[40px]` miss 44/48px touch guidance. |
| **HD-09** | **P2** | KPI strip, tile `liveStat`, and health chips repeat sales/stock/sync. Extra vertical cost for overlapping signals. |
| **HD-10** | **P2** | Tablet portrait (768) stays 2-column; tiles become very wide without becoming more useful. |
| **HD-11** | **P3** | Leftover `max-height: 220px` on hero `.builder-scene-root` at `lg` (currently capped by aspect-ratio width). |
| **HD-12** | **P3** | `tile.scale` persisted but unused on enterprise Home. |
| **HD-13** | **P3** | Many Luganda Home strings fall back to English; clamp contains overflow. |
| **HD-14** | **P3** | Dev-only “Waka stability” overlay in screenshots; production-gated. |
| **HD-15** | **P3** | No `2xl` measure; 1920/ultra-wide repeats HD-01 at larger scale. |
| **HD-16** | **P3** | Operations section caption (`homeModulesSecondarySub`) adds a text row the other bands do not need. |

No P0: Home is usable, touch targets on primary actions are large, Settings persistence is intact, Capacitor/Electron share the layout.

---

## 23. What is already correct

- One Home tree for all devices (no drift between “mobile Home” and “desktop Home”).
- Sell locked hero; Reports dedicated; bands Primary / Operations / Admin.
- Hidden tiles do not leave empty slots.
- Settings preview shares grid tokens and enterprise cards (SETTINGS-DISPLAY-1.1 / 1.3).
- Per-tile accent on well + rail; card fill stays `bg-card`.
- `100dvh` + `viewport-fit=cover` + safe-area tokens (sound architecture).
- No Home bottom nav overlapping tiles.
- Hero preview correctly `display: none` below `sm` (no reserved box).
- KPI strip unmounts when empty.
- Reduced motion / animation pause hooks exist.
- Display Scale correctly **does not** leak Sell density into Home tokens.
- Hospitality with floor permission never sees this Home (`/floor`).

---

## 24. What should NOT be changed

- Do not restore `HomeLauncherTile` or gradient living cards.
- Do not shrink Sell CTA or module cards below ~48px to “save space.”
- Do not merge Reports into normal tiles.
- Do not unlock or recolor the Sell hero via the tile palette.
- Do not connect `HOME_HERO_PREVIEW_BG_PRESETS` to module tiles.
- Do not apply Display Scale `--ds-*` to Home in a drive-by.
- Do not change checkout, POS grid, sync, auth, RLS, or add a migration.
- Do not delete KPI strip or health solely to densify — they were the Phase 34.1 point. Compact **how they share a row**, don’t throw them away.
- Do not add a second mobile-only Home page unless a later phase proves the shared tree cannot serve phones.

---

## 25. Recommended first implementation phase

### HOME-DENSITY-1.1 — Desktop / Electron content measure (no redesign)

**Goal:** Use horizontal space intelligently on ≥1024px (and Electron 1440) while keeping phone 2-col tiles and 48px targets.

In scope (proposed, not implemented here):

1. **Introduce a Home content measure** (e.g. `max-w-6xl` / `max-w-7xl` centered, or a card `max-width`) so 1440/1920 cards stop stretching to 400px+ empty faces. Verify AppShell `max-w-none` does not fight it.
2. **Stop grid row stretch** on module grids (`items-start` or `auto-rows-min`) so a KPI footer does not inflate neighbors.
3. **Revisit `lg:min-h-[calc(100dvh-4.5rem)]` + `flex-1`** so the license footer follows content instead of leaving a dead band (keep footer visible; don’t force it to the bottom of a sparse viewport).
4. **KPI / health on desktop:** allow a denser **shared top scan** (same data, less stacked chrome) without removing either region. Do not change KPI math.
5. **Hide or relabel Display Scale on Home** so Compact is not expected to tighten the launcher.
6. **Raise health chips to ≥44px** without changing Home grid sizing.

Out of scope for 1.1:

- Phone column count (keep 2).
- Hero removal / mobile collapse.
- Reports merge.
- Display Scale on Home cards.
- Physical iOS/Android inset bugs (track as **device** QA in 1.1 test plan).

**Later phases (only if 1.1 is insufficient):**

- HOME-DENSITY-1.2 — first-screen hierarchy (what must be visible at 720p / iPhone 390 without shrinking targets).
- HOME-DENSITY-1.3 — tablet 768 column policy (optional 3-col at `md`, **device**-gated).
- HOME-DENSITY-1.4 — overlapping KPI vs tile `liveStat` (product decision, not CSS).

---

## Breakpoint table (CSS-derived)

Legend: **CSS** = class exists; **inferred** = arithmetic from those classes; **device** = not verified on hardware.

| Viewport | Layout | Columns (primary) | Card width | Card min-h | Major gaps | Issues |
|---|---|---:|---|---|---|---|
| 320×568 | shared | 2 | inferred ~144px | 112px | gap-2.5, px-4 | Tight titles; HD-02 fold; **device** |
| 375×667 | shared | 2 | inferred ~171px | 112px | same | HD-02; **device** |
| 390×844 | shared | 2 | inferred ~174px | 112px | same | HD-02 Primary below fold likely |
| 430×932 | shared | 2 | inferred ~199px | 112px | same | Still 2-col |
| 768×1024 | shared, `sm` pad | **2** (`lg` off) | inferred ~336px | 112px | px-8, gap-3 | HD-10 wide tiles |
| 1024×768 | `lg` | 3 | inferred ~301px | 112px | px-10 | HD-02 vs short landscape; **device** |
| 1280×720 | `xl` | 4 | inferred ~277px | 112px | px-14 | HD-01 + HD-02 + HD-05 |
| 1440×900 | `xl` Electron default | 4 | inferred ~323px | 112px | px-14 | **Primary screenshot case (HD-01)** |
| 1920×1080 | `xl` (no `2xl`) | 4 | inferred ~443px | 112px | px-14 | HD-01 / HD-15 |

Hero preview: hidden &lt;640; 88px then 112px ≥640. Reports: full width, `min-h-[88px]`.

---

## Manual verification still required (not done)

1. iPhone Safari 390/430: first fold contents; safe-area; overlay-free production build.
2. Capacitor iOS vs Android insets under status/nav bars.
3. Pixel  / Android Chrome gesture nav.
4. Electron 1440×900 and 1920×1080: card interior emptiness vs footer gap.
5. Compact vs Comfortable Display Scale on Home (expect **no** layout change) then on Sell (expect change).
6. Luganda: two-line subtitles + row stretch.
7. Cashier (few tiles/KPIs) vs owner (full stack).

---

## Production deployment

NONE (audit only).
