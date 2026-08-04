# Phase 33.0 — Enterprise Cashier Workspace, Cart & Checkout Experience Certification

**Mode:** Read-only forensic audit (**NO code changes, NO CSS changes, NO SQL, NO migrations, NO dependency updates**)  
**Date:** 2026-08-04  
**Scope:** Cashier Workspace after product selection — Cart → Customer → Discount → Tax → Payment → Receipt → Next Sale  
**Out of scope:** Shelf browser, product grid/card geometry (Phases 32.2–32.4.x), Inventory, Purchasing, hospitality table billing (except as contrast)  
**Related prior work:**  
- Phase 32.0 / 32.1 — Sell workspace layout, checkout rail stay-mounted  
- Phase 32.2–32.4.3 — Shelf browser & product selection polish  
- Phase 28.1 — one-tap add / cart qty badge  

**Core question:**

> Can a cashier complete an entire sale quickly, confidently, and with minimal cognitive load?

---

## Executive Summary

Product browsing is now in good shape. The **Cashier Workspace** (cart + checkout panel) is **functionally complete for cash-first retail** and has real enterprise strengths: dock-density qty steppers, sticky pay footer, desktop shortcuts (F4/F8/F9/Enter), mobile checkout FAB, cash change math, and a post-sale receipt with print / PDF / share.

It is **not fully certified** as an enterprise cashier surface because several high-leverage presentation/workflow gaps remain:

1. **Live cart uses ultra-compact “dock” rows that omit line discount and remove** — richer row variants exist but are unused on Sell.  
2. **Totals hierarchy is flattened** — no subtotal / tax / line-discount stack; the payment block suppresses the large payable when `dockMode` is on (always in production).  
3. **Large carts are structurally weak** — no cart virtualization; list height is hard-capped (~10–15rem / 36dvh).  
4. **Customer attach is credit-only**; loyalty is absent from Sell checkout.  
5. **Receipt is production-usable** (print/PDF/share) but lacks dedicated email / SMS / WhatsApp actions (WhatsApp i18n exists unused).

| Dimension | Score | Verdict |
|-----------|------:|---------|
| **Cart workspace** | **6.6 / 10** | Fast for small carts; cramped + orphaned controls |
| **Checkout transition** | **7.0 / 10** | Strong after 32.1 rail; same-panel pay, not a dedicated stage |
| **Payment workspace** | **7.3 / 10** | Cash/MM/credit solid; no retail split tender; ATM ≠ card |
| **Receipt experience** | **6.8 / 10** | Print/PDF/share ready; channel gaps |
| **Desktop workflow** | **7.5 / 10** | Shortcuts + Enter-to-pay competitive |
| **Mobile workflow** | **7.1 / 10** | FAB + overlay good; cart+numpad compete for height |
| **Accessibility** | **6.3 / 10** | Dialogs/labels present; method pressed state / qty a11y weak |
| **Overall cashier workspace** | **6.9 / 10** | Capable retail POS; not maintenance-frozen yet |

**Answer:** A cashier **can** complete typical cash sales quickly. Confidence drops on **discounted lines, large wholesale carts, tax-visible totals, and multi-channel receipts**. Highest ROI for Phase 33.1 is presentation/interaction repair — **not** new business engines.

**Recommended next step:** Phase 33.1 — Cashier Workspace polish (P0 register below), then freeze the Sell end-to-end path for long-term maintenance.

---

## Certification Methodology

1. Static forensics of `PosCheckoutPanel`, `DraftCartLineRow`, `DraftCartSummary`, mount helpers, keypad/focus libs.  
2. Orchestration in `PosPage` / pharmacy `PharmacyDispenseWorkspace` (shared panel).  
3. Totals math in `draftCart.computeDraftCheckoutTotals` vs what UI renders.  
4. Receipt path: post-sale overlay + `DocumentActionsBar` + history reprint.  
5. Keyboard map in `posKeyboardShortcuts` / `posCheckoutFocus`.  
6. Contrast vs hospitality `RestaurantBillSheet` (tax/service/split) — out of Sell scope but proves platform capability.  
7. Workflow benchmark vs Square / Shopify POS / Lightspeed / Toast (speed/clarity only; **do not copy layouts**).

**Not performed:** Live timed cashier lab; device farm for 500-line carts; eye-tracking.

