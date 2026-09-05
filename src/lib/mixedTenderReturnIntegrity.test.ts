import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  cashReduceFromRefund,
  externalPhysicalCashRefundsUgx,
  physicalCashCollectedFromSale,
} from "./cashDrawerSales";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { parsePersistedTenderCashUgx } from "./saleTenderCash";
import { buildSalePushPayload } from "../offline/cloudSync";

const DAY = "2026-09-05";
const AT = `${DAY}T10:00:00.000Z`;

const products: Product[] = [
  {
    id: "p1",
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 1_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: AT,
    version: 1,
  },
];

function line(total: number): SaleLine {
  return {
    id: "line-1",
    productId: "p1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 1_000,
    estimatedProfitUgx: total - 1_000,
    inputMode: "quantity",
    updatedAt: AT,
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    createdAt: AT,
    updatedAt: AT,
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: Math.max(0, total - 1_000),
    lines: [line(total)],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function mixedCredit(): Sale {
  return sale({
    id: "mixed",
    totalUgx: 100_000,
    cashPaidUgx: 50_000,
    amountPaidUgx: 50_000,
    debtUgx: 50_000,
    paymentMethod: "credit",
    tenderCashUgx: 30_000,
  });
}

function ret(saleId: string | null, refundUgx: number, refundCashUgx?: number): ReturnRecord {
  return {
    id: crypto.randomUUID(),
    saleId,
    productId: "p1",
    productName: "Item",
    quantity: 1,
    refundAmountUgx: refundUgx,
    refundCashUgx,
    reason: "other",
    actorUserId: "u1",
    createdAt: `${DAY}T12:00:00.000Z`,
  };
}

function afterReturn(original: Sale, refundUgx: number): Sale {
  return { ...original, ...reduceSaleTotalsByAmount(original, refundUgx) };
}

function dayPhysical(sales: Sale[], returns: ReturnRecord[]): number {
  return getDrawerCashForDayInput({
    sales,
    returns,
    products,
    debtPayments: [],
    cashExpenses: [],
    day: DAY,
  }).expectedDrawerCashUgx;
}

function shiftRemainingPhysical(original: Sale, refundUgx: number): number {
  return physicalCashCollectedFromSale(original) - cashReduceFromRefund(original, refundUgx);
}

describe("CASH-NEW-01 mixed-tender same-day return / void", () => {
  it("A — 100k cash → return 30k leaves 70k physical", () => {
    const original = sale({
      id: "cash",
      totalUgx: 100_000,
      paymentMethod: "cash",
      tenderCashUgx: 100_000,
    });
    const adjusted = afterReturn(original, 30_000);
    expect(adjusted.cashPaidUgx).toBe(70_000);
    expect(adjusted.tenderCashUgx).toBe(70_000);
    expect(adjusted.debtUgx).toBe(0);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(70_000);
    expect(shiftRemainingPhysical(original, 30_000)).toBe(70_000);
  });

  it("B — 100k MoMo → return 30k stays 0 physical", () => {
    const original = sale({
      id: "momo",
      totalUgx: 100_000,
      paymentMethod: "mobile_money",
      tenderCashUgx: 0,
    });
    const adjusted = afterReturn(original, 30_000);
    expect(adjusted.cashPaidUgx).toBe(70_000);
    expect(adjusted.tenderCashUgx).toBe(0);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(0);
    expect(shiftRemainingPhysical(original, 30_000)).toBe(0);
  });

  it("C — mixed 30/20/50 → return 30k leaves 0 physical; day and shift agree", () => {
    const original = mixedCredit();
    expect(physicalCashCollectedFromSale(original)).toBe(30_000);
    const physicalOut = cashReduceFromRefund(original, 30_000);
    expect(physicalOut).toBe(30_000);
    const adjusted = afterReturn(original, 30_000);
    expect(adjusted.totalUgx).toBe(70_000);
    expect(adjusted.cashPaidUgx).toBe(20_000);
    expect(adjusted.amountPaidUgx).toBe(50_000);
    expect(adjusted.debtUgx).toBe(50_000);
    expect(adjusted.tenderCashUgx).toBe(0);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(0);
    const rec = ret(original.id, 30_000, physicalOut);
    expect(externalPhysicalCashRefundsUgx([adjusted], [rec])).toBe(0);
    expect(dayPhysical([adjusted], [rec])).toBe(0);
    expect(shiftRemainingPhysical(original, 30_000)).toBe(0);
  });

  it("D — mixed 30/20/50 → return 10k reduces physical by 10k (physical-first, existing cashReduceFromRefund)", () => {
    const original = mixedCredit();
    const adjusted = afterReturn(original, 10_000);
    expect(adjusted.cashPaidUgx).toBe(40_000);
    expect(adjusted.debtUgx).toBe(50_000);
    expect(adjusted.tenderCashUgx).toBe(20_000);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(20_000);
    expect(shiftRemainingPhysical(original, 10_000)).toBe(20_000);
    const rec = ret(original.id, 10_000, cashReduceFromRefund(original, 10_000));
    expect(externalPhysicalCashRefundsUgx([adjusted], [rec])).toBe(0);
    expect(dayPhysical([adjusted], [rec])).toBe(20_000);
  });

  it("E — mixed 30/20/50 → return 40k never goes negative; remaining physical 0", () => {
    const original = mixedCredit();
    const adjusted = afterReturn(original, 40_000);
    expect(adjusted.cashPaidUgx).toBe(10_000);
    expect(adjusted.debtUgx).toBe(50_000);
    expect(adjusted.tenderCashUgx).toBe(0);
    expect(adjusted.tenderCashUgx).toBeGreaterThanOrEqual(0);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(0);
    expect(shiftRemainingPhysical(original, 40_000)).toBe(0);
  });

  it("F — 100k debt → return 30k stays 0 physical and does not invent tender", () => {
    const original = sale({
      id: "debt",
      totalUgx: 100_000,
      cashPaidUgx: 0,
      amountPaidUgx: 0,
      debtUgx: 100_000,
      paymentMethod: "credit",
    });
    const totals = reduceSaleTotalsByAmount(original, 30_000);
    expect(totals.debtUgx).toBe(70_000);
    expect(totals.cashPaidUgx).toBe(0);
    expect("tenderCashUgx" in totals).toBe(false);
    const adjusted = { ...original, ...totals };
    expect(adjusted.tenderCashUgx).toBeUndefined();
    expect(physicalCashCollectedFromSale(adjusted)).toBe(0);
    expect(shiftRemainingPhysical(original, 30_000)).toBe(0);
  });

  it("G — pharmacy mixed sale uses the same reducer (shared returnProduct path)", () => {
    const original = sale({
      id: "pharm",
      totalUgx: 100_000,
      cashPaidUgx: 50_000,
      amountPaidUgx: 50_000,
      debtUgx: 50_000,
      paymentMethod: "credit",
      tenderCashUgx: 30_000,
      dispenseType: "otc",
    });
    const adjusted = afterReturn(original, 30_000);
    expect(adjusted.tenderCashUgx).toBe(0);
    expect(physicalCashCollectedFromSale(adjusted)).toBe(0);
    expect(adjusted.dispenseType).toBe("otc");
  });

  it("H — same-day linked return is not externally subtracted", () => {
    const original = mixedCredit();
    const adjusted = afterReturn(original, 30_000);
    const rec = ret(original.id, 30_000, 30_000);
    expect(externalPhysicalCashRefundsUgx([adjusted], [rec])).toBe(0);
    expect(dayPhysical([adjusted], [rec])).toBe(physicalCashCollectedFromSale(adjusted));
  });

  it("I — void-line reduction uses the same tender cut", () => {
    const original = mixedCredit();
    const lineAmount = 30_000;
    const totals = reduceSaleTotalsByAmount(original, lineAmount);
    expect(totals.tenderCashUgx).toBe(0);
    expect(physicalCashCollectedFromSale({ ...original, ...totals })).toBe(0);
    expect(cashReduceFromRefund(original, lineAmount)).toBe(30_000);
  });

  it("J — serialization preserves reduced tenderCashUgx", () => {
    const adjusted = afterReturn(mixedCredit(), 30_000);
    expect(adjusted.tenderCashUgx).toBe(0);
    const payload = buildSalePushPayload(adjusted, {
      shopId: "44444444-4444-4444-8444-444444444444",
      userId: "11111111-1111-4111-8111-111111111111",
    });
    const meta = payload.sale.metadata as Record<string, unknown>;
    expect(meta.tenderCashUgx).toBe(0);
    expect(parsePersistedTenderCashUgx(meta.tenderCashUgx)).toBe(0);
  });

  it("K — pull/merge keeps reduced tender from the adjusted financial header", () => {
    const original = mixedCredit();
    const adjusted = afterReturn(original, 30_000);
    const staleRemote = {
      ...original,
      updatedAt: "2026-09-05T18:00:00.000Z",
    };
    const merged = mergeSaleFromCloudPull(adjusted, staleRemote);
    expect(merged.tenderCashUgx).toBe(0);
    expect(merged.cashPaidUgx).toBe(20_000);
    expect(merged.voidedTotalUgx).toBe(30_000);
    expect(physicalCashCollectedFromSale(merged)).toBe(0);
  });

  it("L — tenderCashUgx never becomes negative", () => {
    const original = mixedCredit();
    const adjusted = afterReturn(original, 1_000_000);
    expect(adjusted.tenderCashUgx).toBe(0);
  });

  it("M — day and shift physical cash agree for cash, MoMo, and mixed", () => {
    const cases: Array<{ original: Sale; refund: number }> = [
      { original: sale({ id: "m-cash", totalUgx: 100_000, paymentMethod: "cash", tenderCashUgx: 100_000 }), refund: 30_000 },
      { original: sale({ id: "m-momo", totalUgx: 100_000, paymentMethod: "mobile_money", tenderCashUgx: 0 }), refund: 30_000 },
      { original: mixedCredit(), refund: 30_000 },
      { original: mixedCredit(), refund: 10_000 },
    ];
    for (const { original, refund } of cases) {
      const adjusted = afterReturn(original, refund);
      const rec = ret(original.id, refund, cashReduceFromRefund(original, refund));
      expect(dayPhysical([adjusted], [rec])).toBe(shiftRemainingPhysical(original, refund));
    }
  });
});
