/**
 * SALE-RET-01 — return confirm double-submit must not mint two returns.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Product, Sale, SaleLine } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { setCachedShopId } from "./shopSyncContext";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { openTestShift } from "../test/shiftTestSetup";
import { physicalCashRefundedFromReturn } from "./cashDrawerSales";
import {
  releaseReturnSubmit,
  resetReturnSubmitLocksForTests,
  returnSubmitLockHeld,
  returnSubmitLockKey,
  tryBeginReturnSubmit,
} from "./returnSubmitGuard";
import * as syncEngine from "../offline/syncEngine";

const ROOT = process.cwd();
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCOUNT_A = "sb:sale-ret-01-a";
const ACCOUNT_B = "sb:sale-ret-01-b";

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

function seedStore(opts?: { stock?: number; sale?: Sale; customers?: Customer[] }) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: createDefaultPreferences(),
    products: [product(opts?.stock ?? 20)],
    sales: [opts?.sale ?? sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 50_000 })],
    customers: opts?.customers ?? [],
    returnRecords: [],
    stockMovements: [],
    archivedStockMovements: [],
  });
  expect(openTestShift().ok).toBe(true);
}

const identicalInput = {
  saleId: SALE_ID,
  productId: PRODUCT_ID,
  quantity: 1,
  refundAmountUgx: 10_000,
  reason: "wrong_item" as const,
};

function lockKeyFor(accountKey: string, extra: Partial<typeof identicalInput> = {}) {
  const input = { ...identicalInput, ...extra };
  return returnSubmitLockKey({
    accountKey,
    saleId: input.saleId,
    productId: input.productId,
    quantity: input.quantity,
    refundAmountUgx: input.refundAmountUgx,
    reason: input.reason,
  });
}

describe("SALE-RET-01 return submit guard", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    setCachedShopId(null);
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
    seedStore();
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    resetReturnSubmitLocksForTests();
    setActiveAccountKey(null);
    setCachedShopId(null);
  });

  it("A — two concurrent identical submits mint one return, one stock effect, one queue", () => {
    const first = usePosStore.getState().returnProduct(identicalInput);
    const second = usePosStore.getState().returnProduct(identicalInput);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.errorKey).toBe("invalid");
    expect(first.returnRecord?.id).toBeTruthy();
    expect(second.returnRecord).toBeUndefined();

    const state = usePosStore.getState();
    expect(state.returnRecords).toHaveLength(1);
    expect(state.returnRecords[0]!.id).toBe(first.returnRecord!.id);
    expect(state.products[0]!.stockOnHand).toBe(21);
    expect(state.stockMovements.filter((m) => m.refId === first.returnRecord!.id)).toHaveLength(1);
    expect(state.sales[0]!.totalUgx).toBe(40_000);

    const queuedReturns = enqueueSpy.mock.calls.filter(
      (call) => (call[0] as { kind?: string }).kind === "pending_returns",
    );
    expect(queuedReturns).toHaveLength(1);
    expect((queuedReturns[0]![0] as { payload: { returnId: string } }).payload.returnId).toBe(
      first.returnRecord!.id,
    );
  });

  it("B — two rapid 1-unit returns against 5 units only return 1", () => {
    seedStore({
      sale: sale({ totalUgx: 50_000, tenderCashUgx: 50_000, cashPaidUgx: 50_000, lines: [line(5, 50_000)] }),
    });

    usePosStore.getState().returnProduct(identicalInput);
    usePosStore.getState().returnProduct(identicalInput);

    const state = usePosStore.getState();
    expect(state.returnRecords).toHaveLength(1);
    expect(state.returnRecords[0]!.quantity).toBe(1);
    expect(state.sales[0]!.lines[0]!.quantity).toBe(5);
    expect(state.returnRecords.reduce((n, r) => n + r.quantity, 0)).toBe(1);
  });

  it("C — double submit does not double refundCashUgx", () => {
    const first = usePosStore.getState().returnProduct(identicalInput);
    usePosStore.getState().returnProduct(identicalInput);

    expect(first.returnRecord!.refundCashUgx).toBe(10_000);
    expect(physicalCashRefundedFromReturn(first.returnRecord!)).toBe(10_000);
    const state = usePosStore.getState();
    const cashOut = state.returnRecords.reduce(
      (n, r) => n + physicalCashRefundedFromReturn(r),
      0,
    );
    expect(cashOut).toBe(10_000);
    expect(state.sales[0]!.tenderCashUgx).toBe(40_000);
  });

  it("D — double submit does not reduce customer debt twice", () => {
    seedStore({
      sale: sale({
        totalUgx: 50_000,
        cashPaidUgx: 0,
        debtUgx: 50_000,
        tenderCashUgx: 0,
        customerId: CUSTOMER_ID,
        paymentMethod: "credit",
      }),
      customers: [customer(50_000)],
    });

    usePosStore.getState().returnProduct(identicalInput);
    usePosStore.getState().returnProduct(identicalInput);

    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(40_000);
    expect(usePosStore.getState().sales[0]!.debtUgx).toBe(40_000);
    expect(usePosStore.getState().returnRecords).toHaveLength(1);
  });

  it("E — restocking reason does not increment stock twice", () => {
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(20);
    usePosStore.getState().returnProduct({ ...identicalInput, reason: "wrong_item" });
    usePosStore.getState().returnProduct({ ...identicalInput, reason: "wrong_item" });
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(21);
    expect(usePosStore.getState().stockMovements).toHaveLength(1);
  });

  it("F — failed first attempt releases the lock so a retry can succeed", () => {
    const denied = usePosStore.getState().returnProduct({
      ...identicalInput,
      quantity: 0,
      refundAmountUgx: 10_000,
    });
    expect(denied.ok).toBe(false);
    expect(returnSubmitLockHeld(lockKeyFor("local"))).toBe(false);
    expect(returnSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);

    const retry = usePosStore.getState().returnProduct(identicalInput);
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().returnRecords).toHaveLength(1);
  });

  it("G — after a successful return, a later legitimate return still works", () => {
    const first = usePosStore.getState().returnProduct(identicalInput);
    expect(first.ok).toBe(true);
    expect(usePosStore.getState().returnRecords).toHaveLength(1);

    releaseReturnSubmit(lockKeyFor(ACCOUNT_A));
    const later = usePosStore.getState().returnProduct(identicalInput);
    expect(later.ok).toBe(true);
    expect(later.returnRecord!.id).not.toBe(first.returnRecord!.id);
    expect(usePosStore.getState().returnRecords).toHaveLength(2);
    expect(usePosStore.getState().returnRecords.reduce((n, r) => n + r.quantity, 0)).toBe(2);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(22);
  });

  it("H — Shop A return lock does not block Shop B", () => {
    const keyA = lockKeyFor(ACCOUNT_A);
    const keyB = lockKeyFor(ACCOUNT_B);
    expect(keyA).not.toBe(keyB);
    expect(tryBeginReturnSubmit(keyA)).toBe(true);
    expect(tryBeginReturnSubmit(keyB)).toBe(true);

    resetReturnSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    seedStore();
    const a = usePosStore.getState().returnProduct(identicalInput);
    expect(a.ok).toBe(true);

    setActiveAccountKey(ACCOUNT_B);
    seedStore({
      sale: sale({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", totalUgx: 50_000, tenderCashUgx: 50_000 }),
    });
    const b = usePosStore.getState().returnProduct({
      ...identicalInput,
      saleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(b.ok).toBe(true);
    expect(b.returnRecord!.id).not.toBe(a.returnRecord!.id);
  });

  it("I — existing shop_push_sale_return ON CONFLICT / stock replay remains intact", () => {
    const sql062 = readFileSync(join(ROOT, "supabase/migrations/062_sale_returns.sql"), "utf8");
    const sql103 = readFileSync(join(ROOT, "supabase/migrations/103_sale_return_stock_reason_guard.sql"), "utf8");
    expect(sql062).toContain("on conflict (id) do update set");
    expect(sql103).toContain("im.reference_id = p_return_id");
    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).toContain("queueRemote(\"pending_returns\"");
    expect(store).toContain("tryBeginReturnSubmit");
    const modal = readFileSync(join(ROOT, "src/components/pos/ReturnProductModal.tsx"), "utf8");
    expect(modal).toContain("submitInFlightRef");
    expect(modal).toContain("releaseReturnSubmitsForAccount");
  });
});