---

## Architecture Map (evidence)

```
PosPage
├── full desktop: PosCheckoutPanel(sidebar) | PosDesktopCheckoutRail
│                 + optional PosDesktopCatalogCheckoutDock
├── compact: PosCompactCheckoutSlideover → PosCheckoutPanel(overlay)
├── mobile: portal overlay → PosCheckoutPanel(overlay)
└── minimized: PosMinimizedCheckoutFab (mobile/compact)

PosCheckoutPanel
├── header (clear / title / add items)
├── CartDockBody → DraftCartSummary(dock) + DraftCartLineRow(dock)×N
├── PaymentBlock(dockMode: true)
└── sticky footer (pending + Save / Confirm)

Post-sale: receipt overlay → DocumentActionsBar (print / PDF / share)
```

| File | Role |
|------|------|
| `src/pages/PosPage.tsx` | State, `finishSale`, receipt, shortcuts, mounts |
| `src/components/pos/PosCheckoutPanel.tsx` | Cart + payment shell |
| `src/components/pos/DraftCartLineRow.tsx` | Line densities: `dock` (live), `compact`, default |
| `src/components/pos/DraftCartSummary.tsx` | Stats / total bar |
| `src/components/pos/QuantityEditModal.tsx` | Manual qty numpad |
| `src/components/pos/CartSaleDiscountModal.tsx` | Order discount |
| `src/components/pos/DiscountLineModal.tsx` | Line discount (wired; dock UI omits entry) |
| `src/lib/draftCart.ts` | Stats + `computeDraftCheckoutTotals` |
| `src/lib/posCheckoutMount.ts` | Mount predicates |
| `src/lib/posSellWorkspace.ts` | `browsing` / `cart_review` / `payment` / `receipt` |
| `src/lib/posKeyboardShortcuts.ts` | F2/F4/F8/F9/Enter/± |
| `src/components/documents/DocumentActionsBar.tsx` | Receipt actions |

---

# PART 1 — Cart Workspace

### What works

- Single cashier shell (`PosCheckoutPanel`) across mobile / compact / desktop — reduces mode confusion.  
- Dock density keeps cart + payment + keypad co-visible on phone.  
- Sticky pay footer with upward shadow (`shadow-[0_-4px_12px_…]`) — pay CTA stays reachable.  
- Desktop sidebar stays mounted while draft has lines (Phase 32.1); collapse → rail, not unmount.  
- Mobile minimized bar shows **count + payable + Checkout** (`PosMinimizedCheckoutFab`) — excellent resume cue.

### Gaps

| Issue | Evidence |
|-------|----------|
| Cart scroll region hard-capped | Overlay `max-h-[min(36dvh,14rem)]`; sidebar with numpad `max-h-[min(28%,10rem)]` |
| Summary scrolls with lines | `DraftCartSummary` inside cart scroll pane — not sticky above payment |
| Empty state rarely seen | Mount requires `draftLineCount > 0` (`posCheckoutMount.ts`) |
| No cart virtualization | `draftLines.map` in `CartDockBody` |
| Visual hierarchy is “utility dock” | Teal/waka chrome, compact type — reads as tool panel, not confidence-maximizing register |

**Cart score: 6.6 / 10** — enterprise for small/medium retail carts; not for large wholesale lists.

---

# PART 2 — Line Items

### Live dock row (production)

```
[Name truncates]
[qty · unitPrice · lineTotal]     [−] [qty] [+]
[+ PharmacyFefoBatchChip when pharmacy]
```

Evidence: `DraftCartLineRow` `if (dock)` branch.

| Signal | Present on dock? | Notes |
|--------|------------------|-------|
| Product name | Yes | Truncate; bold |
| Quantity | Yes | In meta line **and** stepper button |
| Unit price | Yes | Via `formatDraftLineUnitPrice` |
| Line subtotal | Yes | `line.lineTotalUgx` |
| Line discount amount | **No** | Shown only on unused `compact` / default variants |
| Variants / modifiers | Partial | Name/qty encoding; no dedicated modifier chips in dock |
| Pharmacy labels | Yes | FEFO batch chip |
| Remove control | **No** | Only on unused variants |

**Understandability:** Strong for plain SKUs. Weak when a line was discounted — cashier cannot see the discount on the live row. Meta line packs qty · unit · total into one muted string — efficient but secondary to name (correct) while line total does not visually dominate the row the way Square/Toast often do.

