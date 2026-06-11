import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Product } from "../types";
import {
  catalogEventsForDay,
  diffProductCatalog,
  formatCatalogAuditSummary,
  isNonOwnerCatalogEvent,
  isSensitiveCatalogEvent,
} from "./catalogAudit";

const DAY = "2026-06-11";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Paracetamol",
    sellingMode: "unit",
    baseUnit: "tablet",
    buyingUnit: null,
    conversionRate: null,
    sellingPricePerUnitUgx: 500,
    costPricePerUnitUgx: 200,
    stockOnHand: 20,
    minimumStockAlert: 5,
    category: "General",
    sku: "SKU-1",
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
    ...overrides,
  };
}

function audit(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: "a1",
    at: `${DAY}T10:00:00.000Z`,
    actorUserId: "u1",
    role: "stock_keeper",
    action: "product_update",
    payloadSummary: "test",
    payload: {},
    ...partial,
  };
}

describe("catalogAudit", () => {
  it("diffs price and stock changes", () => {
    const prev = product();
    const next = product({ sellingPricePerUnitUgx: 450, stockOnHand: 35 });
    const changes = diffProductCatalog(prev, next);
    expect(changes.map((c) => c.field)).toEqual(["price", "stock"]);
    expect(formatCatalogAuditSummary(next.name, changes)).toContain("450");
    expect(formatCatalogAuditSummary(next.name, changes)).toContain("35");
  });

  it("filters today's non-owner catalog events", () => {
    const logs = [
      audit({ action: "product_add", role: "stock_keeper" }),
      audit({ action: "product_add", role: "owner" }),
      audit({ action: "sale_completed", role: "cashier", at: `${DAY}T11:00:00.000Z` }),
      audit({ action: "stock_adjust", role: "manager", at: "2026-06-10T10:00:00.000Z" }),
    ];
    const staffToday = catalogEventsForDay(logs, DAY, { nonOwnerOnly: true });
    expect(staffToday).toHaveLength(1);
    expect(isNonOwnerCatalogEvent(logs[0]!)).toBe(true);
  });

  it("flags sensitive catalog events", () => {
    expect(isSensitiveCatalogEvent(audit({ action: "product_remove" }))).toBe(true);
    expect(
      isSensitiveCatalogEvent(
        audit({
          action: "product_update",
          payload: { changes: [{ field: "price", from: 500, to: 400 }] },
        }),
      ),
    ).toBe(true);
    expect(
      isSensitiveCatalogEvent(
        audit({ action: "stock_adjust", payload: { delta: -12, reason: "damaged" } }),
      ),
    ).toBe(true);
  });
});
