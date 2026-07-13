# Phase 25.3 — Enterprise POS Native Interaction & Touch Experience

**Mode:** Enterprise implementation (presentation & interaction only)  
**Status:** Complete  
**Builds on:** [Phase 25.2 certification](./PHASE_25_2_ENTERPRISE_POS_SCROLL_AND_TOUCH_INTERACTION_CERTIFICATION.md)

---

## Objective

Complete the Android POS interaction layer so selling feels like a professionally built native terminal. Fixes Phase 25.2 root causes (RC-1–RC-3) and standardizes scroll ownership, touch routing, keyboard insets, cart scrolling, and virtualization binding across Android, Windows, and Web.

**No business logic changes.**

---

## Before vs. After

### Before (Phase 25.2 baseline — committed HEAD)

```
Document locked → scroll-main-chrome locked → catalog pane unbounded on Android
Shelf buttons: touch-manipulation → vertical pan blocked
Compact tablet (768–1023px): viewport locked, NO catalog scroll pane → clipped catalog
Virtualizer fallback → .scroll-main-chrome (non-scrolling on sell)
Product tiles: no touch-pan-y
```

### After (Phase 25.3)

```
Document locked → AppShell flex chain → PosPage flex chain
  → [data-pos-catalog-scroll].pos-catalog-scroll-pane ★ single scroll owner ★
Shelf/product tiles: touch-pan-y (vertical scroll through tiles)
Horizontal chips: touch-pan-x
Compact tablet: catalogSellMode + scroll pane (same as mobile/full)
Virtualizer: binds ONLY to [data-pos-catalog-scroll]
Cart/checkout: pos-checkout-scroll-pane (independent vertical scroll)
[waka-pos] diagnostics for scroll owner, viewport, keyboard, virtualizer
```

---

## Scroll Ownership Architecture

```
html / body / #root          overflow: hidden (document never scrolls)
└─ .app-shell-root           h-dvh overflow-hidden
   └─ header                 shrink-0 (fixed)
   └─ main                   flex-1 min-h-0 overflow-hidden
      └─ .scroll-main-chrome  overflow-hidden on /pos (NOT scroll owner)
         └─ Outlet wrapper    flex-1 min-h-0 (sell-focus flex chain)
            └─ PosPage        flex-1 min-h-0 overflow-hidden
               └─ search      sticky shrink-0 (fixed above catalog)
               └─ [data-pos-catalog-scroll]
                    .pos-catalog-scroll-pane   ← AUTHORITATIVE CATALOG SCROLL OWNER
                    ├─ shelves (all rendered, not virtualized)
                    └─ products (virtualized when >10)
```

### Layout bands

| Band | Width | `catalogSellMode` | Scroll owner |
|------|-------|-------------------|--------------|
| Mobile | ≤767px | ✅ | `.pos-catalog-scroll-pane` |
| Compact tablet | 768–1023px | ✅ **(25.3 fix)** | `.pos-catalog-scroll-pane` |
| Full desktop | ≥1024px | ✅ | `.pos-catalog-scroll-pane` |

---

## Android Viewport Chain (RC-1, RC-3)

### CSS — bounded flex scroll pane