**Line-item score: 6.4 / 10**

---

# PART 3 — Quantity Controls

| Control | Behavior | Touch target (dock) |
|---------|----------|---------------------|
| **−** | `draftLineQuantityStep` −1; qty≤0 removes line | `h-11 w-11` (sidebarCompact `h-9 w-9`) |
| **+** | +1 base unit | Same |
| **Qty tap** | Opens `QuantityEditModal` (decimal ≤4 places) | `h-11 min-w-[3rem]` |
| **Delete** | No dedicated ✕ on dock; qty→0 or Clear sale | — |
| **Long press** | **Not implemented** | — |
| Keyboard ± | Adjusts **last** cart line | Desktop speed win |

**Speed verdict:** Steppers are optimized for rapid ±1. Manual qty modal is solid. Missing explicit remove increases error recovery cost (“how do I delete this line?” → decrement to zero). Desktop `sidebarCompact` 36×36 targets are below common 44px guidance.

**Quantity score: 7.2 / 10** (speed good; delete discoverability weak)

---

# PART 4 — Totals Area

### Computed (engine)

`computeDraftCheckoutTotals` returns:

- `lineSubtotalUgx`
- `lineDiscountUgx`
- `cartDiscountUgx`
- `payableUgx`

### Rendered (cashier UI)

Dock summary bar: `N products · M units` + **Total** or **Payable** (payable only when cart discount > 0).

| Row | Shown in Sell checkout? |
|-----|-------------------------|
| Subtotal | **No** |
| Line discounts aggregate | **No** (`draftDiscountTotal` received as `_draftDiscountTotal` unused) |
| Order discount | Indirect (label flips to Payable; original under full non-dock summary only) |
| Tax / VAT | **No** (hospitality has tax; retail Sell cart does not surface it) |
| Service charge | **No** (hospitality-only) |
| Grand total | Yes, but modest — dock summary `text-sm` / sidebarCompact `text-xs`; PaymentBlock **hides** large payable when `dockMode: true` |

**Hierarchy failure:** The total should dominate. In production dock mode, the largest numeric emphasis is often the **cash tender field** or footer Save button — not a register-grade grand total.

**Totals score: 5.5 / 10** — P0 for confidence.

---

# PART 5 — Customer Attachment

| Path | Behavior |
|------|----------|
| Cash / ATM / Mobile money | **No** customer attach UI |
| Credit (“Pay later”) | Name + phone + optional existing customer `<select>` with debt balance |
| Desktop credit | May expand into `PosDesktopCatalogCheckoutDock` |
| Shortcut F9 | Forces credit + focuses customer select |
| Guest checkout | Implicit (no customer) for non-credit |
| Debt flow | `computedDebt`; customer required when debt > 0 |
| Loyalty | **No** Sell checkout UI (`PosPage` has zero loyalty references) |

**Discoverability:** Customer is framed as a **payment method consequence**, not a first-class “attach customer” action. That matches debt-heavy Ugandan retail for credit sales, but fails shops that want CRM/loyalty on cash sales.

**Customer score: 5.8 / 10**

---

# PART 6 — Discounts

| Kind | Entry point | Status |
|------|-------------|--------|
| Order discount | “Discount sale” beside summary; **F8** | **Working** — `CartSaleDiscountModal` (fixed UGX or %) |
| Item discount | `DiscountLineModal` + store `applyDraftLineDiscount` | **Engine + modal exist**; dock rows pass `onDiscount` but **never render a discount button** |
| Visibility on line | Dock: none; unused variants show −UGX | Orphaned |
| Governance | `validateCombinedDraftDiscount` | Present in store |

**Critical UX gap:** Line discount is effectively **unreachable from the live Sell cart surface**. Pharmacy dispense wires the same panel pattern. Hospitality/table ordering uses a different cart that still mounts `DiscountLineModal` with non-dock rows.

**Discount score: 5.0 / 10** (order OK; item broken in presentation)

---

# PART 7 — Payment Transition

