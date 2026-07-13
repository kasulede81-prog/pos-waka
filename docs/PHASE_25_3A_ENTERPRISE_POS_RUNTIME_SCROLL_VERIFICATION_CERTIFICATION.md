# Phase 25.3A — Enterprise POS Runtime Scroll Verification Certification

**Mode:** Read-only forensic runtime audit (NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates)  
**Date:** 2026-07-13  
**Objective:** Determine exactly why shelf and product catalog still do not scroll on the running application (Web and Android) despite Phase 25.3 implementation.  
**Builds on:** [Phase 25.3](./PHASE_25_3_ENTERPRISE_POS_NATIVE_INTERACTION_AND_TOUCH_EXPERIENCE.md) (implementation marked Complete)

---

## Executive Summary

Phase 25.3 **is present in source and in a fresh production web build**, but it **does not produce scrollable shelves at runtime** because the **flex height chain breaks one level above the catalog scroll pane**. The scroll pane receives correct CSS (`overflow-y: scroll`, `flex: 1 1 0%`, `height: 0`, `touch-action: pan-y`) but **expands to full content height** instead of being viewport-bounded. With `clientHeight === scrollHeight`, there is nothing to scroll.

**Primary root cause (RC-1):** `PosPage.tsx` split wrapper (`~L1844`) only receives `flex min-h-0 flex-1 …` when `mountDesktopCheckoutSidebar && isFullDesktopPos` (desktop grid with active cart sidebar). On **mobile, compact tablet, and full desktop with an empty cart**, the wrapper is a plain block box. The catalog column’s `flex-1` is inert; content grows unbounded; `PosPage` root clips with `overflow-hidden`.

**Playwright runtime measurements** (fixture reproducing committed class/CSS chain, 24 shelf tiles):

| Scenario | Scroll pane `clientHeight` | `scrollHeight` | Scrollable | `scrollTop` moves |
|----------|---------------------------|----------------|------------|-------------------|
| Mobile 390px — **current** split wrapper | 3560 | 3560 | ❌ | ❌ |
| Mobile 390px — **fixed** split wrapper (`flex-1 min-h-0 flex-col`) | 499 | 3560 | ✅ | ✅ |
| Compact 800px — **current** | 3560 | 3560 | ❌ | ❌ |
| Compact 800px — **fixed** | 796 | 3560 | ✅ | ✅ |
| Desktop 1280px — **current** | 3560 | 3560 | ❌ | ❌ |
| Desktop 1280px — **fixed** | 572 | 3560 | ✅ | ✅ |

**Web vs Android:** The layout failure is **identical** (same WebView/CSS flex model). Android additionally has **no synced web assets** under `android/app/src/main/assets` and **no Phase 25.3 markers** in `android/app/build` intermediates at audit time — the installed debug APK is almost certainly **stale relative to current source**, but even after sync the RC-1 flex break would still prevent scrolling until fixed.

**Verdict:** Phase 25.3 scroll CSS and component wiring **execute**, but **cannot take effect** without a bounded ancestor. **One-line layout scope** in `PosPage.tsx` is the minimal fix.

---

## Certification Methodology

1. Runtime component trace from React render paths (`PosPage`, `AppShell`, shelf section)
2. Scroll ownership chain from CSS + DOM structure
3. Catalog mode branch analysis (`catalogSellMode`, `showCatalogShelfGrid`, dead branches)
4. Built artifact verification (`npm run build` → `dist/assets/`)
5. Playwright layout probe reproducing committed flex/CSS class chain (read-only script, discarded after audit)
6. Android asset grep for Phase 25.3 bundle markers
7. Event / touch / virtualizer static trace

**Not performed:** Live device systrace, production APK decompile, authenticated full-app Playwright navigation (no test harness / seed login in repo).

---

## PART 1 — Runtime Component Trace

### Active path (shelf grid, no search, `catalogSellMode === true`)

Confirmed from `PosPage.tsx` render conditions:

