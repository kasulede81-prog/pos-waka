import { describe, expect, it } from "vitest";
import { buildDailyReportText } from "./reportExport";
import { buildDailyReportPdfBlob } from "./dailyReportPdf";
import type { Product, Sale } from "../types";

const product: Product = {
  id: "p1",
  name: "Item",
  sellingMode: "unit",
  category: "General",
  sellingPricePerUnitUgx: 1000,
  costPricePerUnitUgx: 600,
  stockOnHand: 10,
  baseUnit: "pcs",
  minimumStockAlert: 2,
  sku: "P1",
  updatedAt: "2026-01-01",
  version: 1,
};

const sale: Sale = {
  id: "s1",
  createdAt: "2026-06-02T10:00:00.000Z",
  lines: [
    {
      productId: "p1",
      name: "Item",
      quantity: 1,
      unitPriceUgx: 1000,
      unitCostUgx: 600,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 400,
      inputMode: "quantity",
      voided: false,
    },
  ],
  subtotalUgx: 1000,
  totalUgx: 1000,
  cashPaidUgx: 1000,
  debtUgx: 0,
  discountTotalUgx: 0,
  estimatedProfitUgx: 400,
  pendingSync: false,
  status: "completed",
};

describe("reportExport", () => {
  it("builds daily report plain text", () => {
    const text = buildDailyReportText("en", "2026-06-02", [sale], [product], [], [], []);
    expect(text).toContain("UGX");
    expect(text).toContain("2026-06-02");
  });

  it("builds daily report PDF blob", () => {
    const blob = buildDailyReportPdfBlob({
      lang: "en",
      dateKey: "2026-06-02",
      shopName: "Shop",
      sales: [sale],
      products: [product],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [{ productId: "p1", name: "Item", quantity: 1, revenueUgx: 1000, profitUgx: 400 }],
    });
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(500);
  });
});
