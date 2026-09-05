import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../../../lib/storeSubscriptionContext";
import { usePosStore } from "../../../store/usePosStore";
import type { Product } from "../../../types";
import { BULK_PRICE_AUDIT_REASON, runInventoryBulkOperation } from "./InventoryBulkOperations";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function product(id: string, sellingPricePerUnitUgx: number, stockOnHand: number): Product {
  return {
    id,
    name: id,
    sellingPricePerUnitUgx,
    costPricePerUnitUgx: 400,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: id,
    minimumStockAlert: 2,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
  };
}

describe("INV-B1 bulk selling price", () => {
  const a = product("prod-a", 1_000, 10);
  const b = product("prod-b", 2_500, 5);
  const c = product("prod-c", 3_000, 0);
  const d = product("prod-d", 9_999, 7);

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [a, b, c, d],
      purchases: [],
      stockMovements: [],
      archivedStockMovements: [],
      supplierPayments: [],
      auditLogs: [],
      preferences: createDefaultPreferences(),
    });
  });

  function ctx(role: "owner" | "cashier" = "owner") {
    if (role !== "owner") {
      usePosStore.setState({
        sessionActor: { userId: `${role}:1`, role, displayName: role },
      });
    }
    const state = usePosStore.getState();
    return {
      lang: "en" as const,
      products: state.products,
      selectedIds: new Set(["prod-a", "prod-b", "prod-c"]),
      preferences: state.preferences,
      store: {
        updateProduct: state.updateProduct,
        adjustStock: state.adjustStock,
        setPreferences: state.setPreferences,
      },
    };
  }

  it("A/B — three selected products all receive the new selling price", async () => {
    const r = await runInventoryBulkOperation(
      { kind: "sellingPrice", mode: "set", valueUgx: 4_200 },
      ctx(),
    );
    expect(r.ok).toBe(true);
    const after = usePosStore.getState().products;
    expect(after.find((p) => p.id === "prod-a")?.sellingPricePerUnitUgx).toBe(4_200);
    expect(after.find((p) => p.id === "prod-b")?.sellingPricePerUnitUgx).toBe(4_200);
    expect(after.find((p) => p.id === "prod-c")?.sellingPricePerUnitUgx).toBe(4_200);
  });

  it("C — unselected products keep their selling price and cost", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 4_200 }, ctx());
    const keep = usePosStore.getState().products.find((p) => p.id === "prod-d");
    expect(keep?.sellingPricePerUnitUgx).toBe(9_999);
    expect(keep?.costPricePerUnitUgx).toBe(400);
    expect(keep?.sku).toBe("prod-d");
  });

  it("D/E/F — bulk price does not change stock, movements, or purchases", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 4_200 }, ctx());
    const after = usePosStore.getState();
    expect(after.products.find((p) => p.id === "prod-a")?.stockOnHand).toBe(10);
    expect(after.products.find((p) => p.id === "prod-b")?.stockOnHand).toBe(5);
    expect(after.products.find((p) => p.id === "prod-c")?.stockOnHand).toBe(0);
    expect(after.stockMovements).toHaveLength(0);
    expect(after.purchases).toHaveLength(0);
    expect(after.supplierPayments).toHaveLength(0);
  });

  it("G — cashier cannot persist a bulk selling-price change", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 4_200 }, ctx("cashier"));
    const after = usePosStore.getState().products;
    expect(after.find((p) => p.id === "prod-a")?.sellingPricePerUnitUgx).toBe(1_000);
    expect(after.find((p) => p.id === "prod-b")?.sellingPricePerUnitUgx).toBe(2_500);
    expect(after.find((p) => p.id === "prod-c")?.sellingPricePerUnitUgx).toBe(3_000);
  });

  it("G — single-product updateProduct still requires an audit reason", () => {
    const r = usePosStore.getState().updateProduct("prod-a", { sellingPricePerUnitUgx: 4_200 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("auditReasonRequired");
    expect(usePosStore.getState().products.find((p) => p.id === "prod-a")?.sellingPricePerUnitUgx).toBe(1_000);
  });

  it("H — existing store rule rejects a zero selling price and leaves prices unchanged", async () => {
    const r = await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 0 }, ctx());
    expect(r.ok).toBe(false);
    const after = usePosStore.getState().products;
    expect(after.find((p) => p.id === "prod-a")?.sellingPricePerUnitUgx).toBe(1_000);
    expect(after.find((p) => p.id === "prod-b")?.sellingPricePerUnitUgx).toBe(2_500);
    expect(after.find((p) => p.id === "prod-c")?.sellingPricePerUnitUgx).toBe(3_000);
  });

  it("I — resulting prices remain on the live product records", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 1_750 }, ctx());
    expect(usePosStore.getState().products.map((p) => [p.id, p.sellingPricePerUnitUgx])).toEqual([
      ["prod-a", 1_750],
      ["prod-b", 1_750],
      ["prod-c", 1_750],
      ["prod-d", 9_999],
    ]);
  });

  it("J — each selected product gets the same catalog price-change audit as a single edit", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 4_200 }, ctx());
    const priceAudits = usePosStore.getState().auditLogs.filter((e) => e.action === "price_change");
    expect(priceAudits.map((e) => e.payload?.productId).sort()).toEqual(["prod-a", "prod-b", "prod-c"]);
    expect(priceAudits.every((e) => e.payload?.reason === BULK_PRICE_AUDIT_REASON)).toBe(true);
  });

  it("does not change cost, category, or identity on selected products", async () => {
    await runInventoryBulkOperation({ kind: "sellingPrice", mode: "set", valueUgx: 4_200 }, ctx());
    const after = usePosStore.getState().products.find((p) => p.id === "prod-a");
    expect(after?.id).toBe("prod-a");
    expect(after?.sku).toBe("prod-a");
    expect(after?.costPricePerUnitUgx).toBe(400);
    expect(after?.category).toBe("General");
  });
});

describe("INV-B1 source wiring", () => {
  it("bulk selling price passes an audit reason into updateProduct", () => {
    const ops = src("src/features/inventory/bulk/InventoryBulkOperations.ts");
    expect(ops).toContain("BULK_PRICE_AUDIT_REASON");
    expect(ops).toMatch(/case "sellingPrice":[\s\S]*auditReason/);
    const toolbar = src("src/features/inventory/bulk/InventoryBulkToolbar.tsx");
    expect(toolbar).toContain("BULK_PRICE_AUDIT_REASON");
    expect(toolbar).toContain('kind: "sellingPrice"');
    expect(src("src/pages/StockPage.tsx")).toContain("StockInventoryProductivityChrome");
  });
});
