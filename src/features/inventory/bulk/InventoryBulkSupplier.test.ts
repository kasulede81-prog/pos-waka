import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../../../data/defaultSeed";
import {
  canPersistInventoryProductTagsPreferences,
  requiredPermissionsForPreferencesPatch,
} from "../../../lib/settingsAuthorization";
import { setStoreSubscriptionContext } from "../../../lib/storeSubscriptionContext";
import { usePosStore } from "../../../store/usePosStore";
import type { Product, ShopPreferences } from "../../../types";
import { productSupplierTag, readProductTags } from "../filters/inventoryAdvancedFilters";
import {
  nextInventoryProductTagsForSupplier,
  runInventoryBulkOperation,
} from "./InventoryBulkOperations";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function product(id: string, stockOnHand: number): Product {
  return {
    id,
    name: id,
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 400,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: id,
    minimumStockAlert: 2,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
  };
}

const SUPPLIER_NEW = "sup-new";
const SUPPLIER_X = "sup-x";
const SUPPLIER_B = "sup-b";
const SUPPLIER_C = "sup-c";
const SUPPLIER_D = "sup-d";

describe("INV-NEW-02 nextInventoryProductTagsForSupplier", () => {
  it("A — undefined initial map tags every selected product", () => {
    const next = nextInventoryProductTagsForSupplier(undefined, ["prod-a", "prod-b", "prod-c"], SUPPLIER_X);
    expect(next).toEqual({
      "prod-a": [productSupplierTag(SUPPLIER_X)],
      "prod-b": [productSupplierTag(SUPPLIER_X)],
      "prod-c": [productSupplierTag(SUPPLIER_X)],
    });
  });

  it("B/C — existing map updates selected ids and keeps unrelated entries", () => {
    const current = {
      "prod-a": [productSupplierTag("old")],
      "prod-b": [productSupplierTag(SUPPLIER_B)],
      "prod-c": [productSupplierTag(SUPPLIER_C)],
      "prod-d": [productSupplierTag(SUPPLIER_D), "seasonal"],
    };
    const next = nextInventoryProductTagsForSupplier(current, ["prod-a", "prod-c"], SUPPLIER_NEW);
    expect(next["prod-a"]).toEqual([productSupplierTag(SUPPLIER_NEW)]);
    expect(next["prod-b"]).toEqual([productSupplierTag(SUPPLIER_B)]);
    expect(next["prod-c"]).toEqual([productSupplierTag(SUPPLIER_NEW)]);
    expect(next["prod-d"]).toEqual([productSupplierTag(SUPPLIER_D), "seasonal"]);
  });

  it("does not invent a clear representation — assign replaces supplier:* only", () => {
    const current = {
      "prod-a": [productSupplierTag(SUPPLIER_X), "featured"],
      "prod-c": [productSupplierTag(SUPPLIER_C)],
    };
    const next = nextInventoryProductTagsForSupplier(current, ["prod-a"], SUPPLIER_NEW);
    expect(next["prod-a"]).toEqual(["featured", productSupplierTag(SUPPLIER_NEW)]);
    expect(next["prod-c"]).toEqual([productSupplierTag(SUPPLIER_C)]);
  });

  it("duplicate selected ids stay deterministic (one entry per product)", () => {
    const next = nextInventoryProductTagsForSupplier(undefined, ["prod-a", "prod-a", "prod-b"], SUPPLIER_X);
    expect(Object.keys(next)).toEqual(["prod-a", "prod-b"]);
    expect(next["prod-a"]).toEqual([productSupplierTag(SUPPLIER_X)]);
  });
});