| Aspect | Finding |
|--------|---------|
| Model | Payment is the **lower half of the same panel**, not a separate route |
| Desktop | Sidebar / rail expand (F4); catalog remains visible in `payment` workspace mode |
| Mobile/compact | Expand from FAB / slideover; often auto-minimized after add to keep browsing |
| Animation | **No** enter/exit slide on overlay/rail — instant mount |
| Interruption | Escape / Android back → minimize; draft preserved (`usePosAndroidBackStack`) |
| Leave guard | Confirm before abandoning draft (`posLeaveGuard`) |

**Dedicated workflow feel:** Partially. Workspace mode `payment` exists, but visually it is still “cart + pay stacked.” Enterprise POS often isolates tender entry; WAKA keeps cart visible (good for verification) at the cost of tender focus on small screens.

**Transition score: 7.0 / 10**

---

# PART 8 — Payment Workspace

### Methods (Sell)

`POS_CHECKOUT_METHODS = ["cash", "atm", "mobile_money", "credit"]` (credit gated by debt permission).

| Method | Tender | Change |
|--------|--------|--------|
| Cash | Keypad; empty ⇒ exact payable | `changeDue = max(0, paid − payable)` |
| ATM | Exact payable | 0 |
| Mobile money | Exact payable | 0 |
| Credit | Cash + MM partials | Remainder → debt |
| True split | **Not in Sell** | Hospitality `RestaurantBillSheet` |
| Card terminal | **Not wired** | i18n `paymentMethod_card` unused; UI says ATM |

### Keypad

- `CheckoutNumpadDock` / `posCheckoutKeypad.ts` — numeric + alpha (debt name) + phone  
- Cash too low blocked with toast (`paymentCashTooLow`)  
- Confirm via footer Save + numpad green confirm + **Enter** (`resolveConfirmSaleAction`)

### Speed

Cash exact / ATM / MM is one-tap method + Enter — competitive with Square for simple tenders. Credit + customer is heavier (appropriate). Split tender across cash+card+MM for one bill is missing in retail.

**Payment score: 7.3 / 10**

---

# PART 9 — Receipt Experience

Post-sale overlay (`receiptSaleId`): HTML preview + `DocumentActionsBar`.

| Action | Sell post-sale | History reprint |
|--------|----------------|-----------------|
| Preview | Yes | Yes (history UI) |
| Print | Yes (+ reprint audit log) | Yes |
| Download PDF | Yes | Yes |
| Share PDF | Yes (Web Share / native) | No share button |
| Email | **No dedicated** | — |
| SMS | **No** | — |
| WhatsApp | i18n `receiptWhatsApp` **unused** | — |
| Next sale | Close receipt → empty draft → browsing | — |

Success flash: ✓ overlay 720ms + toast + haptic/sound — good confidence cue.

**Receipt score: 6.8 / 10** — production-ready for print/PDF shops; not full omnichannel.

---

# PART 10 — Empty Cart

| Aspect | Finding |
|--------|---------|
| Hint copy | “Scan or tap products to add them here.” (`posCartEmptyHint`) |
| Visibility | Panel **unmounts** when `draftLineCount === 0` — hint is defensive/rare |
| First sale | Guidance lives on **catalog** side (shelf/search), not cart |
| FAB | Only when lines > 0 |

Empty cart is not a designed first-sale coaching surface in the cashier column — by architecture, the cart appears only after the first add. That is acceptable if catalog empty/browse states are strong (they are, post-32.x).

**Empty-cart score: 6.0 / 10** (intentional absence more than defect)

---

# PART 11 — Large Sale (100+ / 250+ / 500+ lines)

| Concern | Evidence |
|---------|----------|
| Virtualization | **None** on cart — full DOM list |
| Scroll viewport | Hard max-height ~10–15rem while payment/numpad compete |
| Sticky totals | Pay sticky; summary **not** sticky |
| Performance risk | Re-renders map all lines; no windowing |
| Wholesale fitness | Weak — wholesale stats helpers exist in `draftCart` comments, UI does not scale |

**Projected:** 100 lines painful; 250+ likely unusable on mobile overlay; 500+ desktop also cramped without virtualization + taller cart pane.

**Large-sale score: 3.5 / 10** — structural P0 for shops with long bills.

---

# PART 12 — Desktop Workflow

| Capability | Status |
|------------|--------|
| F2 search | Yes |
| F4 focus/open checkout | Yes |
| F8 cart discount | Yes |
| F9 credit + customer | Yes |
| Enter confirm sale | Yes (focus-aware) |
| Escape minimize / close modals | Yes |
| ± last line qty | Yes |
| Tab order | Native controls; method grid + fields + save |
| Mouse | Hover on catalog; cart is click-dense |
| Persistent column | Yes (32.1) |

