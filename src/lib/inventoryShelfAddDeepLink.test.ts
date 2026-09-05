import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVENTORY_PURCHASING_TABS } from "../features/inventory-purchasing/types";
import { inventoryPurchasingTabFromSearch } from "./pharmacyReceiveDeepLink";
import {
  inventoryAddProductToShelfHref,
  inventoryMovementsHref,
  resolveInventoryWorkspaceView,
} from "./inventoryWorkspaceTiles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const SHELF_A = "SHELF_A";
const SHELF_B = "SHELF_B";

describe("INV-NEW-04 empty-shelf Add product deep link", () => {
  it("A — destination is Products + stockView=shelves + shelf + add=1", () => {
    const href = inventoryAddProductToShelfHref(SHELF_A);
    const url = new URL(href, "https://waka.local");
    expect(url.pathname).toBe("/stock");
    expect(url.searchParams.get("tab")).toBe("products");
    expect(url.searchParams.get("stockView")).toBe("shelves");
    expect(url.searchParams.get("shelf")).toBe(SHELF_A);
    expect(url.searchParams.get("add")).toBe("1");
    expect(href).not.toContain("tab=shelves");
  });

  it("B — tab=products resolves to the Products hub tab", () => {
    expect(inventoryPurchasingTabFromSearch({ tab: "products" })).toBe("products");
    expect(INVENTORY_PURCHASING_TABS).toContain("products");
    expect(INVENTORY_PURCHASING_TABS).not.toContain("shelves");
    expect(inventoryPurchasingTabFromSearch({ tab: "shelves" })).toBe("overview");
  });

  it("C — stockView=shelves activates the existing Shelves workspace view", () => {
    expect(resolveInventoryWorkspaceView({ stockView: "shelves", shelf: null })).toEqual({
      stockTab: "shelves",
      selectedShelf: null,
    });
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain("resolveInventoryWorkspaceView");
    expect(stock).toContain('searchParams.get("stockView")');
  });

  it("D — shelf=SHELF_A selects SHELF_A, never SHELF_B", () => {
    const resolved = resolveInventoryWorkspaceView({ stockView: "shelves", shelf: SHELF_A });
    expect(resolved.selectedShelf).toBe(SHELF_A);
    expect(resolved.selectedShelf).not.toBe(SHELF_B);
    expect(resolved.stockTab).toBe("shelves");
  });

  it("E — add=1 is on the constructed URL and StockPage still opens the existing wizard", () => {
    expect(inventoryAddProductToShelfHref(SHELF_A)).toContain("add=1");
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain('searchParams.get("add") === "1"');
    expect(stock).toContain("setBulkOpen(true)");
    expect(stock).toContain("setWizardPrefill");
  });

  it("F — add=1 is consumed once via the existing replace cleanup", () => {
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain('p.delete("add")');
    expect(stock).toContain("{ replace: true }");
  });

  it("G — unknown shelf id is kept as-is and does not fall back to another shelf", () => {
    const resolved = resolveInventoryWorkspaceView({
      stockView: "shelves",
      shelf: "does-not-exist",
    });
    expect(resolved.selectedShelf).toBe("does-not-exist");
    expect(resolved.selectedShelf).not.toBe(SHELF_A);
    expect(resolved.selectedShelf).not.toBe(SHELF_B);
    expect(resolved.stockTab).toBe("shelves");
  });

  it("I — POS empty-shelf action uses the helper and does not mutate stock itself", () => {
    const pos = src("src/pages/PosPage.tsx");
    expect(pos).toContain("inventoryAddProductToShelfHref");
    expect(pos).not.toMatch(/\/stock\?tab=shelves/);
    expect(pos).not.toMatch(/commitNewProducts|quickAddProduct|adjustStock|recordPurchase/);
  });
});

describe("INV-NEW-04 source wiring / regression", () => {
  it("does not change INV-NEW-03 movements destination", () => {
    expect(inventoryMovementsHref("/stock")).toBe("/stock?tab=products&stockView=movements");
  });

  it("hub Add Product without a shelf still lands on products, not shelves", () => {
    expect(resolveInventoryWorkspaceView({ stockView: null, shelf: null })).toEqual({
      stockTab: "products",
      selectedShelf: null,
    });
  });
});
