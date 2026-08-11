# Phase M1.1-R3 — Mobile Checkout Composition Certification

**Date:** 2026-08-10  
**Mode:** Scoped checkout composition repair  
**Prerequisite:** M1.1-R1 (audit) · M1.1-R2 (**NO-GO** — keypad visible, sale context hidden)  
**Production target:** WAKA Mobile — Android + iOS  
**Architecture:** Density tokens preserved · cart/pricing engines untouched

---

## Final verdict

### **CONDITIONAL GO**

Composition architecture is corrected: **only cart lines scroll**; **TOTAL PAYABLE, payment state, keypad, and Complete Sale are pinned**.

> Automated verification passed; real-device / Simulator visual certification remains OPEN.

If Simulator evidence again shows totals/payment hidden while keypad is visible → **NO-GO**.

Do **not** proceed to M1.2 until the cash workflow is visually confirmed.

---

## Why R2 failed

R2 put cart + totals + payment into one scroll region and pinned only the keypad. On real phones the remaining height after the keypad was consumed by the cart dock, so **totals and payment fell below the fold** of that secondary scroll. Cashier saw header + keypad + Complete Sale without understanding the sale amount.

**R2 verdict: NO-GO** (updated in R2 doc).

---

## Required composition (implemented)

```text
┌──────────────────────────┐
│ ZONE 1 — Header          │  pinned
├──────────────────────────┤
│ ZONE 2 — Cart lines      │  SCROLLS (flex-1)
├──────────────────────────┤
│ ZONE 2b — Totals         │  pinned (TOTAL PAYABLE)
├──────────────────────────┤
│ ZONE 3 — Payment state   │  pinned (method / amount)
├──────────────────────────┤
│ ZONE 4 — Keypad          │  pinned
│ ZONE 5 — Complete Sale   │  pinned
└──────────────────────────┘
```

Priority on small phones: Complete Sale → Keypad → Total Payable → Payment state → Cart lines → Catalog peek.

---

## Implementation changes

| File | Change |
|------|--------|
| `PosCheckoutPanel.tsx` | Dedicated `mobileSheetBudget` branch with `data-pos-checkout-zone` zones; cart-only scroll; denser sheet keypad (`sidebar` numpad); single safe-area via `sheetInsetOwned` |
| `index.css` | Sheet max-height `min(90dvh, 42rem)` — composition wins; residual catalog peek ~8–12dvh |
| `posMobileCheckoutBudget.ts` + test | Anchors zones + rejects R2 `72dvh` regress |
| `PosPage.tsx` | Comment/ownership unchanged (sheet + `sheetInsetOwned`) |

**Not changed:** cart engine, pricing, inventory, checkout math, payment logic, barcode, desktop/tablet sidebar path.

---

## Height budget

| Rule | Value |
|------|-------|
| Sheet max | `min(90dvh, 42rem)` |
| Catalog peek | Residual (~10dvh) — **secondary** |
| Safe-area | Sheet only (footer skips when `sheetInsetOwned`) |
| Cart | `flex-1` + `min-h-[4.5rem]` — yields space first |
| Payment emergency | `max-h-[min(26dvh,11rem)]` if credit fields grow |

Not a silent return to full-screen opaque overlay. Not a blind `88dvh` revert of the broken M1.1 stack.

---

## Automated verification

| Check | Result |
|-------|--------|
| `npm run build` | **Pass** |
| Composition / scale / totals tests | **Pass** |
| Full `npm test` | Expected: pass except known `pharmacyPatientProfile` DOB flake |

---

## Manual acceptance (OPEN)

For a normal cash sale, **simultaneously** visible:

- [ ] Sale/cart context (at least summary / lines)
- [ ] **TOTAL PAYABLE**
- [ ] Payment method
- [ ] Amount entered
- [ ] Keypad (uncclipped)
- [ ] Complete Sale (tappable)

Test: 1 / 3 / 10 product carts · exact / short / change cash · Compact / Balanced / Comfortable · small/normal/large Android + iPhone.

---

## Remaining

| Item | Status |
|------|--------|
| Simulator visual sign-off | **OPEN** |
| Phase M1.2 | **Blocked** until R3 visual GO |

*End of Phase M1.1-R3.*

---

### Phase M1.1-R4 — Cart Item Visibility

**Date:** 2026-08-10  
**Status:** Implemented — visual certification OPEN

#### Problem

R3 kept totals / payment / keypad / Complete Sale visible, but the cart **line list** was nearly invisible (only the “N products · M units” chrome showed). Cashiers could not verify which products were in the sale.

#### Implementation

| Piece | Detail |
|-------|--------|
| Component | `MobileSheetCartItems.tsx` |
| Rules | `posMobileCheckoutItems.ts` — auto-show ≤3; collapsed preview = 3 rows when 4+ |
| Parent zone | Cart zone `shrink-0` when collapsed; `flex-1` + `max-h-[min(38dvh,17rem)]` when expanded |
| Pinned zones | Totals / payment / keypad / Complete Sale unchanged (R3 composition) |

#### Collapsed state

- **1–3 products:** all compact verification rows visible (name, qty · unit, line total). No View-all required.
- **4+ products:** first 3 compact rows + **View all N products** (header also toggles, ≥44px, `aria-expanded`).

#### Expanded state

- Only the cart-items region grows (capped).
- Full editable `DraftCartLineRow` list via virtualizer; scrolls internally.
- Totals / payment / keypad / Complete Sale remain pinned.

#### Large carts

50+ lines: expanded list virtualizes + scrolls; payment composition stays authoritative.

#### Accessibility

- Header control: `aria-expanded`, `aria-controls`, expand/collapse aria labels.
- Min touch 44px on disclosure + View all row.
- Not a floating popover — disclosure stays inside checkout composition.

#### Android / iOS

Same React path; no iPhone-only behavior. Density tokens unchanged (no CSS zoom).

#### Tests

- `posMobileCheckoutItems.test.ts` — visibility rules
- `npm run build` / focused tests (re-run at sign-off)

#### Remaining manual QA

- [ ] 1 / 2 / 3 / 4 / 10 / 50+ products
- [ ] Compact / Balanced / Comfortable
- [ ] Expand does not hide TOTAL PAYABLE / keypad / Complete Sale
- [ ] Cash workflow end-to-end on Android + iOS class devices

#### R4 verdict

**Superseded for viewport ownership by M1.1-R5.** R4 item disclosure is retained inside the full-screen workspace; the partial-height sheet constraint is removed. See [PHASE_M1_1_R5_MOBILE_CHECKOUT_FULL_SCREEN_WORKSPACE_CERTIFICATION.md](./PHASE_M1_1_R5_MOBILE_CHECKOUT_FULL_SCREEN_WORKSPACE_CERTIFICATION.md).

*End of Phase M1.1-R4 notes.*
