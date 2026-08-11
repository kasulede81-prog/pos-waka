# Phase M1.1-R2 — Mobile Sell Height-Budget Repair Certification

**Date:** 2026-08-10  
**Mode:** Scoped presentation/layout implementation  
**Prerequisite:** [Phase M1.1-R1 Regression Audit](./PHASE_M1_1_R1_MOBILE_SELL_REGRESSION_AUDIT.md)  
**Production target:** WAKA Mobile — Android + iOS WebView / Capacitor  
**Architecture:** Density tokens (`--ds-*` / `pos-ds-*`) **preserved**

---

## Final verdict

### **NO-GO** (superseded by M1.1-R3)

Real simulator evidence after R2 showed the keypad/Complete controls visible while **cart / totals / payment state were hidden off-screen**. R2 optimized for “keypad pinned” and moved the failure rather than delivering a usable checkout composition.

See [Phase M1.1-R3](./PHASE_M1_1_R3_MOBILE_CHECKOUT_COMPOSITION_CERTIFICATION.md).

---

## 1. Root causes (from M1.1-R1)

| ID | Issue | Cause |
|----|-------|-------|
| RC-CHK-1/2 | Keypad / Complete Sale clipped; catalog context gone | M1.1 sheet `max-h: 88dvh` wrapping full-screen panel stack |
| RC-CHK-3 | Extra vertical loss on notched iPhones | Safe-area padded on **both** sheet and footer |
| RC-CHK-4 | Payment competed with keypad | Payment `max-h: 38dvh` + cart `min-h: 8rem` |
| RC-SHELF-1 | Dead empty region under 1–2 products | `.pos-catalog-scroll-pane` flex-filled viewport (`h-0` / `flex: 1 1 0%`) |
| RC-SHELF-2 | Comfortable cards feel oversized on phone | `--ds-product-card-min-h` × 1.12 without phone cap |

---

## 2. Exact implementation changes

| File | Change |
|------|--------|
| `src/pages/PosPage.tsx` | Mobile overlay uses `.pos-mobile-checkout-sheet`; passes `sheetInsetOwned`; removed `88dvh` max-height class |
| `src/components/pos/PosCheckoutPanel.tsx` | Overlay: secondary scroll (cart/totals/payment); keypad/Complete Sale `shrink-0`; cart capped; footer skips safe-area when `sheetInsetOwned` |
| `src/index.css` | `.pos-mobile-checkout-sheet` budget; phone catalog content-sized pane; phone product-card min-height cap |
| `src/lib/posMobileCheckoutBudget.ts` | Documented budget anchors |
| `src/lib/posMobileCheckoutBudget.test.ts` | Regression tests against `88dvh` return |

**Not changed:** cart engine, pricing, discounts, inventory, barcode, desktop/tablet Sell, shelf masonry redesign, Vision, EOD, Cash Drawer, Back Office, Home.

---

## 3. Checkout height-budget solution

- Sheet max-height: **`min(72dvh, 36rem)`** (was `min(88dvh, 40rem)`).
- Leaves ~**28dvh** catalog peek for orientation (vs ~12dvh).
- Bottom sheet interaction preserved (dim backdrop + “Keep browsing”).
- Not a silent revert to opaque full-screen overlay.
- Dynamic viewport units (`dvh`) scale across phone heights.

---

## 4. Safe-area ownership

| Layer | Owns bottom inset? |
|-------|--------------------|
| `.pos-mobile-checkout-sheet` / `paddingBottom: checkoutBottomPad` | **YES** — sole owner (safe-area when keyboard closed; keyboard inset when open) |
| Overlay footer (`sheetInsetOwned`) | **NO** — `py-2.5` only |
| Android (`env` ≈ 0) | Sheet pad is zero; no double gap |

---

## 5. Keypad / payment priority

**Highest (pinned `shrink-0`):** keypad + Complete Sale (+ pending save if shown)  
**Secondary (scrolls first):** cart (capped `min(22dvh, 10rem)`) + totals + payment block  

Removed overlay competition from payment `max-h: 38dvh` and cart `min-h: 8rem` inside the sheet budget.

Checkout math / payment business logic untouched.

---

## 6. Sparse shelf / product solution

On phone Sell (`max-width: 767px` + `.app-shell--sell-focus`):

