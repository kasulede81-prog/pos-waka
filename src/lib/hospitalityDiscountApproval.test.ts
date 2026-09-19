/**
 * Table-bill discount approval, end to end, through the REAL store actions:
 *
 *   waiter attempts a discount -> store rejects it and records exactly what was attempted
 *   -> manager PIN approves THAT discount -> approval is stored on the pending sale, bound to
 *      the sale, the kind and the amounts -> waiter applies it -> finalizeDraftSale accepts it.
 *
 * The approval never widens what is authorized: a bigger amount, another kind or another sale
 * is rejected both when applying the discount and inside finalizeDraftSale. The financial
 * calculation itself is untouched (revenue / COGS / stock are asserted below).
 */
import { describe, expect, it } from "vitest";
import type { Product, RestaurantBillDraft } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { isDiscountApprovalValid } from "./discountGovernance";

const STEAK: Product = {
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
const WINE: Product = { ...STEAK, id: "wine", name: "Wine", category: "Wine", sellingPricePerUnitUgx: 50_000, costPricePerUnitUgx: 20_000 };

const MANAGER_PIN = "4321";

type Role = "waiter" | "cashier" | "owner";

function base(role: Role, prefs: Record<string, unknown> = {}) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: role === "owner" ? "local:owner" : `staff:${role}`, role, displayName: role },
    products: [STEAK, WINE],
    sales: [],
    stockMovements: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    discountApprovalRequest: null,
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
      discountMaxPercentThreshold: 5,
      backOfficePin: MANAGER_PIN,
      ...prefs,
    },
  });
  openTestShift();
}

/** Opens table `idx` with one Steak (100,000) and saves the bill. Returns its pending sale id. */
function openBill(idx = 0, extra: Product[] = []) {
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  expect(usePosStore.getState().openTable({ tableId: floor.tables[idx]!.id, guestCount: 2 }).ok).toBe(true);
  expect(usePosStore.getState().addHospitalityDraftLine({ product: STEAK, quantity: 1 }).ok).toBe(true);
  for (const p of extra) expect(usePosStore.getState().addHospitalityDraftLine({ product: p, quantity: 1 }).ok).toBe(true);
  expect(usePosStore.getState().saveTableBill().ok).toBe(true);
  return usePosStore.getState().activePendingSaleId!;
}

const approve = (kind: "bill" | "line" = "bill", pin = MANAGER_PIN) =>
  usePosStore.getState().approveTableBillDiscount({ kind, reason: "regular customer", managerPin: pin });
const cart = (n: number) => usePosStore.getState().setDraftCartDiscount(n);
const pending = (id: string) => usePosStore.getState().sales.find((s) => s.id === id)!;
const completed = () => usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status);

function settle(payUgx: number) {
  usePosStore.getState().saveTableBill();
  expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: payUgx }).ok).toBe(true);
  return usePosStore.getState().finalizeTableBill();
}