```
AppShell (.app-shell-root.app-shell--sell-focus)
└─ header (shrink-0)
└─ main (flex-1 min-h-0 overflow-hidden)
   └─ section (flex-1 min-h-0 flex-col)
      └─ .scroll-main-chrome.scroll-main-chrome--pos (flex flex-col overflow-hidden)  ← NOT scroll owner
         └─ div (flex-1 min-h-0 flex-col overflow-hidden)  ← Outlet wrapper + sell-focus CSS
            └─ ShiftSellGateway (fragment — no DOM node)
               └─ PosPage root div (flex min-h-0 flex-1 flex-col overflow-hidden)
                  ├─ PosOfflineBanner
                  ├─ PosShiftSummaryCollapsible | ActiveShiftBanner | PosDesktopCompactHeader
                  ├─ PosOperationalNav (non-full-desktop)
                  ├─ PosSellHeroCard (compact only)
                  └─ split wrapper div (~L1844)  ⚠️ often NO flex classes
                     └─ catalog column div (flex min-h-0 flex-1 flex-col overflow-hidden)
                        ├─ search block (sticky shrink-0)
                        └─ div[data-pos-catalog-scroll].pos-catalog-scroll-pane  ← intended scroll owner
                           ├─ PosQuickProductChips (optional)
                           └─ PosSellCatalogShelfSection
                              └─ masonry grid
                                 └─ PosShelfTile (<button>, touch-pan-y)
```

### Branches **not** rendered in normal sell flow

| Branch | Condition | Status |
|--------|-----------|--------|
| `showShelfBoxes` | `!catalogSellMode` | **Dead** — `catalogSellMode` is always true (mobile ∨ compact ∨ full) |
| Legacy non-`catalogSellMode` product view | `!catalogSellMode && hasSellViewFilter` | **Dead** |
| `scroll-main-chrome` as document scroll | `viewportLocked === false` on `/pos` | **Not active** — `isViewportLockedRoute('/pos') === true` |

### Product drill-down / search path

When `catalogShelfDrillDown` or `showCatalogSearchResults`: same scroll pane wrapper (`catalogScrollPaneClass` + `data-pos-catalog-scroll`), content switches to `VirtualizedProductGrid` or static product cards inside the pane.

---

## PART 2 — Scroll Ownership Certification

### Intended owner (Phase 25.3)

`[data-pos-catalog-scroll].pos-catalog-scroll-pane`

### Runtime ownership chain (measured — mobile 390px, current code)

| Element | overflow-y | height (computed) | clientH | scrollH | flex | Scroll owner? |
|---------|------------|-------------------|---------|---------|------|---------------|
| `html` / `body` / `#root` | hidden | 100dvh | = viewport | = viewport | — | ❌ locked |
| `.app-shell-root` | hidden | 100dvh | 727 | 727 | flex col | ❌ |
| `main` | hidden | flex child | 671 | 671 | flex 1 | ❌ |
| `.scroll-main-chrome` | hidden | flex child | 671 | 671 | flex 1 | ❌ |
| Outlet wrapper `> div` | hidden | flex child | 671 | 671 | flex 1 | ❌ |
| `.pos-page-root` | hidden | 671px | 671 | **3732** | flex 1 | ❌ **clips overflow** |
| **split wrapper** | visible | **3612px** | 3612 | 3612 | **0 1 auto** | ❌ **breaks chain** |
| catalog column | hidden | 3612px | 3612 | 3612 | flex 1 (inert) | ❌ |
| **`.pos-catalog-scroll-pane`** | **scroll** | **3560px** | 3560 | 3560 | 1 1 0% | ❌ **no overflow** |

**Where scrolling stops:** The scroll pane has `overflow-y: scroll` but **does not overflow** because its height equals content height. The page root clips excess (`overflow-hidden`, `scrollHeight 3732 > clientHeight 671`).

### After minimal fix (split wrapper `flex-1 min-h-0 flex-col overflow-hidden`)

| Element | clientH | scrollH | Scroll owner? |
|---------|---------|---------|---------------|
| split wrapper | 848 | 848 | ❌ bounds children |
| catalog column | 848 | 848 | ❌ |
| **`.pos-catalog-scroll-pane`** | **796** | **3560** | ✅ **authoritative** |

---

## PART 3 — Catalog Mode Verification

| Flag | Runtime value (all POS layout bands) | Phase 25.3 path active? |
|------|--------------------------------------|-------------------------|
| `catalogSellMode` | `true` (mobile ∨ compact ∨ full) | ✅ |
| `catalogViewportLayout` | `true` | ✅ |
| `showCatalogShelfGrid` | `true` when shelves exist & no search | ✅ primary shelf UI |
| `showShelfBoxes` | always `false` (`!catalogSellMode` never satisfied) | ❌ dead |
| `catalogShelfDrillDown` | `true` when category filter ≠ ALL | ✅ uses same scroll pane |
| `viewportLocked` on `/pos` | `true` | ✅ |

**Conclusion:** Phase 25.3 catalog mode **is selected and executed**. The failure is not a wrong branch; it is layout propagation inside the active branch.

---

## PART 4 — CSS Runtime Verification

### Source rules (present)

```331:345:src/index.css
  .pos-catalog-scroll-pane {
    overflow-y: scroll;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
    flex: 1 1 0%;
    height: 0;
    min-height: 0;
    max-height: 100%;
    ...
  }
```