```css
.pos-catalog-scroll-pane {
  overflow-y: scroll;
  flex: 1 1 0%;
  height: 0;
  min-height: 0;
  max-height: 100%;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.app-shell--sell-focus .scroll-main-chrome > div {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

### PosPage flex chain

Mobile, compact, and full desktop sell use:

`flex min-h-0 flex-1 flex-col overflow-hidden` on page root and catalog column.

---

## Touch Routing (RC-2, Part 3)

Central constants in `src/lib/posTouchInteraction.ts`:

| Class | Usage |
|-------|--------|
| `POS_CATALOG_TILE_TOUCH_CLASS` (`touch-pan-y`) | Shelf tiles, product cards, pharmacy sell cards |
| `POS_HORIZONTAL_CHIP_TOUCH_CLASS` (`touch-pan-x`) | Quick products, action chips |
| `POS_CHECKOUT_SCROLL_CLASS` | Cart lines, payment block |
| `POS_ARRANGE_TOUCH_CLASS` | Shelf arrange drag mode only |

### Components updated

- `PosShelfTile` — sell mode `touch-pan-y`
- `PosSellProductCard`, `PosDesktopProductCard`, `PharmacySellMedicineCard`
- `PosQuickProductChips`, `PosSellActionChips`
- `VirtualizedProductGrid` legacy button tiles

Vertical drags on catalog tiles scroll the pane. Horizontal chip rows pan horizontally only.

---

## Virtualization Ownership (Part 7)

`VirtualizedProductGrid` resolves scroll parent via `requireCatalogScrollElement()` — **only** `[data-pos-catalog-scroll]`. No fallback to `.scroll-main-chrome` or window.

Module: `src/lib/posCatalogScroll.ts`

Dev warning if catalog pane missing: `[waka-pos] catalog_scroll_owner_missing`

---

## Keyboard Behavior (Part 5)

- `useKeyboardInset()` — Capacitor native + visualViewport on web
- Checkout overlays: `combinedBottomInsetStyle(keyboardInset)` padding
- Search focus: `scrollIntoView({ block: "nearest" })` when keyboard opens
- Capacitor: `KeyboardResize.Body`, `setScroll({ isDisabled: false })`

---

## Cart / Checkout Interaction (Part 4)

Independent scroll surfaces:

- `PosCheckoutPanel` — `pos-checkout-scroll-pane` on cart lines + payment block
- `PosDesktopCatalogCheckoutDock` — checkout scroll pane
- Mobile overlay / compact slideover — full viewport flex column with padded bottom inset

No nested vertical competition with catalog pane (catalog hidden or separate when checkout open on mobile).

---

## Diagnostics (`[waka-pos]`)

Enable: `localStorage.setItem("waka.pos.log", "1")` (or DEV mode)

| Event | When |
|-------|------|
| `scroll_owner` | PosPage mount — pane clientHeight / scrollHeight |
| `viewport` | innerHeight, visualViewport metrics |
| `keyboard_inset` | keyboardInset > 0 |
| `virtualizer_owner` | VirtualizedProductGrid bind |

No product names, prices, or user data logged.

Module: `src/lib/posInteractionDiagnostics.ts`

---

## Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Sell-focus flex chain (all widths); `pos-checkout-scroll-pane` |
| `src/lib/posTouchInteraction.ts` | Touch class constants |
| `src/lib/posCatalogScroll.ts` | Scroll owner resolution |
| `src/lib/posInteractionDiagnostics.ts` | `[waka-pos]` logging |
| `src/pages/PosPage.tsx` | `catalogSellMode` includes compact; diagnostics; keyboard scroll |
| `src/components/pos/VirtualizedProductGrid.tsx` | Hard-bound virtualizer |
| `src/components/pos/PosShelfTile.tsx` | `touch-pan-y` |
| `src/components/pos/PosSellProductCard.tsx` | `touch-pan-y` |
| `src/components/pos/PosDesktopProductCard.tsx` | `touch-pan-y` |
| `src/components/pos/PharmacySellMedicineCard.tsx` | `touch-pan-y` |
| `src/components/pos/PosQuickProductChips.tsx` | `touch-pan-x` |
| `src/components/pos/PosSellActionChips.tsx` | `touch-pan-x` |
| `src/components/pos/PosCheckoutPanel.tsx` | Checkout scroll pane classes |
| `src/components/pos/PosDesktopCatalogCheckoutDock.tsx` | Checkout scroll pane |

---

## Manual Certification Matrix

### Android

- [ ] Shelf scroll — one finger from tile surface
- [ ] Product scroll — drill-down and search
- [ ] Fast flick momentum
- [ ] Long drag without accidental tap
- [ ] Keyboard open — search visible
- [ ] Cart overlay scroll
- [ ] Checkout numpad + payment scroll
- [ ] Category / quick chips horizontal pan
- [ ] FAB does not cover last shelf row
- [ ] Rotation / resume
- [ ] 200+ products virtualized scroll

### Compact tablet (768–1023px)

- [ ] Catalog scroll pane present
- [ ] No clipped shelves
- [ ] Checkout slideover independent scroll

### Windows

- [ ] Mouse wheel on catalog pane
- [ ] Touchscreen pan
- [ ] Trackpad scroll

### Web

- [ ] Chrome / Edge / Safari catalog scroll

---

## Regression Protection

Verified unchanged:

- Sales / checkout calculations
- Inventory, pricing, staff permissions
- Sync, auth, offline architecture
- Desktop full split layout
- Arrange-mode shelf drag

---

## Verification

```bash
npm run build
npm test
```

---

## Success Criteria

- [x] RC-1/2/3 implemented (bounded pane, touch-pan-y, AppShell flex chain)
- [x] Compact tablet catalogSellMode + scroll pane
- [x] Product/shelf/chip touch routing standardized
- [x] Virtualizer hard-bound to catalog pane
- [x] Checkout independent scroll surfaces
- [x] Keyboard inset + search scrollIntoView
- [x] `[waka-pos]` diagnostics
- [x] Build passes
- [ ] Live Android manual matrix (required for production sign-off)

---

## Remaining POS UX Debt

1. **Live Android certification** — manual matrix above
2. **Tap-vs-scroll guard** — optional movement threshold for tile taps during fast scroll
3. **Shelf virtualization** — only needed at 50+ shelves (performance)
4. **Loading skeletons** — ensure scroll-safe placeholders (P2)
5. **iPad landscape** — verify compact/full boundary at 1024px

---

## Related Documents

- [Phase 25.2 — Scroll & Touch Certification (audit)](./PHASE_25_2_ENTERPRISE_POS_SCROLL_AND_TOUCH_INTERACTION_CERTIFICATION.md)
