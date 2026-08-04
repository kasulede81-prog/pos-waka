# Phase 32.0 — Enterprise Sell Workspace Layout, Scaling & Interaction Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-03  
**Scope:** Sell / POS **workspace layout engine** — stability, zoom/scaling, responsive bands, panel allocation, hidden controls, desktop utilization, cashier ergonomics  

**This is not a product-card audit.** Phase 28.x already addressed text-first tiles, phone columns, and tap-to-add. Phase 32.0 asks a different question:

> Why does Sell still feel unstable — UI locks when panels open, controls hide by size/zoom, scaling feels inconsistent — even though selection UX improved?

**Related prior work (do not re-litigate as substitutes):**  
- Phase 25.2 / 25.3 — scroll & touch ownership  
- Phase 28.0 / 28.1 — product identification & cashier selection  
- Phase 30.x / 31.x — desktop tables / Inventory consolidation (separate modules)

---

## Executive Summary

Sell is **functionally mature** (search, barcode, virtualization, three checkout mount modes, display-scale density). It is **not certified as a stable enterprise workspace** because layout decisions are still driven by **CSS-pixel width bands + mount/unmount of checkout chrome**, not by a resilient workspace engine that reallocates space under zoom, panel open, and density changes.

| Category | Score |
|----------|------:|
| Workspace architecture | **6.0** |
| Layout stability | **5.2** |
| Zoom / scaling | **4.6** |
| Responsive adaptation | **6.4** |
| Panel allocation | **6.1** |
| Hidden-feature safety | **5.0** |
| Desktop productivity | **6.8** |
| Touch vs mouse | **6.5** |
| Performance / jank risk | **6.3** |
| **Overall workspace stability** | **5.8 / 10** |

**Verdict:** Sell is **not architecturally broken** — it is **layout-fragile**. The instability users feel is largely explained by five structural causes:

1. **Browser zoom flips layout mode** (`window.innerWidth` → mobile / compact / full).  
2. **Checkout is mount/unmount, not resize** — minimize / “Add items” collapses the entire desktop sidebar.  
3. **Overlays lock the workspace** (compact slideover + mobile overlay + add sheet steal the full viewport).  
4. **Dual density systems** (browser zoom vs POS Display Scale) fight each other; Ctrl+wheel is intercepted for Display Scale.  
5. **Fixed px checkout column + `overflow-hidden` viewport lock** clip or starve regions instead of reallocating.

**Recommended next step:** Phase 32.1 — Sell Workspace Layout Engine (stability + zoom-safe bands + persistent checkout column), not more product-card patches.

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Why does Sell feel unstable? | Checkout chrome mounts/unmounts; overlays freeze catalog; zoom changes layout band; density and zoom are two competing systems. |
| Why do controls disappear? | Band flips hide desktop split / hero / nav; minimize replaces sidebar with FAB; `md:hidden` / `hidden sm:` hide labels; cart max-height clamps lines. |
| Which containers cause instability? | `AppShell` viewport lock + nested `overflow-hidden`; `catalogSplitRef` grid with fixed px checkout; exclusive overlay mounts; sticky search stacks. |
| Does desktop inherit mobile constraints? | Partially — compact (768–1023) and zoomed-down “full” laptops fall into slideover/FAB patterns designed for phones. |
| Minimum architectural change? | Persistent adaptive checkout region + zoom-invariant layout identity + stop full-workspace lock for non-modal panels. |

---

# PART 1 — Workspace Layout Architecture

## Logical tree

