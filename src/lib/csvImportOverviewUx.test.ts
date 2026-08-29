import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { hasPermission } from "./permissions";
import { resolveInventoryOverviewQuickActions } from "./inventoryWorkspaceTiles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Stock Overview Import CSV wiring", () => {
  it("hub Overview reuses existing Import CSV copy and products.add, not a second importer", () => {
    const csv = resolveInventoryOverviewQuickActions("retail").find((a) => a.id === "importCsv");
    expect(csv?.perm).toBe("products.add");
    expect(csv?.labelKey).toBe("stockQuickImportCsv");
    expect(t("en", "stockQuickImportCsv")).toBe("Import CSV");
    expect(t("lg", "stockQuickImportCsv")).toContain("CSV");
  });

  it("owner/manager/stock_keeper can use hub Import CSV; cashier cannot", () => {
    expect(hasPermission("owner", "products.add")).toBe(true);
    expect(hasPermission("manager", "products.add")).toBe(true);
    expect(hasPermission("supervisor", "products.add")).toBe(true);
    expect(hasPermission("stock_keeper", "products.add")).toBe(true);
    expect(hasPermission("cashier", "products.add")).toBe(false);
    expect(hasPermission("waiter", "products.add")).toBe(false);
  });

  it("InventoryQuickActions hides tiles the actor cannot perform, including Import CSV", () => {
    const actions = src("src/components/inventory/workspace/InventoryQuickActions.tsx");
    expect(actions).toContain("hasActorPermission(actor.role, a.perm, actor.permissions)");
  });

  it("production Stock Overview opens the existing Products-tab CSV sheet via import=csv", () => {
    const overview = src("src/components/inventory/workspace/InventoryWorkspaceOverview.tsx");
    expect(overview).toContain('case "importCsv"');
    expect(overview).toContain("onImportCsv");
    expect(overview).not.toContain("parseProductImportCsv");
    expect(overview).not.toContain("ProductCsvImportSheet");

    const hub = src("src/pages/InventoryPurchasingPage.tsx");
    expect(hub).toContain('import: "csv"');
    expect(hub).toContain("onImportCsv");
    expect(hub).toContain("workspaceEmbed");
    expect(hub).not.toContain("ProductCsvImportSheet");
    expect(hub).not.toContain("parseProductImportCsv");

    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain('searchParams.get("import") === "csv"');
    expect(stock).toContain("setCsvImportOpen(true)");
    expect(stock).toContain("ProductCsvImportSheet");
    expect(stock).toContain("ProductImportReviewSheet");
    expect(stock).toContain("handleCsvParsed");
    expect(stock).toContain("openCsvImport");
  });

  it("Products-tab Import CSV still uses the same sheet and products.add gate", () => {
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain("canImportCsv={canAdd}");
    expect(stock).toContain("onImportCsv={openCsvImport}");
    expect(stock).toContain("csvImportDisabled={freeProductLimitReached}");
    expect(stock).toContain("showCsvImport={canAdd}");
    expect(stock).toContain("if (!canAdd || freeProductLimitReached) return");

    const bar = src("src/features/inventory/InventoryProductsControlBar.tsx");
    expect(bar).toContain("stockQuickImportCsv");
    expect(bar).toContain("canImportCsv");
    expect(bar).toContain("onImportCsv");
  });

  it("does not add a second CSV parser, review sheet, or commit path", () => {
    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain("ProductImportReviewSheet");
    expect(stock).toContain("ProductCsvImportSheet");
    expect(stock).not.toContain("parseProductImportCsv(");
    expect(src("src/components/stock/ProductImportReviewSheet.tsx")).toContain("commitNormalizedProductImport");
    expect(src("src/components/stock/ProductCsvImportSheet.tsx")).toContain("parseProductImportCsvFile");
    expect(src("src/lib/productImport/parseProductImportCsv.ts")).toContain("export function parseProductImportCsv");
  });
});