```260:267:src/index.css
  .app-shell--sell-focus .scroll-main-chrome > div {
    flex: 1 1 0%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
```

### Built web bundle (`npm run build`, 2026-07-13)

- `dist/assets/index-*.css` — contains `.pos-catalog-scroll-pane`, `.app-shell--sell-focus .scroll-main-chrome > div`, `touch-action: pan-y`
- `dist/assets/index-*.js` / POS chunks — contain `data-pos-catalog-scroll`, `pos-catalog-scroll-pane` class string, `requireCatalogScrollElement`

### Computed runtime on scroll pane (current broken chain)

| Property | Expected (Phase 25.3) | Measured runtime |
|----------|----------------------|------------------|
| exists | ✅ | ✅ |
| `overflow-y` | scroll | scroll |
| `flex` | 1 1 0% | 1 1 0% |
| `height` | 0 → flex resolved | **3560px (content-sized)** |
| `min-height` | 0 | 0 |
| `max-height` | 100% | 100% (no effect — parent unbounded) |
| `display` | block | block |
| `position` | static | static |
| `touch-action` | pan-y | pan-y |

**Override audit:** No competing selector disables `overflow-y` on the scroll pane. The pane’s rules apply; **`height: 0` + `flex: 1` cannot constrain height when the flex column parent has no bounded height** (parent is block/auto-height).

---

## PART 5 — Flex Chain Certification

```
AppShell root          flex: 1 1 0%  min-h-0  ✅ bounded
  scroll-main-chrome   flex: 1 1 0%  min-h-0  overflow hidden  ✅
    Outlet wrapper     flex: 1 1 0%  min-h-0  overflow hidden  ✅ (+ sell-focus CSS)
      PosPage root     flex: 1 1 0%  min-h-0  overflow hidden  ✅
        split wrapper  flex: 0 1 auto  min-h-auto  ❌ FIRST BROKEN LINK
          catalog col  flex: 1 1 0%  (inert — parent not flex container)
            scroll pane flex: 1 1 0% height:0  (expands with content)
```

### Code evidence — conditional flex on split wrapper only

```1844:1852:src/pages/PosPage.tsx
      <div
        className={clsx(
          mountDesktopCheckoutSidebar && isFullDesktopPos && "grid min-h-0 flex-1 items-stretch gap-2",
        )}
        style={posSplitColumns ? { gridTemplateColumns: posSplitColumns } : undefined}
      >
        <div
          ref={catalogWidthRef}
          className={clsx(isFullDesktopPos ? "flex min-h-0 min-w-0 flex-col gap-1.5" : catalogSellMode ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "min-w-0 space-y-2")}
```

`shouldMountDesktopCheckoutSidebar` requires **full desktop + products + draft lines + checkout not minimized**. Browsing shelves with an **empty cart** — the common case — leaves the split wrapper **without** `flex-1` or `display:flex/grid`.

---

## PART 6 — Touch Routing

| Target | Class / rule | Computed `touch-action` (runtime) | Blocks vertical pan? |
|--------|--------------|-----------------------------------|----------------------|
| `.pos-catalog-scroll-pane` | CSS `touch-action: pan-y` | pan-y | ❌ |
| `PosShelfTile` (sell mode) | `POS_CATALOG_TILE_TOUCH_CLASS` → `touch-pan-y` | pan-y | ❌ |
| Product cards (`PosSellProductCard`, etc.) | `touch-pan-y` | pan-y | ❌ |
| Category / quick chips | `touch-pan-x` | pan-x | ❌ (horizontal only) |

**Conclusion:** Touch routing from Phase 25.3 **is applied** on the active shelf path. Scrolling fails because **the scroll surface has no overflow**, not because touch-action blocks pan-y.

---

## PART 7 — Virtualizer Verification

```73:79:src/components/pos/VirtualizedProductGrid.tsx
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => {
      const owner = requireCatalogScrollElement(parentRef.current);
      reportPosVirtualizerOwner(owner, variant);
      return owner;
    },
```

| Surface | Virtualized? | Scroll element binding |
|---------|--------------|------------------------|
| Shelf grid (`PosSellCatalogShelfSection`) | **No** — all tiles rendered | N/A |
| Search / drill-down products (>10) | Yes | `[data-pos-catalog-scroll]` via `requireCatalogScrollElement` |
| Fallback to `window` / `scroll-main-chrome` | **Removed** in Phase 25.3 | Not present in source |

**Shelf scroll failure is independent of virtualization.** Product virtualizer would also fail on the same unbounded pane (`scrollHeight === clientHeight`).

---