```text
Sell Workspace (/pos → PosPage inside AppShell sell-focus)

├── AppShell (h-dvh · overflow-hidden · app-shell--sell-focus)
│   ├── Header (Exit · DisplayScaleControl · cashier chrome)
│   └── Main (viewportLocked on full desktop Sell)
│         └── ShiftSellGateway
│               └── PosPage root (flex · min-h-0 · overflow-hidden)
│
├── Header / Shift chrome
│   ├── PosDesktopCompactHeader     (≥1024 full)
│   ├── PosShiftSummaryCollapsible  (mobile + shift)
│   ├── ActiveShiftBanner           (compact tablet)
│   ├── PosOperationalNav           (<1024)
│   └── PosSellHeroCard             (compact only — NOT mobile, NOT full)
│
├── Catalog column (catalogWidthRef)
│   ├── Search (sticky on mobile/compact)
│   ├── Recent / frequent / favorites chips (compact only — hidden on mobile & full)
│   ├── Shelf Navigation (PosShelfTile masonry when empty query)
│   ├── Product Area
│   │     VirtualizedProductGrid / PosDesktopProductCard / PosSellProductCard
│   ├── Filters (category / shelf drill-down)
│   └── PosDesktopCatalogCheckoutDock (optional numpad in catalog column @ full)
│
├── Cart / Checkout (exclusive mount — at most one)
│   ├── full + cart + !minimized → PosCheckoutPanel sidebar (fixed px column)
│   ├── compact + cart + !minimized → PosCompactCheckoutSlideover (locks UI)
│   ├── mobile + cart + !minimized → full-screen overlay (md:hidden)
│   └── minimized → PosMinimizedCheckoutFab only
│
├── Payment / Summary / Customer     (inside PosCheckoutPanel)
├── Action Bar                       (save / clear / add-items / keypad)
└── Bottom Controls
      FAB strip · Display Scale sheet · add-to-sale sheet · receipt / modals
```

## Ownership of layout / scroll / resize

| Concern | Owner |
|---------|--------|
| App height lock | `AppShell` `h-dvh overflow-hidden`; sell-focus CSS forces flex column |
| Viewport lock (no document scroll) | `viewportLocked = isViewportLockedRoute \|\| fullDesktopSell` |
| Catalog scroll | `.pos-catalog-scroll-pane` (`h-0 flex-1 overflow-y: scroll`) |
| Checkout scroll | `.pos-checkout-scroll-pane` inside `PosCheckoutPanel` |
| Desktop split columns | `posSplitGridTemplateColumns(viewportWidth, displayScaleMultiplier)` |
| Layout band | `resolvePosLayoutMode(window.innerWidth)` via `usePosLayoutMode` |
| Product density columns | `catalogColumnCount(measuredCatalogWidth, { displayScale, phoneBand })` |
| Display density (not browser zoom) | `html.pos-display-scale-active` + `--ds-*` CSS vars |
| Overlay stacking | `--waka-z-pos-overlay: 80`, `--waka-z-pos-modal: 90` |

### Key files

| File | Role |
|------|------|
| `src/pages/PosPage.tsx` | Workspace assembly (~2.9k LOC) |
| `src/components/layout/AppShell.tsx` | Shell height, sell-focus, Display Scale in header |
| `src/lib/posCheckoutMount.ts` | Exclusive checkout mount rules |
| `src/lib/posDesktopSplit.ts` | Fixed-px checkout column |
| `src/lib/posLayoutMode.ts` / `responsiveBreakpoints.ts` | Band thresholds 767 / 768 / 1024 |
| `src/lib/displayScale/scaleTokens.ts` | Density multipliers 0.88–1.28 |
| `src/components/pos/PosCheckoutPanel.tsx` | Cart + payment + summary chrome |
| `src/components/pos/PosCompactCheckoutSlideover.tsx` | Tablet lock overlay |
| `src/index.css` | `.pos-catalog-scroll-pane`, sell-focus, z-index tokens |

---

# PART 2 — Layout Stability

## Confirmed instability mechanisms

### S1 — Checkout mount/unmount (critical)

`shouldMountDesktopCheckoutSidebar` requires `draftLineCount > 0 && !saleCheckoutMinimized`.  
When the cashier taps **Add items** (`focusCatalogForAdd`), full desktop **sets minimized = true**, which **unmounts the sidebar**. Catalog grid expands to full width, then remounts later when checkout is reopened → **layout jump**.

Evidence: `PosPage.focusCatalogForAdd` + `posCheckoutMount.ts`.

### S2 — Overlay exclusivity freezes catalog

Compact slideover and mobile overlay render `fixed inset-0` with a blocking backdrop. While open, the product area is not interactive. This is perceived as **“UI lock up when panels open.”**

Evidence: `PosCompactCheckoutSlideover.tsx` (`fixed inset-0` + full-screen dimmer); mobile overlay portal in `PosPage`.

### S3 — Nested overflow-hidden stacks

Chain: `html/body/#root overflow:hidden` → `AppShell h-dvh overflow-hidden` → sell-focus main → `PosPage overflow-hidden` → split `overflow-hidden` → catalog `overflow-hidden` → scroll pane `height:0; flex:1`.

