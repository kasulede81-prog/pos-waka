# Checkout denomination picker — Phase A

## 1. Scope

Phase A is a **tender-entry helper** on the existing desktop/web cash keypad.

On the catalog cash window (Cash customer gave + keypad), the cashier taps Ugandan banknotes:

- 50,000
- 20,000
- 10,000
- 5,000
- 2,000
- 1,000

Each tap **adds** that note to the existing `cashInput` string. All payment math, change, save, finalize, drawer, sync, and inventory stay on the existing path:

`note tap → cashInput → parseDisplayMoney → totalPaidInput → changeDue → finishSale → finalizeDraftSale`

## 2. Explicit non-goals

- Not a cash-drawer composition system
- Note counts are not persisted
- Tender composition is not stored on the sale
- Drawer composition is not tracked
- Change-note availability is not calculated
- No sale schema, migrations, sync, inventory, or payment-math changes
- No mobile / Android / iOS checkout changes
- No checkout UI redesign

## 3. Platform / component boundary

Existing POS layout bands (`src/lib/posLayoutMode.ts` / `src/lib/responsiveBreakpoints.ts`):

| Band | Width | Checkout shell |
|------|--------|----------------|
| `mobile` | ≤767px | `PosCheckoutPanel` overlay (`shouldMountMobileCheckoutOverlay`) |
| `compact` | 768–1023px | `PosCompactCheckoutSlideover` |
| `full` | ≥1024px | Desktop sidebar + `PosDesktopCatalogCheckoutDock` |
| Electron | `isDesktopPosTerminal()` | Same split catalog + dock as full desktop |

The picker is **only** rendered inside `PosDesktopCatalogCheckoutDock`, which `PosPage` mounts when `useDesktopCatalogCheckoutDock` is true (full desktop or Electron split) **and** the catalog cash keypad is open.

That is the existing desktop/large-screen cash window. Compact tablet and web mobile never mount this dock.

## 4. Files changed

- `src/lib/cashDenominations.ts` — `UGX_CHECKOUT_NOTE_DENOMINATIONS`, `addDenominationToCashInput` (counting list `UGX_DENOMINATIONS` unchanged)
- `src/lib/cashDenominations.test.ts` — helper + counting-list protection
- `src/components/pos/CheckoutNotePicker.tsx` — compact 6-note row
- `src/components/pos/PosDesktopCatalogCheckoutDock.tsx` — row under cash amount, above keypad, cash only
- `src/pages/PosPage.tsx` — `addCheckoutCashNote` writes `cashInput` only
- `docs/CHECKOUT_DENOMINATION_PICKER_PHASE_A.md` — this note

Unchanged: `PosCompactCheckoutSlideover.tsx`, `PosCheckoutPanel` overlay/mobile, Android/iOS, migrations, `finalizeDraftSale`, drawer ledger, `cloudSync`.

## 5. How taps feed `cashInput`

`PosPage.addCheckoutCashNote(ugx)`:

1. Focuses the cash field (`checkoutAmountField = "cash"`)
2. `setCashInput(prev => addDenominationToCashInput(prev, ugx))`

`addDenominationToCashInput` parses digits from the current string, adds the integer note value, and writes a digit string (same 10-digit cap as the keypad). It does **not** append digits (tapping 50,000 on a 10,000 amount becomes 60,000, not `1000050000`).

Keypad, hardware keys, backspace, and Clear still mutate `cashInput` as before. `cashInput` remains the only tender source of truth. There is no `noteCounts` state.

## 6. Why no sale schema / database changes

The helper only changes how the cashier arrives at the existing `cashInput`. `finishSale` still passes `amountPaidUgx: totalPaidInput` and `changeGivenUgx: changeDue` into `finalizeDraftSale`. Cloud payload and drawer expected cash are untouched.

## 7. How mobile / Android / iOS were protected

- No changes to mobile overlay, compact slideover, or native shells
- No new global breakpoints or shared CSS
- `CheckoutNotePicker` is imported only by `PosDesktopCatalogCheckoutDock`
- `CashDenominationCountField` still iterates `UGX_DENOMINATIONS` (includes 100,000 and coins)

## 8. Verification

- `npx vitest run src/lib/cashDenominations.test.ts src/lib/posCheckoutKeypad.test.ts src/lib/posCheckoutMount.test.ts`
- Helper cases: 50k+20k, repeated 10k, 5k+2k+1k, add onto manual amount, integer-only, empty input still exact-payable when helper unused
- Counting list still includes 100,000 / 500 / 200 / 100
- Mount tests still keep compact/mobile exclusive of the desktop dock

Browser/device UI pass was not run from this session (no POS browser automation). Confirm on Windows web ≥1024px and Electron: open cash keypad, tap notes, confirm amount and change; on a phone-width window confirm the picker is absent.

## 9. Known limitations

- Note counts are not persisted
- Tender composition is not stored
- Drawer composition is not tracked
- Change-note availability is not calculated
- This is a checkout tender-entry helper only
