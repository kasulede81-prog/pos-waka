import { describe, expect, it, beforeEach } from "vitest";
import type { Customer, DebtPayment, Product, Sale, SaleLine } from "../types";
import {
  buildCreditActivityTimeline,
  findOrphanDebtSales,
  resolveDebtorForSale,
  sumOrphanDebtUgx,
} from "./customerDebtActivity";
import { usePosStore } from "../store/usePosStore";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const draftLine: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 10_000,
  estimatedProfitUgx: 7_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

function customer(partial: Partial<Customer> & Pick<Customer, "name">): Customer {
  return {
    id: CUSTOMER_ID,
    phone: "",
    location: "Uganda",
    createdAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    debtBalanceUgx: 0,
    ...partial,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id">): Sale {
  return {
    status: "completed",
    receiptSeq: 1,
    lines: [],
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 0,
    debtUgx: 10_000,
    discountTotalUgx: 0,
    voidedTotalUgx: 0,
    estimatedProfitUgx: 7_000,
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:00:00.000Z",
    pendingSync: false,
    lastSyncError: null,
    customerId: CUSTOMER_ID,
    ...partial,
  };
}

describe("resolveDebtorForSale", () => {
  it("succeeds with existing customer id", () => {
    const c = customer({ name: "Mama Brian" });
    const r = resolveDebtorForSale([c], { customerId: CUSTOMER_ID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.customerId).toBe(CUSTOMER_ID);
      expect(r.createdCustomer).toBeUndefined();
    }
  });

  it("creates customer when name entered without selection", () => {
    const r = resolveDebtorForSale([], { customerName: "Teacher" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.customers).toHaveLength(1);
      expect(r.customers[0]!.name).toBe("Teacher");
      expect(r.customers[0]!.phone).toBe("");
      expect(r.createdCustomer?.name).toBe("Teacher");
    }
  });

  it("keeps phone optional on auto-create", () => {
    const r = resolveDebtorForSale([], { customerName: "Boda", customerPhone: "+256700000001" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.customers[0]!.phone).toBe("+256700000001");
  });

  it("fails when debt would have no id or name", () => {
    const r = resolveDebtorForSale([], { customerId: null, customerName: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("debtRequiresCustomerName");
  });
});

describe("buildCreditActivityTimeline", () => {
  it("lists credit sales and repayments newest first", () => {
    const credit = sale({
      id: "s1",
      createdAt: "2026-06-02T09:00:00.000Z",
      debtUgx: 8_000,
      receiptSeq: 12,
    });
    const payment: DebtPayment = {
      id: "p1",
      customerId: CUSTOMER_ID,
      amountUgx: 3_000,
      createdAt: "2026-06-02T11:00:00.000Z",
    };
    const timeline = buildCreditActivityTimeline(CUSTOMER_ID, [credit], [payment]);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.kind).toBe("debt_payment");
    expect(timeline[0]!.deltaUgx).toBe(-3_000);
    expect(timeline[1]!.kind).toBe("credit_sale");
    expect(timeline[1]!.deltaUgx).toBe(8_000);
    expect(timeline[1]!.receiptSeq).toBe(12);
  });
});

describe("findOrphanDebtSales", () => {
  it("detects legacy sales with debt but no customer", () => {
    const orphans = findOrphanDebtSales([
      sale({ id: "orphan", customerId: null, debtUgx: 5_000 }),
      sale({ id: "ok", customerId: CUSTOMER_ID, debtUgx: 2_000 }),
      sale({ id: "cash", customerId: null, debtUgx: 0, cashPaidUgx: 10_000 }),
    ]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.saleId).toBe("orphan");
    expect(sumOrphanDebtUgx([sale({ id: "o", customerId: null, debtUgx: 5_000 })])).toBe(5_000);
  });
});

describe("usePosStore finalizeDraftSale — debt identity", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "staff:1", role: "owner", displayName: "Owner" },
      products: [baseProduct],
      customers: [customer({ name: "Existing" })],
      sales: [],
      debtPayments: [],
      draftLines: [{ ...draftLine }],
      draftCartDiscountUgx: 0,
    });
  });

  it("debt with existing customer succeeds and updates balance", () => {
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 10_000,
      customerId: CUSTOMER_ID,
      paymentMethod: "credit",
    });
    expect(r.ok).toBe(true);
    const st = usePosStore.getState();
    expect(st.sales[0]!.customerId).toBe(CUSTOMER_ID);
    expect(st.sales[0]!.debtUgx).toBe(10_000);
    expect(st.customers.find((c) => c.id === CUSTOMER_ID)!.debtBalanceUgx).toBe(10_000);
  });

  it("debt with name auto-creates customer", () => {
    usePosStore.setState({ customers: [] });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 10_000,
      customerName: "Walk-in Mama",
      customerPhone: "",
      paymentMethod: "credit",
    });
    expect(r.ok).toBe(true);
    const st = usePosStore.getState();
    expect(st.customers).toHaveLength(1);
    expect(st.customers[0]!.name).toBe("Walk-in Mama");
    expect(st.sales[0]!.customerId).toBe(st.customers[0]!.id);
    expect(st.customers[0]!.debtBalanceUgx).toBe(10_000);
  });

  it("debt without name or customer fails at store", () => {
    usePosStore.setState({ customers: [] });
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 10_000,
      paymentMethod: "credit",
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("debtRequiresCustomerName");
    expect(usePosStore.getState().sales).toHaveLength(0);
  });

  it("cash sale without customer still succeeds", () => {
    const r = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().sales[0]!.customerId).toBeNull();
  });
});

describe("assignOrphanDebtSale", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      customers: [customer({ id: CUSTOMER_ID, name: "Jane", debtBalanceUgx: 2_000 })],
      sales: [sale({ id: "orphan-sale", customerId: null, debtUgx: 5_000 })],
      debtPayments: [],
    });
  });

  it("links orphan credit sale and updates customer balance", () => {
    const r = usePosStore.getState().assignOrphanDebtSale("orphan-sale", CUSTOMER_ID);
    expect(r.ok).toBe(true);
    const st = usePosStore.getState();
    expect(st.sales[0]!.customerId).toBe(CUSTOMER_ID);
    expect(st.customers[0]!.debtBalanceUgx).toBe(7_000);
  });
});