Correct for single-scroll ownership (Phase 25.3), but **any child that grows (hero, sticky search, chips, status bar) steals catalog height with no reflow warning** — content feels “squeezed” rather than adapted.

### S4 — Sticky competition

Mobile/compact: sticky search at `z-20`. Shelf drill-down adds another sticky back bar at `z-10`. With short CSS viewport height (zoomed laptops), sticky chrome can leave a tiny catalog viewport.

### S5 — Empty cart vs active sale geometry

Desktop split only exists with lines in cart. Empty Sell is catalog-only; first add **suddenly inserts** a 280–460px column. Geometry is discontinuous by design.

### Stability matrix

| Action | Expected enterprise behavior | Actual |
|--------|------------------------------|--------|
| Open checkout (tablet) | Side panel, catalog still usable or dimmed lightly | Full lock overlay |
| Add more items (desktop) | Checkout shrinks / stays docked | Sidebar **unmounts** → FAB |
| Add first item (desktop) | Gentle reveal of cart column | Abrupt grid insert |
| Open qty sheet | Modal over stable workspace | Full-screen sheet replaces Sell |
| Resize window across 1024 | Smooth reflow | Hard band flip compact ↔ full |

---

# PART 3 — Zoom & Scaling (Critical)

## Two scaling systems

| System | What it changes | How triggered |
|--------|-----------------|---------------|
| **Browser zoom** | All CSS px / `innerWidth` / `innerHeight` | Browser UI / Ctrl+wheel (when not intercepted) |
| **POS Display Scale** | `--ds-*` vars on opted-in `.pos-ds-*` nodes + checkout column multiplier + grid column delta | Header control; **Ctrl/Cmd + wheel/± intercepted on Sell** |

Display Scale levels: compact **88%**, normal **100%**, large **112%**, extra_large **128%** (`scaleTokens.ts`).  
It does **not** scale every Sell control — only classes wired to `--ds-*`. Hardcoded `min-h-[44px]`, `text-sm`, hero cards, shelf tiles, FAB strip often **ignore** Display Scale → perceived “inconsistent scaling.”

## Browser zoom × layout band (CSS-pixel model)

Assuming Chrome-like behavior where zoom reduces CSS viewport:

| Native screen | 100% | 125% | 150% |
|---------------|------|------|------|
| **1366×768** | full (1366) | full (1093) | **compact (911)** |
| **1440×900** | full | full (1152) | **compact (960)** |
| **1920×1080** | full | full | full (1280) |
| **2560×1440** | full | full | full |
| **1024×768** | full | **compact (819)** | **mobile (683)** |
| **1280×800** | full | full (1024) | **compact (853)** |

**Critical finding:** On common laptop widths (1366 / 1440 / 1024), **150% browser zoom demotes the workspace from full desktop split to compact slideover** (or even mobile overlay on 1024). Cashiers who enlarge text for readability lose the desktop checkout column and get a locking panel.

## Zoom defect register

| ID | Defect | Evidence |
|----|--------|----------|
| Z1 | Zoom flips layout identity | `resolvePosLayoutMode(window.innerWidth)` |
| Z2 | Fixed px checkout does not reflow under zoom — only shrinks with CSS px | `posCheckoutColumnWidthPx` returns px; grid `minmax(0,1fr) ${checkout}px` |
| Z3 | Sidebar `max-h-[calc(100dvh-5.25rem)]` + short zoomed height clips payment/actions | `PosCheckoutPanel` sidebar class |
| Z4 | Ctrl+wheel on Sell adjusts Display Scale, not browser zoom — operators confuse the two | `PosPage` wheel listener `preventDefault` |
| Z5 | Display Scale grows touch targets via `--ds-touch-min` while column count drops — cards get bigger and fewer; mixed with browser zoom → overcrowding | `catalogColumnDeltaForScale` −2/−3 at large/XL |
| Z6 | Compact slideover width `clamp(320px,34vw,400px)` at zoomed-narrow CSS width can dominate the viewport | `PosCompactCheckoutSlideover` |

### Usability by zoom (synthesis)

| Zoom | 1366×768 | 1920×1080 |
|------|----------|-----------|
| 80–100% | Usable full split | Comfortable |
| 110–125% | Usable but short vertical; sticky chrome pressure | Usable |
| 150% | **Fails enterprise bar** — band flip to compact lock overlay | Still full; denser chrome |

