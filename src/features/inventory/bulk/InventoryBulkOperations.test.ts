import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../../../data/defaultSeed";
import { preferencesPatchTouchesCatalog } from "../../../lib/catalogCloudSync";
import { requiredPermissionsForPreferencesPatch } from "../../../lib/settingsAuthorization";
import { setStoreSubscriptionContext } from "../../../lib/storeSubscriptionContext";
import { usePosStore } from "../../../store/usePosStore";
import type { Product, ShopPreferences } from "../../../types";
import {
  nextInventoryArchivedProductIds,
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

function sequentialArchiveIds(current: readonly string[], productIds: readonly string[]): string[] {
  let ids = [...current];
  for (const id of productIds) {
    ids = nextInventoryArchivedProductIds(ids, [id], "archive");
  }
  return ids;
}

describe("INV-B2 single-archive contract", () => {
  it("one product archive is a set union that does not drop existing ids", () => {
    expect(nextInventoryArchivedProductIds(["kept"], ["p-new"], "archive").sort()).toEqual(["kept", "p-new"]);
  });

  it("already archived ids stay archived (idempotent)", () => {
    expect(nextInventoryArchivedProductIds(["p1"], ["p1"], "archive")).toEqual(["p1"]);
  });

  it("bulk archive of three ids equals three sequential single archives", () => {
    const current = ["already"];
    const selected = ["a", "b", "c"];
    expect(nextInventoryArchivedProductIds(current, selected, "archive").sort()).toEqual(
      sequentialArchiveIds(current, selected).sort(),
    );
  });

  it("unarchive removes only the requested ids", () => {
    expect(nextInventoryArchivedProductIds(["a", "b", "c"], ["b"], "unarchive").sort()).toEqual(["a", "c"]);
  });
});

describe("INV-B2 runInventoryBulkOperation", () => {
  const a = product("prod-a", 10);
  const b = product("prod-b", 5);
  const c = product("prod-c", 0);
  const products = [a, b, c];

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products,
      purchases: [],
      stockMovements: [],
      archivedStockMovements: [],
      supplierPayments: [],
      preferences: {
        ...createDefaultPreferences(),
        inventoryArchivedProductIds: ["already-archived"],
      },
    });
  });

  function ctx(overrides?: { role?: "owner" | "manager" | "cashier"; preferences?: ShopPreferences }) {
    if (overrides?.role) {
      usePosStore.setState({
        sessionActor: { userId: `${overrides.role}:1`, role: overrides.role, displayName: overrides.role },
      });
    }
    const state = usePosStore.getState();
    return {
      lang: "en" as const,
      products: state.products,
      selectedIds: new Set(["prod-a", "prod-b", "prod-c"]),
      preferences: overrides?.preferences ?? state.preferences,
      store: {
        updateProduct: state.updateProduct,
        adjustStock: state.adjustStock,
        setPreferences: state.setPreferences,
      },
    };
  }

  it("A — cashier without settings.shop cannot bulk archive", async () => {
    const before = usePosStore.getState().preferences.inventoryArchivedProductIds;
    await runInventoryBulkOperation({ kind: "archive" }, ctx({ role: "cashier" }));
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual(before);
    expect(requiredPermissionsForPreferencesPatch({ inventoryArchivedProductIds: ["prod-a"] })).toEqual([
      "settings.shop",
    ]);
  });

  it("A — manager (canEdit UI) still cannot persist archive without settings.shop", async () => {
    const before = usePosStore.getState().preferences.inventoryArchivedProductIds;
    await runInventoryBulkOperation({ kind: "archive" }, ctx({ role: "manager" }));
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual(before);
  });

  it("B — owner can bulk archive", async () => {
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx());
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds?.sort()).toEqual(
      ["already-archived", "prod-a", "prod-b", "prod-c"].sort(),
    );
  });

  it("C/H — already archived products are skipped and do not drop other selected ids", async () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        inventoryArchivedProductIds: ["prod-a", "already-archived"],
      },
    });
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx());
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds?.sort()).toEqual(
      ["already-archived", "prod-a", "prod-b", "prod-c"].sort(),
    );
  });

  it("D — bulk archive does not change stockOnHand", async () => {
    await runInventoryBulkOperation({ kind: "archive" }, ctx());
    const after = usePosStore.getState().products;
    expect(after.find((p) => p.id === "prod-a")?.stockOnHand).toBe(10);
    expect(after.find((p) => p.id === "prod-b")?.stockOnHand).toBe(5);
    expect(after.find((p) => p.id === "prod-c")?.stockOnHand).toBe(0);
  });

  it("E — bulk archive does not create a stock movement or purchase", async () => {
    await runInventoryBulkOperation({ kind: "archive" }, ctx());
    expect(usePosStore.getState().stockMovements).toHaveLength(0);
    expect(usePosStore.getState().purchases).toHaveLength(0);
    expect(usePosStore.getState().supplierPayments).toHaveLength(0);
  });

  it("F — archive stays on preferences (same local persist path as a single setPreferences write)", async () => {
    expect(preferencesPatchTouchesCatalog({ inventoryArchivedProductIds: ["prod-a"] })).toBe(false);
    const beforeProducts = usePosStore.getState().products.map((p) => p.id);
    await runInventoryBulkOperation({ kind: "archive" }, ctx());
    expect(usePosStore.getState().products.map((p) => p.id)).toEqual(beforeProducts);
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toBeTruthy();
  });

  it("G — three valid products all archive; last-write-wins cannot drop the first two", async () => {
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx());
    expect(r.ok).toBe(true);
    const ids = new Set(usePosStore.getState().preferences.inventoryArchivedProductIds);
    expect(ids.has("prod-a")).toBe(true);
    expect(ids.has("prod-b")).toBe(true);
    expect(ids.has("prod-c")).toBe(true);
    expect(ids.has("already-archived")).toBe(true);
  });

  it("unarchive of three products removes all three", async () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        inventoryArchivedProductIds: ["prod-a", "prod-b", "prod-c", "kept"],
      },
    });
    const r = await runInventoryBulkOperation({ kind: "unarchive" }, ctx());
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual(["kept"]);
  });

  it("all-already-archived selection does not rewrite the id list", async () => {
    const frozen: ShopPreferences = {
      ...usePosStore.getState().preferences,
      inventoryArchivedProductIds: ["prod-a", "prod-b", "prod-c"],
    };
    usePosStore.setState({ preferences: frozen });
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx({ preferences: frozen }));
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual([
      "prod-a",
      "prod-b",
      "prod-c",
    ]);
  });
});

describe("INV-B2 source wiring", () => {
  it("bulk archive is routed through the batched archived-id helper, not per-row last-write-wins", () => {
    const ops = src("src/features/inventory/bulk/InventoryBulkOperations.ts");
    expect(ops).toContain("nextInventoryArchivedProductIds");
    expect(ops).toContain("applyBulkArchivePreference");
    expect(ops).toContain("writeArchivedProductIds");
    expect(ops).not.toMatch(/case "archive":\s*\{[\s\S]*readArchivedProductIds\(preferences\)/);
  });

  it("toolbar and keyboard archive both call runInventoryBulkOperation", () => {
    expect(src("src/features/inventory/bulk/InventoryBulkToolbar.tsx")).toContain("runInventoryBulkOperation");
    expect(src("src/features/inventory/bulk/InventoryBulkToolbar.tsx")).toContain('{ kind: "archive" }');
    expect(src("src/features/inventory/StockInventoryProductivityChrome.tsx")).toContain(
      "runInventoryBulkOperation",
    );
    expect(src("src/pages/StockPage.tsx")).toContain("StockInventoryProductivityChrome");
  });
});
