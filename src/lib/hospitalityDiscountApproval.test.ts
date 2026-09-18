/**
 * Discount approval on a table bill, traced end to end:
 *   approveTableBillDiscount -> billDraft.discountApproval (persisted on the pending sale)
 *   -> setDraftCartDiscount / applyDraftLineDiscount honour it (draft level)
 *   -> finalizeTableBill -> finalizeDraftSale
 *
 * The last hop is in the protected financial core: finalizeDraftSale re-validates the discount
 * with the ACTOR'S ROLE only (usePosStore.ts, "discountPolicy" block) and never reads
 * billDraft.discountApproval. So an approved discount can be applied to the bill but a cashier /
 * waiter cannot settle it. That needs a change inside finalizeDraftSale, which this round is not
 * allowed to make; the failing hop is pinned below with it.fails so whoever fixes the core sees
 * this test flip.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";

const ITEM: Product = {
  id: "steak",
  name: "Steak",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 30_000,
  stockOnHand: 20,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
};

const MANAGER_PIN = "4321";

function setup(role: "waiter" | "cashier" | "owner") {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: role === "owner" ? "local:owner" : `staff:${role}`, role, displayName: role },
    products: [ITEM],
    sales: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityManualKitchenFire: true,
      hospitalityFloor: defaultHospitalityFloor(),
      hospitalityServiceChargePercent: 0,
      hospitalityTaxEnabled: false,
      discountControlMode: "manager_approval",
      discountMaxPercentThreshold: 10,
      backOfficePin: MANAGER_PIN,
    },
  });
  openTestShift();
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
  expect(usePosStore.getState().addHospitalityDraftLine({ product: ITEM, quantity: 1 }).ok).toBe(true);
  expect(usePosStore.getState().saveTableBill().ok).toBe(true);
}

describe("table-bill discount approval", () => {
  beforeEach(() => undefined);

  it("a waiter cannot exceed the threshold on their own", () => {
    setup("waiter");
    const r = usePosStore.getState().setDraftCartDiscount(30_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("discountManagerApprovalRequired");
  });

  it("a wrong manager PIN does not approve", () => {
    setup("waiter");
    const r = usePosStore.getState().approveTableBillDiscount({ kind: "bill", reason: "regular", managerPin: "0000" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("managerPinInvalid");
  });

  it("a valid approval is persisted on the pending sale and unlocks the discount on the draft", () => {
    setup("waiter");
    const ok = usePosStore.getState().approveTableBillDiscount({ kind: "bill", reason: "regular customer", managerPin: MANAGER_PIN });
    expect(ok.ok).toBe(true);
    const st = usePosStore.getState();
    const sale = st.sales.find((s) => s.id === st.activePendingSaleId)!;
    expect(sale.billDraft?.discountApproval?.reason).toBe("regular customer");
    expect(sale.billDraft?.discountApproval?.approvedByUserId).toBeTruthy();
    expect(usePosStore.getState().setDraftCartDiscount(30_000).ok).toBe(true);
    expect(usePosStore.getState().draftCartDiscountUgx).toBe(30_000);
    expect(usePosStore.getState().saveTableBill().ok).toBe(true);
  });

  it("the approval survives saving and re-reading the pending sale (it is persisted, not transient)", () => {
    setup("waiter");
    usePosStore.getState().approveTableBillDiscount({ kind: "bill", reason: "regular customer", managerPin: MANAGER_PIN });
    usePosStore.getState().setDraftCartDiscount(30_000);
    usePosStore.getState().saveTableBill();
    usePosStore.getState().saveTableBill();
    const st = usePosStore.getState();
    const sale = st.sales.find((s) => s.id === st.activePendingSaleId)!;
    expect(sale.billDraft?.discountApproval?.approvedByUserId).toBeTruthy();
  });

  it("an owner/manager applies and settles a discount above the threshold without any approval", () => {
    setup("owner");
    expect(usePosStore.getState().setDraftCartDiscount(30_000).ok).toBe(true);
    usePosStore.getState().saveTableBill();
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 70_000 }).ok).toBe(true);
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const sale = usePosStore.getState().sales.find((s) => s.id === (res as { saleId: string }).saleId)!;
    expect(sale.totalUgx).toBe(70_000);
  });

  // KNOWN GAP (financial core): the approved discount cannot be settled by the non-manager.
  // Fixing it means finalizeDraftSale must accept the persisted approval, which is a change to the
  // protected core — reported, not made. When that is done this test starts passing and
  // `it.fails` will flag it so the marker can be removed.
  it.fails("a waiter can settle a bill whose discount a manager approved", () => {
    setup("waiter");
    usePosStore.getState().approveTableBillDiscount({ kind: "bill", reason: "regular customer", managerPin: MANAGER_PIN });
    usePosStore.getState().setDraftCartDiscount(30_000);
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 70_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    expect(res.errorKey).not.toBe("discountManagerApprovalRequired");
  });
});