---

# PART 4 — Responsive Behaviour

## Band contract

| Band | Width (CSS px) | Sell geometry |
|------|----------------|---------------|
| mobile | ≤767 | Catalog + FAB / full-screen checkout overlay |
| compact | 768–1023 | Hero card + slideover checkout + FAB |
| full | ≥1024 | Desktop header + optional sidebar split |

## Breakpoints audit

| Width | Expected | Risk |
|------:|----------|------|
| 320–412 | 2-col phone catalog (28.1); overlay checkout | Sticky search + FAB strip steal height — OK if overlay used for pay |
| 768 | Compact hero appears; slideover checkout | Hero + sticky search + slideover = **highest chrome pressure** |
| 1023→1024 | Compact→full hard cut | Instant geometry rewrite |
| 1024–1280 | Narrow full; checkout ~280–320px | Payment strip cramped; catalog dock competes |
| 1366–1440 | Primary laptop full | Stable at 100%; fragile at 150% zoom |
| 1920+ | Wide full; checkout up to 420–460px | Good allocation if sidebar mounted |

## Where adaptation stops

1. **No fluid “tablet split”** — tablets never get a persistent dual-pane; they inherit phone overlay semantics.  
2. **Hard 1024 cliff** — no intermediate “docked narrow cart.”  
3. **Chip rails hidden on mobile and full** — only compact shows recent/frequent/favorites under search (`!mobileSellFocus && !isFullDesktopPos`).  
4. **Mobile overlay CSS `md:hidden`** — if mount rules and CSS disagree under zoom edge cases, checkout can fail to paint.

---

# PART 5 — Panel Allocation

## Desktop split targets (`posDesktopSplit.ts`)

| Viewport CSS px | Checkout target | Catalog share (approx.) |
|----------------:|----------------:|-------------------------|
| 1024–1279 | ~28% capped ≤320 (≥280) | ~70–72% |
| 1280–1919 | ~26% (300–380) | ~70–74% |
| 1920–2559 | ~24% (340–420) | ~76–78% |
| ≥2560 | ~22% capped 460 | ~78%+ |

Display Scale multiplier scales the **checkout px**, not a flex fraction — at XL scale on mid laptops, checkout grows while catalog columns decrease → **both sides feel tight**.

## Cashier-speed assessment

| Region | Speed impact |
|--------|----------------|
| Catalog 70–75% | Good for browse/scan when sidebar visible |
| Checkout 25–30% | Adequate for cart lines; tight for keypad+customer+pay methods together |
| Catalog dock numpad | Moves keypad into catalog column — **double competition** with products when open |
| Compact hero | Shows cart stats but **duplicates** FAB information and burns vertical space |

**Conclusion:** Proportions are reasonable **only in steady full-desktop with sidebar mounted**. They are not optimized for the real state machine (minimized / first item / zoom / dock open).

---

# PART 6 — Hidden Feature Register

| Feature | When hidden / inaccessible | Why |
|---------|----------------------------|-----|
| Desktop checkout sidebar | Minimized; empty cart; width &lt;1024; zoom demotion | Mount predicates |
| Persistent cart while browsing (tablet) | Compact mode always | Slideover design |
| PosOperationalNav | full desktop | Replaced by `PosDesktopCompactHeader` |
| PosSellHeroCard | mobile + full | Compact-only |
| Recent searches / frequent / favorites chips | mobile + full | Compact-only gates |
| Desktop status bar | &lt;1024 | `isFullDesktopPos` gate |
| Payment keypad in sidebar | `catalogDock` moves it to catalog dock | Layout split of concerns |
| “Add more items” on sidebar | Uses minimize → **sidebar vanishes** | `onAddItems` → `setSaleCheckoutMinimized(true)` |
| Display Scale % label text | Narrow headers (`hidden sm:inline` / `min-[400px]`) | Compact header density |
| FAB payable on smallest compact | `hidden sm:inline` on amount | Width gate |
| Cart lines beyond clamp | Sidebar `max-h-[min(28%,10rem)]` / overlay `max-h-[min(36dvh,14rem)]` | Scroll clamp — lines not gone but easy to miss |
| Bottom tab bar on phone Sell | sell-focus sets `--waka-bottom-nav-h: 0` | Intentional; Exit + FAB replace |

---

# PART 7 — Desktop Productivity