describe("discount approval — the contract", () => {
  it("a waiter cannot exceed the threshold, and the store remembers exactly what was attempted", () => {
    base("waiter");
    const saleId = openBill();
    const r = cart(30_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("discountManagerApprovalRequired");
    expect(usePosStore.getState().discountApprovalRequest).toMatchObject({
      saleId,
      kind: "bill",
      cartDiscountUgx: 30_000,
      lineDiscountUgx: 0,
      listSubtotalUgx: 100_000,
    });
  });

  it("approving with no attempted discount is refused (nothing to approve)", () => {
    base("waiter");
    openBill();
    const r = approve();
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("discountApprovalNoRequest");
  });

  it("a wrong manager PIN does not approve", () => {
    base("waiter");
    openBill();
    cart(30_000);
    const r = approve("bill", "0000");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("managerPinInvalid");
  });

  it("the approval is bound to the sale, kind and amounts that were actually attempted", () => {
    base("waiter");
    const saleId = openBill();
    cart(30_000);
    expect(approve().ok).toBe(true);
    const a = pending(saleId).billDraft!.discountApproval!;
    expect(a).toMatchObject({
      kind: "bill",
      saleId,
      approvedCartDiscountUgx: 30_000,
      approvedLineDiscountUgx: 0,
      approvedDiscountUgx: 30_000,
      approvedPercent: 30,
      listSubtotalUgx: 100_000,
      viaManagerPin: true,
    });
  });
});

describe("manager approves -> waiter applies -> settlement succeeds", () => {
  it("settles through finalizeDraftSale with the approved discount (was: discountManagerApprovalRequired)", () => {
    base("waiter");
    const saleId = openBill();
    cart(30_000);
    expect(approve().ok).toBe(true);
    expect(cart(30_000).ok).toBe(true);
    const res = settle(70_000);
    expect(res.ok).toBe(true);
    const sale = pending((res as { saleId: string }).saleId);
    expect(sale.id).toBe(saleId);
    expect(sale.totalUgx).toBe(70_000);
  });

  it("changes nothing else: one sale, revenue once, COGS from the retail engine, stock once", () => {
    base("waiter");
    openBill();
    cart(30_000);
    approve();
    cart(30_000);
    const res = settle(70_000);
    expect(res.ok).toBe(true);
    expect(completed()).toHaveLength(1);
    const sale = completed()[0]!;
    expect(sale.lines).toHaveLength(1);
    expect(sale.lines[0]!.cogsUgx).toBe(30_000); // discount does not touch cost
    expect(sale.lines[0]!.unitCostUgx).toBe(30_000);
    expect((usePosStore.getState().preferences.shifts ?? [])[0]!.salesTotalUgx).toBe(70_000);
    expect(usePosStore.getState().products.find((p) => p.id === "steak")!.stockOnHand).toBe(19);
    expect(usePosStore.getState().stockMovements.filter((m) => m.refId === sale.id)).toHaveLength(1);
  });

  it("a line-level approval works the same way (kind = line)", () => {
    base("waiter");
    openBill();
    expect(usePosStore.getState().applyDraftLineDiscount("steak", "final", 70_000).ok).toBe(false);
    expect(usePosStore.getState().discountApprovalRequest).toMatchObject({ kind: "line", lineDiscountUgx: 30_000 });
    expect(approve("line").ok).toBe(true);
    expect(usePosStore.getState().applyDraftLineDiscount("steak", "final", 70_000).ok).toBe(true);
    const res = settle(70_000);
    expect(res.ok).toBe(true);
    expect(completed()[0]!.totalUgx).toBe(70_000);
  });

  it("owner / manager needs no approval at all (unchanged)", () => {
    base("owner");
    openBill();
    expect(cart(30_000).ok).toBe(true);
    expect(settle(70_000).ok).toBe(true);
  });
});

describe("the approval never widens", () => {
  it("approved 10% -> attempted 20% is rejected (apply and settle)", () => {
    base("waiter");
    const saleId = openBill();
    cart(10_000);
    expect(approve().ok).toBe(true);
    expect(cart(10_000).ok).toBe(true);
    const wider = cart(20_000);
    expect(wider.ok).toBe(false);
    expect(wider.errorKey).toBe("discountManagerApprovalRequired");
    // even if the draft is forced past the approval, the financial core refuses to settle it
    usePosStore.setState({ draftCartDiscountUgx: 20_000 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 80_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("discountManagerApprovalRequired");
    expect(completed()).toHaveLength(0);
    expect(pending(saleId).status).toBe("pending");
  });

  it("approved UGX 10,000 -> attempted UGX 50,000 is rejected", () => {
    base("waiter", { discountMaxPercentThreshold: 1 });
    openBill();
    cart(10_000);
    expect(approve().ok).toBe(true);
    expect(cart(10_000).ok).toBe(true);
    expect(cart(50_000).ok).toBe(false);
    usePosStore.setState({ draftCartDiscountUgx: 50_000 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 50_000 });
    expect(usePosStore.getState().finalizeTableBill().errorKey).toBe("discountManagerApprovalRequired");
  });

  it("the same UGX amount is not enough if it would exceed the approved PERCENT (subtotal shrank)", () => {
    base("waiter");
    openBill(0, [WINE]); // subtotal 150,000
    cart(15_000); // 10%
    expect(approve().ok).toBe(true);
    expect(cart(15_000).ok).toBe(true);
    // the wine is removed: 15,000 would now be 15% of 100,000
    const wineId = usePosStore.getState().draftLines.find((l) => l.productId === "wine")!.id!;
    usePosStore.getState().removeDraftLineById(wineId);
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 85_000 });
    expect(usePosStore.getState().finalizeTableBill().errorKey).toBe("discountManagerApprovalRequired");
  });

  it("an approval for one kind does not authorize the other", () => {
    base("waiter");
    openBill();
    cart(30_000);
    expect(approve("bill").ok).toBe(true);
    // a LINE discount is a different kind of discount: it needs its own approval
    expect(usePosStore.getState().applyDraftLineDiscount("steak", "final", 70_000).ok).toBe(false);
    // and a bill approval does not cover a line amount at settlement either
    usePosStore.setState((st) => ({
      draftLines: st.draftLines.map((l) => ({ ...l, lineTotalUgx: 70_000, discountUgx: 30_000, originalLineTotalUgx: 100_000 })),
      draftCartDiscountUgx: 0,
    }));
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 70_000 });
    expect(usePosStore.getState().finalizeTableBill().errorKey).toBe("discountManagerApprovalRequired");
  });

  it("the hard max-percent cap can never be approved away", () => {
    base("waiter", { discountControlMode: "max_percent", discountMaxPercentThreshold: 10 });
    openBill();
    expect(cart(30_000).errorKey).toBe("discountExceedsMaxPercent");
    // even a forged approval does not lift the cap
    const saleId = usePosStore.getState().activePendingSaleId!;
    usePosStore.setState((st) => ({
      sales: st.sales.map((s) =>
        s.id === saleId
          ? {
              ...s,
              billDraft: {
                ...(s.billDraft as RestaurantBillDraft),
                discountApproval: {
                  approvedByUserId: "x",
                  approvedByLabel: "x",
                  reason: "x",
                  at: "2026-09-18T00:00:00.000Z",
                  kind: "bill",
                  saleId,
                  approvedLineDiscountUgx: 0,
                  approvedCartDiscountUgx: 30_000,
                  approvedDiscountUgx: 30_000,
                  approvedPercent: 30,
                  listSubtotalUgx: 100_000,
                },
              },
            }
          : s,
      ),
    }));
    expect(cart(30_000).errorKey).toBe("discountExceedsMaxPercent");
  });

  it("a legacy approval without amounts authorizes nothing", () => {
    base("waiter");
    const saleId = openBill();
    expect(
      isDiscountApprovalValid(
        { approvedByUserId: "m", approvedByLabel: "m", reason: "r", at: "t", kind: "bill" },
        { saleId, kind: "bill", lineDiscountUgx: 0, cartDiscountUgx: 1, listSubtotalUgx: 100_000 },
      ),
    ).toBe(false);
  });
});