## PART 8 — Overflow Conflict Audit

Ancestors that prevent **page-level** scroll (by design):

| Selector | overflow | Effect |
|----------|----------|--------|
| `html`, `body`, `#root` (app shell) | hidden | Document never scrolls ✅ |
| `.app-shell-root` | hidden | ✅ |
| `main`, `.scroll-main-chrome`, Outlet wrapper | hidden | ✅ |
| `PosPage` root | hidden | Clips unbounded catalog — **symptom surface** |

No ancestor applies `overflow: hidden` **on the scroll pane itself**. Conflict is **missing height bound**, not hidden overflow on the pane.

---

## PART 9 — Runtime Layout Measurements

### Scroll pane — current vs fixed (Playwright, committed CSS/classes)

**Mobile 390×727**

| Metric | Current | Fixed wrapper |
|--------|---------|---------------|
| `clientHeight` | 3560 | 499 |
| `scrollHeight` | 3560 | 3560 |
| `offsetHeight` | 3560 | 499 |
| `getBoundingClientRect().height` | 3560 | 499 |
| `scrollTop` after assignment 400 | 0 | 400 |
| Actually scrollable | false | true |

**PosPage root (current):** `clientHeight 671`, `scrollHeight 3732`, `overflow hidden` — **3061px of catalog content clipped invisibly**.

### Catalog / AppShell (fixed chain — compact 800×1024)

| Node | clientH | scrollH |
|------|---------|---------|
| AppShell | 1024 | 1024 |
| scroll-main-chrome | 968 | 968 |
| PosPage root | 968 | 968 |
| scroll pane | 796 | 3560 |

---

## PART 10 — Event Routing

| Event | POS sell listeners blocking scroll? | Evidence |
|-------|-------------------------------------|----------|
| `wheel` | Only Ctrl/Meta + wheel for display scale | `PosPage.tsx` L451–458, gated by `displayScaleOn` |
| `touchmove` | No POS catalog listeners with `preventDefault` | grep — none in `src/components/pos/` |
| `pointermove` | No catalog blockers | — |
| `keydown` | POS shortcuts; no touch impact | — |

`EnterpriseScrollControls` — `enabled={!viewportLocked}` → **disabled on `/pos`**.

**Conclusion:** Events are not intercepted. Scroll fails for **layout**, not event cancellation.

---

## PART 11 — Web vs Android Comparison

| Aspect | Web (fresh `dist/` build) | Android (Capacitor debug tree) |
|--------|---------------------------|--------------------------------|
| Phase 25.3 CSS in bundle | ✅ Present | ❌ Not found in build intermediates / `src/main/assets` |
| Phase 25.3 JS markers | ✅ Present | ❌ Not found |
| Flex chain break (RC-1) | ✅ Would fail | ✅ Same WebView flex behavior |
| Touch-action pan-y | ✅ In CSS | Unknown in stale APK; present in source |
| Root cause for no scroll | RC-1 layout | RC-1 layout + likely **stale asset sync** |

**Conclusion:** **Same primary failure mode** on both platforms. Android is **not** a separate WebView quirk for this bug; it may **additionally** run pre–Phase 25.3 assets if `npm run build && npx cap sync android` was not run after implementation.

---

## PART 12 — Dead Code Certification

| Artifact | Phase 25.3 modified? | Reached at runtime? |
|----------|---------------------|---------------------|
| `.pos-catalog-scroll-pane` CSS | ✅ | ✅ Applied but ineffective (RC-1) |
| `.app-shell--sell-focus .scroll-main-chrome > div` | ✅ | ✅ Active on `/pos` |
| `catalogSellMode` + scroll pane in `PosPage` | ✅ | ✅ Active branch |
| `showShelfBoxes` legacy shelf UI | Pre-25.3 | ❌ **Never** (`!catalogSellMode` impossible) |
| `PosSellCatalogShelfSection` | ✅ | ✅ Rendered |
| `pos-catalog-scroll-pane--browse` (`SellProductBrowsePanel`) | ✅ | Separate browse panel — not main sell shelf path |
| `POS_CATALOG_TILE_TOUCH_CLASS` | ✅ | ✅ On active tiles |
| `requireCatalogScrollElement` | ✅ | ✅ Used by virtualizer (product lists) |
| `reportPosScrollOwner` on mount | ✅ | Runs once; may log `scrollable: false` when chain broken |

**Phase 25.3 did not modify dead code exclusively** — it modified the **live path**, but omitted **one flex wrapper** required for the scroll pane math to work.

---

## PART 13 — Root Cause Register

### RC-1 — Split wrapper missing flex propagation (PRIMARY)

