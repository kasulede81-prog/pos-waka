import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVENTORY_PURCHASING_TABS } from "../features/inventory-purchasing/types";
import { inventoryPurchasingTabFromSearch } from "./pharmacyReceiveDeepLink";
import { inventoryMovementsHref, resolveInventoryWorkspaceView } from "./inventoryWorkspaceTiles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("INV-NEW-03 count/transfer completion movements deep link", () => {
  it("A — count completion destination is Products + stockView=movements", () => {
    const page = src("src/components/inventory/count/CountCompletionScreen.tsx");
    expect(page).toContain("inventoryMovementsHref");
    expect(page).not.toContain('to="/stock?tab=movements"');
    expect(inventoryMovementsHref("/stock")).toBe("/stock?tab=products&stockView=movements");
  });

  it("B — transfer completion destination is Products + stockView=movements", () => {
    const page = src("src/components/inventory/transfers/TransferCompletionScreen.tsx");
    expect(page).toContain("inventoryMovementsHref");
    expect(page).not.toContain('to="/stock?tab=movements"');
    expect(inventoryMovementsHref("/stock")).toBe("/stock?tab=products&stockView=movements");
  });

  it("C — hub tab=products selects Products; tab=movements is not a hub tab", () => {
    expect(inventoryPurchasingTabFromSearch({ tab: "products" })).toBe("products");
    expect(INVENTORY_PURCHASING_TABS).toContain("products");
    expect(INVENTORY_PURCHASING_TABS).not.toContain("movements");
    expect(inventoryPurchasingTabFromSearch({ tab: "movements" })).toBe("overview");
  });

  it("D — stockView=movements is the existing StockPage movements contract", () => {
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain('searchParams.get("stockView")');
    expect(stock).toContain("resolveInventoryWorkspaceView");
    expect(stock).toContain('stockTab === "movements"');
    expect(stock).toContain("StockMovementsPanel");
    expect(src("src/features/inventory-purchasing/hooks/useInventoryPurchasingTab.ts")).not.toContain(
      '"movements"',
    );
    expect(resolveInventoryWorkspaceView({ stockView: "movements", shelf: null }).stockTab).toBe("movements");
  });
});
