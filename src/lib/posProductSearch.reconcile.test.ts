import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  buildProductSellSearchIndex,
  reconcileProductSellSearchIndex,
} from "./posProductSearch";

function mkProduct(i: number): Product {
  return {
    id: `p-${i}`,
    name: `Product ${i}`,
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 700,
    stockOnHand: 10,
    minimumStockAlert: 2,
    category: "General",
    sku: `SKU-${i}`,
    updatedAt: "2026-07-10T00:00:00.000Z",
    version: 1,
  };
}

describe("reconcileProductSellSearchIndex", () => {
  it("upserts a single new product without dropping prior entries", () => {
    const prevProducts = Array.from({ length: 100 }, (_, i) => mkProduct(i));
    const prev = buildProductSellSearchIndex(prevProducts);
    const added = mkProduct(100);
    const nextProducts = [added, ...prevProducts];
    const next = reconcileProductSellSearchIndex(prev, prevProducts, nextProducts);

    expect(next.entries).toHaveLength(101);
    expect(next.byId.get("p-100")?.product.name).toBe("Product 100");
    expect(next.byId.get("p-0")?.product).toBe(prevProducts[0]);
    expect(next.byBarcode.get("sku-100")).toBe("p-100");
  });

  it("updates haystack when an existing product object changes", () => {
    const prevProducts = [mkProduct(1), mkProduct(2)];
    const prev = buildProductSellSearchIndex(prevProducts);
    const renamed = { ...prevProducts[0]!, name: "Renamed Alpha", version: 2 };
    const nextProducts = [renamed, prevProducts[1]!];
    const next = reconcileProductSellSearchIndex(prev, prevProducts, nextProducts);

    expect(next.byId.get("p-1")?.hay).toContain("renamed alpha");
    expect(next.byId.get("p-2")?.product).toBe(prevProducts[1]);
  });

  it("full-rebuilds when many products change", () => {
    const prevProducts = Array.from({ length: 200 }, (_, i) => mkProduct(i));
    const prev = buildProductSellSearchIndex(prevProducts);
    const nextProducts = prevProducts.map((p) => ({ ...p, version: p.version + 1 }));
    const next = reconcileProductSellSearchIndex(prev, prevProducts, nextProducts);
    expect(next.entries).toHaveLength(200);
    expect(next.byId.get("p-0")?.product.version).toBe(2);
  });
});