describe("INV-NEW-02 bulk supplier-tag last-write-wins", () => {
  const a = product("prod-a", 10);
  const b = product("prod-b", 5);
  const c = product("prod-c", 0);
  const d = product("prod-d", 7);

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [a, b, c, d],
      purchases: [],
      stockMovements: [],
      archivedStockMovements: [],
      supplierPayments: [],
      preferences: createDefaultPreferences(),
    });
  });

  function ctx(overrides?: {
    role?: "owner" | "manager" | "cashier" | "stock_keeper";
    preferences?: ShopPreferences;
    selectedIds?: Set<string>;
  }) {
    if (overrides?.role) {
      usePosStore.setState({
        sessionActor: { userId: `${overrides.role}:1`, role: overrides.role, displayName: overrides.role },
      });
    }
    const state = usePosStore.getState();
    return {
      lang: "en" as const,
      products: state.products,
      selectedIds: overrides?.selectedIds ?? new Set(["prod-a", "prod-b", "prod-c"]),
      preferences: overrides?.preferences ?? state.preferences,
      store: {
        updateProduct: state.updateProduct,
        adjustStock: state.adjustStock,
        setPreferences: state.setPreferences,
      },
    };
  }

  const assignX = { kind: "supplier" as const, supplierId: SUPPLIER_X, supplierName: "Supplier X" };
  const assignNew = { kind: "supplier" as const, supplierId: SUPPLIER_NEW, supplierName: "Supplier NEW" };

  it("A — undefined inventoryProductTags: all three selected products keep the tag", async () => {
    expect(usePosStore.getState().preferences.inventoryProductTags).toBeUndefined();
    const r = await runInventoryBulkOperation(assignX, ctx());
    expect(r.ok).toBe(true);
    const tags = readProductTags(usePosStore.getState().preferences);
    expect(tags["prod-a"]).toEqual([productSupplierTag(SUPPLIER_X)]);
    expect(tags["prod-b"]).toEqual([productSupplierTag(SUPPLIER_X)]);
    expect(tags["prod-c"]).toEqual([productSupplierTag(SUPPLIER_X)]);
    expect(tags["prod-d"]).toBeUndefined();
  });

  it("B — existing map: unrelated product tags are preserved", async () => {
    const preferences: ShopPreferences = {
      ...usePosStore.getState().preferences,
      inventoryProductTags: {
        "prod-a": [productSupplierTag("old")],
        "prod-b": [productSupplierTag(SUPPLIER_B)],
        "prod-c": [productSupplierTag(SUPPLIER_C)],
        "prod-d": [productSupplierTag(SUPPLIER_D)],
      },
    };
    usePosStore.setState({ preferences });
    await runInventoryBulkOperation(
      assignNew,
      ctx({ preferences, selectedIds: new Set(["prod-a", "prod-c"]) }),
    );
    const tags = readProductTags(usePosStore.getState().preferences);
    expect(tags["prod-d"]).toEqual([productSupplierTag(SUPPLIER_D)]);
    expect(tags["prod-b"]).toEqual([productSupplierTag(SUPPLIER_B)]);
  });

  it("C — mixed update: A and C change, B stays", async () => {
    const preferences: ShopPreferences = {
      ...usePosStore.getState().preferences,
      inventoryProductTags: {
        "prod-a": [productSupplierTag("old")],
        "prod-b": [productSupplierTag(SUPPLIER_B)],
        "prod-c": [productSupplierTag(SUPPLIER_C)],
      },
    };
    usePosStore.setState({ preferences });
    await runInventoryBulkOperation(
      assignNew,
      ctx({ preferences, selectedIds: new Set(["prod-a", "prod-c"]) }),
    );
    const tags = readProductTags(usePosStore.getState().preferences);
    expect(tags["prod-a"]).toEqual([productSupplierTag(SUPPLIER_NEW)]);
    expect(tags["prod-b"]).toEqual([productSupplierTag(SUPPLIER_B)]);
    expect(tags["prod-c"]).toEqual([productSupplierTag(SUPPLIER_NEW)]);
  });

  it("D — assign replaces the selected supplier tag; no dedicated bulk-clear kind", async () => {
    const preferences: ShopPreferences = {
      ...usePosStore.getState().preferences,
      inventoryProductTags: {
        "prod-a": [productSupplierTag(SUPPLIER_X), "featured"],
        "prod-b": [productSupplierTag(SUPPLIER_B)],
        "prod-c": [productSupplierTag(SUPPLIER_C)],
      },
    };
    usePosStore.setState({ preferences });
    await runInventoryBulkOperation(
      assignNew,
      ctx({ preferences, selectedIds: new Set(["prod-a", "prod-b"]) }),
    );
    const tags = readProductTags(usePosStore.getState().preferences);
    expect(tags["prod-a"]).toEqual(["featured", productSupplierTag(SUPPLIER_NEW)]);
    expect(tags["prod-b"]).toEqual([productSupplierTag(SUPPLIER_NEW)]);
    expect(tags["prod-c"]).toEqual([productSupplierTag(SUPPLIER_C)]);
    expect(src("src/features/inventory/bulk/InventoryBulkOperations.ts")).not.toMatch(
      /kind:\s*"supplier"[\s\S]*clear|kind:\s*"clear-supplier"/,
    );
  });

  it("E — one authoritative setPreferences write for the whole selection", async () => {
    expect(usePosStore.getState().preferences.inventoryProductTags).toBeUndefined();
    const writes: Array<Record<string, string[]> | undefined> = [];
    const real = usePosStore.getState().setPreferences;
    const spy = vi.fn((p: Partial<ShopPreferences>, opts?: { silent?: boolean }) => {
      writes.push(p.inventoryProductTags);
      return real(p, opts);
    });
    const state = usePosStore.getState();
    const r = await runInventoryBulkOperation(assignX, {
      lang: "en",
      products: state.products,
      selectedIds: new Set(["prod-a", "prod-b", "prod-c"]),
      preferences: state.preferences,
      store: {
        updateProduct: state.updateProduct,
        adjustStock: state.adjustStock,
        setPreferences: spy,
      },
    });
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(writes[0]).toEqual({
      "prod-a": [productSupplierTag(SUPPLIER_X)],
      "prod-b": [productSupplierTag(SUPPLIER_X)],
      "prod-c": [productSupplierTag(SUPPLIER_X)],
    });
  });

  it("INV-POST-01 — cashier cannot persist supplier tags and result is not success", async () => {
    expect(requiredPermissionsForPreferencesPatch({ inventoryProductTags: {} })).toEqual(["settings.shop"]);
    const before = usePosStore.getState().preferences.inventoryProductTags;
    const r = await runInventoryBulkOperation(assignX, ctx({ role: "cashier" }));
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
    expect(r.message).toBe("You do not have permission for this action.");
    expect(usePosStore.getState().preferences.inventoryProductTags).toEqual(before);
  });

  it("INV-POST-01 — manager canEdit does not imply settings.shop; result is forbidden", async () => {
    const local = { snapshot: { kind: "local_full" as const }, authMode: "local" as const };
    expect(canPersistInventoryProductTagsPreferences({ userId: "manager:1", role: "manager", displayName: "manager" }, local)).toBe(
      false,
    );
    const before = usePosStore.getState().preferences.inventoryProductTags;
    const r = await runInventoryBulkOperation(assignX, ctx({ role: "manager" }));
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
    expect(usePosStore.getState().preferences.inventoryProductTags).toEqual(before);
  });

  it("INV-POST-01 — stock keeper cannot persist supplier tags; result is forbidden", async () => {
    const before = usePosStore.getState().preferences.inventoryProductTags;
    const r = await runInventoryBulkOperation(assignX, ctx({ role: "stock_keeper" }));
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
    expect(usePosStore.getState().preferences.inventoryProductTags).toEqual(before);
  });

  it("INV-POST-01 — unauthorized supplier is not a false success", async () => {
    const r = await runInventoryBulkOperation(assignX, ctx({ role: "manager" }));
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/Updated \d+ products/);
  });

  it("INV-POST-01 — owner can persist supplier tags", async () => {
    const r = await runInventoryBulkOperation(assignX, ctx());
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Updated 3 products");
    expect(readProductTags(usePosStore.getState().preferences)["prod-a"]).toEqual([
      productSupplierTag(SUPPLIER_X),
    ]);
  });

  it("INV-POST-01 — Bulk → Supplier is gated by persist helper, not canEdit", () => {
    const toolbar = src("src/features/inventory/bulk/InventoryBulkToolbar.tsx");
    expect(toolbar).toContain("canPersistSupplierTags");
    expect(toolbar).toMatch(/canPersistSupplierTags && suppliers\[0\]/);
    expect(src("src/pages/StockPage.tsx")).toContain("canPersistInventoryProductTagsPreferences");
    expect(src("src/pages/StockPage.tsx")).toContain("canPersistSupplierTags={canPersistSupplierTags}");
  });
});

describe("INV-NEW-02 source wiring", () => {
  it("bulk supplier is routed through the batched tag helper, not per-row last-write-wins", () => {
    const ops = src("src/features/inventory/bulk/InventoryBulkOperations.ts");
    expect(ops).toContain("nextInventoryProductTagsForSupplier");
    expect(ops).toContain("applyBulkSupplierPreference");
    expect(ops).toContain("writeProductTags");
    expect(ops).not.toMatch(/case "supplier":\s*\{[\s\S]*readProductTags\(preferences\)/);
  });
});