| Question | Finding |
|----------|---------|
| Forced into mobile layouts? | **Yes under zoom or &lt;1024** — slideover/FAB path. Native ≥1024 at 100% zoom is true desktop. |
| Cart width | Fixed px band, not drag-resizable; disappears when minimized |
| Product width | Fluid `1fr` but column count jumps by measured width + scale delta |
| Product density | Up to 12 columns — productivity high, identification harder (28.x); XL scale reduces columns |
| Payment area | Cramped when dock+methods+customer+save share sidebar height under `max-h` |
| Keyboard | Strong (shortcuts, Enter-to-pay guards in `posCheckoutFocus`); undermined when checkout unmounted |

Desktop users are productive **in the happy path** (full band, cart open, 100% zoom, normal Display Scale). Outside that path, desktop **inherits tablet/phone interaction models**.

---

# PART 8 — Touch & Mouse

## Touch

| Strength | Weakness |
|----------|----------|
| 44–48px targets; sell-focus removes bottom nav on phone | Full-screen overlays for checkout & qty sheet increase mode-switching |
| Catalog pan-y hardened (25.3) | Sticky + FAB reduce browse viewport |
| Slideover width OK for finger pay | Backdrop lock prevents “glance at shelf while adjusting cart” |

## Mouse

| Strength | Weakness |
|----------|----------|
| Split pane + keyboard pay | Cursor travels far when sidebar unmounts to FAB |
| Hover/click density on desktop cards | Ctrl+wheel captured for Display Scale (surprising vs browser zoom habit) |
| Status bar + compact header | No split-pane resize handle |

**Shared-layout compromise:** One `PosCheckoutPanel` serves sidebar + overlay via variants — good for logic reuse, bad when overlay semantics (lock, minimize) leak into desktop “Add items.”

---

# PART 9 — Performance

| Topic | Finding |
|-------|---------|
| Rerenders | `PosPage` is a large stateful surface; layout mode + minimize + draft lines trigger broad re-render (checkout mount toggles whole aside) |
| Layout shifts | **High** — sidebar mount/unmount, first cart line, dock open, band flip |
| Animation jank | Overlay enter + display-scale CSS transitions on cards; nested overflow usually OK |
| Zoom performance | Band recalculation on resize is cheap; **cost is UX thrash**, not FPS |
| Resize performance | `usePosLayoutMode` + `usePosViewportWidth` + catalog width observer — acceptable |
| Virtualization | Present above threshold — good for large catalogs; shelf masonry still not virtualized (28.0 debt) |

Bottleneck for “feels unstable” is **layout thrash**, not JS frame cost.

---

# PART 10 — Enterprise Benchmark (workflow)

Compared to Square / Lightspeed / Toast **workspace behavior** (not visual clones):

| Workflow property | Enterprise norm | WAKA Sell today |
|-------------------|-----------------|-----------------|
| Cart always present on desktop once sale starts | Persistent column | Unmounts when “add items” / minimize |
| Zoom enlarges UI without changing IA | Same panes, larger type | May flip to slideover IA |
| Tablet = reduced desktop, not phone modal | Docked or push panel | Locking slideover |
| Density control separate from zoom | One operator mental model | Display Scale + browser zoom compete |
| Open payment without freezing browse | Optional focus mode | Overlay freezes catalog (mobile/compact) |

WAKA matches enterprise POS on **scan → cart → pay** capability. It lags on **workspace persistence under density/zoom**.

---

# PART 11 — Root Cause Register

| ID | Root cause | Severity | Evidence |
|----|------------|----------|----------|
| **RC-1** | Layout identity is CSS-pixel width, so **browser zoom changes architecture** | P0 | `resolvePosLayoutMode(window.innerWidth)`; zoom tables above |
| **RC-2** | Checkout is **conditional mount**, not an adaptive persistent region | P0 | `shouldMountDesktopCheckoutSidebar` / minimize unmount |
| **RC-3** | Compact/mobile checkout uses **full-viewport lock overlays** | P0 | `PosCompactCheckoutSlideover`, mobile `fixed inset-0` |
| **RC-4** | **Dual scaling** (Display Scale vs browser zoom) with Ctrl+wheel capture | P1 | `PosPage` wheel handler; partial `--ds-*` coverage |
| **RC-5** | Desktop split uses **fixed px checkout** that competes with dock/keypad instead of flex reflow | P1 | `posDesktopSplit.ts`; catalog dock |
| **RC-6** | Nested **overflow-hidden viewport lock** amplifies chrome growth into catalog starvation | P1 | AppShell sell-focus + PosPage + scroll pane `height:0` |
| **RC-7** | Compact band **inherits mobile interaction** (hero + slideover + FAB) | P1 | Mount helpers + `PosSellHeroCard` gates |
| **RC-8** | Feature chrome gated by band (chips, nav, status) → “missing features” reports | P2 | Conditional renders in `PosPage` |
| **RC-9** | Cart list max-height clamps hide lines without strong affordance | P2 | `PosCheckoutPanel` max-h classes |

