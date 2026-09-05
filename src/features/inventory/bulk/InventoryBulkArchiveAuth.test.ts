import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../../../data/defaultSeed";
import {
  canPersistInventoryArchivePreferences,
  requiredPermissionsForPreferencesPatch,
} from "../../../lib/settingsAuthorization";
import { setStoreSubscriptionContext } from "../../../lib/storeSubscriptionContext";
import type { SessionActor } from "../../../lib/sessionActor";
import { usePosStore } from "../../../store/usePosStore";
import type { Product } from "../../../types";
import { runInventoryBulkOperation } from "./InventoryBulkOperations";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: `${role}:1`, role, displayName: role };
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

describe("INV-NEW-05 inventory bulk archive permission / false-success", () => {
  const a = product("prod-a", 10);
  const b = product("prod-b", 5);
  const c = product("prod-c", 0);
  const d = product("prod-d", 7);

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("owner"),
      products: [a, b, c, d],
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

  function ctx(role: SessionActor["role"] = "owner") {
    usePosStore.setState({ sessionActor: actor(role) });
    const state = usePosStore.getState();
    return {
      lang: "en" as const,
      products: state.products,
      selectedIds: new Set(["prod-a", "prod-b", "prod-c"]),
      preferences: state.preferences,
      store: {
        updateProduct: state.updateProduct,
        adjustStock: state.adjustStock,
        setPreferences: state.setPreferences,
      },
    };
  }

  it("A — authorized owner archives all selected products and reports success", async () => {
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx("owner"));
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Updated 3 products");
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds?.sort()).toEqual(
      ["already-archived", "prod-a", "prod-b", "prod-c"].sort(),
    );
  });

  it("B — manager/stock_keeper canEdit UI does not persist archive and UI must not advertise it", () => {
    const local = { snapshot: { kind: "local_full" as const }, authMode: "local" as const };
    expect(canPersistInventoryArchivePreferences(actor("manager"), local)).toBe(false);
    expect(canPersistInventoryArchivePreferences(actor("stock_keeper"), local)).toBe(false);
    expect(canPersistInventoryArchivePreferences(actor("owner"), local)).toBe(true);

    const toolbar = src("src/features/inventory/bulk/InventoryBulkToolbar.tsx");
    expect(toolbar).toContain("canArchive");
    expect(toolbar).toMatch(/canArchive \? \(/);
    expect(toolbar).toContain('{ kind: "archive" }');
    expect(src("src/pages/StockPage.tsx")).toContain("canPersistInventoryArchivePreferences");
    expect(src("src/pages/StockPage.tsx")).toContain("canArchive={canArchive}");
    expect(src("src/features/inventory/StockInventoryProductivityChrome.tsx")).toContain(
      "onArchive: canArchive ? onArchive : undefined",
    );
  });

  it("C — unauthorized manager bypass still leaves archive IDs unchanged", async () => {
    const before = usePosStore.getState().preferences.inventoryArchivedProductIds;
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx("manager"));
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual(before);
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
  });

  it("D — unauthorized archive is not a false success", async () => {
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx("manager"));
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/Updated \d+ products/);
    expect(r.message).toBe("You do not have permission for this action.");
  });

  it("E — B2 batching: authorized A+B+C all persist in one write", async () => {
    const r = await runInventoryBulkOperation({ kind: "archive" }, ctx("owner"));
    expect(r.ok).toBe(true);
    const ids = new Set(usePosStore.getState().preferences.inventoryArchivedProductIds);
    expect(ids.has("prod-a")).toBe(true);
    expect(ids.has("prod-b")).toBe(true);
    expect(ids.has("prod-c")).toBe(true);
  });

  it("F — unrelated existing archive IDs remain", async () => {
    await runInventoryBulkOperation({ kind: "archive" }, ctx("owner"));
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toContain("already-archived");
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).not.toContain("prod-d");
  });

  it("G — store permission for inventoryArchivedProductIds remains settings.shop", () => {
    expect(requiredPermissionsForPreferencesPatch({ inventoryArchivedProductIds: ["prod-a"] })).toEqual([
      "settings.shop",
    ]);
    expect(src("src/lib/settingsAuthorization.ts")).not.toMatch(
      /inventoryArchivedProductIds[\s\S]{0,80}stock\.adjust|inventoryArchivedProductIds[\s\S]{0,80}products\.add/,
    );
  });

  it("C/D — unauthorized unarchive is the same preference gate (no false success)", async () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        inventoryArchivedProductIds: ["already-archived", "prod-a"],
      },
    });
    const before = usePosStore.getState().preferences.inventoryArchivedProductIds;
    const r = await runInventoryBulkOperation({ kind: "unarchive" }, ctx("manager"));
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("forbidden");
    expect(usePosStore.getState().preferences.inventoryArchivedProductIds).toEqual(before);
  });
});
