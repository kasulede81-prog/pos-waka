# Phase M1.1-R1 — Mobile Sell Regression Audit

**Date:** 2026-08-10  
**Mode:** READ-ONLY forensic audit (no code changes)  
**Scope:** WAKA Mobile Sell workspace (Android + iOS WebView / Capacitor)  
**Evidence:** Current iPhone simulator recording + static code trace vs Phase M1.1 uncommitted/landing diffs  
**Product framing:** WAKA Mobile — not iPhone-only

---

## Executive verdict

### **NO-GO**

The current mobile Sell workspace is **not** production-ready.

Two cashier-blocking layout failures are confirmed:

1. **Sparse shelf/product view feels dead** — tall cards at the top, large unused viewport below.  
2. **Mobile checkout sheet height budget is broken** — sheet claims ~88% of the viewport, clips keypad / Complete Sale, and erases usable catalog context.

**M1.1 introduced the checkout regression.**  
**M1.1 aggravated (did not invent) the sparse-catalog emptiness.**

Do **not** authorize random CSS height tweaks until Phase **M1.1-R2** implements a scoped height-budget fix.

---

## Current vs expected behavior

| Surface | Current (recording / code) | Expected (M1.1 intent) |
|---------|----------------------------|-------------------------|
| Sparse shelf (1–2 products) | Tall cards top-aligned; large empty flex region below | Intentional cashier density; content should feel purposeful, not abandoned |
| Comfortable density | Cards inflate via `--ds-product-card-min-h`; empty pane remains | Comfortable = larger type/targets, not “broken empty workspace” |
| Cart open | Bottom sheet `max-h: min(88dvh, 40rem)` + dim backdrop | Continuity sheet with catalog peek + payment always reachable |
| Cash checkout | Keypad / Complete Sale clipped at bottom | Keypad + Complete Sale always visible without awkward hunting |
| Catalog under cart | ~12dvh dim strip — context effectively gone | Meaningful catalog orientation preserved |

---

## Finding 1 — Shelf / product area too dead

### Observed

When a shelf has 1–2 products:

- Cards sit near the top.
- A massive unused vertical area remains underneath.
- Cards feel tall relative to Name / Price / Stock content.
- Comfortable mode makes this feel worse, not more professional.

### Root causes (ranked)

| Rank | Cause | Type | Evidence |
|------|-------|------|----------|
| 1 | Catalog scroll pane **flex-fills the viewport** (`h-0` + `flex: 1 1 0%`) even when content is short | **Pre-existing** (exposed by M1.1) | `src/index.css` `.pos-catalog-scroll-pane` (~347–360); `PosPage.tsx` `catalogScrollPaneClass` |
| 2 | Product cards use **min-height floors** that grow under Display Scale | **Partly M1.1** (Comfortable path + token wiring) | `PosSellProductCard.tsx` `min-h-[96px]`; `scaleTokens.ts` `--ds-product-card-min-h` = `px(108, m)` → Comfortable ≈ **121px**; `index.css` `.pos-ds-product-card` applies the var |
| 3 | Phone band **does not reduce columns** for Comfortable (`columnDelta` ignored on mobile) | Pre-existing density design | `catalogColumnCount` / phone early-return — Comfortable only grows type/mins |
| 4 | Cards do **not** stretch to fill the empty pane (`h-full` / aspect-ratio absent on button) | N/A — emptiness is the flex pane, not stretched cards | `PosSellProductCard.tsx` |
| 5 | Shelf landing masonry uses **fixed tall tracks** (`auto-rows-[9.25rem]`) | Pre-existing; M1.1 dampen incomplete | `posShelfLayout.ts` `shelfMasonryGridClass`; `PosShelfTile` dampens typography scale but grid span still uses raw shelf scale |

### What it is **not**

- Not a virtualizer bug for 1–2 SKUs (`VirtualizedProductGrid` only when product count > threshold ~10).
- Not “stopped rendering” — the empty region is intentional flex chrome for scroll height.
- Not Android-only / iPhone-only — same React + CSS path on both Capacitor WebViews.

### Classification

| ID | Severity | Why |
|----|----------|-----|
| **RC-SHELF-1** | **P1** | Sparse shelves feel broken; cashier confidence / speed suffers; not a hard sale-blocker |
| **RC-SHELF-2** | **P2** | Comfortable card min-height inflation without phone column compensation |
| **RC-SHELF-3** | **P2** | Shelf masonry track height + undampened spans undercut M1.1 dampening intent |

### Files / components responsible

| File | Responsibility |
|------|----------------|
| `src/index.css` | `.pos-catalog-scroll-pane` flex-fill + scroll-tail padding |
| `src/pages/PosPage.tsx` | Applies `catalogScrollPaneClass`; M1.1 popular landing cards |
| `src/components/pos/PosSellProductCard.tsx` | Base `min-h-[96px]` card |
| `src/lib/displayScale/scaleTokens.ts` | `--ds-product-card-min-h` multiplier |
| `src/index.css` (pos-ds rules) | Applies density min-height to `.pos-ds-product-card` |
| `src/lib/posShelfLayout.ts` | Mobile shelf `auto-rows-[9.25rem]` |
| `src/components/pos/PosShelfTile.tsx` | M1.1 dampen typography only |

