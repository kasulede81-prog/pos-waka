import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { unitCostFromPackTotal } from "./costPrecision";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { getCompletedFinancials } from "./financialMetrics";
import {
  allocateCartDiscountUgx,
  applyCartDiscountSnapshot,
  ensureMoneySaleQuantity,
  finalizeSaleLineFinancials,
  resolveReturnCogsFromSaleLine,
  resolveReturnFinancials,
  resolveSaleLineFinancials,
  saleEstimatedProfitUgx,
} from "./saleFinancialEngine";

const DAY = "2026-06-11";

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-rice",
    name: "Rice",
    sellingMode: "unit",
    baseUnit: "kg",
    sellingPricePerUnitUgx: 4000,
    costPricePerUnitUgx: 2500,
    stockOnHand: 100,
    minimumStockAlert: 5,
    category: "Food",
    sku: "",
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
    stockOnHand: units,
  });
}

function draftLine(partial: Partial<SaleLine> & Pick<SaleLine, "lineTotalUgx">): SaleLine {
  return {
    productId: partial.productId ?? "prod-rice",
    name: partial.name ?? "Rice",
    inputMode: "quantity",
    quantity: partial.quantity ?? 1,
    unitPriceUgx: partial.unitPriceUgx ?? partial.lineTotalUgx,
    unitCostUgx: partial.unitCostUgx ?? 2500,
    estimatedProfitUgx: partial.estimatedProfitUgx ?? partial.lineTotalUgx - 2500,
    moneyAmountUgx: null,
    ...partial,
  };
}

function completedSale(lines: SaleLine[], totalUgx?: number, discountTotalUgx = 0): Sale {
  const lineSubtotal = lines.reduce((s, l) => s + l.lineTotalUgx, 0);
  const total = totalUgx ?? lineSubtotal;
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
    discountTotalUgx,
    estimatedProfitUgx: saleEstimatedProfitUgx(lines),
    pendingSync: false,
  };
}