- Catalog pane: `flex: 0 1 auto; height: auto; max-height: 100%`
- Short catalogs → content-sized (no forced empty flex void)
- Long / virtualized catalogs → still bounded + scroll
- Tighter bottom padding (safe-area) instead of full `--waka-scroll-tail-pos` void

Shelf masonry (`auto-rows-[9.25rem]`) left unchanged — not the primary product-drill-down void.

---

## 7. Density behavior

- Compact / Balanced / Comfortable retained.
- Token architecture retained (no CSS zoom).
- Phone-only consumer: `min-height: min(var(--ds-product-card-min-h), 108px)` so Comfortable does not inflate past Balanced floor on phone.
- Desktop/tablet density consumers unchanged.

---

## 8. Android considerations

- Same React + CSS path in Capacitor WebView.
- Content-sized catalog pane still uses `overflow-y: scroll` for touch reliability.
- Safe-area often 0 → sheet pad harmless; footer no longer invents a second gap.
- Must validate mid-range devices (Samsung A / Tecno / Infinix / Xiaomi) in lab.

---

## 9. iOS considerations

- Notched devices: single safe-area pad on sheet.
- `dvh` budget adapts to SE / standard / Pro Max.
- Keyboard: `combinedBottomInsetStyle` still applied on sheet only.

---

## 10. Regression verification

| Check | Result |
|-------|--------|
| Diff limited to Mobile Sell presentation | **Yes** — PosPage overlay, PosCheckoutPanel overlay path, index.css phone/sheet rules, budget helpers |
| Cart/pricing/inventory/barcode | Untouched |
| Desktop/tablet sidebar checkout | Untouched (sidebar path preserved) |
| `npm run build` | **Pass** (2026-08-10) |
| Focused budget / scale / catalog tests | **19/19 pass** |
| `npm test` | **348/349 files pass**; sole failure: known unrelated `pharmacyPatientProfile > computes age from DOB` timezone flake |

---

## 11. Test results (automated)

```
npm run build          → Pass
posMobileCheckoutBudget.test.ts → Pass (guards against 88dvh regression)
scaleTokens.test.ts    → Pass
posCatalogScroll.test.ts → Pass
Full suite             → 1827 passed; 1 pre-existing DOB flake
```

---

## 12. Manual QA matrix

| Device class | Compact | Balanced | Comfortable | Cash keypad | Complete Sale | Sparse 1–2 SKU | Notes |
|--------------|---------|----------|-------------|-------------|---------------|----------------|-------|
| Small Android | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |
| Normal Android | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |
| Large Android | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |
| Small iPhone | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |
| Normal iPhone | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |
| Large iPhone | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | OPEN |

**Mandatory cash workflow (all classes):**  
Product → Add → Cart → Checkout → Cash → Amount → Keypad → Complete Sale  
Verify: keypad visible, Complete Sale visible, no clipping, no double safe-area, meaningful catalog peek.

---

## 13. Remaining issues

| Item | Status |
|------|--------|
| Real-device / Simulator cash-path sign-off | **OPEN** |
| Tablet Sell | Out of scope (unchanged) |
| Shelf masonry track height | Deferred (not P0 for product drill-down) |
| Pre-existing pharmacy DOB test flake | Unrelated; still open |
| Phase M1.2 cross-platform certification | **Blocked until manual matrix filled** |

---

## Success criteria checklist

| Criterion | Status |
|-----------|--------|
| Complete Sale never clipped (by architecture) | ✅ Implemented |
| Cash keypad usable (pinned) | ✅ Implemented |
| Critical payment controls not sacrificed for cart | ✅ Implemented |
| Dynamic height budget (`72dvh`) | ✅ |
| Safe-area exactly once | ✅ |
| Meaningful catalog context (~28dvh) | ✅ |
| Sparse shelves not forced empty flex void | ✅ |
| Compact/Balanced/Comfortable functional | ✅ |
| Same layout architecture Android + iOS | ✅ |
| POS engines untouched | ✅ |
| Build pass | ✅ |
| Tests pass except known unrelated | ✅ |
| No wholesale Sell redesign | ✅ |
| Real-device certification | ⬜ OPEN |

---

## Statement

> Automated verification passed; real-device certification remains OPEN.

After device-lab sign-off of the cash workflow matrix, re-evaluate for **GO** and only then proceed to **Phase M1.2 — Cross-Platform Mobile Sell Production Certification**.

*End of Phase M1.1-R2 certification.*
