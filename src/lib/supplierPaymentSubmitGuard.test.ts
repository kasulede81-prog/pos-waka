/**
 * CASH-SUP-01 — Pay supplier double-submit must not mint two payment IDs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Supplier } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { setCachedShopId } from "./shopSyncContext";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { getDrawerCashForDayInput, sumSupplierPaymentsOnDay } from "./cashReconciliation";
import { computeReportsPeriodCashFlow } from "./reportsCashFlow";
import { dateKeyKampala } from "./datesUg";
import {
  releaseSupplierPaymentSubmit,
  resetSupplierPaymentSubmitLocksForTests,
  supplierPaymentSubmitLockHeld,
  supplierPaymentSubmitLockKey,
  tryBeginSupplierPaymentSubmit,
} from "./supplierPaymentSubmitGuard";
import * as syncEngine from "../offline/syncEngine";

const ROOT = process.cwd();
const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_A = "sb:cash-sup-01-a";
const ACCOUNT_B = "sb:cash-sup-01-b";

function supplier(id: string, balanceOwedUgx: number): Supplier {
  return {
    id,
    name: id === SUPPLIER_A ? "Wholesaler A" : "Wholesaler B",
    phone: "",
    location: "",
    notes: "",
    balanceOwedUgx,
    lastSupplyAt: null,
    totalPurchasesUgx: balanceOwedUgx,
    createdAt: "2026-05-01T00:00:00.000Z",
    version: 1,
  };
}

function seedStore(opts?: { suppliers?: Supplier[] }) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: createDefaultPreferences(),
    products: [],
    sales: [],
    customers: [],
    suppliers: opts?.suppliers ?? [supplier(SUPPLIER_A, 100_000)],
    supplierPayments: [],
    debtPayments: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
  });
}

function lockKeyFor(accountKey: string, supplierId = SUPPLIER_A, amountUgx = 10_000) {
  return supplierPaymentSubmitLockKey({ accountKey, supplierId, amountUgx });
}

function queuedSupplierPayments(enqueueSpy: { mock: { calls: unknown[][] } }) {
  return enqueueSpy.mock.calls.filter((call) => {
    const op = call[0] as { kind?: string; payload?: { kind?: string } };
    return op.kind === "pending_expenses" && op.payload?.kind === "supplier_payment";
  });
}

function drawerFor(payments: ReturnType<typeof usePosStore.getState>["supplierPayments"]) {
  const day = dateKeyKampala(new Date());
  return getDrawerCashForDayInput({
    sales: [],
    returns: [],
    products: [],
    debtPayments: [],
    cashExpenses: [],
    supplierPayments: payments,
    day,
  });
}

describe("CASH-SUP-01 supplier payment submit guard", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    resetSupplierPaymentSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    setCachedShopId(null);
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
    seedStore();
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    resetSupplierPaymentSubmitLocksForTests();
    setActiveAccountKey(null);
    setCachedShopId(null);
    vi.restoreAllMocks();
  });

  it("A — two concurrent identical submits mint one payment, one queue, one drawer reduction", () => {
    const first = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    const second = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.errorKey).toBe("invalid");

    const state = usePosStore.getState();
    expect(state.supplierPayments).toHaveLength(1);
    expect(state.supplierPayments[0]!.amountUgx).toBe(10_000);
    expect(state.suppliers[0]!.balanceOwedUgx).toBe(90_000);

    const queued = queuedSupplierPayments(enqueueSpy);
    expect(queued).toHaveLength(1);
    expect((queued[0]![0] as { payload: { paymentId: string } }).payload.paymentId).toBe(
      state.supplierPayments[0]!.id,
    );
    expect(drawerFor(state.supplierPayments).supplierPaymentsUgx).toBe(10_000);
    expect(drawerFor(state.supplierPayments).expectedDrawerCashUgx).toBe(-10_000);
  });

  it("B — two rapid 10k submits against 100k leave balance 90k", () => {
    usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);

    const state = usePosStore.getState();
    expect(state.supplierPayments).toHaveLength(1);
    expect(state.supplierPayments[0]!.amountUgx).toBe(10_000);
    expect(state.suppliers[0]!.balanceOwedUgx).toBe(90_000);
  });

  it("C — two rapid full 100k submits create one 100k payment", () => {
    const first = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 100_000);
    const second = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 100_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(usePosStore.getState().supplierPayments).toHaveLength(1);
    expect(usePosStore.getState().supplierPayments[0]!.amountUgx).toBe(100_000);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(0);
  });

  it("D — failed first attempt releases the lock so a retry can succeed", () => {
    const denied = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 0);
    expect(denied.ok).toBe(false);
    expect(denied.errorKey).toBe("invalidMoney");
    expect(supplierPaymentSubmitLockHeld(lockKeyFor("local"))).toBe(false);
    expect(supplierPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);

    const retry = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().supplierPayments).toHaveLength(1);
  });

  it("E — thrown mutation releases the lock so a later retry works", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementationOnce(() => {
      throw new Error("payment id failed");
    });

    expect(() => usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000)).toThrow("payment id failed");
    expect(supplierPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);
    expect(usePosStore.getState().supplierPayments).toHaveLength(0);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(100_000);

    const retry = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().supplierPayments).toHaveLength(1);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(90_000);
  });

  it("F — after a successful payment, a later legitimate same-amount payment still works", () => {
    const first = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(first.ok).toBe(true);
    expect(usePosStore.getState().supplierPayments).toHaveLength(1);
    const firstId = usePosStore.getState().supplierPayments[0]!.id;

    releaseSupplierPaymentSubmit(lockKeyFor(ACCOUNT_A));
    const later = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(later.ok).toBe(true);
    const payments = usePosStore.getState().supplierPayments;
    expect(payments).toHaveLength(2);
    expect(payments[0]!.id).not.toBe(firstId);
    expect(new Set(payments.map((p) => p.id)).size).toBe(2);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(80_000);
  });

  it("G — Supplier A in-flight does not block Supplier B", () => {
    seedStore({ suppliers: [supplier(SUPPLIER_A, 100_000), supplier(SUPPLIER_B, 80_000)] });

    const a = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(a.ok).toBe(true);

    const b = usePosStore.getState().addSupplierPayment(SUPPLIER_B, 10_000);
    expect(b.ok).toBe(true);
    const payments = usePosStore.getState().supplierPayments;
    expect(payments).toHaveLength(2);
    expect(payments[0]!.id).not.toBe(payments[1]!.id);

    const state = usePosStore.getState();
    expect(state.suppliers.find((s) => s.id === SUPPLIER_A)!.balanceOwedUgx).toBe(90_000);
    expect(state.suppliers.find((s) => s.id === SUPPLIER_B)!.balanceOwedUgx).toBe(70_000);
  });

  it("H — Shop A payment lock does not block Shop B", () => {
    const keyA = lockKeyFor(ACCOUNT_A);
    const keyB = lockKeyFor(ACCOUNT_B);
    expect(keyA).not.toBe(keyB);
    expect(tryBeginSupplierPaymentSubmit(keyA)).toBe(true);
    expect(tryBeginSupplierPaymentSubmit(keyB)).toBe(true);

    resetSupplierPaymentSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    seedStore();
    const a = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(a.ok).toBe(true);
    const idA = usePosStore.getState().supplierPayments[0]!.id;

    setActiveAccountKey(ACCOUNT_B);
    seedStore();
    const b = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(b.ok).toBe(true);
    expect(usePosStore.getState().supplierPayments[0]!.id).not.toBe(idA);
  });

  it("I — existing shop_push_supplier_payment same-ID idempotency remains intact", () => {
    const sql081 = readFileSync(join(ROOT, "supabase/migrations/081_shop_purchases.sql"), "utf8");
    expect(sql081).toContain("shop_push_supplier_payment");
    expect(sql081).toContain("on conflict (id) do update");
    expect(sql081).toContain("payment_id");

    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).toContain('kind: "supplier_payment"');
    expect(store).toContain("tryBeginSupplierPaymentSubmit");
    expect(store).toContain("resetSupplierPaymentSubmitLocksForTests");

    const push = readFileSync(join(ROOT, "src/offline/cloudSync.ts"), "utf8");
    expect(push).toContain("shop_push_supplier_payment");
    expect(push).toContain("id: payment.id");
  });

  it("J — both supplier-payment UI entry points guard the same active submit", () => {
    const tab = readFileSync(join(ROOT, "src/features/inventory-purchasing/components/SuppliersTab.tsx"), "utf8");
    expect(tab).toContain("paySubmitInFlightRef");
    expect(tab).toContain("releaseSupplierPaymentSubmitsForAccount");
    expect(tab).toContain("addSupplierPayment");
    expect(tab).toContain("if (!paySupplier || paySubmitInFlightRef.current) return");
    expect(tab).toContain("loading={paySubmitting}");

    const detail = readFileSync(join(ROOT, "src/pages/SupplierDetailPage.tsx"), "utf8");
    expect(detail).toContain("paySubmitInFlightRef");
    expect(detail).toContain("releaseSupplierPaymentSubmitsForAccount");
    expect(detail).toContain("addSupplierPayment");
    expect(detail).toContain("if (paySubmitInFlightRef.current) return");
    expect(detail).toContain("loading={paySubmitting}");
  });

  it("financial invariant — one logical payment moves balance, drawer, reports, and CC once", () => {
    const before = usePosStore.getState();
    const beforeBalance = before.suppliers[0]!.balanceOwedUgx;
    const day = dateKeyKampala(new Date());
    const bounds = { fromKey: day, toKey: day, isSingleDay: true };
    const beforeDrawer = drawerFor(before.supplierPayments);
    const beforeReports = sumSupplierPaymentsOnDay(before.supplierPayments, day);
    const beforeFlow = computeReportsPeriodCashFlow({
      sales: [],
      returns: [],
      products: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: before.supplierPayments,
      bounds,
    });

    const first = usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000);
    expect(first.ok).toBe(true);

    const after = usePosStore.getState();
    const afterDrawer = drawerFor(after.supplierPayments);
    const afterFlow = computeReportsPeriodCashFlow({
      sales: [],
      returns: [],
      products: [],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: after.supplierPayments,
      bounds,
    });
    expect(beforeBalance - after.suppliers[0]!.balanceOwedUgx).toBe(10_000);
    expect(after.supplierPayments).toHaveLength(1);
    expect(after.supplierPayments[0]!.amountUgx).toBe(10_000);
    expect(sumSupplierPaymentsOnDay(after.supplierPayments, day) - beforeReports).toBe(10_000);
    expect(afterDrawer.supplierPaymentsUgx - beforeDrawer.supplierPaymentsUgx).toBe(10_000);
    expect(beforeDrawer.expectedDrawerCashUgx - afterDrawer.expectedDrawerCashUgx).toBe(10_000);
    expect(afterFlow.cashOutUgx - beforeFlow.cashOutUgx).toBe(10_000);
  });

  it("sign-out clears supplier payment locks", () => {
    expect(usePosStore.getState().addSupplierPayment(SUPPLIER_A, 10_000).ok).toBe(true);
    expect(supplierPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(true);
    usePosStore.getState().resetForSignOut();
    expect(supplierPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);
  });
});
