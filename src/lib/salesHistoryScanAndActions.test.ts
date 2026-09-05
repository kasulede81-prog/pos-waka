import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { findProductByBarcode } from "./pharmacyMedicine";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Mirrors ReceiptsPage camera onScan → search query (no listSales change). */
function salesHistoryScanQuery(products: Product[], code: string): string {
  const hit = findProductByBarcode(products, code);
  return hit?.name?.trim() || code;
}

function mkProduct(id: string, name: string, sku: string, barcodes: string[] = []): Product {
  return {
    id,
    name,
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
    pharmacyMaster: barcodes.length ? { brandName: name, genericName: null, barcodes } : null,
  };
}

describe("Sales History scan wiring", () => {
  it("empty search click opens camera via onScan; filled search still clears", () => {
    const bar = src("src/components/receipts/SalesHistorySearchBar.tsx");
    expect(bar).toContain("onScan?: () => void");
    expect(bar).toContain("if (value.trim()) onChange(\"\")");
    expect(bar).toContain("else if (canScan && onScan) onScan()");
    expect(bar).not.toContain("startBarcodeSession");
  });

  it("ReceiptsPage reuses camera adapter only — no HID session", () => {
    const page = src("src/pages/ReceiptsPage.tsx");
    expect(page).toContain("onScan={openCameraScan}");
    expect(page).toContain('startBarcodeSession("camera"');
    expect(page).toContain("stopBarcodeSession");
    expect(page).toContain("findProductByBarcode");
    expect(page).not.toContain('startBarcodeSession("hid"');
    expect(page).not.toContain("useSellBarcodeScanner");
  });

  it("known SKU and pharmacy barcode become product.name; unknown stays the code", () => {
    const products = [
      mkProduct("milk", "Fresh Milk", "SKU-MILK", ["600123"]),
      mkProduct("soda", "Soda", "SKU-SODA"),
    ];
    expect(salesHistoryScanQuery(products, "SKU-MILK")).toBe("Fresh Milk");
    expect(salesHistoryScanQuery(products, "600123")).toBe("Fresh Milk");
    expect(salesHistoryScanQuery(products, "NO-SUCH")).toBe("NO-SUCH");
  });
});

describe("Sales History desktop ⋯ wiring", () => {
  it("desktop host clears parent selection on sheet close; mobile row does not", () => {
    const row = src("src/components/receipts/SalesHistoryRow.tsx");
    expect(row).toContain("onActionsClose?: () => void");
    expect(row).toContain("onActionsClose?.()");
    expect(row).toContain("onClose={closeActions}");

    const page = src("src/pages/ReceiptsPage.tsx");
    expect(page).toContain("onActionsClose={() => setDesktopActionSale(null)}");
    expect(page).toContain("forceOpenActions");

    const renderSaleRow = page.slice(page.indexOf("const renderSaleRow"), page.indexOf("return ("));
    expect(renderSaleRow).not.toContain("onActionsClose");
  });
});