---

## Finding 2 — Checkout sheet too tall / clipped

### Observed

- Sheet consumes almost the entire phone viewport.
- Keypad cut off at the bottom.
- Primary payment / Complete Sale action not comfortably visible.
- Catalog context disappears.
- Cashier must work around a constrained viewport.

### Root causes (ranked)

| Rank | Cause | Type | Evidence |
|------|-------|------|----------|
| 1 | **M1.1 replaced full-screen overlay with capped bottom sheet** while keeping a full-screen-designed panel stack | **CAUSED by M1.1** | Diff: removed `waka-overlay-full fixed inset-0 … h-full` path; added `max-h-[min(88dvh,40rem)]` + `overflow-hidden` sheet (`PosPage.tsx` ~2197–2228) |
| 2 | Overlay `PosCheckoutPanel` stack still demands: header + **cart `min-h-[8rem] flex-1`** + totals + payment **`max-h-[min(38dvh,16rem)]`** + **shrink-0 keypad** (`min-h-[52px]` keys + Complete Sale column) | Pre-existing panel (exposed) | `PosCheckoutPanel.tsx` ~1115–1239 |
| 3 | **Safe-area double-count** inside the 88dvh box | **CAUSED by M1.1** | Sheet `paddingBottom: checkoutBottomPad` (= `env(safe-area-inset-bottom)` when keyboard closed) **and** footer `pb-[max(0.5rem,env(safe-area-inset-bottom))]` |
| 4 | Outer sheet `overflow-hidden` — no sheet-level scroll; keypad is `shrink-0` → **clips first** when budget overflows | M1.1 container + pre-existing dock | Sheet class + `CheckoutNumpadDock` |
| 5 | “Continuity” fails numerically: 88dvh sheet leaves ~12dvh dim peek — not usable catalog context | M1.1 design miss | Backdrop + sheet max-height |

### Height budget sketch (cash + keypad)

Approximate non-negotiables inside the sheet:

- Drag handle + header (“Keep browsing”) ≈ 56–72px  
- Cart region min ≈ 128px (`min-h-[8rem]`)  
- Totals ≈ 64–96px  
- Payment methods / amount ≈ up to 16rem cap when contentful  
- Numpad + Complete Sale column ≈ 220–280px+ (4×52px key rows + gaps + save)  
- Safe area ×1 or ×2 ≈ 34–68px on notched iPhones  

On smaller phones (`88dvh` ≈ 560–650px), this stack **cannot fit**. Pre-M1.1 full-screen overlay gave ~100dvh minus top safe area — more room, opaque takeover. M1.1 cut the budget without re-prioritizing the stack.

### Can payment always be exposed without awkward scrolling?

**Not with the current budget.** Complete Sale lives in the keypad dock footer (`CheckoutNumpadDock`), which is `shrink-0` at the bottom of an `overflow-hidden` 88dvh sheet. When the stack overflows, the **primary cashier action is the first thing clipped**.

### Classification

| ID | Severity | Why |
|----|----------|-----|
| **RC-CHK-1** | **P0** | Cash keypad / Complete Sale can be clipped → blocks reliable sale completion |
| **RC-CHK-2** | **P0** | Sheet height + opacity effectively removes catalog continuity M1.1 claimed to add |
| **RC-CHK-3** | **P1** | Safe-area double padding worsens clip on iOS notch devices |
| **RC-CHK-4** | **P1** | Payment block `max-h: 38dvh` competes with keypad for the same scarce budget |

### Files / components responsible

| File | Responsibility |
|------|----------------|
| `src/pages/PosPage.tsx` | M1.1 bottom sheet shell (`88dvh` / `40rem`, pad, backdrop) |
| `src/components/pos/PosCheckoutPanel.tsx` | Overlay stack: cart min-height, payment max-height, footer safe-area, always-on numpad |
| `src/components/pos/PosCheckoutPanel.tsx` (`CheckoutNumpadDock`) | 52px keys + Complete Sale column |
| `src/index.css` | `.pos-ds-cart-sheet` density rules (secondary) |

---

## M1.1 regression analysis

| M1.1 change | Checkout clip | Dead sparse shelf | Notes |
|-------------|---------------|-------------------|-------|
| Mobile cart → bottom sheet `88dvh` | **CAUSED** | — | Primary regression |
| Sheet `overflow-hidden` + pad on sheet | **CAUSED** (with double safe-area) | — | |
| Keep browsing / dim backdrop | Partial intent | — | Continuity nominal only |
| Comfortable / Balanced / Compact labels | — | **Aggravates** | Token math largely pre-existed; cashier path emphasizes Comfortable |
| Extended `pos-ds-*` coverage | Minor | **Aggravates** card mins | Architecture intact |
| Shelf scale dampening | — | Incomplete | Typography only; masonry tracks unchanged |
| Popular landing cards | — | Can add another sparse top block | Harmless when data exists |
| `text-size-adjust: 100%` | Unrelated | Unrelated | Anti-compounding; not the void |

