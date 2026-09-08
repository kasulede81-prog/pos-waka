import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReturnRecord, Sale, SaleLine } from "../types";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import {
  HISTORICAL_REPAIR_PRODUCT_ID,
  HISTORICAL_REPAIR_RETURN_ID,
  HISTORICAL_REPAIR_SALE_ID,
  HISTORICAL_REPAIR_SHOP_ID,
  assertLocalOriginalHeader,
  localOriginalCashUgx,
  maybeRepairHistoricalSaleHeader,
  resetHistoricalSaleHeaderRepairForTests,
} from "./historicalSaleHeaderRepair";

const getSessionMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  sales: [] as unknown[],
  archivedSales: [] as unknown[],
  returnRecords: [] as unknown[],
  archivedReturnRecords: [] as unknown[],
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getSession: (...args: unknown[]) => getSessionMock(...args) },
  },
}));

vi.mock("../offline/shopScope", () => ({
  getActiveShopId: () => HISTORICAL_REPAIR_SHOP_ID,
}));

vi.mock("../offline/entityStore", () => ({
  getEntitiesByIds: async () => [],
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => storeState,
    setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
  },
}));

function line(): SaleLine {
  return {
    id: "line-1",
    productId: HISTORICAL_REPAIR_PRODUCT_ID,
    name: "Coke",
    quantity: 1,
    unitPriceUgx: 1000,
    unitCostUgx: 400,
    estimatedProfitUgx: 600,
    inputMode: "quantity",
    lineTotalUgx: 1000,
  };
}

function originalSale(): Sale {
  return {
    id: HISTORICAL_REPAIR_SALE_ID,
    status: "completed",
    createdAt: "2026-09-07T22:43:05.537Z",
    lines: [line()],
    subtotalUgx: 1000,
    totalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    discountTotalUgx: 0,
    voidedTotalUgx: 0,
    estimatedProfitUgx: 600,
    pendingSync: false,
  };
}

function localReturn(): ReturnRecord {
  return {
    id: HISTORICAL_REPAIR_RETURN_ID,
    saleId: HISTORICAL_REPAIR_SALE_ID,
    productId: HISTORICAL_REPAIR_PRODUCT_ID,
    productName: "Coke",
    quantity: 1,
    refundAmountUgx: 1000,
    reason: "warm_bad",
    actorUserId: "user-1",
    createdAt: "2026-09-07T22:43:57.593Z",
  };
}

