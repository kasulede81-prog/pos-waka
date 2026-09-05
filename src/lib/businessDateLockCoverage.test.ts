import { beforeEach, describe, expect, it } from "vitest";
import type { CashExpense, Customer, DayCloseSummary, Product, Supplier } from "../types";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { dateKeyKampala } from "./datesUg";
import { cashExpenseTransitionWouldAffectDrawer } from "./cashExpenses";
import { openTestShift } from "../test/shiftTestSetup";

const TODAY = dateKeyKampala(new Date());
const CLOSED_PRIOR = "2026-09-04";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUPPLIER_ID = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_OWNER = { userId: "owner-1", role: "owner" as const, displayName: "Owner" };
const ACTOR_CASHIER = { userId: "staff:1", role: "cashier" as const, displayName: "Cashier" };
const ACTOR_WAITER = { userId: "waiter-1", role: "waiter" as const, displayName: "Waiter" };

function closeFor(dateKey: string): DayCloseSummary {
  return {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: 100_000,
    countedCashUgx: 100_000,
    differenceUgx: 0,
    totalSalesUgx: 0,
    totalDebtUgx: 0,
    profitEstimateUgx: 0,
    createdAt: `${dateKey}T20:00:00.000Z`,
  };
}

function customer(debtBalanceUgx = 50_000): Customer {
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

function supplier(balanceOwedUgx = 80_000): Supplier {
  return {
    id: SUPPLIER_ID,
    name: "Wholesaler",
    phone: "",
    location: "",
    notes: "",
    balanceOwedUgx,
    lastSupplyAt: null,
    totalPurchasesUgx: 80_000,
    createdAt: "2026-05-01T00:00:00.000Z",
    version: 1,
  };
}

function expense(
  partial: Partial<CashExpense> & Pick<CashExpense, "id" | "approvalStatus" | "paidOn">,
): CashExpense {
  return {
    category: "lunch",
    amountUgx: 50_000,
    description: "soda",
    createdAt: `${partial.paidOn}T10:00:00.000Z`,
    updatedAt: `${partial.paidOn}T10:00:00.000Z`,
    createdByUserId: "cashier-1",
    createdByLabel: "Cashier",
    pendingSync: false,
    deletedAt: null,
    ...partial,
  };
}

const product: Product = {
  id: PRODUCT_ID,
  name: "Item",
  sellingPricePerUnitUgx: 1_000,
  costPricePerUnitUgx: 100,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function seed(opts?: {
  role?: "owner" | "cashier" | "waiter";
  dayCloses?: DayCloseSummary[];
  cashExpenses?: CashExpense[];
}) {
  const role = opts?.role ?? "owner";
  const actor = role === "owner" ? ACTOR_OWNER : role === "waiter" ? ACTOR_WAITER : ACTOR_CASHIER;
  usePosStore.setState({
    _hydrated: true,
    sessionActor: actor,
    products: [product],
    customers: [customer()],
    suppliers: [supplier()],
    debtPayments: [],
    supplierPayments: [],
    cashExpenses: opts?.cashExpenses ?? [],
    cashDrawerAdjustments: [],
    sales: [],
    returnRecords: [],
    dayCloses: opts?.dayCloses ?? [],
    dayDrawerOpens: [],
    auditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    preferences: {
      ...createDefaultPreferences(),
      cashDrawerFormulaVersion: "v2",
      staffCanRecordCashExpenses: true,
      requireCashierExpenseApproval: true,
      backOfficePin: "1234",
      shifts: [],
    },
  });
}

describe("cashExpenseTransitionWouldAffectDrawer", () => {
  it("approve pending changes drawer; reject pending does not", () => {
    const pending = expense({ id: "e1", approvalStatus: "pending", paidOn: TODAY });
    expect(cashExpenseTransitionWouldAffectDrawer(pending, "approved")).toBe(true);
    expect(cashExpenseTransitionWouldAffectDrawer(pending, "rejected")).toBe(false);
    expect(cashExpenseTransitionWouldAffectDrawer(pending, "voided")).toBe(false);
  });

  it("void approved changes drawer; void rejected does not", () => {
    const approved = expense({ id: "e2", approvalStatus: "approved", paidOn: TODAY });
    const rejected = expense({ id: "e3", approvalStatus: "rejected", paidOn: TODAY });
    expect(cashExpenseTransitionWouldAffectDrawer(approved, "voided")).toBe(true);
    expect(cashExpenseTransitionWouldAffectDrawer(rejected, "voided")).toBe(false);
  });
});

describe("CASH-POST-07 business-date lock coverage", () => {
  beforeEach(() => {
    seed();
  });

  it("A — closed day rejects debt cash payment with no mutation", () => {
    seed({ role: "cashier", dayCloses: [closeFor(TODAY)] });
    expect(openTestShift().ok).toBe(true);
    const beforeDebt = usePosStore.getState().customers[0]!.debtBalanceUgx;
    const r = usePosStore.getState().addDebtPayment(CUSTOMER_ID, 10_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().debtPayments).toHaveLength(0);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(beforeDebt);
  });

  it("B — open day debt cash payment succeeds", () => {
    seed({ role: "cashier" });
    expect(openTestShift().ok).toBe(true);
    const r = usePosStore.getState().addDebtPayment(CUSTOMER_ID, 10_000);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().debtPayments).toHaveLength(1);
    expect(usePosStore.getState().customers[0]!.debtBalanceUgx).toBe(40_000);
  });

  it("C — closed day rejects supplier cash payment with no mutation", () => {
    seed({ dayCloses: [closeFor(TODAY)] });
    const before = usePosStore.getState().suppliers[0]!.balanceOwedUgx;
    const r = usePosStore.getState().addSupplierPayment(SUPPLIER_ID, 15_000);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().supplierPayments).toHaveLength(0);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(before);
  });

  it("D — open day supplier cash payment succeeds", () => {
    const r = usePosStore.getState().addSupplierPayment(SUPPLIER_ID, 15_000);
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().supplierPayments).toHaveLength(1);
    expect(usePosStore.getState().suppliers[0]!.balanceOwedUgx).toBe(65_000);
  });

  it("E — closed ledger date rejects expense approval; expense stays pending", () => {
    seed({
      cashExpenses: [expense({ id: "exp-pending", approvalStatus: "pending", paidOn: CLOSED_PRIOR })],
      dayCloses: [closeFor(CLOSED_PRIOR)],
    });
    const r = usePosStore.getState().approveCashExpense("exp-pending");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
    const row = usePosStore.getState().cashExpenses[0]!;
    expect(row.approvalStatus).toBe("pending");
    expect(row.pendingSync).toBe(false);
  });

  it("E2 — approval uses expense paidOn, not today", () => {
    seed({
      cashExpenses: [expense({ id: "exp-prior", approvalStatus: "pending", paidOn: CLOSED_PRIOR })],
      dayCloses: [closeFor(CLOSED_PRIOR)],
    });
    expect(usePosStore.getState().dayCloses.some((d) => d.dateKey === TODAY && !d.supersededAt)).toBe(false);
    const r = usePosStore.getState().approveCashExpense("exp-prior");
    expect(r.errorKey).toBe("businessDateLocked");
  });

  it("F — open day expense approval succeeds", () => {
    seed({
      cashExpenses: [expense({ id: "exp-open", approvalStatus: "pending", paidOn: TODAY })],
    });
    const r = usePosStore.getState().approveCashExpense("exp-open");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("approved");
  });

  it("G — reject pending on closed date is allowed because drawer is unchanged", () => {
    seed({
      cashExpenses: [expense({ id: "exp-rej", approvalStatus: "pending", paidOn: CLOSED_PRIOR })],
      dayCloses: [closeFor(CLOSED_PRIOR)],
    });
    const r = usePosStore.getState().rejectCashExpense("exp-rej");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("rejected");
  });

  it("H — void approved on closed date is rejected; expense remains", () => {
    seed({
      cashExpenses: [expense({ id: "exp-void", approvalStatus: "approved", paidOn: CLOSED_PRIOR })],
      dayCloses: [closeFor(CLOSED_PRIOR)],
    });
    const r = usePosStore.getState().voidCashExpense("exp-void", "remove after close");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
    const row = usePosStore.getState().cashExpenses[0]!;
    expect(row.deletedAt).toBeFalsy();
    expect(row.pendingSync).toBe(false);
  });

  it("H2 — void pending on closed date is allowed because drawer is unchanged", () => {
    seed({
      cashExpenses: [expense({ id: "exp-void-p", approvalStatus: "pending", paidOn: CLOSED_PRIOR })],
      dayCloses: [closeFor(CLOSED_PRIOR)],
    });
    const r = usePosStore.getState().voidCashExpense("exp-void-p", "cleanup pending");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().cashExpenses[0]!.deletedAt).toBeTruthy();
  });

  it("I — closed day rejects beginShiftV2", () => {
    seed({ dayCloses: [closeFor(TODAY)] });
    const opened = usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    expect(opened.ok).toBe(false);
    expect(opened.errorKey).toBe("businessDateLocked");

    usePosStore.setState({
      dayDrawerOpens: [
        {
          id: "do-1",
          dateKey: TODAY,
          openingFloatUgx: 100_000,
          countedAt: new Date().toISOString(),
          countedByUserId: "owner-1",
          countedByLabel: "Owner",
          firstVerifiedByUserId: null,
          firstVerifiedByLabel: null,
          note: "",
          witnessUserId: null,
          deviceId: "dev-1",
          status: "open",
          supersedesId: null,
          voidReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pendingSync: false,
          lastSyncError: null,
          deletedAt: null,
        },
      ],
    });
    const r = usePosStore.getState().beginShiftV2({ verifiedFloatUgx: 100_000 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().preferences.shifts ?? []).toHaveLength(0);
  });

  it("J — open day beginShiftV2 succeeds", () => {
    const opened = usePosStore.getState().recordDayDrawerOpen({ openingFloatUgx: 100_000 });
    expect(opened.ok).toBe(true);
    const r = usePosStore.getState().beginShiftV2({ verifiedFloatUgx: 100_000 });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.shifts?.[0]?.endAt).toBeNull();
  });

  it("K — existing sale / void / return / expense create / adjustment still reject after close", () => {
    seed({ role: "owner", dayCloses: [closeFor(TODAY)] });
    expect(openTestShift().ok).toBe(true);

    usePosStore.setState({
      draftLines: [
        {
          id: "line-1",
          productId: PRODUCT_ID,
          name: "Item",
          inputMode: "quantity",
          quantity: 1,
          unitPriceUgx: 1_000,
          unitCostUgx: 100,
          lineTotalUgx: 1_000,
          estimatedProfitUgx: 900,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const sale = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 1_000,
      changeGivenUgx: 0,
    });
    expect(sale.ok).toBe(false);
    expect(sale.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().sales).toHaveLength(0);

    usePosStore.setState({
      sales: [
        {
          id: "sale-closed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          subtotalUgx: 1_000,
          totalUgx: 1_000,
          cashPaidUgx: 1_000,
          debtUgx: 0,
          paymentMethod: "cash",
          estimatedProfitUgx: 100,
          lines: [
            {
              id: "line-1",
              productId: PRODUCT_ID,
              name: "Item",
              inputMode: "quantity",
              quantity: 1,
              unitPriceUgx: 1_000,
              unitCostUgx: 100,
              lineTotalUgx: 1_000,
              estimatedProfitUgx: 900,
              updatedAt: new Date().toISOString(),
            },
          ],
          pendingSync: false,
          lastSyncError: null,
          status: "completed",
        },
      ],
    });
    const voidR = usePosStore.getState().voidSaleLine({
      saleId: "sale-closed",
      lineIndex: 0,
      reason: "wrong_item",
    });
    expect(voidR.ok).toBe(false);
    expect(voidR.errorKey).toBe("businessDateLocked");

    const ret = usePosStore.getState().returnProduct({
      saleId: "sale-closed",
      productId: PRODUCT_ID,
      quantity: 1,
      refundAmountUgx: 1_000,
      reason: "wrong_item",
    });
    expect(ret.ok).toBe(false);
    expect(ret.errorKey).toBe("businessDateLocked");

    const exp = usePosStore.getState().addCashExpense({ amountUgx: 5_000, category: "lunch" });
    expect(exp.ok).toBe(false);
    expect(exp.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().cashExpenses).toHaveLength(0);

    const adj = usePosStore.getState().addCashDrawerAdjustment({
      type: "cash_added",
      amountUgx: 5_000,
      note: "till top up",
    });
    expect(adj.ok).toBe(false);
    expect(adj.errorKey).toBe("businessDateLocked");
    expect(usePosStore.getState().cashDrawerAdjustments).toHaveLength(0);
  });

  it("L — permission denial stays distinct from date-lock denial", () => {
    seed({ role: "waiter", dayCloses: [closeFor(TODAY)] });
    expect(openTestShift().ok).toBe(true);
    const debt = usePosStore.getState().addDebtPayment(CUSTOMER_ID, 10_000);
    expect(debt.ok).toBe(false);
    expect(debt.errorKey).toBe("forbidden");
    expect(debt.errorKey).not.toBe("businessDateLocked");

    const pay = usePosStore.getState().addSupplierPayment(SUPPLIER_ID, 10_000);
    expect(pay.ok).toBe(false);
    expect(pay.errorKey).toBe("forbidden");

    seed({
      role: "cashier",
      dayCloses: [closeFor(CLOSED_PRIOR)],
      cashExpenses: [expense({ id: "exp-perm", approvalStatus: "pending", paidOn: CLOSED_PRIOR })],
    });
    const approve = usePosStore.getState().approveCashExpense("exp-perm");
    expect(approve.ok).toBe(false);
    expect(approve.errorKey).toBe("forbidden");
    expect(usePosStore.getState().cashExpenses[0]!.approvalStatus).toBe("pending");
  });

  it("M — rejected mutation does not mark a pending cash sync row", () => {
    seed({ dayCloses: [closeFor(TODAY)] });
    expect(openTestShift().ok).toBe(true);
    usePosStore.getState().addDebtPayment(CUSTOMER_ID, 10_000);
    usePosStore.getState().addSupplierPayment(SUPPLIER_ID, 10_000);
    expect(usePosStore.getState().debtPayments).toHaveLength(0);
    expect(usePosStore.getState().supplierPayments).toHaveLength(0);
    expect(usePosStore.getState().customers[0]!.version).toBe(1);
    expect(usePosStore.getState().suppliers[0]!.version).toBe(1);
  });
});
