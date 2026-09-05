import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  inventoryPurchasingTabFromSearch,
  pharmacyReceiveReplacementHref,
  resolvePharmacyReceiveDeepLink,
  stripPharmacyReceiveQuery,
} from "./pharmacyReceiveDeepLink";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const PRODUCT_A = "prod-a";
const PRODUCT_B = "prod-b";
const products = [{ id: PRODUCT_A }, { id: PRODUCT_B }];

describe("INV-NEW-01 pharmacy receive replacement deep link", () => {
  it("A — expiry destination includes tab=products, productId, and receive=1", () => {
    const href = pharmacyReceiveReplacementHref(PRODUCT_A);
    const url = new URL(href, "https://waka.local");
    expect(url.pathname).toBe("/pharmacy/inventory");
    expect(url.searchParams.get("tab")).toBe("products");
    expect(url.searchParams.get("productId")).toBe(PRODUCT_A);
    expect(url.searchParams.get("receive")).toBe("1");
  });

  it("B — hub selects Products for the receive intent", () => {
    expect(inventoryPurchasingTabFromSearch({ tab: "products", receive: "1" })).toBe("products");
    expect(inventoryPurchasingTabFromSearch({ receive: "1" })).toBe("products");
    expect(inventoryPurchasingTabFromSearch({})).toBe("overview");
    expect(inventoryPurchasingTabFromSearch({ tab: "purchases" })).toBe("purchases");
    expect(inventoryPurchasingTabFromSearch({ tab: "overview" })).toBe("overview");
  });

  it("C — receive sheet opens for product A, never product B", () => {
    const result = resolvePharmacyReceiveDeepLink({
      productId: PRODUCT_A,
      receive: "1",
      pharmacyMode: true,
      products,
      hydrated: true,
    });
    expect(result).toEqual({ action: "open", productId: PRODUCT_A });
    expect(result.action === "open" && result.productId).not.toBe(PRODUCT_B);
  });

  it("D — receive intent is one-shot after consume", () => {
    const first = resolvePharmacyReceiveDeepLink({
      productId: PRODUCT_A,
      receive: "1",
      pharmacyMode: true,
      products,
      hydrated: true,
    });
    expect(first.action).toBe("open");

    const cleaned = stripPharmacyReceiveQuery(
      new URLSearchParams("tab=products&productId=prod-a&receive=1"),
      true,
    );
    expect(cleaned.get("receive")).toBeNull();
    expect(cleaned.get("productId")).toBeNull();
    expect(cleaned.get("tab")).toBe("products");

    const second = resolvePharmacyReceiveDeepLink({
      productId: cleaned.get("productId"),
      receive: cleaned.get("receive"),
      pharmacyMode: true,
      products,
      hydrated: true,
    });
    expect(second).toEqual({ action: "noop" });
  });

  it("D — a rerender with receive already consumed does not reopen", () => {
    expect(
      resolvePharmacyReceiveDeepLink({
        productId: PRODUCT_A,
        receive: null,
        pharmacyMode: true,
        products,
        hydrated: true,
      }),
    ).toEqual({ action: "noop" });
  });

  it("E — missing product does not open another product", () => {
    const result = resolvePharmacyReceiveDeepLink({
      productId: "missing-id",
      receive: "1",
      pharmacyMode: true,
      products,
      hydrated: true,
    });
    expect(result).toEqual({ action: "miss" });
  });

  it("E — empty catalog before hydration waits instead of missing", () => {
    expect(
      resolvePharmacyReceiveDeepLink({
        productId: PRODUCT_A,
        receive: "1",
        pharmacyMode: true,
        products: [],
        hydrated: false,
      }),
    ).toEqual({ action: "wait" });
  });

  it("F — non-pharmacy mode does not open the receive sheet", () => {
    expect(
      resolvePharmacyReceiveDeepLink({
        productId: PRODUCT_A,
        receive: "1",
        pharmacyMode: false,
        products,
        hydrated: true,
      }),
    ).toEqual({ action: "miss" });
  });
});

describe("INV-NEW-01 source wiring", () => {
  it("expiry action uses the deep-link helper", () => {
    const page = src("src/pages/PharmacyExpiryCenterPage.tsx");
    expect(page).toContain("pharmacyReceiveReplacementHref");
    expect(page).not.toMatch(/\/pharmacy\/inventory\?productId=\$\{row\.productId\}&receive=1/);
  });

  it("hub tab parser and StockPage consume the same helper", () => {
    const hook = src("src/features/inventory-purchasing/hooks/useInventoryPurchasingTab.ts");
    expect(hook).toContain("inventoryPurchasingTabFromSearch");
    expect(hook).toContain('searchParams.get("receive")');

    const stock = src("src/pages/StockPage.tsx");
    expect(stock).toContain("resolvePharmacyReceiveDeepLink");
    expect(stock).toContain("stripPharmacyReceiveQuery");
    expect(stock).toContain("setReceiveProduct");
    expect(stock).toContain("PharmacyReceiveBatchSheet");
  });
});
