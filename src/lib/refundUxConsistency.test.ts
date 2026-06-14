import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import {
  buildLineRefundBreakdown,
  buildRefundDisplayConsistencyReport,
  customerPaidUgxForSaleLine,
} from "./refundBreakdown";
import { receiptLineDetailLabel, buildReceiptDisplayData } from "./receiptPrint";
import { suggestReturnRefundUgx } from "./returnLimits";

function mkLine(productId: string, name: string, lineTotal: number): SaleLine {
  return {
    id: `line-${productId}`,
    productId,
    name,
    quantity: 1,
    unitPriceUgx: lineTotal,
    unitCostUgx: 100,
    lineTotalUgx: lineTotal,
    estimatedProfitUgx: lineTotal - 100,
    inputMode: "quantity",
  };
}

/** Pepes 1,000 + Super 2,500, cart discount 1,000 → paid 2,500. Pepes paid share = 714. */
function pepesSuperSale(): Sale {
  return {
    id: "sale-mix",
    status: "completed",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    subtotalUgx: 3500,
    totalUgx: 2500,
    cashPaidUgx: 2500,
    debtUgx: 0,
    estimatedProfitUgx: 2000,
    lines: [mkLine("pepes", "Pepes", 1000), mkLine("super", "Super", 2500)],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

describe("refundUxConsistency — Pepes + Super cart discount", () => {
  const sale = pepesSuperSale();

  it("sales history customer paid matches refund engine for Pepes", () => {
    const paid = customerPaidUgxForSaleLine(sale, sale.lines[0]!);
    expect(paid.listPriceUgx).toBe(1000);
    expect(paid.customerPaidUgx).toBe(714);
    expect(paid.showPaidBreakdown).toBe(true);
  });

  it("return modal breakdown matches customer paid", () => {
    const suggested = suggestReturnRefundUgx(sale, "pepes", 1, []);
    expect(suggested).toBe(714);
    const bd = buildLineRefundBreakdown({ sale, productId: "pepes", returnQty: 1, returnRecords: [] });
    expect(bd!.customerPaidUgx).toBe(714);
    expect(bd!.cartDiscountAllocationUgx).toBe(286);
  });

  it("receipt PDF line label shows list and paid", () => {
    const display = buildReceiptDisplayData({
      shopName: "Test Shop",
      cashier: "Jane",
      receiptNumber: "001",
      sale,
    });
    const pepesLine = display.lines.find((l) => l.name === "Pepes");
    expect(pepesLine?.showCustomerPaid).toBe(true);
    expect(pepesLine?.listPriceUgx).toBe(1000);
    expect(pepesLine?.customerPaidUgx).toBe(714);
    expect(receiptLineDetailLabel(pepesLine!)).toContain("714");
    expect(receiptLineDetailLabel(pepesLine!)).toContain("1,000");
  });

  it("consistency report aligns customer paid across surfaces", () => {
    const report = buildRefundDisplayConsistencyReport({
      sale,
      productId: "pepes",
      returnQty: 1,
      returnRecords: [],
      finalRefundUgx: 714,
    });
    const history = report.find((r) => r.surface === "sales_history");
    const modal = report.find((r) => r.surface === "return_modal");
    expect(history?.customerPaidUgx).toBe(714);
    expect(modal?.customerPaidUgx).toBe(714);
    expect(modal?.refundUgx).toBe(714);
  });
});

describe("refundUxConsistency — no duplicate formulas", () => {
  it("breakdown customer paid equals suggestReturnRefundUgx", () => {
    const sale = pepesSuperSale();
    const suggested = suggestReturnRefundUgx(sale, "pepes", 1, []);
    const bd = buildLineRefundBreakdown({ sale, productId: "pepes", returnQty: 1, returnRecords: [] });
    expect(bd!.customerPaidUgx).toBe(suggested);
  });
});
