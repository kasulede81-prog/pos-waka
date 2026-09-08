/**
 * SALES-RETURN-01 — linked return must not silently become unlinked
 * when the sale is missing from state.sales.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Product, ReturnRecord, Sale, SaleLine } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { setCachedShopId } from "./shopSyncContext";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { openTestShift } from "../test/shiftTestSetup";
import { resetReturnSubmitLocksForTests } from "./returnSubmitGuard";
import { resolveLocalSaleForReturn } from "./resolveLocalSaleForReturn";
import { remainingRefundableAmount, remainingReturnableQuantity } from "./returnLimits";
import { returnRestocksInventory } from "./returnPolicy";
import * as syncEngine from "../offline/syncEngine";
import * as entityStore from "../offline/entityStore";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCOUNT = "sb:sales-return-01";

function product(stockOnHand = 20): Product {
  return {
    id: PRODUCT_ID,
    name: "Soap",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-09-06T08:00:00.000Z",
    version: 1,
  };
}

function line(quantity: number, lineTotalUgx: number): SaleLine {
  return {
    id: "line-1",
    productId: PRODUCT_ID,
    name: "Soap",
    quantity,
    unitPriceUgx: lineTotalUgx / quantity,
    unitCostUgx: 3_000,
    estimatedProfitUgx: lineTotalUgx - quantity * 3_000,
    inputMode: "quantity",
    lineTotalUgx,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  const total = partial.totalUgx;
  const debt = partial.debtUgx ?? 0;
  return {
    id: SALE_ID,
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    status: "completed",
    subtotalUgx: total,
    cashPaidUgx: partial.cashPaidUgx ?? Math.max(0, total - debt),
    debtUgx: debt,
    estimatedProfitUgx: Math.max(0, total - 15_000),
    lines: partial.lines ?? [line(5, total)],
    pendingSync: false,
    lastSyncError: null,
    customerId: partial.customerId ?? null,
    paymentMethod: partial.paymentMethod ?? "cash",
    tenderCashUgx: partial.tenderCashUgx,
    ...partial,
  };
}

function customer(debtBalanceUgx: number): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Buyer",
    phone: "",
    location: "",
    debtBalanceUgx,
    createdAt: "2026-05-01T00:00:00.000Z",
    version: 1,
  };
}

function priorReturn(refundAmountUgx: number, quantity = 1): ReturnRecord {
  return {
    id: crypto.randomUUID(),
    saleId: SALE_ID,
    productId: PRODUCT_ID,
    productName: "Soap",
    quantity,
    refundAmountUgx,
    reason: "damaged",
    actorUserId: "owner:1",
    createdAt: "2026-09-06T11:00:00.000Z",
  };
}

function seedStore(opts?: {
  stock?: number;
  sales?: Sale[];
  archivedSales?: Sale[];
  returnRecords?: ReturnRecord[];
  archivedReturnRecords?: ReturnRecord[];
  customers?: Customer[];
  role?: "owner" | "cashier";
}) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: {
      userId: opts?.role === "cashier" ? "cashier:1" : "owner:1",
      role: opts?.role ?? "owner",
      displayName: opts?.role === "cashier" ? "Cashier" : "Owner",
    },
    preferences: createDefaultPreferences(),
    products: [product(opts?.stock ?? 20)],
    sales: opts?.sales ?? [sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 50_000 })],
    archivedSales: opts?.archivedSales ?? [],
    customers: opts?.customers ?? [],
    returnRecords: opts?.returnRecords ?? [],
    archivedReturnRecords: opts?.archivedReturnRecords ?? [],
    stockMovements: [],
    archivedStockMovements: [],
  });
  expect(openTestShift().ok).toBe(true);
}

const linkedInput = {
  saleId: SALE_ID,
  productId: PRODUCT_ID,
  quantity: 2,
  refundAmountUgx: 20_000,
  reason: "damaged" as const,
  note: "Would look unlinked if sale missing",
};

describe("resolveLocalSaleForReturn", () => {
  it("prefers state.sales then archivedSales", () => {
    const live = sale({ totalUgx: 50_000 });
    const archived = { ...live, id: "other" };
    expect(resolveLocalSaleForReturn(SALE_ID, [live], [archived])?.bucket).toBe("sales");
    expect(resolveLocalSaleForReturn(SALE_ID, [], [live])?.bucket).toBe("archivedSales");
    expect(resolveLocalSaleForReturn(SALE_ID, [], [])).toBeNull();
    expect(resolveLocalSaleForReturn(null, [live], [])).toBeNull();
  });
});

describe("SALES-RETURN-01 linked return missing sale", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };
  let getEntitiesSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT);
    setCachedShopId(null);
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
    getEntitiesSpy = vi.spyOn(entityStore, "getEntitiesByIds").mockResolvedValue([]);
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    getEntitiesSpy.mockRestore();
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(null);
    setCachedShopId(null);
  });

  it("1 — sale in state.sales validates and adjusts the header", () => {
    seedStore();
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(true);
    const next = usePosStore.getState();
    expect(next.sales[0]!.totalUgx).toBe(30_000);
    expect(next.returnRecords).toHaveLength(1);
    expect(next.returnRecords[0]!.saleId).toBe(SALE_ID);
  });

  it("2 — sale in archivedSales still validates and adjusts that sale", () => {
    const archived = sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 50_000 });
    seedStore({ sales: [], archivedSales: [archived] });
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(true);
    const next = usePosStore.getState();
    expect(next.sales).toHaveLength(0);
    expect(next.archivedSales[0]!.totalUgx).toBe(30_000);
    expect(next.returnRecords[0]!.saleId).toBe(SALE_ID);
  });

  it("3 — sale only in entityStore is not loaded; fail closed", () => {
    seedStore({ sales: [], archivedSales: [] });
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("returnSaleUnavailable");
    expect(getEntitiesSpy).not.toHaveBeenCalled();
    const next = usePosStore.getState();
    expect(next.returnRecords).toHaveLength(0);
    expect(next.products[0]!.stockOnHand).toBe(20);
  });

  it("4 — sale nowhere rejects and does not persist", () => {
    seedStore({ sales: [], archivedSales: [] });
    const beforeCash = usePosStore.getState().preferences.shifts?.[0]?.estimatedCashUgx ?? 0;
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("returnSaleUnavailable");
    const next = usePosStore.getState();
    expect(next.returnRecords).toHaveLength(0);
    expect(next.products[0]!.stockOnHand).toBe(20);
    expect(next.preferences.shifts?.[0]?.estimatedCashUgx).toBe(beforeCash);
    const queuedReturns = enqueueSpy.mock.calls.filter(
      (call) => (call[0] as { kind?: string }).kind === "pending_returns",
    );
    expect(queuedReturns).toHaveLength(0);
  });

  it("5 — missing linked sale does not become an unlinked return", () => {
    seedStore({ sales: [], archivedSales: [], role: "owner" });
    const r = usePosStore.getState().returnProduct({
      ...linkedInput,
      note: "Owner note that used to unlock unlinked",
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("returnSaleUnavailable");
    expect(r.errorKey).not.toBe("returnUnlinkedForbidden");
    expect(usePosStore.getState().returnRecords).toHaveLength(0);
  });

  it("6 — quantity ceiling: 5 sold, 3 returned, 2 passes, 3 rejects", () => {
    const s = sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 20_000, lines: [line(5, 50_000)] });
    seedStore({
      sales: [{ ...s, totalUgx: 20_000, cashPaidUgx: 20_000 }],
      returnRecords: [priorReturn(30_000, 3)],
    });
    expect(remainingReturnableQuantity(usePosStore.getState().sales[0]!, PRODUCT_ID, usePosStore.getState().returnRecords)).toBe(2);

    const pass = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 2,
      refundAmountUgx: 20_000,
      reason: "damaged",
    });
    expect(pass.ok).toBe(true);

    resetReturnSubmitLocksForTests();
    seedStore({
      sales: [{ ...s, totalUgx: 20_000, cashPaidUgx: 20_000 }],
      returnRecords: [priorReturn(30_000, 3)],
    });
    const reject3 = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 3,
      refundAmountUgx: 20_000,
      reason: "damaged",
    });
    expect(reject3.ok).toBe(false);
    expect(reject3.errorKey).toBe("returnExceedsQty");

    resetReturnSubmitLocksForTests();
    const reject6 = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 6,
      refundAmountUgx: 20_000,
      reason: "damaged",
    });
    expect(reject6.ok).toBe(false);
    expect(reject6.errorKey).toBe("returnExceedsQty");
  });

  it("7 — refund ceiling uses remainingRefundableAmount / line cap", () => {
    const s = sale({ totalUgx: 42_000, tenderCashUgx: 42_000, cashPaidUgx: 42_000, lines: [line(5, 50_000)] });
    seedStore({
      sales: [s],
      returnRecords: [priorReturn(8_000, 1)],
    });
    const remaining = remainingRefundableAmount(usePosStore.getState().sales[0]!);
    expect(remaining).toBe(42_000);

    const over = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 50_000,
      reason: "damaged",
    });
    expect(over.ok).toBe(false);
    expect(over.errorKey).toMatch(/^returnExceeds/);
  });

  it("8 — multiple previous returns are counted toward remaining qty", () => {
    const s = sale({ totalUgx: 10_000, tenderCashUgx: 10_000, cashPaidUgx: 10_000, lines: [line(5, 50_000)] });
    seedStore({
      sales: [s],
      returnRecords: [priorReturn(20_000, 2), priorReturn(20_000, 2)],
    });
    const reject = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 2,
      refundAmountUgx: 10_000,
      reason: "damaged",
    });
    expect(reject.ok).toBe(false);
    expect(reject.errorKey).toBe("returnExceedsQty");
  });

  it("9 — offline missing sale fails closed", () => {
    seedStore({ sales: [], archivedSales: [] });
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("returnSaleUnavailable");
  });

  it("10 — offline available sale proceeds", () => {
    seedStore();
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().returnRecords[0]!.saleId).toBe(SALE_ID);
  });

  it("11 — restart/hydration: reject until sale is in RAM, then allow", () => {
    seedStore({ sales: [], archivedSales: [] });
    const before = usePosStore.getState().returnProduct(linkedInput);
    expect(before.ok).toBe(false);
    expect(before.errorKey).toBe("returnSaleUnavailable");

    resetReturnSubmitLocksForTests();
    usePosStore.setState({
      sales: [sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 50_000 })],
    });
    const after = usePosStore.getState().returnProduct(linkedInput);
    expect(after.ok).toBe(true);
  });

  it("12 — mixed tender uses cash-first header + cashReduce", () => {
    seedStore({
      sales: [
        sale({
          totalUgx: 50_000,
          cashPaidUgx: 20_000,
          debtUgx: 30_000,
          paymentMethod: "mixed",
          tenderCashUgx: 20_000,
        }),
      ],
    });
    const r = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 3,
      refundAmountUgx: 25_000,
      reason: "damaged",
    });
    expect(r.ok).toBe(true);
    expect(r.returnRecord!.refundCashUgx).toBe(20_000);
    const next = usePosStore.getState().sales[0]!;
    expect(next.cashPaidUgx).toBe(0);
    expect(next.debtUgx).toBe(25_000);
  });

  it("13 — credit sale reduces debt, not cash", () => {
    seedStore({
      sales: [
        sale({
          totalUgx: 50_000,
          cashPaidUgx: 0,
          debtUgx: 50_000,
          paymentMethod: "credit",
          customerId: CUSTOMER_ID,
        }),
      ],
      customers: [customer(50_000)],
    });
    const r = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "damaged",
    });
    expect(r.ok).toBe(true);
    expect(r.returnRecord!.refundCashUgx).toBe(0);
    expect(usePosStore.getState().sales[0]!.debtUgx).toBe(40_000);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(40_000);
  });

  it("14 — wrong_item restocks", () => {
    seedStore({ stock: 10 });
    const r = usePosStore.getState().returnProduct({
      ...linkedInput,
      reason: "wrong_item",
    });
    expect(r.ok).toBe(true);
    expect(returnRestocksInventory("wrong_item")).toBe(true);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(12);
  });

  it("14b — other restocks a sold unit back onto the shelf", () => {
    seedStore({ stock: 11 });
    const r = usePosStore.getState().returnProduct({
      ...linkedInput,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "other",
    });
    expect(r.ok).toBe(true);
    expect(returnRestocksInventory("other")).toBe(true);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(12);
  });

  it("15 — damaged does not restock", () => {
    seedStore({ stock: 10 });
    const r = usePosStore.getState().returnProduct({
      ...linkedInput,
      reason: "damaged",
    });
    expect(r.ok).toBe(true);
    expect(returnRestocksInventory("damaged")).toBe(false);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(10);
  });

  it("16 — successful linked return still queues pending_returns with saleId", () => {
    seedStore();
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(true);
    const queued = enqueueSpy.mock.calls.filter(
      (call) => (call[0] as { kind?: string }).kind === "pending_returns",
    );
    expect(queued.length).toBeGreaterThan(0);
    expect((queued[0]![0] as { payload: { saleId?: string } }).payload.saleId).toBe(SALE_ID);
  });

  it("17 — header remains original-minus-returns so Device B absorb is not double-counted", () => {
    const s = sale({ totalUgx: 42_000, tenderCashUgx: 42_000, cashPaidUgx: 42_000, lines: [line(5, 50_000)] });
    seedStore({
      sales: [s],
      returnRecords: [priorReturn(8_000, 1)],
    });
    expect(remainingRefundableAmount(usePosStore.getState().sales[0]!)).toBe(42_000);
    const r = usePosStore.getState().returnProduct({
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "damaged",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().sales[0]!.totalUgx).toBe(32_000);
  });

  it("explicit unlinked path is unchanged when saleId is omitted", () => {
    seedStore({ sales: [], archivedSales: [] });
    const r = usePosStore.getState().returnProduct({
      saleId: null,
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 5_000,
      reason: "damaged",
      note: "Walk-in without receipt",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().returnRecords[0]!.saleId).toBeNull();
  });

  it("cashier cannot convert a missing linked sale into an unlinked return", () => {
    seedStore({ sales: [], archivedSales: [], role: "cashier" });
    const r = usePosStore.getState().returnProduct(linkedInput);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("returnSaleUnavailable");
  });
});
