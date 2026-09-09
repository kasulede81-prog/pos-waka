/**
 * DEBT-PAY-01 — Pay Debt double-submit must not mint two payment IDs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { setCachedShopId } from "./shopSyncContext";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { openTestShift } from "../test/shiftTestSetup";
import { getDrawerCashForDay, sumDebtPaymentsOnDay } from "./cashReconciliation";
import { sumDebtPaymentsInBounds } from "./customerDebtActivity";
import { dateKeyKampala } from "./datesUg";
import * as receiptBranding from "./receiptBranding";
import {
  debtPaymentSubmitLockHeld,
  debtPaymentSubmitLockKey,
  releaseDebtPaymentSubmitsForAccount,
  resetDebtPaymentSubmitLocksForTests,
  tryBeginDebtPaymentSubmit,
} from "./debtPaymentSubmitGuard";
import * as syncEngine from "../offline/syncEngine";

const ROOT = process.cwd();
const CUSTOMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_A = "sb:debt-pay-01-a";
const ACCOUNT_B = "sb:debt-pay-01-b";

function customer(id: string, debtBalanceUgx: number): Customer {
  return {
    id,
    name: id === CUSTOMER_A ? "Buyer A" : "Buyer B",
    phone: "",
    location: "",
    debtBalanceUgx,
    createdAt: "2026-05-01T00:00:00.000Z",
    version: 1,
  };
}

function seedStore(opts?: { customers?: Customer[] }) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: createDefaultPreferences(),
    products: [],
    sales: [],
    customers: opts?.customers ?? [customer(CUSTOMER_A, 100_000)],
    debtPayments: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
  });
  expect(openTestShift().ok).toBe(true);
}

function lockKeyFor(accountKey: string, customerId = CUSTOMER_A, amountUgx = 10_000) {
  return debtPaymentSubmitLockKey({ accountKey, customerId, amountUgx });
}

function queuedDebtPayments(enqueueSpy: { mock: { calls: unknown[][] } }) {
  return enqueueSpy.mock.calls.filter((call) => {
    const op = call[0] as { kind?: string; payload?: { kind?: string } };
    return op.kind === "customer" && op.payload?.kind === "debt_payment";
  });
}

describe("DEBT-PAY-01 debt payment submit guard", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    resetDebtPaymentSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    setCachedShopId(null);
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
    seedStore();
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    resetDebtPaymentSubmitLocksForTests();
    setActiveAccountKey(null);
    setCachedShopId(null);
    vi.restoreAllMocks();
  });

  it("A — nested re-entrant submit while first is in-flight mints one payment", () => {
    let reentered = false;
    const unsub = usePosStore.subscribe(() => {
      if (reentered) return;
      reentered = true;
      expect(debtPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(true);
      const second = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
      expect(second.ok).toBe(false);
      expect(second.errorKey).toBe("invalid");
      expect(second.payment).toBeUndefined();
    });

    const first = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    unsub();

    expect(first.ok).toBe(true);
    expect(first.payment?.id).toBeTruthy();
    expect(reentered).toBe(true);

    const state = usePosStore.getState();
    expect(state.debtPayments).toHaveLength(1);
    expect(state.debtPayments[0]!.id).toBe(first.payment!.id);
    expect(state.customers[0]!.debtBalanceUgx).toBe(90_000);
    expect(state.preferences.shifts?.[0]?.debtPaymentsTotalUgx).toBe(10_000);

    const queued = queuedDebtPayments(enqueueSpy);
    expect(queued).toHaveLength(1);
    expect((queued[0]![0] as { payload: { paymentId: string } }).payload.paymentId).toBe(first.payment!.id);
    expect(debtPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);
  });

  it("B — overlapping in-flight lock rejects a concurrent duplicate", () => {
    const key = lockKeyFor(ACCOUNT_A);
    expect(tryBeginDebtPaymentSubmit(key)).toBe(true);
    expect(debtPaymentSubmitLockHeld(key)).toBe(true);

    const blocked = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.errorKey).toBe("invalid");
    expect(usePosStore.getState().debtPayments).toHaveLength(0);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(100_000);
  });

  it("C — two rapid full 100k submits create one 100k payment", () => {
    const first = usePosStore.getState().addDebtPayment(CUSTOMER_A, 100_000);
    const second = usePosStore.getState().addDebtPayment(CUSTOMER_A, 100_000);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(usePosStore.getState().debtPayments).toHaveLength(1);
    expect(usePosStore.getState().debtPayments[0]!.amountUgx).toBe(100_000);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(0);
  });

  it("D — failed first attempt releases the lock so a retry can succeed", () => {
    const denied = usePosStore.getState().addDebtPayment(CUSTOMER_A, 0);
    expect(denied.ok).toBe(false);
    expect(denied.errorKey).toBe("invalidMoney");
    expect(debtPaymentSubmitLockHeld(lockKeyFor("local"))).toBe(false);
    expect(debtPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);

    const retry = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().debtPayments).toHaveLength(1);
  });

  it("E — thrown mutation releases the lock so a later retry works", () => {
    vi.spyOn(receiptBranding, "buildReceiptBrandingSnapshot").mockImplementation(() => {
      throw new Error("receipt snapshot failed");
    });

    expect(() => usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000)).toThrow("receipt snapshot failed");
    expect(debtPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);
    expect(usePosStore.getState().debtPayments).toHaveLength(0);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(100_000);

    vi.mocked(receiptBranding.buildReceiptBrandingSnapshot).mockRestore();

    const retry = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().debtPayments).toHaveLength(1);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(90_000);
  });

  it("F — after a successful payment, a later legitimate same-amount payment works without sheet reopen", () => {
    const first = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(first.ok).toBe(true);
    expect(usePosStore.getState().debtPayments).toHaveLength(1);
    expect(debtPaymentSubmitLockHeld(lockKeyFor(ACCOUNT_A))).toBe(false);

    const later = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(later.ok).toBe(true);
    expect(later.payment!.id).not.toBe(first.payment!.id);
    expect(usePosStore.getState().debtPayments).toHaveLength(2);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(80_000);
  });

  it("G — Customer A in-flight does not block Customer B", () => {
    seedStore({ customers: [customer(CUSTOMER_A, 100_000), customer(CUSTOMER_B, 80_000)] });

    const a = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(a.ok).toBe(true);

    const b = usePosStore.getState().addDebtPayment(CUSTOMER_B, 10_000);
    expect(b.ok).toBe(true);
    expect(b.payment!.id).not.toBe(a.payment!.id);
    expect(usePosStore.getState().debtPayments).toHaveLength(2);

    const state = usePosStore.getState();
    expect(state.customers.find((c) => c.id === CUSTOMER_A)!.debtBalanceUgx).toBe(90_000);
    expect(state.customers.find((c) => c.id === CUSTOMER_B)!.debtBalanceUgx).toBe(70_000);
  });

  it("H — Shop A payment lock does not block Shop B", () => {
    const keyA = lockKeyFor(ACCOUNT_A);
    const keyB = lockKeyFor(ACCOUNT_B);
    expect(keyA).not.toBe(keyB);
    expect(tryBeginDebtPaymentSubmit(keyA)).toBe(true);
    expect(tryBeginDebtPaymentSubmit(keyB)).toBe(true);

    resetDebtPaymentSubmitLocksForTests();
    setActiveAccountKey(ACCOUNT_A);
    seedStore();
    const a = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(a.ok).toBe(true);

    setActiveAccountKey(ACCOUNT_B);
    seedStore();
    const b = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(b.ok).toBe(true);
    expect(b.payment!.id).not.toBe(a.payment!.id);
  });

  it("R7 — sheet reopen helper still clears leftover in-flight keys", () => {
    const key = lockKeyFor(ACCOUNT_A);
    expect(tryBeginDebtPaymentSubmit(key)).toBe(true);
    releaseDebtPaymentSubmitsForAccount(ACCOUNT_A);
    expect(debtPaymentSubmitLockHeld(key)).toBe(false);
    const after = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(after.ok).toBe(true);
  });

  it("I — existing shop_push_debt_payment same-ID idempotency remains intact", () => {
    const sql174 = readFileSync(join(ROOT, "supabase/migrations/174_debt_payment_durable_idempotency.sql"), "utf8");
    expect(sql174).toContain("shop_push_debt_payment");
    expect(sql174).toContain("idempotent");
    expect(sql174).toContain("v_payment_id");

    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).toContain("kind: \"debt_payment\"");
    expect(store).toContain("tryBeginDebtPaymentSubmit");

    const sheet = readFileSync(join(ROOT, "src/components/debts/DebtReceivePaymentSheet.tsx"), "utf8");
    expect(sheet).toContain("submitInFlightRef");
    expect(sheet).toContain("releaseDebtPaymentSubmitsForAccount");

    const push = readFileSync(join(ROOT, "src/lib/debtPaymentPush.ts"), "utf8");
    expect(push).toContain("payment_id: payment.id");
    expect(push).toContain("ack: true");
    expect(push).toContain("idempotent: data.idempotent === true");
  });

  it("financial invariant — one logical payment moves debt, drawer, reports, and CC once", () => {
    const before = usePosStore.getState();
    const beforeBalance = before.customers[0]!.debtBalanceUgx;
    const day = dateKeyKampala(new Date());
    const bounds = { fromKey: day, toKey: day, isSingleDay: true };
    const beforeDrawer = getDrawerCashForDay([], [], [], before.debtPayments, day);
    const beforeReports = sumDebtPaymentsOnDay(before.debtPayments, day);
    const beforeCc = sumDebtPaymentsInBounds(before.debtPayments, bounds);

    const first = usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    const key = lockKeyFor(ACCOUNT_A);
    expect(tryBeginDebtPaymentSubmit(key)).toBe(true);
    usePosStore.getState().addDebtPayment(CUSTOMER_A, 10_000);
    expect(first.ok).toBe(true);

    const after = usePosStore.getState();
    const afterDrawer = getDrawerCashForDay([], [], [], after.debtPayments, day);
    expect(beforeBalance - after.customers[0]!.debtBalanceUgx).toBe(10_000);
    expect(after.debtPayments[0]!.amountUgx).toBe(10_000);
    expect(sumDebtPaymentsOnDay(after.debtPayments, day) - beforeReports).toBe(10_000);
    expect(afterDrawer.debtCollectedUgx - beforeDrawer.debtCollectedUgx).toBe(10_000);
    expect(afterDrawer.expectedDrawerCashUgx - beforeDrawer.expectedDrawerCashUgx).toBe(10_000);
    expect(sumDebtPaymentsInBounds(after.debtPayments, bounds) - beforeCc).toBe(10_000);
    expect(after.preferences.shifts?.[0]?.debtPaymentsTotalUgx).toBe(10_000);
  });
});
