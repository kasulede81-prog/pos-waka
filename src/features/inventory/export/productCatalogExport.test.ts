import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from "../../../lib/i18n";
import { actorCanSeeInventoryCostValue } from "../../../lib/inventoryFinancialVisibility";
import { resolveSessionActor, type SessionActor } from "../../../lib/sessionActor";
import type { Product, UserRole } from "../../../types";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "../../../lib/subscriptionEntitlements";
import { buildProductCatalogCsv } from "./productCatalogExport";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const STARTER: SubscriptionSnapshot = {
  kind: "remote",
  row: {
    id: "1",
    organization_id: "o1",
    shop_id: "s1",
    plan_code: "starter",
    status: "active",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    max_pos_users: null,
    max_shops: null,
    max_devices: null,
  } as RemoteSubscriptionRow,
};

function actor(role: UserRole): SessionActor {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: `${role}@waka.invalid` } as never,
    email: `${role}@waka.invalid`,
    shopMemberRole: role,
    preferences: {} as never,
  });
}

const PRODUCT: Product = {
  id: "prod-test-1",
  name: "Test Product",
  sellingPricePerUnitUgx: 8_000,
  costPricePerUnitUgx: 5_000,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "SKU-TEST-1",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const OTHER: Product = {
  ...PRODUCT,
  id: "prod-other",
  name: "Other Item",
  sku: "SKU-OTHER",
  costPricePerUnitUgx: 1_111,
  sellingPricePerUnitUgx: 2_222,
  stockOnHand: 3,
};

function csvCells(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.split(","));
}

describe("INV-B6 product catalog CSV financial visibility", () => {
  it("A — cashier cannot receive the cost column or unit cost", () => {
    const cashier = actor("cashier");
    expect(actorCanSeeInventoryCostValue(cashier, STARTER, "supabase")).toBe(false);
    const csv = buildProductCatalogCsv("en", [PRODUCT], {
      includeCost: actorCanSeeInventoryCostValue(cashier, STARTER, "supabase"),
    });
    expect(csv).not.toContain(t("en", "inventoryTableCost"));
    expect(csv).not.toContain("5000");
    expect(csv).toContain("Test Product");
    expect(csv).toContain(t("en", "inventoryTablePrice"));
    expect(csv).toContain(t("en", "inventoryTableStock"));
  });

  it("B — owner keeps the cost column with the real unit cost", () => {
    const owner = actor("owner");
    expect(actorCanSeeInventoryCostValue(owner, STARTER, "supabase")).toBe(true);
    const csv = buildProductCatalogCsv("en", [PRODUCT], {
      includeCost: actorCanSeeInventoryCostValue(owner, STARTER, "supabase"),
    });
    const header = csvCells(csv)[0] ?? [];
    expect(header).toContain(t("en", "inventoryTableCost"));
    expect(csv).toContain("5000");
    expect(csv).toContain("Test Product");
  });

  it("C — export does not mutate the product record", () => {
    const before = { ...PRODUCT };
    buildProductCatalogCsv("en", [PRODUCT], { includeCost: true });
    expect(PRODUCT).toEqual(before);
    expect(PRODUCT.costPricePerUnitUgx).toBe(5_000);
    expect(PRODUCT.stockOnHand).toBe(10);
  });

  it("D — CSV contains only the products passed in (filter/selection parity)", () => {
    const csv = buildProductCatalogCsv("en", [PRODUCT], { includeCost: true });
    expect(csv).toContain("Test Product");
    expect(csv).not.toContain(OTHER.name);
    expect(csv).not.toContain(String(OTHER.costPricePerUnitUgx));
    const both = buildProductCatalogCsv("en", [PRODUCT, OTHER], { includeCost: true });
    expect(both).toContain("Test Product");
    expect(both).toContain(OTHER.name);
  });

  it("E — catalog and stock columns remain when cost is omitted", () => {
    const csv = buildProductCatalogCsv("en", [PRODUCT], { includeCost: false });
    const header = csvCells(csv)[0] ?? [];
    expect(header).toContain(t("en", "inventoryTableProduct"));
    expect(header).toContain(t("en", "inventoryTableSku"));
    expect(header).toContain(t("en", "inventoryTableShelf"));
    expect(header).toContain(t("en", "inventoryTableStock"));
    expect(header).toContain(t("en", "inventoryTablePrice"));
    expect(header).toContain(t("en", "inventoryTableUpdated"));
    expect(csv).toContain("SKU-TEST-1");
    expect(csv).toContain("10");
  });

  it("F — direct invocation without includeCost is fail-closed", () => {
    const csv = buildProductCatalogCsv("en", [PRODUCT]);
    expect(csv).not.toContain(t("en", "inventoryTableCost"));
    expect(csv).not.toContain("5000");
  });

  it("F — passing a cashier actor into the exporter omits cost without a UI flag", () => {
    const csv = buildProductCatalogCsv("en", [PRODUCT], {
      actor: actor("cashier"),
      snapshot: STARTER,
      authMode: "supabase",
    });
    expect(csv).not.toContain(t("en", "inventoryTableCost"));
    expect(csv).not.toContain("5000");
  });

  it("H — stock keeper (stock.adjust, no reports.profit) still gets cost, matching the UI helper", () => {
    const keeper = actor("stock_keeper");
    expect(actorCanSeeInventoryCostValue(keeper, STARTER, "supabase")).toBe(true);
    const csv = buildProductCatalogCsv("en", [PRODUCT], {
      includeCost: actorCanSeeInventoryCostValue(keeper, STARTER, "supabase"),
    });
    expect(csv).toContain(t("en", "inventoryTableCost"));
    expect(csv).toContain("5000");
  });
});

describe("INV-B6 source wiring", () => {
  it("all inventory catalog exporters pass includeCost from the financial visibility contract", () => {
    const exporter = src("src/features/inventory/export/productCatalogExport.ts");
    expect(exporter).toContain("includeCost");
    expect(exporter).toContain("actorCanSeeInventoryCostValue");
    expect(exporter).toContain("resolveCatalogCsvIncludeCost");
    expect(src("src/features/inventory/InventoryProductsControlBar.tsx")).toContain("includeCost: canSeeCost");
    expect(src("src/features/inventory/bulk/InventoryBulkToolbar.tsx")).toContain("includeCost: canSeeCost");
    expect(src("src/features/inventory/StockInventoryProductivityChrome.tsx")).toContain(
      "includeCost: canSeeCost",
    );
    expect(src("src/pages/StockPage.tsx")).toContain("actorCanSeeInventoryCostValue");
    expect(src("src/pages/StockPage.tsx")).toContain("canSeeCost={canSeeCost}");
  });
});
