import { describe, expect, it } from "vitest";
import { buildRestaurantReceiptEscPos, buildRestaurantReceiptLines } from "./restaurantReceiptPrint";
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

  it("builds 58mm ESC/POS without clipping long names", () => {
    const longSale = {
      ...baseSale,
      lines: [
        {
          ...baseSale.lines[0],
          name: "House Special Grilled Chicken With Extra Garden Salad And Chips",
        },
      ],
    };
    const bytes = buildRestaurantReceiptEscPos(
      {
        sale: longSale,
        products: [],
        prefs: basePrefs,
        lang: "en",
        tableLabel: "Table 12",
        waiterLabel: "Jane",
        receiptKind: "master",
      },
      "58mm",
    );
    const text = decodeEscPosAscii(bytes);
    expect(text).toContain("CAFE WAKA");
    expect(text).toContain("House Special");
    expect(text).toContain("Grilled Chicken");
    expect(text).toContain("TOTAL");
    expect(text).toContain("UGX");
    expect(text.split("\n").filter(Boolean).every((line) => line.length <= 32)).toBe(true);
    expect(hasPartialCut(bytes)).toBe(false);
    expect(bytes.includes(0x0c)).toBe(false);
  });
});

function decodeEscPosAscii(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      const next = bytes[i + 1];
      if (next === 0x40) {
        i += 1;
        continue;
      }
      if (next === 0x74 || next === 0x61 || next === 0x45 || next === 0x64) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x1d) {
      const next = bytes[i + 1];
      if (next === 0x21) {
        i += 2;
        continue;
      }
      if (next === 0x56) {
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (b === 0x0a) {
      out += "\n";
      continue;
    }
    if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
  }
  return out;
}

function hasPartialCut(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x42 && bytes[i + 3] === 0x03) return true;
  }
  return false;
}
