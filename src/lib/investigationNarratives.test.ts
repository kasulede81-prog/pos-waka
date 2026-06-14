import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Product } from "../types";
import { describeAuditLine } from "./activityNarrative";
import { formatAuditRowSummary } from "./auditCenterDetails";

const product: Product = {
  id: "p-cola",
  name: "Coca Cola 500ml",
  sellingPricePerUnitUgx: 2_500,
  costPricePerUnitUgx: 1_500,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Drinks",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: "2026-06-01T00:00:00.000Z",
  version: 1,
};

const productById = new Map([[product.id, { name: product.name }]]);

function entry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "action">): AuditLogEntry {
  return {
    id: "e1",
    at: "2026-06-11T10:00:00.000Z",
    actorUserId: "local:Sarah",
    actorName: "Sarah",
    role: "manager",
    payloadSummary: "technical summary",
    payload: {},
    deviceId: "550e8400-e29b-41d4-a716-446655440000",
    ...partial,
  };
}

describe("investigation narratives", () => {
  it("price change uses human narrative not payload summary", () => {
    const e = entry({
      action: "price_change",
      payload: { productId: product.id, priceBefore: 2_000, priceAfter: 2_500 },
    });
    const line = describeAuditLine("en", e, productById, new Map());
    expect(line).toContain("Coca Cola");
    expect(line).toContain("2,000");
    expect(line).toContain("2,500");
    expect(line).not.toBe("technical summary");
  });

  it("product removal narrative names the product", () => {
    const e = entry({
      action: "product_remove",
      payload: { name: "Fanta 500ml", stock: 3 },
    });
    const line = formatAuditRowSummary("en", e, { productById });
    expect(line).toContain("Fanta 500ml");
    expect(line).not.toContain("550e8400");
  });

  it("discount given shows amount narrative", () => {
    const e = entry({
      action: "discount_given",
      payload: { discountUgx: 5_000, saleId: "sale-1" },
    });
    const line = formatAuditRowSummary("en", e);
    expect(line).toContain("5,000");
  });

  it("expense approved uses category and amount", () => {
    const e = entry({
      action: "cash_expense_approved",
      payload: { category: "Fuel", amountUgx: 50_000 },
    });
    const line = formatAuditRowSummary("en", e);
    expect(line).toContain("Fuel");
    expect(line).toContain("50,000");
  });
});
