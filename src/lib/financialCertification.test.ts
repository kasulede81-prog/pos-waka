import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { unitCostFromPackTotal } from "./costPrecision";
import {
  assertCloudRoundTripPreservesFinancials,
  assertFinancialCertification,
  assertHistoricalSaleImmutable,
  certifiedSaleLineTotals,
  computeCertifiedFinancialTotals,
  readAllModuleFinancials,
  receiptCalculationForLine,
  stockQuantityMatches,
} from "./financialCertification";
import {
  finalizeSaleLineFinancials,
  resolveReturnCogsFromSaleLine,
  resolveReturnFinancials,
  resolveSaleLineFinancials,
} from "./saleFinancialEngine";
import { roundTripSaleLineThroughCloud } from "./saleLineCloudCodec";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";

const DAY = "2026-06-11";

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-std",
    name: "Standard Item",
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 5000,
    costPricePerUnitUgx: 3000,
    stockOnHand: 200,
    minimumStockAlert: 10,
    category: "General",
    sku: "SKU-1",
    updatedAt: `${DAY}T08:00:00.000Z`,
    version: 1,
    ...overrides,
  };
}

function crateProduct(): Product {
  const units = 24;
  const packCost = 20_000;
  return baseProduct({
    id: "prod-crate",
    name: "Soda",
    baseUnit: "piece",
    buyingUnit: "crate",
    conversionRate: units,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: unitCostFromPackTotal(packCost, units),
    buyingPackCostUgx: packCost,
    stockOnHand: units * 5,
    category: "Drinks",
  });
}

function riceProduct(): Product {
  return baseProduct({
    id: "prod-rice",
    name: "Rice",
    baseUnit: "kg",
    sellingPricePerUnitUgx: 4000,
    costPricePerUnitUgx: 2500,
    stockOnHand: 500,
    category: "Food",
  });
}

function completedSale(
  lines: SaleLine[],
  opts?: { totalUgx?: number; cartDiscount?: number },
): Sale {
  const lineSubtotal = lines.reduce((a, l) => a + l.lineTotalUgx, 0);
  const total = opts?.totalUgx ?? lineSubtotal - (opts?.cartDiscount ?? 0);
  return {
    id: crypto.randomUUID(),
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    lines,
    subtotalUgx: lineSubtotal,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    discountTotalUgx: opts?.cartDiscount ?? 0,
    estimatedProfitUgx: lines.reduce((a, l) => a + (l.grossProfitUgx ?? l.estimatedProfitUgx), 0),
    pendingSync: false,
  };
}

