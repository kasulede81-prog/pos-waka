import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import {
  cashReduceFromRefund,
  externalPhysicalCashRefundsUgx,
  physicalCashCollectedFromSale,
  physicalCashRefundedFromReturn,
} from "./cashDrawerSales";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { rowToReturnRecord } from "./returnRecovery";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { createDefaultPreferences } from "../data/defaultSeed";

const ROOT = process.cwd();
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const DAY1 = "2026-09-04";
const DAY2 = "2026-09-05";

function line(total: number): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 40_000,
    estimatedProfitUgx: total - 40_000,
    inputMode: "quantity",
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    createdAt: `${DAY1}T10:00:00.000Z`,
    updatedAt: `${DAY1}T10:00:00.000Z`,
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: Math.max(0, total - 40_000),
    lines: [line(total)],
    pendingSync: false,
    ...partial,
  };
}

function ret(partial: Partial<ReturnRecord> & Pick<ReturnRecord, "id" | "refundAmountUgx">): ReturnRecord {
  return {
    saleId: partial.saleId ?? null,
    productId: "prod-1",
    productName: "Widget",
    quantity: 1,
    reason: "damaged",
    actorUserId: "u1",
    createdAt: `${DAY2}T12:00:00.000Z`,
    ...partial,
  };
}

const products: Product[] = [
  {
    id: "prod-1",
    name: "Widget",
    sellingPricePerUnitUgx: 100_000,
    costPricePerUnitUgx: 40_000,
    stockOnHand: 20,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: `${DAY1}T08:00:00.000Z`,
    version: 1,
  },
];

function dayExpected(sales: Sale[], returns: ReturnRecord[], day: string): number {
  return getDrawerCashForDayInput({
    sales,
    returns,
    products,
    debtPayments: [],
    cashExpenses: [],
    day,
  }).expectedDrawerCashUgx;
}