---

# PART 12 — Enterprise Roadmap

## P0 — Workspace stability

1. **Persistent checkout region on full desktop** — minimize = collapse width / density, not unmount; “Add items” must not destroy the column.  
2. **Zoom-safe layout identity** — decide band using a zoom-invariant signal (e.g. `devicePixelRatio`-aware floor, `min(innerWidth * deviceZoomEstimate, screen.width)`, or operator-selected “POS layout: phone / tablet / desktop”) so 150% on 1366 does not silently become compact.  
3. **Stop full-workspace lock for tablet checkout** — push/dock panel that keeps catalog visible (dimmed optional), matching desktop mental model.

## P1 — Scaling & desktop allocation

4. Unify operator density: either Display Scale **or** document zoom guidance — don’t intercept Ctrl+wheel without clear UX, or map it to one system only.  
5. Extend `--ds-*` coverage to checkout chrome, shelf tiles, FAB, hero — or accept browser zoom as the single scaler and simplify.  
6. Replace fixed-px checkout with `minmax(280px, 30%)` / resizable split; keep caps for ultrawide.  
7. Reduce chrome pressure in compact: hero optional/collapsible; don’t duplicate FAB + hero totals.

## P2 — Polish

8. Harmonize hidden chip rails (decide one place for favorites/frequent across bands).  
9. Stronger cart-scroll affordance when lines clamp.  
10. Micro-interactions for sidebar expand/collapse without grid teleport.

---

## Before / after architecture (target for 32.1)

### Before (today)

```text
innerWidth band → mount one of {sidebar, slideover, overlay, fab}
                 → zoom can change the band
                 → minimize unmounts sidebar
                 → overlays lock Sell
```

### After (Phase 32.1 target)

```text
Workspace layout identity (zoom-stable)
  → persistent catalog + checkout regions
  → collapse / expand densities (not remount)
  → modal only for true interruptions (qty ambiguity, auth, receipt)
  → one density story for cashiers
```

---

## Workspace diagrams

### Full desktop (≥1024 CSS px, cart open)

```text
┌──────────────────────────────── AppShell (locked height) ────────────────────────────────┐
│ Header · Display Scale · Exit                                                            │
│ PosDesktopCompactHeader                                                                  │
├─────────────────────────────────────┬────────────────────────────────────────────────────┤
│ Catalog (~70–75%)                   │ Checkout sidebar (280–460px)                       │
│  Search                             │  Cart lines (clamped scroll)                       │
│  Shelves / Products (scroll pane)   │  Summary · Pay methods · Customer                  │
│  [optional Numpad Dock]             │  Save                                              │
├─────────────────────────────────────┴────────────────────────────────────────────────────┤
│ PosDesktopStatusBar                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Compact (768–1023) or zoom-demoted laptop

```text
┌──────────── Catalog + Hero + sticky search ────────────┐
│ ... browse ...                                         │
│ FAB / strip → opens                                    │
└────────────────────────────────────────────────────────┘
        ↓ locks
┌──── fixed inset-0 slideover (320–400px) + dimmer ─────┐
│ PosCheckoutPanel overlay                               │
└────────────────────────────────────────────────────────┘
```

### Mobile (≤767)

```text
Catalog (nav height 0) + checkout FAB strip
  → full-screen checkout overlay
  → full-screen add sheet when qty ambiguous
