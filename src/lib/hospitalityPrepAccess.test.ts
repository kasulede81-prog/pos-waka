/**
 * Inventory prep-batch access — `stock.adjust` prepares, `settings.shop` configures.
 *
 * The store action already re-checks `stock.adjust`; these tests pin the UI
 * contract and prove a settings-only operator cannot use the inventory surface
 * to create prepared stock.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "../types";
import type { SessionActor } from "./sessionActor";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import { usePosStore } from "../store/usePosStore";
import { isBatchPreparableProduct, resolveHospitalityPrepAccess } from "./hospitalityPrepAccess";

const SNAPSHOT: SubscriptionSnapshot = { kind: "local_full" };

const DISH_ID = "dish-1";
const CHICKEN_ID = "chicken-1";

function actor(role: SessionActor["role"], permissions?: SessionActor["permissions"]): SessionActor {
  return {
    userId: "staff:1",
    role,
    displayName: "Staff",
    // A JWT/membership snapshot for the authenticated operator (not Path S PIN staff).
    ...(permissions ? { authPermissions: permissions } : {}),
  };
}

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 15_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-10-20T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const chicken = product({
  id: CHICKEN_ID,
  name: "Chicken",
  costPricePerUnitUgx: 8_000,
  stockOnHand: 10,
  baseUnit: "kg",
  menu: { productKind: "ingredient" },
});

function dish(overrides?: Partial<Product>): Product {
  return product({
    id: DISH_ID,
    name: "Chicken + Chips",
    baseUnit: "portion",
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: {
        yieldQty: 20,
        lines: [{ ingredientProductId: CHICKEN_ID, quantityBase: 5, unitLabel: "kg" }],
      },
      modifierGroups: [],
      variants: [],
    },
    ...overrides,
  });
}

function seed(seedActor: SessionActor, products: Product[] = [chicken, dish()]) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: seedActor,
    products,
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    archivedVoidRecords: [],
    returnRecords: [],
    archivedReturnRecords: [],
    auditLogs: [],
    archivedAuditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
  });
}

describe("resolveHospitalityPrepAccess", () => {
  it("lets a stock keeper prepare batches without opening menu configuration", () => {
    expect(resolveHospitalityPrepAccess(actor("stock_keeper"), SNAPSHOT, "local")).toEqual({
      canPrepareBatches: true,
      canConfigureMenu: false,
    });
  });

  it("lets a manager prepare batches without opening menu configuration", () => {
    expect(resolveHospitalityPrepAccess(actor("manager"), SNAPSHOT, "local")).toEqual({
      canPrepareBatches: true,
      canConfigureMenu: false,
    });
  });

  it("denies a cashier without stock.adjust", () => {
    expect(resolveHospitalityPrepAccess(actor("cashier"), SNAPSHOT, "local")).toEqual({
      canPrepareBatches: false,
      canConfigureMenu: false,
    });
  });

  it("keeps a settings-only custom role on configuration and out of preparation", () => {
    expect(
      resolveHospitalityPrepAccess(actor("supervisor", ["settings.shop"]), SNAPSHOT, "local"),
    ).toEqual({
      canPrepareBatches: false,
      canConfigureMenu: true,
    });
  });

  it("keeps the owner on both paths", () => {
    expect(resolveHospitalityPrepAccess(actor("owner"), SNAPSHOT, "local")).toEqual({
      canPrepareBatches: true,
      canConfigureMenu: true,
    });
  });
});

describe("isBatchPreparableProduct", () => {
  it("accepts a finished dish already saved as batch prepared with a recipe", () => {
    expect(isBatchPreparableProduct(dish())).toBe(true);
  });

  it("rejects made-to-order dishes (mode changes belong to Menu Builder)", () => {
    expect(isBatchPreparableProduct(dish({ menu: { ...dish().menu!, prepMode: "made_to_order" } }))).toBe(false);
  });

  it("rejects ingredients and dishes without a recipe", () => {
    expect(isBatchPreparableProduct(chicken)).toBe(false);
    expect(isBatchPreparableProduct(dish({ menu: { ...dish().menu!, recipe: { lines: [] } } }))).toBe(false);
  });
});

describe("prepareMenuBatch authorization boundary", () => {
  beforeEach(() => {
    seed(actor("stock_keeper"));
  });

  it("records the batch for a stock keeper through the existing action", () => {
    const result = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 20,
      batchId: "batch-stock-keeper",
    });

    expect(result).toEqual({ ok: true, batchId: "batch-stock-keeper" });
    const state = usePosStore.getState();
    expect(state.products.find((p) => p.id === CHICKEN_ID)!.stockOnHand).toBe(5);
    expect(state.products.find((p) => p.id === DISH_ID)!.stockOnHand).toBe(20);
    expect(state.products.find((p) => p.id === DISH_ID)!.menu?.prepBatches).toHaveLength(1);
    expect(state.stockMovements.some((m) => m.refId === "batch-stock-keeper")).toBe(true);
    expect(state.auditLogs.some((a) => a.action === "hospitality_prep_batch")).toBe(true);
  });

  it("denies a cashier with no batch, stock or audit side effects", () => {
    seed(actor("cashier"));

    const result = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 20,
      batchId: "batch-cashier",
    });

    expect(result).toEqual({ ok: false, errorKey: "forbidden" });
    const state = usePosStore.getState();
    expect(state.products.find((p) => p.id === CHICKEN_ID)!.stockOnHand).toBe(10);
    expect(state.products.find((p) => p.id === DISH_ID)!.stockOnHand).toBe(0);
    expect(state.products.find((p) => p.id === DISH_ID)!.menu?.prepBatches ?? []).toHaveLength(0);
    expect(state.stockMovements).toHaveLength(0);
    expect(state.auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("denies a settings-only operator at the store boundary too", () => {
    seed(actor("supervisor", ["settings.shop"]));

    const result = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 20,
      batchId: "batch-settings-only",
    });

    expect(result).toEqual({ ok: false, errorKey: "forbidden" });
    expect(usePosStore.getState().products.find((p) => p.id === DISH_ID)!.stockOnHand).toBe(0);
    expect(usePosStore.getState().stockMovements).toHaveLength(0);
  });
});