describe("CASH-POST-05 refund physical cash classification", () => {
  it("CASE A/J — same-day linked cash return reduces physical cash once via sale header", () => {
    const original = sale({
      id: "s-a",
      totalUgx: 100_000,
      paymentMethod: "cash",
      createdAt: `${DAY1}T10:00:00.000Z`,
    });
    const refund = 30_000;
    const cashOut = cashReduceFromRefund(original, refund);
    expect(cashOut).toBe(30_000);
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, refund) };
    const rec = ret({
      id: "r-a",
      saleId: original.id,
      refundAmountUgx: refund,
      refundCashUgx: cashOut,
      createdAt: `${DAY1}T12:00:00.000Z`,
    });
    expect(physicalCashCollectedFromSale(adjusted)).toBe(70_000);
    expect(externalPhysicalCashRefundsUgx([adjusted], [rec])).toBe(0);
    expect(dayExpected([adjusted], [rec], DAY1)).toBe(70_000);
  });

  it("CASE B — same-day linked MoMo return does not reduce physical cash", () => {
    const original = sale({
      id: "s-b",
      totalUgx: 100_000,
      paymentMethod: "mobile_money",
      createdAt: `${DAY1}T10:00:00.000Z`,
    });
    const cashOut = cashReduceFromRefund(original, 30_000);
    expect(cashOut).toBe(0);
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 30_000) };
    const rec = ret({
      id: "r-b",
      saleId: original.id,
      refundAmountUgx: 30_000,
      refundCashUgx: cashOut,
      createdAt: `${DAY1}T12:00:00.000Z`,
    });
    expect(dayExpected([adjusted], [rec], DAY1)).toBe(0);
    expect(physicalCashRefundedFromReturn(rec)).toBe(0);
  });

  it("CASE C — same-day linked ATM return does not reduce physical cash", () => {
    const original = sale({
      id: "s-c",
      totalUgx: 100_000,
      paymentMethod: "atm",
      createdAt: `${DAY1}T10:00:00.000Z`,
    });
    expect(cashReduceFromRefund(original, 30_000)).toBe(0);
  });

  it("CASE D — cross-day MoMo, unknown tender (no refundCashUgx) is 0", () => {
    const original = sale({
      id: "s-d",
      totalUgx: 100_000,
      paymentMethod: "mobile_money",
    });
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 30_000) };
    const rec = ret({ id: "r-d", saleId: original.id, refundAmountUgx: 30_000 });
    expect(physicalCashRefundedFromReturn(rec)).toBe(0);
    expect(dayExpected([adjusted], [rec], DAY2)).toBe(0);
  });

  it("CASE E — cross-day cash sale with persisted cash refund reduces day-2 cash by 30k", () => {
    const original = sale({
      id: "s-e",
      totalUgx: 100_000,
      paymentMethod: "cash",
    });
    const cashOut = cashReduceFromRefund(original, 30_000);
    expect(cashOut).toBe(30_000);
    const adjusted = { ...original, ...reduceSaleTotalsByAmount(original, 30_000) };
    const rec = ret({
      id: "r-e",
      saleId: original.id,
      refundAmountUgx: 30_000,
      refundCashUgx: cashOut,
    });
    const todaySale = sale({
      id: "s-e-today",
      totalUgx: 100_000,
      paymentMethod: "cash",
      createdAt: `${DAY2}T09:00:00.000Z`,
    });
    expect(physicalCashRefundedFromReturn(rec)).toBe(30_000);
    expect(dayExpected([adjusted, todaySale], [rec], DAY2)).toBe(70_000);
    expect(
      getDrawerCashForDayInput({
        sales: [adjusted, todaySale],
        returns: [rec],
        products,
        debtPayments: [],
        cashExpenses: [],
        day: DAY2,
      }).cashRefundsUgx,
    ).toBe(30_000);
  });

  it("CASE F — no refund-method UI; cash sale refund is classified from original sale physical cash", () => {
    const original = sale({ id: "s-f", totalUgx: 100_000, paymentMethod: "cash" });
    expect(cashReduceFromRefund(original, 30_000)).toBe(30_000);
  });

  it("CASE G — unlinked unknown tender is 0", () => {
    expect(cashReduceFromRefund(undefined, 30_000)).toBe(0);
    const rec = ret({ id: "r-g", saleId: null, refundAmountUgx: 30_000 });
    expect(physicalCashRefundedFromReturn(rec)).toBe(0);
    const today = sale({
      id: "s-g",
      totalUgx: 100_000,
      paymentMethod: "cash",
      createdAt: `${DAY2}T10:00:00.000Z`,
    });
    expect(dayExpected([today], [rec], DAY2)).toBe(100_000);
  });

  it("CASE H — partial refund uses only the refunded amount", () => {
    const original = sale({ id: "s-h", totalUgx: 100_000, paymentMethod: "cash" });
    expect(cashReduceFromRefund(original, 30_000)).toBe(30_000);
    expect(cashReduceFromRefund(original, 100_000)).toBe(100_000);
  });

  it("push metadata and pull reconstruct refundCashUgx", () => {
    expect(CLOUD_SYNC).toMatch(/refundCashUgx: returnRow\.refundCashUgx \?\? null/);
    const rec = ret({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      saleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      refundAmountUgx: 30_000,
      refundCashUgx: 0,
    });
    const pulled = rowToReturnRecord({
      id: rec.id,
      sale_id: rec.saleId,
      product_id: rec.productId,
      quantity: rec.quantity,
      refund_amount_ugx: rec.refundAmountUgx,
      reason: rec.reason,
      note: null,
      created_by: rec.actorUserId,
      created_at: rec.createdAt,
      updated_at: rec.createdAt,
      metadata: { productName: rec.productName, refundCashUgx: 0, wakaClient: true },
    });
    expect(pulled!.record.refundCashUgx).toBe(0);
    expect(physicalCashRefundedFromReturn(pulled!.record)).toBe(0);

    const cashPull = rowToReturnRecord({
      id: rec.id,
      sale_id: rec.saleId,
      product_id: rec.productId,
      quantity: rec.quantity,
      refund_amount_ugx: 30_000,
      reason: rec.reason,
      created_by: rec.actorUserId,
      created_at: rec.createdAt,
      updated_at: rec.createdAt,
      metadata: { productName: rec.productName, refundCashUgx: 30_000, wakaClient: true },
    });
    expect(cashPull!.record.refundCashUgx).toBe(30_000);
    expect(physicalCashRefundedFromReturn(cashPull!.record)).toBe(30_000);
  });
});

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("CASH-POST-05 returnProduct persist + pharmacy/retail path", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: createDefaultPreferences(),
      products: [
        {
          id: PRODUCT_ID,
          name: "Soap",
          sellingPricePerUnitUgx: 100_000,
          costPricePerUnitUgx: 40_000,
          stockOnHand: 20,
          baseUnit: "pcs",
          sellingMode: "unit",
          category: "General",
          sku: "",
          minimumStockAlert: 2,
          updatedAt: `${DAY1}T08:00:00.000Z`,
          version: 1,
        },
      ],
      sales: [
        sale({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          totalUgx: 100_000,
          paymentMethod: "mobile_money",
          cashPaidUgx: 100_000,
          lines: [
            {
              id: "line-1",
              productId: PRODUCT_ID,
              name: "Soap",
              quantity: 1,
              unitPriceUgx: 100_000,
              unitCostUgx: 40_000,
              estimatedProfitUgx: 60_000,
              inputMode: "quantity",
              lineTotalUgx: 100_000,
            },
          ],
        }),
      ],
      returnRecords: [],
    });
    expect(openTestShift().ok).toBe(true);
  });

  it("CASE I — pharmacy/retail returnProduct persists refundCashUgx from the sale", () => {
    const r = usePosStore.getState().returnProduct({
      saleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 30_000,
      reason: "wrong_item",
    });
    expect(r.ok).toBe(true);
    expect(r.returnRecord!.refundAmountUgx).toBe(30_000);
    expect(r.returnRecord!.refundCashUgx).toBe(0);
    expect(physicalCashRefundedFromReturn(r.returnRecord!)).toBe(0);
  });

  it("unlinked return persists refundCashUgx = 0", () => {
    const r = usePosStore.getState().returnProduct({
      saleId: null,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 30_000,
      reason: "damaged",
      note: "owner unlinked return",
    });
    expect(r.ok).toBe(true);
    expect(r.returnRecord!.refundCashUgx).toBe(0);
  });

});