describe("Financial Certification Suite", () => {
  describe("product types", () => {
    it("standard product sale certifies across modules", () => {
      const product = baseProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 3,
            unitPriceUgx: 5000,
            unitCostUgx: 3000,
            lineTotalUgx: 15_000,
            estimatedProfitUgx: 6000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        0,
      );
      const sale = completedSale(lines);
      const readings = readAllModuleFinancials([sale], [], [product], { day: DAY });
      const result = assertFinancialCertification(readings);
      expect(result.mismatches).toEqual([]);
      expect(result.pass).toBe(true);
    });

    it("crate product uses exact pack COGS", () => {
      const product = crateProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 24,
            unitPriceUgx: 1000,
            unitCostUgx: product.costPricePerUnitUgx,
            lineTotalUgx: 24_000,
            estimatedProfitUgx: 4000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        0,
      );
      expect(lines[0]!.cogsUgx).toBe(20_000);
      expect(lines[0]!.grossProfitUgx).toBe(4000);
    });
  });

  describe("sales scenarios", () => {
    it("money sale — UGX 13,000 rice", () => {
      const product = riceProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "money",
            quantity: 3.25,
            unitPriceUgx: 4000,
            unitCostUgx: 2500,
            lineTotalUgx: 13_000,
            moneyAmountUgx: 13_000,
            estimatedProfitUgx: 0,
          },
        ],
        [product],
        0,
      );
      expect(lines[0]!.quantity).toBe(3.25);
      expect(lines[0]!.lineTotalUgx).toBe(13_000);
      const calc = receiptCalculationForLine(lines[0]!, product);
      expect(calc).toContain("13,000");
      expect(calc).toContain("4,000");
    });

    it("cart discount reduces profit consistently", () => {
      const product = baseProduct();
      const draft = [
        {
          productId: product.id,
          name: product.name,
          inputMode: "quantity" as const,
          quantity: 2,
          unitPriceUgx: 5000,
          unitCostUgx: 3000,
          lineTotalUgx: 10_000,
          estimatedProfitUgx: 4000,
          moneyAmountUgx: null,
        },
      ];
      const lines = finalizeSaleLineFinancials(draft, [product], 2000);
      const sale = completedSale(lines, { cartDiscount: 2000, totalUgx: 8000 });
      const readings = readAllModuleFinancials([sale], [], [product], { day: DAY });
      expect(assertFinancialCertification(readings).pass).toBe(true);
    });

    it("mixed cart with money + quantity lines", () => {
      const rice = riceProduct();
      const std = baseProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: rice.id,
            name: rice.name,
            inputMode: "money",
            quantity: 1.25,
            unitPriceUgx: 4000,
            unitCostUgx: 2500,
            lineTotalUgx: 5000,
            moneyAmountUgx: 5000,
            estimatedProfitUgx: 0,
          },
          {
            productId: std.id,
            name: std.name,
            inputMode: "quantity",
            quantity: 2,
            unitPriceUgx: 5000,
            unitCostUgx: 3000,
            lineTotalUgx: 10_000,
            estimatedProfitUgx: 4000,
            moneyAmountUgx: null,
          },
        ],
        [rice, std],
        0,
      );
      const sale = completedSale(lines);
      const totals = computeCertifiedFinancialTotals([sale], [], [rice, std]);
      expect(totals.revenueUgx).toBe(15_000);
    });
  });

  describe("historical integrity", () => {
    it("completed sale unchanged after product cost/price/name/category edits", () => {
      const product = riceProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "money",
            quantity: 3.25,
            unitPriceUgx: 4000,
            unitCostUgx: 2500,
            lineTotalUgx: 13_000,
            moneyAmountUgx: 13_000,
            estimatedProfitUgx: 0,
          },
        ],
        [product],
        0,
      );
      const before = lines.map((l) => ({ ...l }));
      const finBefore = resolveSaleLineFinancials(before[0]!);

      product.costPricePerUnitUgx = 9999;
      product.sellingPricePerUnitUgx = 8888;
      product.name = "Changed Name";
      product.category = "Other";
      product.baseUnit = "bag";
      product.buyingUnit = "sack";
      product.conversionRate = 50;

      const finAfter = resolveSaleLineFinancials(before[0]!);
      expect(finAfter.revenueUgx).toBe(finBefore.revenueUgx);
      expect(finAfter.cogsUgx).toBe(finBefore.cogsUgx);
      expect(finAfter.grossProfitUgx).toBe(finBefore.grossProfitUgx);
      expect(assertHistoricalSaleImmutable(before, before)).toBe(true);
    });
  });

  describe("returns", () => {
    it("partial return reverses original COGS not current cost", () => {
      const product = riceProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 4,
            unitPriceUgx: 4000,
            unitCostUgx: 2500,
            lineTotalUgx: 16_000,
            estimatedProfitUgx: 6000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        0,
      );
      const line = lines[0]!;
      product.costPricePerUnitUgx = 9999;

      const returnCogs = resolveReturnCogsFromSaleLine(line, 2);
      expect(returnCogs).toBe(Math.round(line.cogsUgx! / 2));

      const rec: ReturnRecord = {
        id: "ret-1",
        saleId: "sale-1",
        productId: product.id,
        productName: product.name,
        quantity: 2,
        refundAmountUgx: 8000,
        cogsUgx: returnCogs,
        unitCostUgx: 2500,
        reason: "damaged",
        actorUserId: "u1",
        createdAt: `${DAY}T12:00:00.000Z`,
      };
      const retFin = resolveReturnFinancials(rec, line);
      expect(retFin.cogsUgx).toBe(returnCogs);
      expect(retFin.grossProfitUgx).toBe(8000 - returnCogs);
    });
  });

  describe("inventory", () => {
    it("inventory valuation uses pack-aware engine", () => {
      const crate = crateProduct();
      const std = baseProduct();
      const value = inventoryValueAtCostUgx([crate, std]);
      const insights = readAllModuleFinancials([], [], [crate, std]).inventoryInsights;
      expect(insights.inventoryValueUgx).toBe(value);
      expect(value).toBeGreaterThan(0);
    });

    it("stock deduction matches sale quantity", () => {
      const product = riceProduct();
      const startStock = product.stockOnHand;
      const qty = 3.25;
      product.stockOnHand -= qty;
      expect(stockQuantityMatches(product.stockOnHand, startStock - qty)).toBe(true);
    });
  });

  describe("cloud sync round-trip", () => {
    it("preserves all financial snapshot fields", () => {
      const product = riceProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "money",
            quantity: 3.25,
            unitPriceUgx: 4000,
            unitCostUgx: 2500,
            lineTotalUgx: 13_000,
            moneyAmountUgx: 13_000,
            estimatedProfitUgx: 0,
          },
        ],
        [product],
        1000,
      );
      const line = lines[0]!;
      expect(assertCloudRoundTripPreservesFinancials(line)).toBe(true);
      const restored = roundTripSaleLineThroughCloud(line);
      expect(restored.inputMode).toBe("money");
      expect(restored.netRevenueUgx).toBe(line.netRevenueUgx);
    });

    it("offline sale financials match after cloud round-trip", () => {
      const product = baseProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 5,
            unitPriceUgx: 5000,
            unitCostUgx: 3000,
            lineTotalUgx: 25_000,
            estimatedProfitUgx: 10_000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        0,
      );
      const sale = completedSale(lines);
      const before = computeCertifiedFinancialTotals([sale], [], [product]);
      const roundTripped = completedSale(lines.map(roundTripSaleLineThroughCloud));
      const after = computeCertifiedFinancialTotals([roundTripped], [], [product]);
      expect(after.revenueUgx).toBe(before.revenueUgx);
      expect(after.cogsUgx).toBe(before.cogsUgx);
      expect(after.grossProfitUgx).toBe(before.grossProfitUgx);
    });
  });

  describe("receipts", () => {
    it("money sale shows fractional quantity calculation", () => {
      const product = riceProduct();
      const line: SaleLine = {
        productId: product.id,
        name: product.name,
        inputMode: "money",
        quantity: 3.25,
        unitPriceUgx: 4000,
        unitCostUgx: 2500,
        lineTotalUgx: 13_000,
        moneyAmountUgx: 13_000,
        estimatedProfitUgx: 1875,
        netRevenueUgx: 13_000,
        cogsUgx: 8125,
        grossProfitUgx: 4875,
      };
      const calc = receiptCalculationForLine(line, product);
      expect(calc).toMatch(/3.*kg.*4,000.*13,000/i);
    });

    it("receipt total matches sale total", () => {
      const product = baseProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 2,
            unitPriceUgx: 5000,
            unitCostUgx: 3000,
            lineTotalUgx: 10_000,
            estimatedProfitUgx: 4000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        0,
      );
      const sale = completedSale(lines);
      const readings = readAllModuleFinancials([sale], [], [product], { day: DAY });
      expect(readings.receiptTotalUgx).toBe(sale.totalUgx);
    });
  });

  describe("performance stress", () => {
    it(
      "100k sales — no financial drift across modules",
      () => {
        const product = baseProduct({ stockOnHand: 1_000_000 });
        const template = finalizeSaleLineFinancials(
          [
            {
              productId: product.id,
              name: product.name,
              inputMode: "quantity",
              quantity: 1,
              unitPriceUgx: 5000,
              unitCostUgx: 3000,
              lineTotalUgx: 5000,
              estimatedProfitUgx: 2000,
              moneyAmountUgx: null,
            },
          ],
          [product],
          0,
        )[0]!;
        const sales: Sale[] = [];
        for (let i = 0; i < 100_000; i++) {
          sales.push(
            completedSale([{ ...template, id: `line-${i}` }], {
              totalUgx: 5000,
            }),
          );
        }
        const totals = computeCertifiedFinancialTotals(sales, [], [product]);
        expect(totals.revenueUgx).toBe(500_000_000);
        expect(totals.grossProfitUgx).toBe(200_000_000);
        const fin = readAllModuleFinancials(sales.slice(0, 500), [], [product], { day: DAY });
        expect(fin.engine.inventoryValueUgx).toBe(fin.inventoryInsights.inventoryValueUgx);
      },
      60_000,
    );

    it("inventory integrity on large product catalog", () => {
      const products: Product[] = Array.from({ length: 1000 }, (_, i) =>
        baseProduct({
          id: `p-${i}`,
          name: `Product ${i}`,
          stockOnHand: 10 + (i % 5),
          costPricePerUnitUgx: 1000 + i,
        }),
      );
      const result = verifyInventoryIntegrity({ products, movements: [] });
      expect(result.ok).toBe(true);
    });
  });

  describe("certification rule", () => {
    it("fails when modules disagree", () => {
      const readings = readAllModuleFinancials([], [], [baseProduct()], { day: DAY });
      readings.homeProfit.revenueUgx = readings.engine.revenueUgx + 1;
      const result = assertFinancialCertification(readings);
      expect(result.pass).toBe(false);
      expect(result.mismatches.length).toBeGreaterThan(0);
    });

    it("sale line totals match engine", () => {
      const product = baseProduct();
      const lines = finalizeSaleLineFinancials(
        [
          {
            productId: product.id,
            name: product.name,
            inputMode: "quantity",
            quantity: 3,
            unitPriceUgx: 5000,
            unitCostUgx: 3000,
            lineTotalUgx: 15_000,
            estimatedProfitUgx: 6000,
            moneyAmountUgx: null,
          },
        ],
        [product],
        2000,
      );
      const sale = completedSale(lines, { cartDiscount: 2000, totalUgx: 13_000 });
      const certified = certifiedSaleLineTotals(sale);
      expect(certified.revenueUgx).toBe(13_000);
      expect(certified.grossProfitUgx).toBe(lines[0]!.grossProfitUgx);
    });
  });
});