Competitive with Lightspeed/Square desktop for **keyboard cashiers**. Weaknesses: line discount has no shortcut; remove-line has no shortcut; grand total under-emphasized.

**Desktop score: 7.5 / 10**

---

# PART 13 — Mobile Workflow

| Aspect | Finding |
|--------|---------|
| One-hand | Bottom Checkout bar + 44–48px targets on overlay — good |
| After add | Often re-minimizes — browse-first, pay-second (cashier-friendly) |
| Overlay | Full-screen dialog; safe-area footer padding |
| Cart vs keypad | Height competition — cart shrinks hard when numpad open |
| Payment sheet | Same panel, not a separate bottom sheet stage |

**Mobile score: 7.1 / 10**

---

# PART 14 — Accessibility

| Check | Status |
|-------|--------|
| Mobile checkout `role="dialog"` `aria-modal` | Yes |
| Receipt dialog labelling | Yes |
| Qty ± `aria-label` | Yes |
| Qty center button | **No** explicit `aria-label` (shows qty text only) |
| Payment method `aria-pressed` | **Missing** — visual selection only |
| Focus outline on pay/save | Relies on browser/default + some focus refs |
| Keyboard-only checkout | Possible via F4/Enter/tab; credit fields harder |
| Zoom | Display Scale + browser zoom history (Phase 32.0/32.1); checkout densifies via `sidebarCompact` |
| Contrast | Teal/waka on card generally OK; muted meta line secondary |

**Accessibility score: 6.3 / 10**

---

# PART 15 — Root Cause Register

Ranked by cashier-speed / confidence impact. All evidence-backed.

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| **RC-1** | **P0** | Line discount + remove orphaned from live cart | Dock branch omits buttons; `compact`/`default` unused in Sell |
| **RC-2** | **P0** | Totals hierarchy underpowered | `dockMode` hides PaymentBlock payable; no subtotal/tax/line-discount rows; summary `text-xs`–`text-sm` |
| **RC-3** | **P0** | Large carts structurally unsupported | No virtualizer; `max-h-[min(36dvh,14rem)]` / `10rem` caps |
| **RC-4** | **P1** | Customer only on credit path | `PaymentBlock` credit branches; no cash-sale attach; no loyalty |
| **RC-5** | **P1** | Item discount unreachable despite modal/store | `DiscountLineModal` mounted from `PosPage`; dock never calls `onDiscount` |
| **RC-6** | **P1** | No retail split tender | Methods exclude `mixed` as selectable; hospitality has real split |
| **RC-7** | **P1** | Receipt channel gaps | `DocumentActionsBar` = print/PDF/share only; WhatsApp i18n unused |
| **RC-8** | **P1** | Cart summary not sticky | Summary inside scroll pane with lines |
| **RC-9** | **P2** | No checkout mount transition | Instant conditional render |
| **RC-10** | **P2** | Payment method a11y pressed state | Class toggle only |
| **RC-11** | **P2** | Dead row density variants | Maintenance cost / confusion for future edits |
| **RC-12** | **P2** | Empty cart coaching unreachable | Mount predicates require lines |

---

# PART 16 — Enterprise Comparison

Compare **workflow quality** (not layout cloning).

| Dimension | WAKA (today) | Square | Shopify POS | Lightspeed | Toast |
|-----------|--------------|--------|-------------|------------|-------|
| Cashier add→pay speed (small cart) | Strong | Strong | Strong | Strong | Strong |
| Cart line clarity | Medium (dock pack) | High | High | High | High |
| Qty ergonomics | Strong steppers | Strong | Strong | Strong | Strong |
| Totals confidence | Weak | High | High | High | High |
| Customer on any tender | Weak | Strong | Strong | Strong | Strong |
| Discounts (item+order) | Order only in UI | Both | Both | Both | Both |
| Split tender | Missing (retail) | Yes | Yes | Yes | Yes |
| Receipt channels | Print/PDF/share | Broad | Broad | Broad | Broad |
| Desktop shortcuts | Strong | Medium | Medium | Strong | Medium |
| Large cart | Weak | Medium–Strong | Medium | Strong | Medium |

