# Phase 25.2 — Enterprise POS Scroll & Touch Interaction Certification

**Mode:** Read-only forensic audit (no code changes, no SQL, no migrations, no dependency updates)  
**Date:** 2026-07-13  
**Scope:** POS Sell page scroll hierarchy, Android touch behavior, nested scrolling, shelf navigation  
**Next phase:** [Phase 25.3 blueprint](#part-13--phase-253-implementation-blueprint) (implementation)

---

## Executive Summary

The POS Sell page uses a **viewport-locked AppShell** with a **single delegated scroll surface** (`.pos-catalog-scroll-pane`) for mobile (≤767px) and full desktop (≥1024px). The shelf grid is **not virtualized** — all shelf tiles render in a CSS masonry grid inside that pane.

Android shelf scrolling fails because of **layout and touch-interaction defects**, not because of missing data or React re-render logic. The root causes are **provable from static code**:

| Root cause | Evidence | Affects |
|------------|----------|---------|
| **RC-1** Flex scroll pane lacks bounded height on Android WebView | Committed `.pos-catalog-scroll-pane` has `overflow-y: auto` + `min-height: 0` but **no** `flex: 1 1 0%; height: 0` | Mobile + full desktop sell |
| **RC-2** `touch-manipulation` on shelf `<button>` tiles intercepts vertical pan | Committed `PosShelfTile` (HEAD) | Mobile shelf grid (primary user touch target) |
| **RC-3** AppShell outlet wrapper missing sell-focus flex chain | Committed CSS lacks `.app-shell--sell-focus .scroll-main-chrome > div` rule | Android WebView specifically |
| **RC-4** Compact tablet (768–1023px) has viewport lock but no catalog scroll pane | `catalogSellMode === false` while `viewportLocked === true` | Tablet POS |
| **RC-5** Product virtualizer fallback to non-scrolling ancestor | Only when `filteredProducts.length > 10` — **not shelf grid** | Product drill-down / search |

**Verdict: 🔴 Not certified for enterprise Android sell scrolling**

A partial fix exists in the **uncommitted working tree** (not HEAD) addressing RC-1, RC-2, and RC-3. It has not been certified on device and is not in production baseline.

**Scroll Interaction Readiness: 4.8 / 10** (architecture direction correct; Android execution broken on committed baseline)

Target after Phase 25.3: **9.0+ / 10** — one-finger natural scroll, no dead zones, native-terminal feel on Capacitor Android.

---

## Certification Methodology

1. Static trace: `AppShell` → `PosPage` → shelf/product grids  
2. CSS overflow / flex / viewport audit (`index.css`, Tailwind classes)  
3. Touch-action and event-handler grep (`preventDefault`, `touch-action`, pointer handlers)  
4. Virtualization audit (`VirtualizedProductGrid`, `@tanstack/react-virtual`)  
5. Layout band analysis (`resolvePosLayoutMode`, `viewportLock.ts`)  
6. Capacitor/Android config (`capacitor.config.ts`, `capacitorInit.ts`, `MainActivity.java`)  
7. Git baseline vs working-tree delta for in-progress scroll fixes  

**Not performed:** Live Android systrace, scroll FPS capture, Chrome DevTools touch emulation on production APK.

---

## PART 1 — Scroll Ownership

### Intended model (mobile sell, ≤767px)

**One vertical scroll owner:** `[data-pos-catalog-scroll].pos-catalog-scroll-pane`

Everything above it is **fixed within the flex column** (does not scroll with shelves):

- AppShell header (shrink-0)
- Shift summary collapsible (shrink-0)
- Search bar (`sticky top-0 shrink-0` — sibling **above** scroll pane)
- Quick product chips (inside scroll pane header area when shelf grid visible)

Everything below the viewport is **fixed overlay**:

- `PosMinimizedCheckoutFab` (fixed bottom strip, `z-[48]`)

### Scroll hierarchy diagram

```
html / body / #root
  overflow: hidden; height: 100dvh          ← document does NOT scroll
└─ .app-shell-root
     h-dvh overflow-hidden flex-col
   └─ header (shrink-0, fixed chrome)
   └─ main
        flex-1 min-h-0 overflow-hidden
      └─ section
           flex-1 min-h-0 flex-col
         └─ .scroll-main-chrome
              viewportLocked → overflow-hidden flex-col   ← NOT scroll owner on /pos
            └─ div (Outlet wrapper)
                 flex-1 min-h-0 overflow-hidden
               └─ PosPage root
                    flex-1 min-h-0 overflow-hidden flex-col
                  └─ catalog column
                       flex-1 min-h-0 overflow-hidden flex-col
                     ├─ search block (sticky shrink-0)     ← fixed above scroll
                     └─ [data-pos-catalog-scroll]
                          .pos-catalog-scroll-pane       ← ★ SCROLL OWNER ★
                            ├─ PosQuickProductChips (optional)
                            ├─ PosSellCatalogShelfSection
                            │    └─ masonry grid → PosShelfTile (<button>)
                            └─ OR VirtualizedProductGrid (drill-down / search)
```

### Code evidence — document lock

```134:146:src/index.css
html:has(.app-shell-root):not(:has(.marketing-scroll-root)),
body:has(.app-shell-root):not(:has(.marketing-scroll-root)) {
  overflow: hidden;
  height: 100dvh;
  max-height: 100dvh;
}
```

### Code evidence — viewport lock on `/pos`

```8:10:src/lib/viewportLock.ts
export function isViewportLockedRoute(pathname: string): boolean {
  if (isPosSellPath(pathname)) return true;
```

### Code evidence — main chrome does not scroll on sell

```539:551:src/components/layout/AppShell.tsx
            <div
              className={clsx(
                "scroll-main-chrome min-h-0 flex-1 overscroll-y-contain [-webkit-overflow-scrolling:touch]",
                viewportLocked ? "flex flex-col overflow-hidden" : "overflow-y-auto",
```

### Code evidence — catalog scroll pane assignment

```1540:1543:src/pages/PosPage.tsx
  const mobileSellFocus = posLayoutMode === "mobile";
  const catalogSellMode = mobileSellFocus || isFullDesktopPos;
  const catalogScrollPaneClass =
    "pos-catalog-scroll-pane h-0 min-h-0 flex-1 overscroll-y-contain [-webkit-overflow-scrolling:touch]";
```

```2035:2038:src/pages/PosPage.tsx
          <div
            ref={catalogRef}
            className={clsx(catalogSellMode && catalogScrollPaneClass, mobileSellFocus && "mt-2")}
            data-pos-catalog-scroll={catalogSellMode ? true : undefined}
```

### Scroll ownership by layout band

| Band | Width | `catalogSellMode` | Scroll owner | Shelf in scroll pane? |
|------|-------|-------------------|--------------|------------------------|
| Mobile | ≤767px | ✅ | `.pos-catalog-scroll-pane` | ✅ |
| Compact tablet | 768–1023px | ❌ | **None** (viewport locked, no pane) | ❌ legacy `space-y-2` |
| Full desktop | ≥1024px | ✅ | `.pos-catalog-scroll-pane` | ✅ |

---

## PART 2 — Android Touch Events

### Global touch policy

```194:205:src/index.css
body {
  ...
  overscroll-behavior-y: none;
  overflow-x: hidden;
  touch-action: manipulation;
}
```

`touch-action: manipulation` on `body` disables double-tap zoom. Child elements can override with `touch-action: pan-y`.

### Catalog scroll pane touch policy

```330:336:src/index.css
  .pos-catalog-scroll-pane {
    overflow-y: scroll;
    ...
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
```

The scroll pane explicitly allows vertical panning.

### Shelf tile touch policy — **root cause RC-2**

**Committed baseline (HEAD):** all tiles use `touch-manipulation`:

```diff
- "relative w-full touch-manipulation overflow-hidden ..."
```

**Working tree (uncommitted):**

```201:205:src/components/pos/PosShelfTile.tsx
  const touchScrollClass = mode === "sell" && !isArrange ? "touch-pan-y" : "touch-manipulation";

  const sharedClass = clsx(
    "relative w-full overflow-hidden text-left transition-all duration-150 motion-reduce:transition-none",
    touchScrollClass,
```

Shelf tiles in sell mode are `<button type="button">` elements (```254:257:src/components/pos/PosShelfTile.tsx```). On Android WebView, `touch-manipulation` on interactive elements commonly **consumes the touch sequence for tap** and prevents the parent scroll container from receiving the vertical drag. `touch-pan-y` explicitly delegates vertical pan to the ancestor scroll pane.

### Event handlers on sell path

| Handler | Location | Event | passive | Blocks shelf scroll? |
|---------|----------|-------|---------|----------------------|
| Display scale zoom | `PosPage.tsx` L438–445 | `wheel` | **false** | No (wheel only; Ctrl/meta) |
| POS shortcuts | `PosPage.tsx` L1343+ | `keydown` | default | No |
| Shelf drag reorder | `useShelfDragReorder.ts` | `pointerdown` | default | No (arrange mode only) |
| Barcode wedge | `barcodeAdapter` | `keydown` | default | No |

**No `touchstart` / `touchmove` `preventDefault`** on the sell catalog path.

### Android WebView delivery model

Capacitor Android uses Chromium WebView with:

- `Keyboard.setScroll({ isDisabled: false })` — ```25:25:src/lib/capacitorInit.ts```
- `KeyboardResize.Body` — body resizes on keyboard
- `SystemBars.insetsHandling: "css"` + `viewport-fit=cover` — safe-area via CSS env()

Touches are delivered to the DOM normally. The failure is **which element becomes the scroll target** (layout) and **whether buttons capture the gesture** (touch-action), not missing WebView touch events.

---

## PART 3 — Nested Scroll Containers

### Nested container map (mobile sell)

| Element | overflow-y | height constraint | Scrolls? | Competes with catalog pane? |
|---------|------------|-------------------|----------|----------------------------|
| `html/body/#root` | hidden | 100dvh | No | — |
| `.app-shell-root` | hidden | h-dvh | No | — |
| `main` | hidden | flex-1 min-h-0 | No | — |
| `.scroll-main-chrome` | hidden (sell) | flex-1 min-h-0 | **No** | Was wrongly targeted for scroll reset (HEAD) |
| PosPage root | hidden | flex-1 min-h-0 | No | — |
| Catalog column | hidden | flex-1 min-h-0 | No | — |
| Search block | — | shrink-0 sticky | No | No |
| **`.pos-catalog-scroll-pane`** | **scroll** | flex-1 h-0 min-h-0 | **Yes** | **Owner** |
| `PosCheckoutPanel` (overlay) | auto (internal) | max-h calc | Yes (when open) | Separate portal — OK |
| Horizontal chip rows | auto (x) | — | Horizontal only | No vertical competition |

### Horizontal scroll regions (non-traps)

- `PosSellActionChips`, quick-sell rows, category chips: `overflow-x-auto [-webkit-overflow-scrolling:touch]`
- These do not create competing **vertical** scroll parents.

### Committed vs working tree — flex height contract

**HEAD (committed):**

```css
.pos-catalog-scroll-pane {
  overflow-y: auto;
  min-height: 0;
  /* NO flex: 1 1 0%; NO height: 0 */
}
```

**Working tree (uncommitted):**

```330:340:src/index.css
  .pos-catalog-scroll-pane {
    overflow-y: scroll;
    ...
    flex: 1 1 0%;
    height: 0;
    min-height: 0;
    max-height: 100%;
```

The `height: 0; flex: 1 1 0%` pattern is the standard fix for **flex children that must scroll** in WebKit/Android. Without it, the pane grows to content height and **never overflows** — so no scroll gesture activates.

---

## PART 4 — Sell Layout Regions

| Region | Mobile behavior | Should scroll? | Actual |
|--------|-----------------|----------------|--------|
| **AppShell header** | Fixed top, safe-area inset | Fixed | ✅ Fixed |
| **Shift summary** | `PosShiftSummaryCollapsible` above catalog | Fixed | ✅ Fixed |
| **Search bar** | Sticky sibling above scroll pane | Fixed / always visible | ✅ Fixed |
| **Quick products** | Inside scroll pane (when shelf grid) | Scrolls with catalog | ✅ By design |
| **Shelf grid** | Inside scroll pane | **Primary scroll content** | ⚠️ Broken on Android (committed) |
| **Product grid** | Drill-down / search in scroll pane | Scrolls with catalog | ⚠️ Same pane; virtualizer depends on `[data-pos-catalog-scroll]` |
| **Cart** | Full-screen overlay when open | Own internal scroll | ✅ Separate surface |
| **Checkout strip** | `PosMinimizedCheckoutFab` fixed bottom | Fixed | ✅ Fixed |
| **Operational nav** | Hidden on mobile sell focus | — | ✅ |

### Region that should NOT scroll with shelves

Search, header, shift summary, and checkout FAB correctly remain fixed. The architecture matches enterprise POS expectations **on paper**; execution fails at the catalog pane boundary on Android.

---

## PART 5 — Android vs Web Comparison

| Behavior | Desktop browser | Mobile browser | Capacitor Android |
|----------|-----------------|----------------|-------------------|
| Document scroll | Locked on `/pos` | Locked | Locked |
| Scroll owner | `.pos-catalog-scroll-pane` | Same | Same (intended) |
| Flex height chain | Chrome resolves flex scroll reliably | Safari/Chrome mostly OK | **WebView often fails without `height:0` flex trick** |
| Shelf tile touch | Mouse wheel / trackpad unaffected | Touch on buttons | **`touch-manipulation` on buttons blocks pan (RC-2)** |
| Keyboard | visualViewport inset | visualViewport | Capacitor `keyboardWillShow` |
| Bottom chrome | N/A / FAB | FAB + safe-area | FAB; bottom nav hidden (`--waka-bottom-nav-h: 0`) |
| `-webkit-overflow-scrolling: touch` | Ignored | Momentum scroll | Momentum scroll (legacy but still set) |

**Conclusion:** Android differs because of **WebView flex layout + button touch-action**, not because of different React components. The same `PosPage` renders on all platforms; CSS and touch CSS properties diverge in effect.

---

## PART 6 — Scroll Lock Sources

### Searched patterns — sell path impact

| Source | Found on sell path? | Impact |
|--------|---------------------|--------|
| `preventDefault()` on touch | **No** | — |
| `touch-action: none` | **No** on sell | — |
| `touch-action: manipulation` (body) | Yes | Overridden by pane `pan-y` and (fix) tile `pan-y` |
| `touch-manipulation` on shelf buttons | Yes (HEAD) | **RC-2 — blocks scroll** |
| `overscroll-behavior-y: none` (body) | Yes | Prevents pull-to-refresh; does not block internal scroll |
| `overscroll-y-contain` (pane) | Yes | Contains scroll chaining — correct |
| Body `overflow: hidden` | Yes | Intentional; delegates to inner pane |
| Drag handlers | Arrange mode only | Not sell catalog |
| Pull-to-refresh | Not implemented on POS | — |
| Modal body lock | Checkout overlay only | Expected when cart open |

**No accidental global scroll lock** beyond the intentional viewport-lock architecture.

---

## PART 7 — Virtualization

### Shelf grid

**Not virtualized.** All shelves render in a CSS grid:

```31:47:src/components/pos/PosSellCatalogShelfSection.tsx
      <div className={shelfMasonryGridClass(true)}>
        {shelves.map((shelf) => (
          <PosShelfTile ... />
```

Masonry class: `auto-rows-[7.5rem] grid-cols-2 ...` (```396:398:src/lib/posShelfLayout.ts```).

**Virtualization is NOT the cause of shelf scroll failure.** Even 2 shelves should scroll if the pane has bounded height and touch pan reaches the pane.

### Product grid

Virtualized when `filteredProducts.length > 10`:

```1604:1618:src/pages/PosPage.tsx
    if (filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD) {
      return (
        <VirtualizedProductGrid ... />
```

Scroll parent resolution:

```70:75:src/components/pos/VirtualizedProductGrid.tsx
    getScrollElement: () =>
      parentRef.current?.closest<HTMLElement>("[data-pos-catalog-scroll]") ??
      parentRef.current?.closest<HTMLElement>(".scroll-main-chrome") ??
      document.querySelector<HTMLElement>(".scroll-main-chrome"),
```

**Risk (RC-5):** Fallback to `.scroll-main-chrome` is **non-scrolling** on viewport-locked sell. If `[data-pos-catalog-scroll]` is absent (compact tablet) and products > 10, virtualizer attaches to a dead scroll parent.

Uses `@tanstack/react-virtual` with `overscan: 5`, absolute `translateY` rows, `contentVisibility: auto` on legacy default variant buttons.

---

## PART 8 — Layout Measurements

### Viewport units

| Usage | Location | Notes |
|-------|----------|-------|
| `100dvh` | AppShell root, body lock | Correct for mobile browser chrome |
| `100dvh` | Checkout panel max-h | Sidebar variant |
| `-webkit-fill-available` | html/body fallback | iOS legacy |

### Safe-area insets

```230:243:src/index.css
    --waka-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
    --waka-scroll-tail-pos: calc(var(--waka-bottom-nav-h) + var(--waka-pos-checkout-strip-h) + var(--waka-safe-bottom) + 0.5rem);
```

Sell mobile sets `--waka-bottom-nav-h: 0` via `.app-shell--sell-focus`.

Catalog pane `padding-bottom: var(--waka-scroll-tail-pos)` prevents last shelf row hiding behind checkout FAB.

### Keyboard resize

- Web: `useVisualViewportInset()`  
- Native: Capacitor Keyboard events (`useKeyboardInset.ts`)  
- `PosPage` applies `combinedBottomInsetStyle()` to checkout overlay padding  

Keyboard open **shrinks body** (`KeyboardResize.Body`); catalog pane should reflow within remaining flex space. No evidence keyboard causes shelf scroll failure when keyboard is closed.

### Content height vs scroll area

On committed HEAD, when flex height contract is missing, **content height equals pane height** (pane expands) → **no overflow** → scroll area effectively zero. This matches “cannot scroll” symptom even with few shelves.

---

## PART 9 — Sticky Elements

| Element | Position | Inside scroll pane? | Reduces scroll area? |
|---------|----------|---------------------|----------------------|
| Mobile search | `sticky top-0 shrink-0` | **No** (sibling above) | Correct — does not consume pane height incorrectly |
| Drill-down back bar | `sticky top-0 z-10` | **Yes** | Acceptable — pins within pane |
| AppShell header | Fixed in flex column | No | Correct |
| Checkout FAB | `fixed bottom` | No | Correct — tail padding compensates |

Sticky search being **outside** the scroll pane is correct enterprise UX (always visible). It is not the root cause.

---

## PART 10 — Performance (Static Analysis)

Live FPS was not measured. Static assessment:

| Factor | Shelf grid | Product grid (virtualized) |
|--------|------------|----------------------------|
| DOM nodes | O(shelf count) — all rendered | O(visible rows × cols) |
| Typical shop | 5–30 shelves | 20–500+ products |
| Layout | CSS masonry `grid-flow-dense` | Absolute positioned rows |
| Paint risk | Moderate on long shelf lists | Lower with virtualization |
| Re-render on scroll | None (no scroll state in React) | Virtualizer updates visible slice |

**Scrolling should be smooth** once the correct scroll container receives touch events. Performance is secondary to the layout/touch defects for the reported bug.

Potential future concern: 50+ shelves without virtualization may jank on low-end Android — separate from current “cannot scroll at all” report.

---

## PART 11 — Enterprise UX Certification

### Expected interaction model (Shopify POS, Square, Toast, Lightspeed)

| Expectation | WAKA design intent | Committed Android reality |
|-------------|-------------------|---------------------------|
| Header fixed | ✅ | ✅ |
| Search always accessible | ✅ Sticky above pane | ✅ |
| One-finger vertical scroll on catalog | ✅ Single pane model | ❌ Broken |
| No nested vertical dead zones | ✅ By architecture | ❌ Flex/touch defects create dead zone |
| No scroll trapping | ✅ | ❌ Pane may not scroll at all |
| Tap shelf to drill down | ✅ Button onClick | ✅ (tap works; pan doesn't) |
| Cart/checkout separate surface | ✅ Overlay + FAB | ✅ |

**Gap:** WAKA's **architecture matches** enterprise POS patterns. **Android execution** on committed baseline does not.

---

## PART 12 — Root Cause Report

### Primary answer: Why Android cannot scroll the shelf list

**On the committed production baseline (HEAD), the shelf list cannot scroll on Android because the designated scroll container (`.pos-catalog-scroll-pane`) often has no overflow boundary, and vertical touch gestures starting on shelf `<button>` tiles do not propagate to that container.**

This is supported by three independent code facts:

#### RC-1 — Unbounded flex scroll pane (layout)

The catalog pane has `overflow-y: auto` but committed CSS lacks `flex: 1 1 0%; height: 0`. In a nested `flex-col overflow-hidden` chain (AppShell → main → scroll-main-chrome → PosPage → catalog column), Android WebView frequently computes the pane height as **the full content height** rather than the **remaining viewport height**. When pane height ≥ content height, **no overflow exists** and touch drag does nothing.

Evidence: committed HEAD CSS (via `git show HEAD:src/index.css`); fix explicitly commented for Android WebView in uncommitted ```259:266:src/index.css```.

#### RC-2 — Button touch-action captures gesture (touch)

Shelf tiles are `<button>` elements with `touch-manipulation` on committed HEAD. Android WebView treats these as the touch target. Vertical drag intended as scroll is interpreted as a press/drag on the button, not a scroll on the ancestor pane.

Evidence: HEAD `PosShelfTile` used `touch-manipulation`; working tree switches sell mode to `touch-pan-y` (```201:205:src/components/pos/PosShelfTile.tsx```).

#### RC-3 — Incomplete AppShell flex chain (Android-specific)

The Outlet wrapper inside `.scroll-main-chrome` must be a bounded flex column for height to propagate. Committed CSS does not include the sell-focus rule; uncommitted adds:

```259:266:src/index.css
    .app-shell--sell-focus .scroll-main-chrome > div {
      flex: 1 1 0%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
```

Without this, PosPage's `flex-1 min-h-0` may not receive a definite parent height on Android.

### Secondary issues

| ID | Issue | Severity |
|----|-------|----------|
| RC-4 | Compact tablet viewport lock without `catalogSellMode` | High for 768–1023px devices |
| RC-5 | Virtualizer fallback to non-scrolling `.scroll-main-chrome` | Medium — products only, not shelves |
| RC-6 | `PosSellProductCard` uses inner `<button>` without `touch-pan-y` | Medium — product scroll inside pane |
| RC-7 | Scroll reset targeted `.scroll-main-chrome` on mobile (HEAD) | Low — wrong element; fixed in working tree |

### What is NOT the cause (evidence-based)

- ❌ Virtualization of shelf grid (shelves are not virtualized)  
- ❌ Missing touch events in WebView (no touch preventDefault on path)  
- ❌ Network / sync / React state (scroll is CSS/DOM)  
- ❌ Intentional scroll lock on body (by design; inner pane should scroll)  

---

## PART 13 — Phase 25.3 Implementation Blueprint

### Smallest fix (P0 — Android shelf scroll)

Complete and certify the **uncommitted working-tree changes**:

1. **Commit flex height contract** — `.pos-catalog-scroll-pane` with `flex: 1 1 0%; height: 0; overflow-y: scroll`  
2. **Commit AppShell sell-focus flex chain** — `.app-shell--sell-focus .scroll-main-chrome > div`  
3. **Commit `touch-pan-y`** on sell-mode `PosShelfTile` buttons  
4. **Commit PosPage scroll ref split** — `catalogWidthRef` vs `catalogRef`; scroll reset targets `[data-pos-catalog-scroll]`  
5. **Device verify** on Capacitor Android APK (2 shelves, 20 shelves, drill-down products)

Estimated scope: **4 files**, no business logic changes.

### P1 — Compact tablet scroll trap (RC-4)

Either enable `catalogSellMode` for compact band or add equivalent scroll pane to `showShelfBoxes` branch. Currently ```2125:2171:src/pages/PosPage.tsx``` renders shelves without `[data-pos-catalog-scroll]`.

### P1 — Product tile touch parity (RC-6)

Apply `touch-pan-y` to `PosSellProductCard` and virtualized product buttons for consistent pan inside catalog pane.

### P1 — Virtualizer hardening (RC-5)

Remove fallback to `.scroll-main-chrome` on viewport-locked routes; require `[data-pos-catalog-scroll]` or fail loudly in dev.

### Recommended broader scope (user guidance)

Don't fix shelf scroll in isolation. Phase 25.3 should audit the **full POS interaction layer**:

| Area | Include in 25.3 |
|------|-----------------|
| Sell catalog scroll | P0 (above) |
| Cart overlay scroll + keyboard | Verify `PosCheckoutPanel` internal panes on Android |
| Category / action chip horizontal scroll | Already `overflow-x-auto` — spot-check |
| Checkout keypad + keyboard inset | `useKeyboardInset` + overlay padding |
| Search focus + keyboard | Ensure pane reflow doesn't trap scroll |
| Android back stack | `usePosAndroidBackStack` — no scroll side effects |
| Display scale zoom | Wheel handler only — OK |

Goal: Android experience comparable to a **native POS terminal**, not a web page in WebView.

---

## In-Progress Fix Inventory (Uncommitted Working Tree)

| File | Change | Addresses |
|------|--------|-----------|
| `src/index.css` | Flex chain + pane `height:0` + `overflow-y:scroll` | RC-1, RC-3 |
| `src/components/pos/PosShelfTile.tsx` | `touch-pan-y` on sell tiles | RC-2 |
| `src/pages/PosPage.tsx` | Scroll pane class, refs, overflow-hidden chain, quick chips inside pane | RC-1, RC-7 |

**Status:** Not merged to HEAD; not device-certified.

---

## Manual Verification Checklist (Post–Phase 25.3)

Run on **Capacitor Android**, **mobile browser**, and **desktop** after fix:

### Shelf scroll

- [ ] Mobile (≤767px): one-finger vertical scroll through full shelf list  
- [ ] Scroll starts on shelf tile (not only on gaps between tiles)  
- [ ] Scroll starts on shelf tile edge and center  
- [ ] Last shelf row clears checkout FAB (tail padding)  
- [ ] Momentum scroll feels natural (no sticky/jank)  
- [ ] 2 shelves and 20+ shelves both scroll  

### Navigation

- [ ] Tap shelf opens drill-down; back returns to grid at scroll top  
- [ ] Search filters products; scroll works in search results  
- [ ] Virtualized product list (>10 items) scrolls in drill-down  

### Layout bands

- [ ] Compact tablet (768–1023px): catalog scrolls or uses catalogSellMode  
- [ ] Full desktop (≥1024px): catalog pane scrolls in split layout  

### Overlays

- [ ] Checkout overlay opens; cart lines scroll independently  
- [ ] Keyboard open: search usable; catalog pane still scrolls when keyboard closed  
- [ ] No document/body scroll bleed (background fixed)  

### Regression

- [ ] Desktop mouse wheel scroll on catalog  
- [ ] Arrange-mode shelf drag still works (stock page)  
- [ ] No impact to auth, sync, or sell business logic  

---

## Related Documents

- Prior shelf scroll session fixes (uncommitted): `PosPage.tsx`, `PosShelfTile.tsx`, `index.css`  
- Layout bands: `src/lib/responsiveBreakpoints.ts`  
- Viewport lock: `src/lib/viewportLock.ts`  

---

## Certification Verdict

| Criterion | Status |
|-----------|--------|
| Scroll ownership documented | ✅ |
| Root cause identified with code evidence | ✅ |
| Android-specific failure mode explained | ✅ |
| Phase 25.3 blueprint defined | ✅ |
| **Production-ready Android shelf scroll** | ❌ — pending Phase 25.3 implementation + manual checklist |

**Phase 25.2 complete (read-only). Proceed to Phase 25.3 implementation.**
