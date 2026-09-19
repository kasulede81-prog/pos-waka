/**
 * Round 3 / P4 — cancelling a pending table bill must never make recorded payments disappear.
 *
 * Money recorded on a table bill (cash / MoMo / ...) is only booked to the shift when the sale is
 * finalized. Cancelling before then used to flip the sale to "cancelled" and close the session, leaving
 * the cash in the till with no refund and no record the shift could reconcile. Retail's shared void
 * lifecycle (settle → void) is the only path that books a refund, so the cancel is refused instead.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { pendingSaleReceivedPaymentsUgx } from "./saleLifecycle";

const PLATE: Product = {
  id: "plate",
  name: "Plate",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 20_000,
  costPricePerUnitUgx: 8_000,
  stockOnHand: 50,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
};

const st = () => usePosStore.getState();
const shift = () => (st().preferences.shifts ?? [])[0]!;

function openBillWithPlate(qty = 2) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [{ ...PLATE }],
    customers: [{ id: "c1", name: "Regular", phone: "0700000001", debtUgx: 0 } as never],
    sales: [],
    stockMovements: [],
    voidRecords: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...st().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityFloor: defaultHospitalityFloor(),
      hospitalityServiceChargePercent: 0,
      hospitalityTaxEnabled: false,
    },
  });
  openTestShift();
  const floor = st().preferences.hospitalityFloor!;
  const opened = st().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
  expect(opened.ok).toBe(true);
  const sessionId = (opened as { sessionId: string }).sessionId;
  st().addHospitalityDraftLine({ product: PLATE, quantity: qty });
  expect(st().saveTableBill().ok).toBe(true);
  return { sessionId, saleId: st().activePendingSaleId! };
}

const pendingSale = (saleId: string) => st().sales.find((s) => s.id === saleId)!;

describe("cancelling a pending table bill with recorded payments", () => {
  let ids: { sessionId: string; saleId: string };
  beforeEach(() => {
    ids = openBillWithPlate();
  });

  it("is refused when cash was already taken, and nothing changes", () => {
    expect(st().recordTableBillPayment({ method: "cash", amountUgx: 15_000 }).ok).toBe(true);
    const before = pendingSale(ids.saleId);

    const res = st().cancelPendingSale(ids.saleId);
    expect(res).toEqual({ ok: false, errorKey: "pendingSalePaymentsRecorded" });

    const after = pendingSale(ids.saleId);
    expect(after.status).toBe("pending");
    expect(after.billDraft?.payments).toHaveLength(1);
    expect(after.billDraft?.payments[0]!.amountUgx).toBe(15_000);
    expect(after).toEqual(before);
    const session = st().preferences.hospitalityFloor!.sessions.find((s) => s.id === ids.sessionId)!;
    expect(session.status).not.toBe("cancelled");
    expect(st().activePendingSaleId).toBe(ids.saleId);
  });

  it("the same guard applies to the cashier's Void Sale action", () => {
    expect(st().recordTableBillPayment({ method: "mobile_money", amountUgx: 10_000, reference: "MM-1" }).ok).toBe(true);
    const res = st().voidCurrentCart();
    expect(res.ok).toBe(false);
    expect((res as { errorKey?: string }).errorKey).toBe("pendingSalePaymentsRecorded");
    expect(pendingSale(ids.saleId).status).toBe("pending");
    expect(pendingSale(ids.saleId).billDraft?.payments).toHaveLength(1);
  });

  it("is allowed when nothing was received", () => {
    expect(st().cancelPendingSale(ids.saleId).ok).toBe(true);
    expect(pendingSale(ids.saleId).status).toBe("cancelled");
    expect(shift().salesTotalUgx ?? 0).toBe(0);
    expect(shift().estimatedCashUgx ?? 0).toBe(0);
  });

  it("is allowed when the only payment is credit (a promise to pay, not money received)", () => {
    st().setDraftSaleCustomer({ customerId: "c1" });
    expect(st().recordTableBillPayment({ method: "credit", amountUgx: 10_000 }).ok).toBe(true);
    expect(pendingSaleReceivedPaymentsUgx(pendingSale(ids.saleId))).toBe(0);
    expect(st().cancelPendingSale(ids.saleId).ok).toBe(true);
    expect(pendingSale(ids.saleId).status).toBe("cancelled");
  });

  it("the supported route — settle then void — books the refund and returns the till to zero", () => {
    expect(st().recordTableBillPayment({ method: "cash", amountUgx: 40_000 }).ok).toBe(true);
    const res = st().finalizeTableBill();
    expect(res.ok).toBe(true);
    expect(shift().salesTotalUgx).toBe(40_000);
    expect(st().voidSettledTableBill({ sessionId: ids.sessionId, reason: "walked out", managerPin: "" }).ok).toBe(true);
    expect(shift().voidsTotalUgx).toBe(40_000);
    expect(shift().estimatedCashUgx).toBe(0);
    expect(st().products.find((p) => p.id === "plate")!.stockOnHand).toBe(50);
  });

  it("pendingSaleReceivedPaymentsUgx ignores credit and sums real receipts", () => {
    const mk = (method: string, amountUgx: number) => ({ method, amountUgx, id: method + amountUgx, recordedAt: "" });
    expect(
      pendingSaleReceivedPaymentsUgx({ billDraft: { payments: [mk("cash", 5_000), mk("credit", 9_000), mk("card", 2_000)] } } as never),
    ).toBe(7_000);
    expect(pendingSaleReceivedPaymentsUgx({ billDraft: undefined })).toBe(0);
  });
});