describe("the approval is bound to its own sale", () => {
  it("approval from draft A is rejected on draft B (apply and settle)", () => {
    base("waiter");
    const saleA = openBill(0);
    cart(30_000);
    expect(approve().ok).toBe(true);
    const approvalA = pending(saleA).billDraft!.discountApproval!;

    const saleB = openBill(1);
    expect(saleB).not.toBe(saleA);
    // B has no approval of its own
    expect(cart(30_000).ok).toBe(false);

    // carry A's approval object onto B (a copy / merge / replay): the sale id no longer matches
    usePosStore.setState((st) => ({
      sales: st.sales.map((s) => (s.id === saleB ? { ...s, billDraft: { ...(s.billDraft as RestaurantBillDraft), discountApproval: approvalA } } : s)),
    }));
    expect(cart(30_000).ok).toBe(false);
    usePosStore.setState({ draftCartDiscountUgx: 30_000 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 70_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("discountManagerApprovalRequired");
    expect(completed()).toHaveLength(0);
  });

  it("a request recorded for table A cannot be approved onto table B", () => {
    base("waiter");
    openBill(0);
    cart(30_000); // request recorded for A
    openBill(1); // now working on B
    const r = approve();
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("discountApprovalNoRequest");
  });
});

describe("isDiscountApprovalValid — each rule on its own", () => {
  const approval = (over: Record<string, unknown> = {}) => ({
    approvedByUserId: "manager",
    approvedByLabel: "Manager",
    reason: "regular",
    at: "2026-09-18T10:00:00.000Z",
    kind: "bill" as const,
    saleId: "sale-1",
    approvedLineDiscountUgx: 0,
    approvedCartDiscountUgx: 10_000,
    approvedDiscountUgx: 10_000,
    approvedPercent: 10,
    listSubtotalUgx: 100_000,
    ...over,
  });
  const ctx = (over: Record<string, unknown> = {}) => ({
    saleId: "sale-1",
    kind: "bill" as const,
    lineDiscountUgx: 0,
    cartDiscountUgx: 10_000,
    listSubtotalUgx: 100_000,
    ...over,
  });

  it("accepts exactly what was approved (and anything smaller)", () => {
    expect(isDiscountApprovalValid(approval(), ctx())).toBe(true);
    expect(isDiscountApprovalValid(approval(), ctx({ cartDiscountUgx: 5_000 }))).toBe(true);
  });

  it("kind: another kind is refused even when every amount is within the caps", () => {
    const loose = approval({ kind: "line", approvedLineDiscountUgx: 50_000, approvedCartDiscountUgx: 50_000, approvedDiscountUgx: 100_000, approvedPercent: 100 });
    expect(isDiscountApprovalValid(loose, ctx({ kind: "line", lineDiscountUgx: 1, cartDiscountUgx: 1 }))).toBe(true);
    expect(isDiscountApprovalValid(loose, ctx({ kind: "bill", lineDiscountUgx: 1, cartDiscountUgx: 1 }))).toBe(false);
  });

  it("sale: another sale is refused, and so is a missing sale id", () => {
    expect(isDiscountApprovalValid(approval(), ctx({ saleId: "sale-2" }))).toBe(false);
    expect(isDiscountApprovalValid(approval(), ctx({ saleId: null }))).toBe(false);
    expect(isDiscountApprovalValid(approval({ saleId: undefined }), ctx())).toBe(false);
  });

  it("cart cap: a larger cart discount is refused even inside the total and percent caps", () => {
    const loose = approval({ approvedCartDiscountUgx: 10_000, approvedDiscountUgx: 100_000, approvedPercent: 100 });
    expect(isDiscountApprovalValid(loose, ctx({ cartDiscountUgx: 10_000 }))).toBe(true);
    expect(isDiscountApprovalValid(loose, ctx({ cartDiscountUgx: 20_000 }))).toBe(false);
  });

  it("line cap: a larger line discount is refused even inside the total and percent caps", () => {
    const loose = approval({ approvedLineDiscountUgx: 5_000, approvedCartDiscountUgx: 50_000, approvedDiscountUgx: 100_000, approvedPercent: 100 });
    expect(isDiscountApprovalValid(loose, ctx({ lineDiscountUgx: 5_000, cartDiscountUgx: 0 }))).toBe(true);
    expect(isDiscountApprovalValid(loose, ctx({ lineDiscountUgx: 6_000, cartDiscountUgx: 0 }))).toBe(false);
  });

  it("total cap: line + cart together cannot exceed the approved total", () => {
    const a = approval({ approvedLineDiscountUgx: 50_000, approvedCartDiscountUgx: 50_000, approvedDiscountUgx: 60_000, approvedPercent: 100 });
    expect(isDiscountApprovalValid(a, ctx({ lineDiscountUgx: 30_000, cartDiscountUgx: 30_000 }))).toBe(true);
    expect(isDiscountApprovalValid(a, ctx({ lineDiscountUgx: 40_000, cartDiscountUgx: 30_000 }))).toBe(false);
  });

  it("percent cap: the same amount is refused if it is now a larger share of the subtotal", () => {
    expect(isDiscountApprovalValid(approval(), ctx({ listSubtotalUgx: 200_000 }))).toBe(true);
    expect(isDiscountApprovalValid(approval(), ctx({ listSubtotalUgx: 50_000 }))).toBe(false);
  });

  it("missing or non-finite caps authorize nothing", () => {
    expect(isDiscountApprovalValid(approval({ approvedPercent: undefined }), ctx())).toBe(false);
    expect(isDiscountApprovalValid(approval({ approvedDiscountUgx: Number.NaN }), ctx())).toBe(false);
    expect(isDiscountApprovalValid(null, ctx())).toBe(false);
  });
});
