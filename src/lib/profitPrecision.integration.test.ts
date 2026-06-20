import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { getCompletedFinancials } from "./financialMetrics";
import { unitCostFromPackTotal } from "./costPrecision";

const DAY = "2026-06-19";

function crateProduct(): Product {
  const units = 24;
  const packCost = 20_000;
  return {
    id: "prod-crate",
    name: "Soda",
    sellingMode: "unit",
    baseUnit: "piece",
    buyingUnit: "crate",
    conversionRate: units,
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
    buyingPackCostUgx: packCost,
    stockOnHand: units,
    minimumStockAlert: 5,
    category: "Drinks",
    sku: "SKU-1",
    updatedAt: `${DAY}T08:00:00.000Z`,
    version: 1,
  };
}

function saleLine(qty: number, product: Product): SaleLine {
  const lineTotalUgx = qty * product.sellingPricePerUnitUgx;
  return {
    productId: product.id,
    name: product.name,
    inputMode: "quantity",
    quantity: qty,
    unitPriceUgx: product.sellingPricePerUnitUgx,
    unitCostUgx: product.costPricePerUnitUgx,
    lineTotalUgx,
    estimatedProfitUgx: lineTotalUgx - 20_000,
    moneyAmountUgx: null,
  };
}

function completedSale(lines: SaleLine[]): Sale {
  const totalUgx = lines.reduce((s, l) => s + l.lineTotalUgx, 0);
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    lines,
    totalUgx,
    subtotalUgx: totalUgx,
    cashPaidUgx: totalUgx,
    debtUgx: 0,
    estimatedProfitUgx: lines.reduce((s, l) => s + l.estimatedProfitUgx, 0),
    pendingSync: false,
    soldByUserId: "u1",
  };
}

describe("profit precision — crate breakdown", () => {
  it("full crate sale profit is 4_000 UGX (not phantom +8)", () => {
    const product = crateProduct();
    const map = new Map([[product.id, product]]);
    const sale = completedSale([saleLine(24, product)]);
    const breakdown = computeTodayProfitBreakdown([sale], map);
    expect(breakdown.salesUgx).toBe(24_000);
    expect(breakdown.costUgx).toBe(20_000);
    expect(breakdown.profitUgx).toBe(4_000);
  });

  it("matches getCompletedFinancials profit", () => {
    const product = crateProduct();
    const sale = completedSale([saleLine(24, product)]);
    const fin = getCompletedFinancials([sale], [], [product], { day: DAY });
    expect(fin.profitUgx).toBe(4_000);
  });
});
