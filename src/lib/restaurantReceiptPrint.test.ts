import { describe, expect, it } from "vitest";
import { buildRestaurantReceiptLines } from "./restaurantReceiptPrint";
import type { Sale, ShopPreferences } from "../types";

const basePrefs = {
  shopDisplayName: "Cafe Waka",
  hospitalityServiceChargePercent: 10,
  hospitalityTaxPercent: 0,
} as ShopPreferences;

const baseSale: Sale = {
  id: "sale-12345678",
  referenceLabel: "T12",
  createdAt: "2026-06-01T14:30:00.000Z",
  status: "completed",
  subtotalUgx: 5000,
  totalUgx: 5000,
  cashPaidUgx: 5000,
  debtUgx: 0,
  discountTotalUgx: 0,
  estimatedProfitUgx: 4000,
  pendingSync: false,
  lines: [
    {
      id: "line-1",
      productId: "p1",
      name: "Coffee",
      inputMode: "quantity",
      quantity: 2,
      unitPriceUgx: 2500,
      unitCostUgx: 500,
      lineTotalUgx: 5000,
      estimatedProfitUgx: 4000,
      updatedAt: "2026-06-01T14:30:00.000Z",
    },
  ],
};

describe("buildRestaurantReceiptLines", () => {
  it("includes commercial certification fields", () => {
    const lines = buildRestaurantReceiptLines({
      sale: baseSale,
      products: [],
      prefs: basePrefs,
      lang: "en",
      tableLabel: "Table 12",
      waiterLabel: "Jane",
      guestCount: 4,
      cashierLabel: "Cashier 1",
      printedBy: "Cashier 1",
      businessDate: "2026-06-01",
      orderRound: 2,
      receiptKind: "master",
    });
    const text = lines.join("\n");
    expect(text).toContain("CAFE WAKA");
    expect(text).toContain("Table 12");
    expect(text).toContain("Jane");
    expect(text).toContain("Guests");
    expect(text).toContain("Order round");
    expect(text).toContain("Business date");
    expect(text).toContain("Printed by");
    expect(text).toContain("MASTER RECEIPT");
    expect(text).toContain("TOTAL");
  });

  it("marks void and reprint receipts", () => {
    const voidLines = buildRestaurantReceiptLines({
      sale: baseSale,
      products: [],
      prefs: basePrefs,
      lang: "en",
      receiptKind: "void",
      voidReason: "Wrong table",
    });
    expect(voidLines.join("\n")).toContain("VOID");

    const reprintLines = buildRestaurantReceiptLines({
      sale: baseSale,
      products: [],
      prefs: basePrefs,
      lang: "en",
      receiptKind: "reprint",
    });
    expect(reprintLines.join("\n")).toContain("REPRINT");
  });
});
