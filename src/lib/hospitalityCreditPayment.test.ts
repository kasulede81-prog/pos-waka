/**
 * Credit on a table bill follows retail/Kiosk Duka exactly: a debt needs a chosen or named
 * customer, and the debt itself is created by the shared finalizeDraftSale / resolveDebtorForSale
 * machinery — hospitality has no debt logic of its own.
 */
import { describe, expect, it } from "vitest";
import type { Customer, Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { physicalCashCollectedFromSale } from "./cashDrawerSales";

const ITEM: Product = {
  id: "grill",
  name: "Grill",
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

const REGULAR: Customer = {
  id: "cust-1",
  name: "Regular Rita",
  phone: "0700000000",
  location: "Kampala",
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  debtBalanceUgx: 5_000,
};

function setup(customer?: { id?: string; name?: string; phone?: string }) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [ITEM],
    customers: [REGULAR],
    sales: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftSaleCustomerId: customer?.id ?? "",
    draftSaleCustomerName: customer?.name ?? "",
    draftSaleCustomerPhone: customer?.phone ?? "",
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityManualKitchenFire: true,
      hospitalityFloor: defaultHospitalityFloor(),
      hospitalityServiceChargePercent: 0,
      hospitalityTaxEnabled: false,
    },
  });
  openTestShift();
  const floor = usePosStore.getState().preferences.hospitalityFloor!;
  expect(usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 }).ok).toBe(true);
  expect(usePosStore.getState().addHospitalityDraftLine({ product: ITEM, quantity: 1 }).ok).toBe(true);
  expect(usePosStore.getState().saveTableBill().ok).toBe(true);
}

const completed = () => usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status);

describe("credit payment on a table bill", () => {
  it("cannot be recorded without a customer (same rule as retail checkout)", () => {
    setup();
    const r = usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 100_000 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("debtRequiresCustomerName");
    const st = usePosStore.getState();
    expect(st.sales.find((s) => s.id === st.activePendingSaleId)!.billDraft?.payments ?? []).toHaveLength(0);
  });

  it("a whitespace-only name is not a customer", () => {
    setup({ name: "   " });
    expect(usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 100_000 }).errorKey).toBe(
      "debtRequiresCustomerName",
    );
  });

  it("an unknown customer id with no name is not a customer either", () => {
    setup({ id: "ghost" });
    expect(usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 100_000 }).ok).toBe(false);
  });

  it("with a NAMED customer it settles as ONE sale with the debt on a new customer record", () => {
    setup({ name: "Walk-in Wanjiru", phone: "0711111111" });
    expect(usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 100_000 }).ok).toBe(true);
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    const sales = completed();
    expect(sales).toHaveLength(1);
    expect(sales[0]!.totalUgx).toBe(100_000);
    expect(sales[0]!.debtUgx).toBe(100_000);
    expect(sales[0]!.paymentMethod).toBe("credit");
    const debtor = usePosStore.getState().customers.find((c) => c.name === "Walk-in Wanjiru");
    expect(debtor?.debtBalanceUgx).toBe(100_000);
    expect(sales[0]!.customerId).toBe(debtor?.id);
  });

  it("with an EXISTING customer the debt is added to their balance", () => {
    setup({ id: REGULAR.id });
    expect(usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 100_000 }).ok).toBe(true);
    expect(usePosStore.getState().finalizeTableBill().ok).toBe(true);
    expect(usePosStore.getState().customers.find((c) => c.id === REGULAR.id)!.debtBalanceUgx).toBe(105_000);
    expect(completed()[0]!.customerId).toBe(REGULAR.id);
  });

  it("cash + credit: debt is only the credit part and the drawer only the cash part", () => {
    setup({ id: REGULAR.id });
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 40_000 }).ok).toBe(true);
    expect(usePosStore.getState().recordTableBillPayment({ method: "credit", amountUgx: 60_000 }).ok).toBe(true);
    expect(usePosStore.getState().finalizeTableBill().ok).toBe(true);
    const sale = completed()[0]!;
    expect(sale.totalUgx).toBe(100_000);
    expect(sale.debtUgx).toBe(60_000);
    expect(physicalCashCollectedFromSale(sale)).toBe(40_000);
    expect(usePosStore.getState().customers.find((c) => c.id === REGULAR.id)!.debtBalanceUgx).toBe(65_000);
  });

  it("non-credit payments never need a customer and never create debt", () => {
    setup();
    expect(usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: 100_000 }).ok).toBe(true);
    expect(usePosStore.getState().finalizeTableBill().ok).toBe(true);
    expect(completed()[0]!.debtUgx ?? 0).toBe(0);
    expect(usePosStore.getState().customers.find((c) => c.id === REGULAR.id)!.debtBalanceUgx).toBe(5_000);
  });
});