function chain(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.select = vi.fn(self);
  q.eq = vi.fn(self);
  q.update = vi.fn(self);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

describe("historical sale header repair", () => {
  beforeEach(async () => {
    resetHistoricalSaleHeaderRepairForTests();
    fromMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    const reduced = {
      ...originalSale(),
      ...reduceSaleTotalsByAmount(originalSale(), 1000),
      pendingSync: false,
    };
    storeState.sales = [reduced];
    storeState.archivedSales = [];
    storeState.returnRecords = [localReturn()];
    storeState.archivedReturnRecords = [];
  });

  it("reconstructs original 1000/1000/0 from the reduced local sale", () => {
    const reduced = { ...originalSale(), ...reduceSaleTotalsByAmount(originalSale(), 1000) };
    expect(reduced.totalUgx).toBe(0);
    expect(reduced.cashPaidUgx).toBe(0);
    expect(localOriginalCashUgx(reduced)).toBe(1000);
    expect(assertLocalOriginalHeader(reduced, [localReturn()])).toEqual({ ok: true });
  });

  it("does not write when the cloud line quantity is not 1", async () => {
    const saleQ = chain({
      data: {
        id: HISTORICAL_REPAIR_SALE_ID,
        shop_id: HISTORICAL_REPAIR_SHOP_ID,
        total_ugx: 0,
        cash_amount_ugx: 0,
        debt_amount_ugx: 0,
        subtotal_ugx: 1000,
        discount_ugx: 0,
      },
      error: null,
    });
    const lineQ = chain({
      data: [{ product_id: HISTORICAL_REPAIR_PRODUCT_ID, quantity: 2, unit_price_ugx: 1000, line_total_ugx: 2000 }],
      error: null,
    });
    const retQ = chain({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "sales") return saleQ;
      if (table === "sale_line_items") return lineQ;
      return retQ;
    });
    const outcome = await maybeRepairHistoricalSaleHeader();
    expect(outcome.status).toBe("assert_failed");
    expect(outcome.wrote).toBe(false);
    expect(saleQ.update).not.toHaveBeenCalled();
  });

  it("writes only total and cash for the scoped sale when assertions pass", async () => {
    const repairedSale = {
      id: HISTORICAL_REPAIR_SALE_ID,
      shop_id: HISTORICAL_REPAIR_SHOP_ID,
      total_ugx: 1000,
      cash_amount_ugx: 1000,
      debt_amount_ugx: 0,
      subtotal_ugx: 1000,
      discount_ugx: 0,
    };
    const saleRead = chain({
      data: {
        id: HISTORICAL_REPAIR_SALE_ID,
        shop_id: HISTORICAL_REPAIR_SHOP_ID,
        total_ugx: 0,
        cash_amount_ugx: 0,
        debt_amount_ugx: 0,
        subtotal_ugx: 1000,
        discount_ugx: 0,
      },
      error: null,
    });
    const saleWrite = chain({
      data: {
        id: HISTORICAL_REPAIR_SALE_ID,
        total_ugx: 1000,
        cash_amount_ugx: 1000,
        debt_amount_ugx: 0,
        subtotal_ugx: 1000,
      },
      error: null,
    });
    const saleAfter = chain({ data: repairedSale, error: null });
    const lineQ = chain({
      data: [{ product_id: HISTORICAL_REPAIR_PRODUCT_ID, quantity: 1, unit_price_ugx: 1000, line_total_ugx: 1000 }],
      error: null,
    });
    const retQ = chain({ data: [], error: null });
    let salesCalls = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "sale_line_items") return lineQ;
      if (table === "sale_returns") return retQ;
      salesCalls += 1;
      if (salesCalls === 2) return saleWrite;
      if (salesCalls >= 3) return saleAfter;
      return saleRead;
    });
    const outcome = await maybeRepairHistoricalSaleHeader();
    expect(saleWrite.update).toHaveBeenCalledWith({ total_ugx: 1000, cash_amount_ugx: 1000 });
    expect(saleWrite.eq).toHaveBeenCalledWith("id", HISTORICAL_REPAIR_SALE_ID);
    expect(saleWrite.eq).toHaveBeenCalledWith("shop_id", HISTORICAL_REPAIR_SHOP_ID);
    expect(saleWrite.eq).toHaveBeenCalledWith("total_ugx", 0);
    expect(saleWrite.eq).toHaveBeenCalledWith("cash_amount_ugx", 0);
    expect(outcome.status).toBe("repaired");
    expect(outcome.wrote).toBe(true);
    expect(outcome.allowReturnRecovery).toBe(true);
    expect(outcome.after).toMatchObject({
      totalUgx: 1000,
      cashAmountUgx: 1000,
      debtAmountUgx: 0,
      subtotalUgx: 1000,
      lineQty: 1,
      lineTotal: 1000,
      returnCount: 0,
    });
  });

  it("skips the write when the header is already 1000/1000", async () => {
    const saleQ = chain({
      data: {
        id: HISTORICAL_REPAIR_SALE_ID,
        shop_id: HISTORICAL_REPAIR_SHOP_ID,
        total_ugx: 1000,
        cash_amount_ugx: 1000,
        debt_amount_ugx: 0,
        subtotal_ugx: 1000,
        discount_ugx: 0,
      },
      error: null,
    });
    const lineQ = chain({
      data: [{ product_id: HISTORICAL_REPAIR_PRODUCT_ID, quantity: 1, unit_price_ugx: 1000, line_total_ugx: 1000 }],
      error: null,
    });
    const retQ = chain({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "sales") return saleQ;
      if (table === "sale_line_items") return lineQ;
      return retQ;
    });
    const outcome = await maybeRepairHistoricalSaleHeader();
    expect(outcome.status).toBe("already_repaired");
    expect(outcome.wrote).toBe(false);
    expect(outcome.allowReturnRecovery).toBe(true);
    expect(saleQ.update).not.toHaveBeenCalled();
  });

  it("does not write when the header is already 1000/1000 even if the return exists", async () => {
    const saleQ = chain({
      data: {
        id: HISTORICAL_REPAIR_SALE_ID,
        shop_id: HISTORICAL_REPAIR_SHOP_ID,
        total_ugx: 1000,
        cash_amount_ugx: 1000,
        debt_amount_ugx: 0,
        subtotal_ugx: 1000,
        discount_ugx: 0,
      },
      error: null,
    });
    const lineQ = chain({
      data: [{ product_id: HISTORICAL_REPAIR_PRODUCT_ID, quantity: 1, unit_price_ugx: 1000, line_total_ugx: 1000 }],
      error: null,
    });
    const retQ = chain({
      data: [
        {
          id: HISTORICAL_REPAIR_RETURN_ID,
          quantity: 1,
          refund_amount_ugx: 1000,
          reason: "warm_bad",
          product_id: HISTORICAL_REPAIR_PRODUCT_ID,
          sale_id: HISTORICAL_REPAIR_SALE_ID,
        },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "sales") return saleQ;
      if (table === "sale_line_items") return lineQ;
      return retQ;
    });
    const outcome = await maybeRepairHistoricalSaleHeader();
    expect(outcome.status).toBe("already_repaired");
    expect(outcome.wrote).toBe(false);
    expect(outcome.allowReturnRecovery).toBe(true);
    expect(saleQ.update).not.toHaveBeenCalled();
  });
});