```

---

## Manual certification checklist (for Phase 32.1 validation)

### Stability
- [ ] Desktop: Add items does **not** remove checkout column  
- [ ] Tablet: Checkout open still shows catalog (even if dimmed)  
- [ ] First cart line does not jarringly reflow beyond ~1 animated frame  

### Zoom (1366×768 and 1920×1080)
- [ ] 100% / 125% / 150% — same IA (or explicit operator override)  
- [ ] No clipped Save / payment methods  
- [ ] Display Scale and browser zoom do not fight  

### Responsive
- [ ] 320–412 usable  
- [ ] 768 usable without hero+slideover starvation  
- [ ] 1024+ persistent split  

### Hidden features
- [ ] Cart accessible within 1 tap whenever `draftLines > 0`  
- [ ] Search always visible in catalog region  

---

## Appendix A — Evidence index

| Claim | Location |
|-------|----------|
| Band thresholds | `src/lib/responsiveBreakpoints.ts` |
| Checkout mount rules | `src/lib/posCheckoutMount.ts` |
| Split column math | `src/lib/posDesktopSplit.ts` |
| Minimize unmounts desktop sidebar | `PosPage` `focusCatalogForAdd` + mount helper |
| Compact lock overlay | `PosCompactCheckoutSlideover.tsx` |
| Display Scale tokens | `src/lib/displayScale/scaleTokens.ts` |
| Ctrl+wheel capture | `PosPage.tsx` display-scale `useEffect` |
| Sidebar max height | `PosCheckoutPanel.tsx` `max-h-[calc(100dvh-5.25rem)]` |
| Sell viewport lock | `AppShell.tsx` `viewportLocked` / `app-shell--sell-focus` |
| Catalog scroll owner | `index.css` `.pos-catalog-scroll-pane` |

## Appendix B — What this audit is not

- Not a re-run of Phase 28 product-card / tap-to-add certification  
- Not permission to redesign brand chrome to copy Square/Toast pixels  
- Not an instruction to remove Display Scale without a migration plan  
- Not a performance rewrite of `PosPage` unless layout thrash requires split  

## Appendix C — Supplemental forensics (deep map)

### C1 — Unreachable layout branches (maintenance debt)

`catalogSellMode` is `mobile || compact || full` — i.e. **always true** for every live band. Therefore:

| Branch | Predicate | Runtime |
|--------|-----------|---------|
| `showShelfBoxes` | `!catalogSellMode` (+ other gates) | **Unreachable** |
| `showDesktopProductView` | `!catalogSellMode && hasSellViewFilter` | **Unreachable** |

Live catalog path is always the Phase 25.3 scroll-pane model (shelf → drill-down → search results). Legacy non-`catalogSellMode` UI in `PosPage` should not be treated as a second architecture in Phase 32.1 — retire or gate-delete during cleanup.

### C2 — Catalog replaced during pay (full desktop)

When `catalogNumpadOpen` **or** payment method is credit, `PosDesktopCatalogCheckoutDock` **replaces** shelf/product content in the catalog column. On short viewports (zoomed 1366×768), the product browse surface can disappear entirely while paying — compounding RC-5 / panel competition.

### C3 — Scroll ownership (virtualizer)

`VirtualizedProductGrid` does **not** own window scroll. It binds to the nearest `[data-pos-catalog-scroll]` / `.pos-catalog-scroll-pane` and positions rows with `transform: translateY(...)`. Sticky search chrome is a **sibling outside** that pane (constant height budget). Virtualization threshold: catalogs above ~10 products use the virtualizer.

### C4 — Parallel Sell surface (pharmacy)

Pharmacy shops redirect `/pos` → dispense workspace (`PharmacyDispenseWorkspace`), which reuses checkout mount helpers, layout bands, and overlay z-tokens. Phase 32.1 changes to mount rules / zoom identity must be verified on **both** retail Sell and pharmacy dispense.

### C5 — Overlay z-stack (POS)

| Layer | z |
|-------|--:|
| Shift summary | 44–45 |
| Bottom nav token | 45 |
| Minimized FAB | 48 |
| POS overlay (checkout / sheets) | **80** |
| POS receipt | 85 |
| POS modal (qty / discount / scale) | **90** |

Overlays portal via `PosScreenPortal` → `document.body` (escape overflow chain). Non-portaled absolute UI inside the catalog pane remains clip-risk under `.pos-catalog-scroll-pane { overflow-x: hidden }`.

---

**Certified by:** Phase 32.0 Enterprise Sell Workspace Layout, Scaling & Interaction read-only forensic audit — 2026-08-03  

**Decision:** Sell is a **capable cashier product with a fragile workspace engine**. Instability is primarily **structural** (band-from-zoom, mount/unmount checkout, locking overlays, dual density), not residual product-card debt from Phase 28.

**Recommended next step:** **Phase 32.1 — Sell Workspace Layout Engine** — persistent adaptive checkout, zoom-safe layout identity, non-locking tablet panel, single density story — preserving scan/pay logic, cart math, and Phase 28.1 selection improvements.

---

## Phase 32.1 Sell Workspace Consolidation

**Mode:** Surgical implementation (presentation / workspace architecture only)  
**Date:** 2026-08-03  

### Before / after runtime architecture

#### Before (32.0)

```text
innerWidth band → mount {sidebar | slideover | overlay | fab}
                 → zoom can flip band
                 → minimize unmounts desktop sidebar
                 → catalog dock replaces browse
                 → unreachable showShelfBoxes / showDesktopProductView
