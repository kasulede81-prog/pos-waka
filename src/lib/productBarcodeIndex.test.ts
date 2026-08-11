import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  buildProductBarcodeLookup,
  findProductByBarcodeLookup,
  getProductBarcodeLookup,
  upsertProductBarcodeLookup,
} from "./productBarcodeIndex";

function mkProduct(id: string, sku: string, barcodes: string[] = []): Product {
  return {
    id,
    name: id,
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 700,
    stockOnHand: 1,
    minimumStockAlert: 0,
    category: "General",
    sku,
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
    pharmacyMaster: barcodes.length
      ? {
          brandName: id,
          genericName: null,
          barcodes,
        }
      : null,
  };
}

describe("productBarcodeIndex", () => {
  it("resolves SKU and pharmacy barcodes in O(1) map", () => {
    const products = [
      mkProduct("a", "SKU-A", ["111"]),
      mkProduct("b", "SKU-B", ["222"]),
    ];
    const lookup = buildProductBarcodeLookup(products);
    expect(lookup.get("sku-a")).toBe("a");
    expect(lookup.get("111")).toBe("a");
    expect(findProductByBarcodeLookup(products, "222", lookup)?.id).toBe("b");
  });

  it("caches lookup per products array identity", () => {
    const products = [mkProduct("a", "SKU-A")];
    const first = getProductBarcodeLookup(products);
    const second = getProductBarcodeLookup(products);
    expect(first).toBe(second);
  });

  it("upserts barcode keys after product edit", () => {
    const a = mkProduct("a", "OLD", ["111"]);
    const products = [a];
    let lookup = buildProductBarcodeLookup(products);
    const edited = { ...a, sku: "NEW", pharmacyMaster: { brandName: "a", genericName: null, barcodes: ["999"] } };
    lookup = upsertProductBarcodeLookup(lookup, edited, new Map([["a", edited]]));
    expect(lookup.get("old")).toBeUndefined();
    expect(lookup.get("111")).toBeUndefined();
    expect(lookup.get("new")).toBe("a");
    expect(lookup.get("999")).toBe("a");
  });
});
