import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { saleReportingDayKey } from "./datesUg";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { getCompletedFinancials } from "./financialMetrics";
import {
  advancePackCostUnitsDepleted,
  applyPackSlotCostsToSaleLine,
  inventoryLineValueAtCostUgx,
  lineCostForProductQuantity,
  retractPackCostUnitsDepleted,
  unitCostFromPackTotal,
} from "./costPrecision";

const PACK_COST = 20_000;
const UNITS = 24;
const SELL_PRICE = 1_000;

function crateProduct(stock = UNITS, depleted = 0): Product {
  return {
    id: "prod-crate",
    name: "Soda",
    sellingMode: "unit",
    baseUnit: "piece",
    buyingUnit: "crate",
    conversionRate: UNITS,
    sellingPricePerUnitUgx: SELL_PRICE,
    costPricePerUnitUgx: unitCostFromPackTotal(PACK_COST, UNITS),
    buyingPackCostUgx: PACK_COST,
    packCostUnitsDepleted: depleted,
    stockOnHand: stock,
    minimumStockAlert: 5,
    category: "Drinks",
    sku: "SKU-1",
    updatedAt: "2026-06-19T08:00:00.000Z",
    version: 1,
  };
}

function simulateUnitSale(product: Product, day: string, hour: number): { product: Product; line: SaleLine } {
  const slotStart = product.packCostUnitsDepleted ?? 0;
  const lineTotalUgx = SELL_PRICE;
  const slotCosts = applyPackSlotCostsToSaleLine(product, { quantity: 1, lineTotalUgx }, slotStart);
  const line: SaleLine = {
    productId: product.id,
    name: product.name,
    inputMode: "quantity",
    quantity: 1,
    unitPriceUgx: SELL_PRICE,
    unitCostUgx: slotCosts.unitCostUgx,
    lineTotalUgx,
    estimatedProfitUgx: slotCosts.estimatedProfitUgx,
    moneyAmountUgx: null,
  };
  const next: Product = {
    ...product,
    stockOnHand: product.stockOnHand - 1,
    packCostUnitsDepleted: advancePackCostUnitsDepleted(product.packCostUnitsDepleted, 1),
    updatedAt: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    version: product.version + 1,
  };
  return { product: next, line };
}

function saleFromLine(line: SaleLine, day: string, hour: number): Sale {
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    lines: [line],
    totalUgx: line.lineTotalUgx,
    subtotalUgx: line.lineTotalUgx,
    cashPaidUgx: line.lineTotalUgx,
    debtUgx: 0,
    estimatedProfitUgx: line.estimatedProfitUgx,
    pendingSync: false,
    soldByUserId: "u1",
  };
}

describe("cost allocation completeness — 24 individual sales", () => {
  it("cumulative COGS equals pack cost with zero profit drift", () => {
    let product = crateProduct();
    const lines: SaleLine[] = [];
    let totalCogs = 0;
    let totalProfit = 0;

    for (let i = 0; i < UNITS; i++) {
      const day = i < 12 ? "2026-06-19" : "2026-06-20";
      const hour = 10 + (i % 12);
      const slotStart = product.packCostUnitsDepleted ?? 0;
      const cogs = lineCostForProductQuantity(product, 1, undefined, slotStart);
      const { product: next, line } = simulateUnitSale(product, day, hour);
      product = next;
      lines.push(line);
      totalCogs += cogs;
      totalProfit += line.estimatedProfitUgx;
    }

    expect(totalCogs).toBe(PACK_COST);
    expect(totalProfit).toBe(UNITS * SELL_PRICE - PACK_COST);
    expect(product.stockOnHand).toBe(0);
    expect(product.packCostUnitsDepleted).toBe(UNITS);
    expect(inventoryLineValueAtCostUgx(product)).toBe(0);
  });

  it("profit reports stay exact across multiple days", () => {
    let product = crateProduct();
    const sales: Sale[] = [];

    for (let i = 0; i < UNITS; i++) {
      const day = i < 12 ? "2026-06-19" : "2026-06-20";
      const hour = 2 + (i % 12);
      const { product: next, line } = simulateUnitSale(product, day, hour);
      product = next;
      sales.push(saleFromLine(line, day, hour));
    }

    const map = new Map([[product.id, product]]);
    const day1Sales = sales.filter((s) => saleReportingDayKey(s) === "2026-06-19");
    const day2Sales = sales.filter((s) => saleReportingDayKey(s) === "2026-06-20");
    const day1 = computeTodayProfitBreakdown(day1Sales, map);
    const day2 = computeTodayProfitBreakdown(day2Sales, map);

    expect(day1.costUgx + day2.costUgx).toBe(PACK_COST);
    expect(day1.profitUgx + day2.profitUgx).toBe(UNITS * SELL_PRICE - PACK_COST);

    const fin19 = getCompletedFinancials(sales, [], [product], { day: "2026-06-19" });
    const fin20 = getCompletedFinancials(sales, [], [product], { day: "2026-06-20" });
    expect(fin19.profitUgx + fin20.profitUgx).toBe(UNITS * SELL_PRICE - PACK_COST);
  });

  it("return restock retracts depleted and preserves allocation integrity", () => {
    let product = crateProduct();
    const { product: afterSale, line } = simulateUnitSale(product, "2026-06-19", 10);
    product = afterSale;

    const restored: Product = {
      ...product,
      stockOnHand: product.stockOnHand + 1,
      packCostUnitsDepleted: retractPackCostUnitsDepleted(product.packCostUnitsDepleted, 1),
    };

    expect(restored.packCostUnitsDepleted).toBe(0);
    expect(inventoryLineValueAtCostUgx(restored)).toBe(PACK_COST);

    const reSale = simulateUnitSale(restored, "2026-06-19", 11);
    expect(reSale.line.estimatedProfitUgx).toBe(line.estimatedProfitUgx);
    expect(lineCostForProductQuantity(restored, 1)).toBe(
      lineCostForProductQuantity(crateProduct(), 1, undefined, 0),
    );
  });
});