describe("allocateCartDiscountUgx", () => {
  it("allocates proportionally with remainder on last line", () => {
    const shares = allocateCartDiscountUgx([10_000, 20_000], 3000);
    expect(shares[0]).toBe(1000);
    expect(shares[1]).toBe(2000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(3000);
  });
});

describe("money sale snapshot", () => {
  it("stores derived quantity at finalize", () => {
    const product = baseProduct();
    const line = draftLine({
      inputMode: "money",
      quantity: 13000,
      unitPriceUgx: 4000,
      lineTotalUgx: 13000,
      moneyAmountUgx: 13000,
      estimatedProfitUgx: 0,
    });
    const [snap] = finalizeSaleLineFinancials([line], [product], 0);
    expect(snap!.quantity).toBe(3.25);
    expect(snap!.lineTotalUgx).toBe(13000);
    expect(snap!.cogsUgx).toBe(Math.round(3.25 * 2500));
    expect(snap!.grossProfitUgx).toBe(snap!.netRevenueUgx! - snap!.cogsUgx!);
  });
});

describe("cart discount allocation", () => {
  it("reduces per-line profit when cart discount applied", () => {
    const product = baseProduct();
    const lines = [
      draftLine({ quantity: 2, unitPriceUgx: 4000, lineTotalUgx: 8000, estimatedProfitUgx: 3000 }),
      draftLine({ quantity: 1, unitPriceUgx: 4000, lineTotalUgx: 4000, estimatedProfitUgx: 1500 }),
    ];
    const snapshotted = finalizeSaleLineFinancials(lines, [product], 3000);
    const profit = saleEstimatedProfitUgx(snapshotted);
    const rawCogs = 7500;
    expect(snapshotted[0]!.cartDiscountUgx).toBe(2000);
    expect(snapshotted[1]!.cartDiscountUgx).toBe(1000);
    expect(snapshotted[0]!.netRevenueUgx).toBe(6000);
    expect(profit).toBe(12000 - 3000 - rawCogs);
  });
});

describe("crate / pack COGS", () => {
  it("full crate sale uses exact pack COGS", () => {
    const product = crateProduct();
    const line = draftLine({
      productId: product.id,
      name: product.name,
      quantity: 24,
      unitPriceUgx: 1000,
      lineTotalUgx: 24_000,
      unitCostUgx: product.costPricePerUnitUgx,
      estimatedProfitUgx: 4000,
    });
    const [snap] = finalizeSaleLineFinancials([line], [product], 0);
    expect(snap!.cogsUgx).toBe(20_000);
    expect(snap!.grossProfitUgx).toBe(4000);
  });
});

describe("returns use sale snapshot", () => {
  it("reverses original COGS not current product cost", () => {
    const product = baseProduct({ costPricePerUnitUgx: 9999 });
    const line = draftLine({
      quantity: 4,
      unitPriceUgx: 4000,
      lineTotalUgx: 16000,
      cogsUgx: 10000,
      netRevenueUgx: 16000,
      grossProfitUgx: 6000,
      estimatedProfitUgx: 6000,
    });
    const cogs = resolveReturnCogsFromSaleLine(line, 2);
    expect(cogs).toBe(5000);

    const rec: ReturnRecord = {
      id: "ret-1",
      saleId: "sale-1",
      productId: product.id,
      productName: product.name,
      quantity: 2,
      refundAmountUgx: 8000,
      cogsUgx: 5000,
      unitCostUgx: 2500,
      reason: "other",
      actorUserId: "u1",
      createdAt: `${DAY}T11:00:00.000Z`,
    };
    const fin = resolveReturnFinancials(rec, line);
    expect(fin.cogsUgx).toBe(5000);
    expect(fin.grossProfitUgx).toBe(3000);
  });
});

describe("reporting consistency", () => {
  it("dashboard profit matches financial metrics for snapshotted sale", () => {
    const product = crateProduct();
    const lines = finalizeSaleLineFinancials(
      [
        draftLine({
          productId: product.id,
          name: product.name,
          quantity: 24,
          unitPriceUgx: 1000,
          lineTotalUgx: 24_000,
          unitCostUgx: product.costPricePerUnitUgx,
          estimatedProfitUgx: 4000,
        }),
      ],
      [product],
      0,
    );
    const sale = completedSale(lines);
    const map = new Map([[product.id, product]]);
    const breakdown = computeTodayProfitBreakdown([sale], map);
    const fin = getCompletedFinancials([sale], [], [product], { day: DAY });
    expect(breakdown.profitUgx).toBe(4000);
    expect(fin.profitUgx).toBe(4000);
  });

  it("historical price edit does not change snapshotted profit", () => {
    const product = baseProduct();
    const lines = finalizeSaleLineFinancials(
      [draftLine({ quantity: 3, unitPriceUgx: 4000, lineTotalUgx: 12000, estimatedProfitUgx: 4500 })],
      [product],
      0,
    );
    const finBefore = resolveSaleLineFinancials(lines[0]!);
    product.costPricePerUnitUgx = 9999;
    product.sellingPricePerUnitUgx = 9999;
    const finAfter = resolveSaleLineFinancials(lines[0]!);
    expect(finAfter.grossProfitUgx).toBe(finBefore.grossProfitUgx);
    expect(finAfter.cogsUgx).toBe(finBefore.cogsUgx);
  });
});

describe("legacy sale fallback", () => {
  it("allocates cart discount from sale context when lines lack snapshot", () => {
    const line = draftLine({ quantity: 2, unitPriceUgx: 5000, lineTotalUgx: 10000, estimatedProfitUgx: 6000 });
    const fin = resolveSaleLineFinancials(line, { cartDiscountUgx: 2000, lineSubtotalUgx: 10000 });
    expect(fin.revenueUgx).toBe(8000);
    expect(fin.cartDiscountUgx).toBe(2000);
  });
});

describe("ensureMoneySaleQuantity", () => {
  it("fixes legacy money line quantity", () => {
    const product = baseProduct();
    const fixed = ensureMoneySaleQuantity(
      draftLine({
        inputMode: "money",
        quantity: 13000,
        unitPriceUgx: 4000,
        lineTotalUgx: 13000,
        moneyAmountUgx: 13000,
      }),
      product,
    );
    expect(fixed.quantity).toBe(3.25);
  });
});

describe("applyCartDiscountSnapshot", () => {
  it("sets estimatedProfitUgx equal to grossProfitUgx", () => {
    const lines = applyCartDiscountSnapshot(
      [
        {
          ...draftLine({ lineTotalUgx: 10000, cogsUgx: 4000 }),
        },
      ],
      1000,
    );
    expect(lines[0]!.estimatedProfitUgx).toBe(lines[0]!.grossProfitUgx);
    expect(lines[0]!.netRevenueUgx).toBe(9000);
  });
});
