# Phase M1.1-R5 — Mobile Checkout Full-Screen Workspace Certification

**Date:** 2026-08-10  
**Mode:** Scoped checkout presentation  
**Prerequisite:** R1 audit · R2–R4 partial-height sheet experiments  
**Production target:** WAKA Mobile — Android + iOS  
**Engines:** Untouched (cart / pricing / inventory / payment math / barcode)

---

## Final verdict

### **CONDITIONAL GO**

Architecture now matches the product decision: **checkout owns the entire phone viewport**. Cart-only scrolling; totals, payment state, keypad, and Complete Sale are pinned.

> Automated verification passed; real-device / Simulator visual certification remains OPEN.

- If any keypad row or Complete Sale is clipped → **NO-GO**  
- If TOTAL PAYABLE / payment state disappears → **NO-GO**  
- If only the cart list scrolls and critical controls stay visible → keep **CONDITIONAL GO** until Android lab

Do **not** proceed to M1.2 until visual verification passes.

---

## Why R3 / R4 were insufficient

| Phase | Intent | Failure |
|-------|--------|---------|
| R2 | Pin keypad in ~72dvh sheet | Hid totals / payment |
| R3 | Pin totals + payment + keypad in ~90dvh sheet | Catalog peek still stole viewport; keypad clipped |
| R4 | Expandable cart items | Improved verification, but **partial-height sheet** still clipped lower keypad / Complete Sale |

Root mistake: treating Sell catalog and Checkout as if they must coexist on one phone screen. They should not.

---

## Full-screen decision

**Sell mode** — catalog-first.  
**Checkout mode** — checkout-first, **100dvh** workspace.

Removed:

- 72dvh / 88dvh / 90dvh max-height sheets  
- Dimmed catalog peek / drag handle / `justify-end` bottom sheet  
- Residual catalog orientation behind payment  

---

## Viewport ownership

| Layer | Role |
|-------|------|
| `.pos-mobile-checkout-workspace` | `height/max-height: 100dvh`; `fixed inset-0` |
| Top pad | `env(safe-area-inset-top)` on workspace |
| Bottom pad | `checkoutBottomPad` on workspace only (safe-area or keyboard) |
| Panel footer | `sheetInsetOwned` — no second safe-area |

---

## Composition (unchanged zone model, full height)

```text
HEADER (pin)
CART ITEMS (flex remainder — only scroll region)
TOTALS / PAYABLE (pin)
PAYMENT STATE (pin; soft max for tall credit fields)
KEYPAD + COMPLETE SALE (pin)
```

Budget:  
`Viewport − header − totals − payment − keypad/action − safe-area = cart flex space`

---

## Product list (R4 kept, constrained)

- 1–3 products: compact rows auto-shown  
- 4+: preview + View all / Collapse  
- Expanded / large carts: virtualized scroll **inside cart zone only**  
- No floating popover over payment  

---

## Android / iOS

Same Capacitor WebView path. `100dvh` + single safe-area owner. No iPhone-only hacks.

---

## Automated verification

| Check | Result |
|-------|--------|
| `npm run build` | **Pass** (2026-08-10) |
| `posMobileCheckoutBudget.test.ts` | **Pass** — guards `100dvh`, forbids 72/88/90dvh sheet |
| `posMobileCheckoutItems.test.ts` | **Pass** — R4 visibility rules retained |
| Diff scope | PosPage overlay, PosCheckoutPanel mobile branch, index.css workspace, budget helpers |

---

## Manual QA (OPEN)

| Case | Status |
|------|--------|
| Entire keypad visible | ☐ |
| Complete Sale above home indicator | ☐ |
| TOTAL PAYABLE + payment + amount + change | ☐ |
| 1 / 3 / 10 / 50 / 100+ carts — cart-only scroll | ☐ |
| Compact / Balanced / Comfortable | ☐ |
| Small / normal / large Android + iPhone | ☐ |
| Cash: exact / short / change | ☐ |

---

## Success criteria

| Criterion | Status |
|-----------|--------|
| Full mobile viewport | ✅ Implemented |
| No catalog peek | ✅ |
| Cart-only scroll | ✅ |
| Pinned payable / payment / keypad / Complete | ✅ Architecture |
| Safe-area once | ✅ |
| Density tokens / no CSS zoom | ✅ |
| Engines untouched | ✅ |
| Visual device sign-off | ⬜ OPEN |

*End of Phase M1.1-R5.*
