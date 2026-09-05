import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { catalogDuplicatePrefill, DUPLICATE_OPENING_STOCK } from "./duplicateProductCatalog";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const source: Product = {
  id: SOURCE_ID,
  name: "Soda",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 800,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "Drinks",
  sku: "SODA-1",
  minimumStockAlert: 4,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 3,
};

describe("INV-B3 catalogDuplicatePrefill", () => {
  it("copies catalog fields and never copies live stock", () => {
    const prefill = catalogDuplicatePrefill(source, " (2)");
    expect(prefill.name).toBe("Soda (2)");
    expect(prefill.category).toBe("Drinks");
    expect(prefill.sellingPricePerUnitUgx).toBe(2_000);
    expect(prefill.costPricePerUnitUgx).toBe(800);
    expect(prefill.stockOnHand).toBe(0);
    expect(prefill.stockOnHand).toBe(DUPLICATE_OPENING_STOCK);
    expect(prefill.stockOnHand).not.toBe(source.stockOnHand);
  });
});

describe("INV-B3 duplicateProduct store", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [source],
      purchases: [],
      stockMovements: [],
      archivedStockMovements: [],
      supplierPayments: [],
    });
  });

  it("creates a new product id with zero stock and leaves the source unchanged", () => {
    const beforeMovements = usePosStore.getState().stockMovements.length;
    const beforePurchases = usePosStore.getState().purchases.length;

    const r = usePosStore.getState().duplicateProduct(SOURCE_ID, " (2)");
    expect(r.ok).toBe(true);

    const products = usePosStore.getState().products;
    const original = products.find((p) => p.id === SOURCE_ID);
    const copy = products.find((p) => p.id !== SOURCE_ID && p.name === "Soda (2)");

    expect(original?.stockOnHand).toBe(10);
    expect(original?.sku).toBe("SODA-1");
    expect(copy).toBeTruthy();
    expect(copy!.id).not.toBe(SOURCE_ID);
    expect(copy!.stockOnHand).toBe(0);
    expect(copy!.sellingPricePerUnitUgx).toBe(2_000);
    expect(copy!.costPricePerUnitUgx).toBe(800);
    expect(copy!.category).toBe("Drinks");
    expect(copy!.sku).not.toBe("SODA-1");
    expect(copy!.pharmacyPackaging).toBeFalsy();

    expect(usePosStore.getState().purchases).toHaveLength(beforePurchases);
    expect(usePosStore.getState().stockMovements.filter((m) => m.productId === copy!.id)).toHaveLength(0);
    expect(usePosStore.getState().stockMovements).toHaveLength(beforeMovements);
  });
});

describe("INV-B3 source wiring", () => {
  it("StockPage duplicate prefill does not copy source stockOnHand", () => {
    const page = src("src/pages/StockPage.tsx");
    expect(page).toContain("catalogDuplicatePrefill");
    expect(page).not.toContain("setQaStock(String(p.stockOnHand))");
    const store = src("src/store/usePosStore.ts");
    expect(store).toContain("catalogDuplicatePrefill");
    expect(store).toContain("stockOnHand: catalog.stockOnHand");
  });
});