**Evidence:** `PosPage.tsx` L1844–1848; Playwright measurements showing split wrapper `display:block`, `flex:0 1 auto`, height 3612px; scroll pane `clientHeight === scrollHeight`; fixing wrapper alone restores scroll.

**Effect:** Mobile, compact, full desktop (empty cart) — **all shelf/product catalog scrolling**.

---

### RC-2 — PosPage root clips unbounded catalog (SECONDARY — symptom of RC-1)

**Evidence:** `overflow-hidden` on PosPage root; measured `scrollHeight 3732 > clientHeight 671`; no scroll owner above pane (`scroll-main-chrome` also `overflow-hidden`).

**Effect:** Content below fold is ** unreachable** — appears as “won’t scroll”.

---

### RC-3 — Android / installed APK may run stale web assets (DEPLOYMENT)

**Evidence:** Empty `android/app/src/main/assets`; no `pos-catalog-scroll-pane` / `data-pos-catalog-scroll` in `android/app/build` grep; fresh `dist/` contains markers.

**Effect:** Android may lack Phase 25.3 CSS/JS entirely until rebuild + `cap sync`. **Does not explain Web failure** if Web serves fresh build.

---

### RC-4 — `showShelfBoxes` legacy branch dead (INFORMATIONAL)

**Evidence:** `catalogSellMode` always true; `showShelfBoxes` requires `!catalogSellMode`.

**Effect:** None on current bug — confirms users are on Phase 25.3 branch, not legacy.

---

**Not root causes (ruled out):**

- Wrong catalog mode branch — active path is Phase 25.3
- `touch-manipulation` on shelf buttons — sell tiles use `touch-pan-y`
- Virtualizer binding to wrong element — shelves not virtualized; virtualizer targets catalog pane
- `scroll-main-chrome` stealing scroll — locked hidden on `/pos`
- Event `preventDefault` on touchmove — none on catalog path

---

## PART 14 — Smallest Fix Scope

**Not a redesign.** Extend the existing flex chain one level.

### Implementation blueprint

| Item | Scope |
|------|--------|
| **Files** | **1** — `src/pages/PosPage.tsx` |
| **Components** | **0** new; **1** wrapper div className change |
| **CSS** | **0** — Tailwind utilities only (`flex min-h-0 flex-1 flex-col overflow-hidden`) |
| **Runtime paths** | All `catalogSellMode` sell layouts (mobile, compact, full) |

### Exact change (description only — not implemented in 25.3A)

On the split wrapper `~L1844`, when `catalogSellMode` (or always on sell), add the same flex column bound used elsewhere:

`flex min-h-0 flex-1 flex-col overflow-hidden`

Preserve existing desktop grid classes when `mountDesktopCheckoutSidebar && isFullDesktopPos`.

### Verification after fix

1. Playwright / manual: `[data-pos-catalog-scroll]` has `scrollHeight > clientHeight`
2. One-finger shelf scroll on mobile width
3. Compact tablet (768–1023px)
4. Full desktop **empty cart** shelf browse
5. `npm run build && npx cap sync android` — confirm CSS/JS markers in Android assets
6. Optional: `[waka-pos] scroll_owner` diagnostic shows `scrollable: true`

### Estimated effort

~5 lines changed, 1 file, 0 migrations, 0 dependency updates.

---

## Deliverables Checklist

| Deliverable | Section |
|-------------|---------|
| Executive summary | Top |
| Runtime component hierarchy | Part 1 |
| Scroll ownership diagram | Part 2 |
| Flex propagation diagram | Part 5 |
| CSS runtime verification | Part 4 |
| Virtualizer verification | Part 7 |
| Touch routing | Part 6 |
| Layout measurements | Part 9 |
| Root cause register | Part 13 |
| Dead code report | Part 12 |
| Smallest implementation blueprint | Part 14 |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Why don’t shelves scroll? | Scroll pane is not height-bounded; `clientHeight === scrollHeight`. Split wrapper breaks flex chain (RC-1). |
| Is Phase 25.3 code executed? | **Yes** — active branch, classes and CSS apply. |
| Which container owns scrolling? | **None** at runtime (broken). Intended: `[data-pos-catalog-scroll].pos-catalog-scroll-pane`. |
| Which rule/layout breaks overflow? | Missing `flex-1 min-h-0` on PosPage split wrapper — not a CSS override on the pane. |
| Web vs Android same reason? | **Yes** for layout (RC-1). Android may also serve stale bundle (RC-3). |
| Minimal fix? | One wrapper className in `PosPage.tsx` + Android asset sync. |

---

**Phase 25.3A status:** Complete — read-only forensic certification. No implementation performed.