```

#### After (32.1)

```text
zoom-safe layout width → band (full stays full when maximized+zoomed)
  → workspace mode: browsing | searching | cart_review | payment | receipt
  → full desktop: sidebar always mounted for active sale
       · expanded = PosCheckoutPanel
       · collapsed = PosDesktopCheckoutRail (catalog keeps width)
  → payment dock overlays bottom of catalog (browse stays present)
  → compact slideover: non-locking dock (catalog interactive)
  → mobile overlay unchanged
  → dead layout branches removed
```

### Removed layout branches

| Branch | Action |
|--------|--------|
| `showShelfBoxes` | Deleted (unreachable) |
| `showDesktopProductView` (+ empty/no-match forks) | Deleted (unreachable) |
| `PosPageScrollSpacer` when `!catalogSellMode` | Removed |
| `clearSellView` (only used by dead UI) | Removed |
| Legacy `PosShelfTile` / masonry imports on PosPage | Removed |

### Workspace state model

`src/lib/posSellWorkspace.ts`:

| Mode | Trigger |
|------|---------|
| `receipt` | Receipt open |
| `payment` | Catalog numpad/credit dock or expanded overlay checkout |
| `cart_review` | Cart lines + checkout expanded |
| `searching` | Non-empty search |
| `browsing` | Default |

Exposed on Sell root as `data-sell-workspace-mode`.

### Panel allocation improvements

- Desktop split uses fluid `minmax(0,1fr) minmax(min, min(max, 30%))`.
- Collapsed sale uses ~88px rail — **no unmount**.
- “Add items” collapses to rail; expand restores full checkout.
- Pharmacy dispense shares the same mount + rail + zoom-safe band hooks.

### Zoom verification (implementation)

`resolvePosLayoutModeZoomSafe()` / `usePosLayoutMode()`:

- Maximized **laptop/desktop** screen (≥1280) + browser-zoomed CSS width &lt; 1024 → keep **full**.
- Maximized **tablet-class** screen (768–1279) + zoomed CSS ≤767 → keep **compact** (not mobile).
- Narrow real window on wide monitor → still compact/mobile as appropriate.
- Covered by `posSellWorkspace.test.ts`.

### Scroll ownership verification

- Catalog still owns `.pos-catalog-scroll-pane` / `[data-pos-catalog-scroll]`.
- Checkout owns `.pos-checkout-scroll-pane`.
- Payment dock is an overlay **inside** the catalog column (does not steal the scroll owner).
- Compact dock no longer uses a full-screen modal lock.

### Z-layer consolidation

Documented authoritative stack in `index.css` (`--waka-z-pos-overlay` 80 → receipt 85 → modal 90). Overlay/modal token order clarified.

### Regression summary

| Area | Changed? |
|------|----------|
| Pricing / tax / discount / cart math | No |
| Barcode / scan-to-cart | No |
| Stock / sync / offline / DB / APIs | No |
| Checkout payment methods / finalize | No (chrome only) |
| Workspace mount, zoom band, dead branches, dock/rail | Yes |

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| One runtime architecture / no unreachable paths | **Met** |
| Explicit workspace modes | **Met** (`posSellWorkspace` + data attr) |
| Stable desktop panels across resolutions/zoom | **Met** (zoom-safe + fluid split + rail) |
| Payment preserves catalog context | **Met** (dock overlay + rail) |
| Scroll / z-layer predictable | **Met** |
| Pharmacy shares runtime | **Met** |
| Architecturally complete for Sell workspace | **Met** — future work = features, not layout rewrites |