### Pre-M1.1 checkout (HEAD)

```text
waka-overlay-full fixed inset-0 … flex flex-col
  paddingBottom: checkoutBottomPad
  PosCheckoutPanel variant=overlay (h-full)
```

Full viewport ownership hid the panel’s aggressive min-heights.  
M1.1 kept the panel, cut the container → **regression**.

---

## Cross-platform (Android + iOS)

| Factor | iOS WebView | Android WebView |
|--------|-------------|-----------------|
| Same React Sell bundle | Yes | Yes |
| Same `pos-ds-*` / sheet classes | Yes | Yes |
| `88dvh` sheet budget | Fail on small/medium | Fail on small/medium |
| Safe-area double pad | Worse (notch home indicator) | Often milder (`env` ≈ 0) |
| Flex catalog empty pane | Same | Same (pane exists for Android scroll reliability) |
| Keyboard inset (`visualViewport`) | Different path, same pad helper | Different path |

**Production target remains WAKA Mobile.** Fix must be validated on mid-range Android (Samsung A / Tecno / Infinix) and iPhone classes — not Simulator alone.

---

## Cashier workflow impact

`Product → Add → Cart → Checkout → Payment → Complete Sale`

| Step | Status | Notes |
|------|--------|-------|
| Product discovery | Degraded (P1) | Sparse shelves look empty; density feels accidental |
| Add to cart | OK | Cart engine unchanged |
| Open cart / checkout | **Blocked / slowed (P0)** | Sheet too tall; continuity failed |
| Enter cash / use keypad | **Blocked (P0)** | Keypad clipped |
| Complete Sale | **Blocked (P0)** | Primary CTA in clipped dock |
| Pricing / barcode / inventory | Unaffected | Out of scope; not implicated |

---

## Priority summary

| ID | Priority | Finding |
|----|----------|---------|
| RC-CHK-1 | **P0** | Checkout sheet height budget clips keypad / Complete Sale |
| RC-CHK-2 | **P0** | 88dvh sheet removes usable catalog context |
| RC-CHK-3 | **P1** | Double safe-area padding inside sheet |
| RC-CHK-4 | **P1** | Payment `38dvh` competes with keypad |
| RC-SHELF-1 | **P1** | Flex-filled catalog pane leaves dead empty region under sparse products |
| RC-SHELF-2 | **P2** | Comfortable card min-height inflation on phone |
| RC-SHELF-3 | **P2** | Shelf masonry tall tracks / incomplete dampen |

---

## What must NOT change in the next fix phase

- Density-token architecture (`--ds-*` / `pos-ds-*`) — improve consumers / budgets, do not replace with CSS zoom  
- Cart engine, pricing, inventory, checkout math, payment logic, barcode decode  
- Desktop / tablet Sell bands (regression-only)  
- Full redesign of Sell

---

## Recommended next phase

### **Phase M1.1-R2 — Mobile Sell Height-Budget Repair**

Presentation / layout only. Scope tightly:

1. **P0 — Checkout sheet budget**  
   - Lower / smarter `max-height` so catalog peek is real.  
   - Single owner for safe-area padding.  
   - Prioritize Complete Sale + keypad visibility; cart/payment regions scroll or shrink first.  
   - Keep bottom-sheet continuity intent (do not silently revert to opaque full-screen without decision).

2. **P1 — Sparse product/shelf emptiness**  
   - Address empty flex pane presentation for short catalogs (content-sized vs forced full-pane void).  
   - Optionally tighten Comfortable card mins on phone band only — without replacing tokens.

3. **Verify on WAKA Mobile**  
   - Android mid-range + iPhone SE / standard / Pro Max  
   - Compact / Balanced / Comfortable  
   - Cash path with keypad + Complete Sale always reachable

Then resume **Phase M1.2 — Cross-Platform Mobile Sell Production Certification**.

---

## Verification performed (read-only)

| Check | Result |
|-------|--------|
| Code trace of shelf/product layout | Done |
| Code trace of checkout overlay vs HEAD | Done — M1.1 sheet is the delta |
| Density token math | Done — Comfortable multiplies card min-h |
| Automated fix / redesign | **Not performed** (forbidden) |
| `npm run build` / `npm test` | Not required for root-cause; optional baseline from M1.1 still applies |

---

## Final statement

> The mobile Sell UI has a confirmed **P0 checkout height-budget regression introduced by Phase M1.1’s bottom sheet**, and a **P1 sparse-catalog emptiness** mostly from pre-existing flex scroll-pane behavior, worsened by Comfortable density.  
>  
> **Verdict: NO-GO** for production freeze.  
> Authorize **M1.1-R2** before M1.2 certification.

*End of Phase M1.1-R1 — Mobile Sell Regression Audit.*
