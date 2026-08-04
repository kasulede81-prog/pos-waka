import { describe, expect, it } from "vitest";
import { computeDraftCheckoutTotals } from "../../lib/draftCart";
import type { SaleLine } from "../../types";

function line(partial: Partial<SaleLine> & Pick<SaleLine, "productId" | "lineTotalUgx">): SaleLine {
  return {
    name: "Item",
    quantity: 1,
    unitPriceUgx: partial.lineTotalUgx,
    unitCostUgx: 0,
    estimatedProfitUgx: 0,
    ...partial,
  } as SaleLine;
}

describe("Phase 33.1 draft totals hierarchy inputs", () => {
  it("exposes subtotal, line discount, cart discount, and payable for the stack", () => {
    const totals = computeDraftCheckoutTotals(
      [
        line({
          productId: "a",
          lineTotalUgx: 8000,
          originalLineTotalUgx: 10000,
        }),
        line({ productId: "b", lineTotalUgx: 5000 }),
      ],
      1000,
    );

    const grossSubtotal = totals.lineSubtotalUgx + totals.lineDiscountUgx;
    const totalDiscount = totals.lineDiscountUgx + totals.cartDiscountUgx;

    expect(grossSubtotal).toBe(15000);
    expect(totalDiscount).toBe(3000);
    expect(totals.payableUgx).toBe(12000);
    expect(grossSubtotal - totalDiscount).toBe(totals.payableUgx);
  });
});
