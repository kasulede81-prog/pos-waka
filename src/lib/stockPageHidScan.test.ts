import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { usePosStore } from "../store/usePosStore";
import type { Product } from "../types";
import { resolveStockPageHidScan } from "./stockPageHidScan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function product(id: string, sku: string, name = id, barcodes: string[] = []): Product {
  return {
    id,
    name,
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 400,
    stockOnHand: 4,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku,
    minimumStockAlert: 2,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
    pharmacyMaster: barcodes.length ? { brandName: name, genericName: null, barcodes } : null,
  };
}

describe("INV-NEW-06 StockPage HID scanner lifecycle", () => {
  const productA = product("prod-a", "SKU-A", "Product A", ["111111"]);
  const productAUpdated = { ...productA, name: "Product A updated", stockOnHand: 9, version: 2 };
  const productB = product("prod-b", "SKU-B", "Product B", ["222222"]);

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [productA],
      preferences: createDefaultPreferences(),
    });
  });

  it("A — StockPage HID effect depends on pharmacyMode, not products identity", () => {
    const page = src("src/pages/StockPage.tsx");
    expect(page).toContain("resolveStockPageHidScan");
    expect(page).toMatch(/startBarcodeSession\("hid"[\s\S]*?\}, \[pharmacyMode\]\);/);
    expect(page).not.toMatch(/startBarcodeSession\("hid"[\s\S]*?\}, \[pharmacyMode, products\]\);/);
    expect(page).not.toMatch(/findProductByBarcode\(products,/);
  });

  it("B — scan after products-array replace uses the current store catalog", () => {
    expect(resolveStockPageHidScan("111111", true).detailProduct?.id).toBe("prod-a");

    usePosStore.setState({ products: [productAUpdated, productB] });

    const scanB = resolveStockPageHidScan("SKU-B", true);
    expect(scanB.listQuery).toBe("SKU-B");
    expect(scanB.detailProduct?.id).toBe("prod-b");
    expect(scanB.detailProduct?.name).toBe("Product B");

    const scanA = resolveStockPageHidScan("111111", true);
    expect(scanA.detailProduct?.name).toBe("Product A updated");
    expect(scanA.detailProduct?.stockOnHand).toBe(9);
  });

  it("C — known barcode still searches the code and opens pharmacy detail", () => {
    const r = resolveStockPageHidScan("SKU-A", true);
    expect(r.listQuery).toBe("SKU-A");
    expect(r.detailProduct?.id).toBe("prod-a");
  });

  it("D — unknown barcode still searches the entered code and does not invent a product", () => {
    const r = resolveStockPageHidScan("NO-SUCH", true);
    expect(r.listQuery).toBe("NO-SUCH");
    expect(r.detailProduct).toBeNull();
  });

  it("E — non-pharmacy mode never opens detail (search only)", () => {
    const r = resolveStockPageHidScan("SKU-A", false);
    expect(r.listQuery).toBe("SKU-A");
    expect(r.detailProduct).toBeNull();
  });

  it("F — StockPage still stops the HID session on effect cleanup", () => {
    const page = src("src/pages/StockPage.tsx");
    const hid = page.slice(page.indexOf("startBarcodeSession(\"hid\""), page.indexOf("}, [pharmacyMode]);") + 24);
    expect(hid).toContain("return () =>");
    expect(hid).toContain("stopBarcodeSession()");
  });

  it("G — adapter start always tears down the previous session; StockPage does not remount on products", () => {
    const adapter = src("src/services/hardware/barcodeAdapter.ts");
    expect(adapter).toContain("await stopBarcodeSession()");
    expect(adapter).toContain("window.removeEventListener(\"keydown\", onKeyDown, true)");
    expect(adapter).toContain("window.clearTimeout(timer)");
    expect(src("src/lib/stockPageHidScan.ts")).toContain("usePosStore.getState().products");
  });

  it("products identity change mid-session still resolves the completing scan", () => {
    usePosStore.setState({ products: [productA] });
    usePosStore.setState({ products: [productAUpdated, productB] });
    const r = resolveStockPageHidScan("222222", true);
    expect(r.listQuery).toBe("222222");
    expect(r.detailProduct?.id).toBe("prod-b");
  });
});