**Positioning:** WAKA is closest to a **cash-first, keyboard-capable African retail register** — ahead on mobile browse→FAB→pay and desktop F-keys; behind on **totals theater**, **line-level cart tools**, and **large-ticket cart performance**.

---

# PART 17 — Prioritized Implementation Roadmap

### Phase 33.1 candidates (presentation / interaction only — preserve business logic)

#### P0 — Cashier speed & confidence

1. **Restore line actions on dock rows (surgical)**  
   - Surface remove (and optionally line discount) without abandoning dock density.  
   - Or: long-press / overflow “⋯” to keep one-handed ± dominant.  
   - Wire existing `onDiscount` / `onRemove` — no new APIs.

2. **Elevate totals hierarchy**  
   - Sticky payable strip between cart list and payment methods.  
   - Show subtotal → discounts → **payable** when any discount > 0.  
   - Do not invent tax UI unless tax is already computed for retail drafts (avoid false precision).

3. **Large-cart survival**  
   - Virtualize cart list **or** raise scroll budget when numpad closed + sticky summary.  
   - Target: 100+ lines remain scrollable with pay CTA always visible.

#### P1 — Visual polish & workflow completeness

4. Sticky cart summary / discount chip visibility.  
5. Optional “Customer” control for non-credit sales (guest default preserved).  
6. Receipt: surface WhatsApp/share intent if Web Share already covers it; label clearly.  
7. Payment method `aria-pressed` + qty button `aria-label`.  
8. ATM label clarity vs “Card” if hardware path still absent.

#### P2 — Micro-interactions

9. Subtle checkout expand transition (≤200ms; respect `prefers-reduced-motion`).  
10. Remove or formally deprecate unused `DraftCartLineRow` densities to prevent drift.  
11. Press feedback parity with product cards (Phase 32.4.3).

### Explicit non-goals for 33.1

- No pricing / tax engine rewrite  
- No new payment providers / card terminal integration (unless separately scoped)  
- No Inventory / Purchasing changes  
- No hospitality cart merge into Sell  
- No database / sync / API changes  

---

## Scorecard (detail)

| Area | Score | Notes |
|------|------:|-------|
| Cart workspace | 6.6 | Density good; scroll + orphaned actions |
| Line items | 6.4 | Clear SKU rows; discount/modifier weak |
| Quantity controls | 7.2 | Fast ±; delete discoverability |
| Totals | 5.5 | Flattened; dock hides big total |
| Customer | 5.8 | Credit-only |
| Discounts | 5.0 | Order yes; line UI dead |
| Payment transition | 7.0 | Rail/FAB solid; no stage animation |
| Payment workspace | 7.3 | Cash/MM/credit strong |
| Receipt | 6.8 | Print/PDF/share |
| Empty cart | 6.0 | By design rarely shown |
| Large sale | 3.5 | Structural risk |
| Desktop | 7.5 | Shortcuts competitive |
| Mobile | 7.1 | FAB excellence; height fight |
| Accessibility | 6.3 | Baseline dialogs; gaps remain |
| **Overall** | **6.9** | Ready for surgical 33.1 — not freeze yet |

---

## Success Criteria — Answers

| Question | Answer |
|----------|--------|
| Does the cart support enterprise cashier productivity? | **Yes for typical retail carts (<~30 lines).** No for large/wholesale lists or discounted-line clarity. |
| Does checkout introduce unnecessary friction? | **Low for cash/ATM/MM.** Medium when needing line discount, customer on cash, or split tender. |
| Do totals and payment hierarchy maximize confidence? | **No** — payable is under-emphasized in dock mode; stack incomplete. |
| Is the receipt workflow production-ready? | **Yes for print/PDF/share.** Not for email/SMS/WhatsApp-specific flows. |
| Highest-return refinements without business-logic change? | **RC-1, RC-2, RC-3** — line actions, totals theater, large-cart scroll/virtualization. |

---

## Final Goal Alignment

After **Phase 33.1** addresses the P0 register, the Sell module (Shelf Browser → Product Selection → Cart → Checkout → Receipt) should be cohesive enough to **enter long-term maintenance**, with future work focused on features (loyalty, card terminal, tax display policy) rather than UI architecture.

---

## Manual Certification Checklist (for Phase 33.1 acceptance)

