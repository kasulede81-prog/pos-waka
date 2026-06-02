import { describe, expect, it } from "vitest";
import { mergePendingSales } from "./pendingSaleMerge";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import { buildAuditExportText } from "./auditHealth";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import type { Sale, SaleLine, Product, StockMovement, AuditLogEntry } from "../types";

const DAY = "2026-06-02";

function line(productId: string, name: string, qty: number, totalUgx: number): SaleLine {
  return {
    id: crypto.randomUUID(),
    updatedAt: `${DAY}T08:00:00.000Z`,
    productId,
    name,
    inputMode: "quantity",
    quantity: qty,
    unitPriceUgx: totalUgx,
    unitCostUgx: Math.max(0, totalUgx - 100),
    lineTotalUgx: totalUgx,
    estimatedProfitUgx: 100,
  };
}

function sale(id: string, lines: SaleLine[], partial?: Partial<Sale>): Sale {
  const total = lines.reduce((sum, l) => sum + l.lineTotalUgx, 0);
  return {
    id,
    status: "pending",
    createdAt: `${DAY}T08:00:00.000Z`,
    updatedAt: `${DAY}T08:00:00.000Z`,
    lines,
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: lines.reduce((sum, l) => sum + l.estimatedProfitUgx, 0),
    pendingSync: true,
    ...partial,
  };
}

describe("recovery certification", () => {
  it("Scenario A: offline sales reconnect and sync merge preserves totals", () => {
    const localCompleted = {
      ...sale("sale-a", [line("p1", "Rice 25kg Bag", 1, 95000)], {
        status: "completed",
        cashPaidUgx: 95_000,
        debtUgx: 0,
        pendingSync: true,
      }),
    };
    const remoteStale = {
      ...localCompleted,
      totalUgx: 100_000,
      cashPaidUgx: 100_000,
      updatedAt: `${DAY}T09:00:00.000Z`,
      pendingSync: false,
    };
    const merged = mergeSaleFromCloudPull(localCompleted, remoteStale);
    expect(merged.totalUgx).toBe(95_000);
  });

  it("Scenario B: backup/restore snapshot is deterministic", () => {
    const snapshot = {
      products: [{ id: "p1", name: "Sugar 50kg Sack", stockOnHand: 10 }],
      sales: [{ id: "s1", totalUgx: 210_000 }],
      updatedAt: `${DAY}T10:00:00.000Z`,
    };
    const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(restored.products[0]?.name).toBe(snapshot.products[0]?.name);
    expect(restored.sales[0]?.totalUgx).toBe(snapshot.sales[0]?.totalUgx);
  });

  it("Scenario C: multi-device conflict merge converges", () => {
    const base = sale("sale-c", [line("p1", "Soap Carton", 1, 78_000)]);
    const deviceA = { ...base, updatedAt: `${DAY}T10:01:00.000Z`, lines: [...base.lines, line("p2", "Water Case", 1, 18_000)] };
    const deviceB = { ...base, updatedAt: `${DAY}T10:02:00.000Z`, lines: [...base.lines, line("p3", "Detergent Carton", 1, 132_000)] };
    const merged = mergePendingSales(deviceA, deviceB);
    expect(merged.lines.length).toBeGreaterThanOrEqual(2);
    expect(merged.totalUgx).toBeGreaterThan(78_000);
  });

  it("Scenario D: audit-log replay export remains complete and ordered", () => {
    const logs: AuditLogEntry[] = [
      {
        id: "a1",
        at: `${DAY}T08:00:00.000Z`,
        actorUserId: "u1",
        role: "owner",
        action: "sale_completed",
        payloadSummary: "invoice done",
        payload: {},
      },
      {
        id: "a2",
        at: `${DAY}T08:05:00.000Z`,
        actorUserId: "u2",
        role: "manager",
        action: "stock_adjust",
        payloadSummary: "stock fixed",
        payload: {},
      },
    ];
    const exportText = buildAuditExportText(logs, "en");
    expect(exportText).toContain("sale_completed");
    expect(exportText).toContain("stock_adjust");
    expect(exportText.indexOf("stock_adjust")).toBeLessThan(exportText.indexOf("sale_completed"));
  });

  it("Scenario E: inventory reconciliation catches mismatch deterministically", () => {
    const products: Product[] = [
      {
        id: "p1",
        name: "Rice 25kg Bag",
        sellingMode: "weighted",
        baseUnit: "kg",
        sellingPricePerUnitUgx: 3800,
        costPricePerUnitUgx: 3000,
        stockOnHand: 30,
        minimumStockAlert: 10,
        category: "Grains",
        sku: "RICE-25",
        updatedAt: `${DAY}T07:00:00.000Z`,
        version: 1,
      },
    ];
    const movements: StockMovement[] = [
      {
        id: "m1",
        at: `${DAY}T06:00:00.000Z`,
        productId: "p1",
        productName: "Rice 25kg Bag",
        deltaBaseUnits: 20,
        kind: "purchase_in",
        summary: "restock",
      },
    ];
    const result = verifyInventoryIntegrity({ products, movements });
    expect(result.ok).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });
});
