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

const supplier: Supplier = {
  id: "sup-metro",
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
    id: "price",
    at: "2026-06-10T14:00:00.000Z",
    action: "price_change",
    actorName: "Sarah",
    payload: { productId: product.id, name: product.name, priceBefore: 1800, priceAfter: 2000 },
  }),
  entry({
    id: "stock",
    at: "2026-06-10T13:00:00.000Z",
    action: "stock_adjust",
    payload: { productId: product.id, productName: product.name, delta: -2 },
  }),
  entry({
    id: "void",
    at: "2026-06-10T12:00:00.000Z",
    action: "sale_void",
    payload: { productName: "Coca Cola 500ml", amountUgx: 2000 },
  }),
  entry({
    id: "return",
    at: "2026-06-10T11:00:00.000Z",
    action: "sale_return",
    payload: { productName: "Coca Cola 500ml", refundUgx: 2000 },
  }),
  entry({
    id: "supplier",
    at: "2026-06-10T10:00:00.000Z",
    action: "supplier_edit",
    actorName: "Bob",
    payload: { supplierId: supplier.id, supplierName: supplier.name },
  }),
  entry({
    id: "purchase",
    at: "2026-06-10T09:00:00.000Z",
    action: "purchase_saved",
    payload: { supplierId: supplier.id, supplierName: supplier.name, totalCostUgx: 100_000 },
  }),
];

const ctx = { products: [product], suppliers: [supplier], customers: [] as Customer[], lang: "en" as const };

describe("investigation search", () => {
  it("finds all Coca Cola related actions by product name", () => {
    const hits = filterAuditLogs(logs, { searchText: "Coca Cola" }, ctx);
    const ids = hits.map((h) => h.id).sort();
    expect(ids).toEqual(["price", "return", "stock", "void"]);
  });

  it("finds all actions by staff member name", () => {
    const hits = filterAuditLogs(logs, { searchText: "Sarah" }, ctx);
    expect(hits.every((h) => h.actorName === "Sarah")).toBe(true);
    expect(hits.length).toBe(1);
  });

  it("finds supplier-related actions by supplier name", () => {
    const hits = filterAuditLogs(logs, { searchText: "Metro Wholesalers" }, ctx);
    const ids = hits.map((h) => h.id).sort();
    expect(ids).toEqual(["purchase", "supplier"]);
  });
});