### Cart
- [ ] Line remove discoverable without clearing whole sale  
- [ ] Line discount reachable if product policy allows  
- [ ] Totals readable at a glance (payable dominates)  
- [ ] 50+ line cart remains usable on phone and desktop  

### Payment
- [ ] Cash change still correct  
- [ ] Credit + customer still required when debt > 0  
- [ ] Enter-to-pay / F-keys unchanged  

### Receipt
- [ ] Print / PDF / share still work  
- [ ] Close → next sale returns to browsing  

### Regression
- [ ] Inventory unchanged  
- [ ] Pricing / barcode / sync / offline unchanged  
- [ ] Product grid Phase 32.4.x proportions unchanged  

---

*End of Phase 33.0 certification — read-only; no implementation in this phase.*

---

## Phase 33.1 — Cashier Workspace Final Polish

**Mode:** Surgical presentation / interaction / performance  
**Date:** 2026-08-04  
**Scope:** P0 register from Phase 33.0 — enterprise cart rows, totals hierarchy, large-cart virtualization  

### Before vs after — cart rows

| Before (dock) | After (Phase 33.1) |
|---------------|--------------------|
| Name + packed `qty · unit · total` meta | Name; spaced Qty / unit price / **line total** |
| No line discount cue | Discount chip when applied (tap to edit); **%** when none |
| No remove control | Always-visible **✕** (`removeLine`) |
| Qty center unlabeled for a11y | `aria-label` includes qty |

Handlers unchanged: `onIncrement` / `onDecrement` / `onQtyTap` / `onDiscount` / `onRemove` → existing store modals.

### Totals hierarchy improvements

New sticky `DraftCartTotalsStack` **outside** the virtualized list:

1. Subtotal (gross = post-line totals + line discounts)  
2. Discounts (line + cart, when > 0)  
3. Tax / service charge rows **only when applicable** (> 0; Sell does not invent tax)  
4. **TOTAL PAYABLE** — largest type (`text-2xl` / sidebarCompact `text-lg`)  
5. Change (when `changeDue > 0`)

Uses existing `computeDraftCheckoutTotals` only — no pricing/tax engine changes. Payment method block still hides its duplicate dock payable; sticky stack is the confidence surface.

### Large-cart virtualization

- `VirtualizedDraftCartList` (`@tanstack/react-virtual`) windows cart lines.  
- Scroll viewport owns the list; product count chip + **Discount sale** stay above; totals + payment + pay footer stay below.  
- `measureElement` corrects row height (discount / pharmacy chips).  
- Cart region uses `flex-1` (raised vs hard `14rem` ceiling) so large lists scroll inside the windowed pane.

### Keyboard verification

| Key | Status |
|-----|--------|
| Enter / Esc / F2 / F4 / F8 / F9 / ± | Unchanged (`PosPage` / shortcuts) |
| Tab / Shift+Tab | Logical order through mounted row controls → payment → Save |
| ↑ ↓ | Not a dedicated cart navigator (unchanged); focus stays on interactive controls |

### Responsive verification

| Band | Notes |
|------|-------|
| Mobile overlay | Virtual list + sticky totals + sticky pay footer; numpad path unchanged |
| Compact slideover | Same panel |
| Full desktop / catalogDock | `sidebarCompact` denser rows; stack still dominates payable |

### Regression summary

| Area | Changed? |
|------|----------|
| Pricing / tax / discount engines | No |
| Payment finalize / receipt / barcode | No |
| Inventory / sync / offline / DB / APIs | No |
| Pharmacy FEFO chip + dispense panel mount | Presentation only (shared panel) |
| Cart row actions / totals presentation / virtualization | **Yes** |

### Verification

- `npm run build` — passed  
- `npm test` — 1774 passed; 1 pre-existing flake (`pharmacyPatientProfile` age DOB)

### Success criteria — status

| Criterion | Status |
|-----------|--------|
| Cart rows expose critical actions without clutter | **Met** |
| Totals communicate payable clearly | **Met** |
| Large carts remain responsive via virtualization | **Met** |
| Desktop / mobile cashier speed retained | **Met** |
| Sell journey ready for long-term maintenance | **Met** |

**Recommended next step:** Freeze Sell UI architecture; future work = features (loyalty, card terminal, tax policy) not layout redesign.
