import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Customer, Product, Supplier } from "../types";
import { filterAuditLogs } from "./auditSearch";

const product: Product = {
  id: "prod-cola",
  name: "Coca Cola 500ml",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_200,
  stockOnHand: 24,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Drinks",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const customer: Customer = {
  id: "cust-1",
  name: "Jane",
  phone: "",
  location: "",
  debtBalanceUgx: 0,
  createdAt: "2026-05-01T00:00:00.000Z",
  version: 1,
};

const supplier: Supplier = {
  id: "sup-1",
  name: "Metro Wholesalers",
  phone: "",
  location: "",
  notes: "",
  balanceOwedUgx: 0,
  totalPurchasesUgx: 0,
  createdAt: "2026-05-01T00:00:00.000Z",
  version: 1,
};

function entry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "at" | "action">): AuditLogEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    actorUserId: partial.actorUserId ?? "staff-1",
    actorName: partial.actorName ?? "Alice",
    role: partial.role ?? "manager",
    payloadSummary: partial.payloadSummary ?? "summary",
    payload: partial.payload ?? {},
    deviceId: partial.deviceId ?? "device-abc",
    ...partial,
  };
}

const logs: AuditLogEntry[] = [
  entry({
    id: "e1",
    at: "2026-06-10T14:00:00.000Z",
    action: "price_change",
    payloadSummary: "Coca Cola price",
    payload: { productId: product.id, name: product.name, priceBefore: 1800, priceAfter: 2000, reason: "market" },
  }),
  entry({
    id: "e2",
    at: "2026-06-09T10:00:00.000Z",
    action: "stock_adjust",
    payloadSummary: "Stock down",
    payload: { productId: product.id, productName: product.name, delta: -2, reason: "damaged" },
  }),
  entry({
    id: "e3",
    at: "2026-06-08T09:00:00.000Z",
    action: "sale_void",
    payloadSummary: "Void cola sale",
    payload: { productId: product.id, name: "Coca Cola 500ml" },
  }),
  entry({
    id: "e4",
    at: "2026-06-07T09:00:00.000Z",
    action: "debt_payment",
    payloadSummary: "Debt paid",
    payload: { customerId: customer.id, amountUgx: 5000 },
  }),
];

describe("filterAuditLogs", () => {
  const ctx = { products: [product], customers: [customer], suppliers: [supplier] };

  it("sorts newest first", () => {
    const out = filterAuditLogs(logs, {}, ctx);
    expect(out.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("filters by date range", () => {
    const out = filterAuditLogs(logs, { dateFrom: "2026-06-09", dateTo: "2026-06-10" }, ctx);
    expect(out.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("filters by staff member", () => {
    const withOther = [
      ...logs,
      entry({
        id: "e5",
        at: "2026-06-10T15:00:00.000Z",
        action: "sale_completed",
        actorUserId: "staff-2",
        actorName: "Bob",
        payload: {},
      }),
    ];
    const out = filterAuditLogs(withOther, { actorUserId: "staff-2" }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("e5");
  });

  it("filters by action type", () => {
    const out = filterAuditLogs(logs, { action: "price_change" }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("e1");
  });

  it("filters by product id", () => {
    const out = filterAuditLogs(logs, { productId: product.id }, ctx);
    expect(out.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("search text finds product-related investigation hits", () => {
    const out = filterAuditLogs(logs, { searchText: "coca cola" }, ctx);
    expect(out.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("filters by customer id", () => {
    const out = filterAuditLogs(logs, { customerId: customer.id }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("e4");
  });
});
