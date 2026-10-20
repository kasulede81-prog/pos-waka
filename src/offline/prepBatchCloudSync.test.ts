import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, StockMovement } from "../types";
import { usePosStore } from "../store/usePosStore";
import type { PrepBatchSyncPayload } from "../lib/prepBatchSync";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
  hasSupabaseConfig: true,
}));

const SHOP = "11111111-1111-4111-8111-111111111111";
const DISH = "dish-1";

function batchJson(over: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    menuProductId: DISH,
    preparedAt: "2026-10-01T10:00:00.000Z",
    portionsPrepared: 5,
    remainingPortions: 3,
    unitCostUgx: 1_000,
    expectedPortions: 5,
    actualPortions: 5,
    yieldBasis: "actual",
    costBasis: "recipe_estimate",
    batchCostPerPlateUgx: 1_200,
    status: "active",
    version: 2,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

function dish(batches: unknown[] = []): Product {
  return {
    id: DISH,
    name: "Prepared dish",
    sellingMode: "unit",
    baseUnit: "portion",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-10-01T09:00:00.000Z",
    version: 1,
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: { yieldQty: 10, lines: [{ ingredientProductId: "ing", quantityBase: 5 }] },
      modifierGroups: [],
      variants: [],
      prepBatches: batches as never,
    },
  };
}

const payload: PrepBatchSyncPayload = {
  kind: "waste",
  eventId: "waste-event",
  batchId: "batch-1",
  productId: DISH,
  portions: 2,
  reason: "unsold",
  dishStockAdjustmentId: "waste-event",
  createdAt: "2026-10-01T11:00:00.000Z",
};

beforeEach(() => {
  rpcMock.mockReset();
  usePosStore.setState({
    products: [dish()],
    stockMovements: [],
    archivedStockMovements: [],
  });
});

describe("prep batch cloud processor", () => {
  it("sends the durable payload, adopts server stock and the authoritative batch", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        batch: batchJson(),
        stocks: [{ product_id: DISH, stock_on_hand: 3, updated_at: "2026-10-01T11:00:00.000Z" }],
        stockDeltas: [{ productId: DISH, delta: -2 }],
      },
      error: null,
    });
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    expect(await processPrepBatchSyncOperation(payload, { shopId: SHOP, userId: "u1" })).toBe(true);

    expect(rpcMock).toHaveBeenCalledWith("shop_apply_prep_batch_event", {
      p_shop_id: SHOP,
      p_payload: payload,
    });
    const product = usePosStore.getState().products[0]!;
    expect(product.stockOnHand).toBe(3);
    expect(product.menu?.prepBatches).toHaveLength(1);
    expect(product.menu?.prepBatches?.[0]).toMatchObject({ id: "batch-1", remainingPortions: 3, version: 2 });
  });

  it("keeps a strictly newer local batch (an unacknowledged local event)", async () => {
    usePosStore.setState({ products: [dish([batchJson({ version: 5, remainingPortions: 1 })])] });
    rpcMock.mockResolvedValue({
      data: { ok: true, idempotent: false, batch: batchJson({ version: 4 }), stocks: [] },
      error: null,
    });
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    expect(await processPrepBatchSyncOperation(payload, { shopId: SHOP, userId: "u1" })).toBe(true);
    expect(usePosStore.getState().products[0]!.menu?.prepBatches?.[0]).toMatchObject({
      version: 5,
      remainingPortions: 1,
    });
  });

  it("reconciles a clamped waste movement to the server's applied delta", async () => {
    const movement: StockMovement = {
      id: "waste-event",
      at: "2026-10-01T11:00:00.000Z",
      productId: DISH,
      productName: "Prepared dish",
      deltaBaseUnits: -5,
      kind: "adjust_damage",
      summary: "Prep waste",
      refId: "batch-1",
      supplierId: null,
    };
    usePosStore.setState({ stockMovements: [movement] });
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        batch: batchJson({ remainingPortions: 1 }),
        stocks: [{ product_id: DISH, stock_on_hand: 1, updated_at: "2026-10-01T11:00:00.000Z" }],
        stockDeltas: [{ productId: DISH, delta: -4 }],
      },
      error: null,
    });
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    expect(await processPrepBatchSyncOperation({ ...payload, portions: 5 }, { shopId: SHOP, userId: "u1" })).toBe(true);
    expect(usePosStore.getState().stockMovements.find((m) => m.id === "waste-event")!.deltaBaseUnits).toBe(-4);
  });

  it("undoes an optimistic cancel restoration the server could not apply", async () => {
    const ingredient: Product = {
      ...dish(),
      id: "ing-1",
      name: "Ingredient",
      stockOnHand: 50,
      menu: { productKind: "ingredient" },
    };
    const movement: StockMovement = {
      id: "cancel-ing-move",
      at: "2026-10-01T11:00:00.000Z",
      productId: "ing-1",
      productName: "Ingredient",
      deltaBaseUnits: 5,
      kind: "adjust_use",
      summary: "Prep cancel +5",
      refId: "batch-1",
      supplierId: null,
    };
    usePosStore.setState({ stockMovements: [movement], products: [dish(), ingredient] });
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        batch: batchJson({ status: "cancelled", remainingPortions: 0 }),
        stocks: [],
        stockDeltas: [],
      },
      error: null,
    });
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    const cancel: PrepBatchSyncPayload = {
      kind: "cancel",
      eventId: "cancel-event",
      batchId: "batch-1",
      productId: DISH,
      dishStockAdjustmentId: "cancel-dish-move",
      ingredientAdjustments: [{ productId: "ing-1", adjustmentId: "cancel-ing-move" }],
      createdAt: payload.createdAt,
    };
    expect(await processPrepBatchSyncOperation(cancel, { shopId: SHOP, userId: "u1" })).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === "ing-1")!.stockOnHand).toBe(45);
    expect(usePosStore.getState().stockMovements.find((m) => m.id === "cancel-ing-move")!.deltaBaseUnits).toBe(0);
  });

  it("retries when the sale is not yet completed / the RPC is missing", async () => {
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    rpcMock.mockResolvedValue({ data: { ok: false, error: "sale_not_completed", retry: true }, error: null });
    expect(
      await processPrepBatchSyncOperation(
        { kind: "sale_consume", eventId: "line-1", saleId: "sale-1", saleLineId: "line-1", createdAt: payload.createdAt },
        { shopId: SHOP, userId: "u1" },
      ),
    ).toBe(false);

    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await processPrepBatchSyncOperation(payload, { shopId: SHOP, userId: "u1" })).toBe(false);
  });

  it("an idempotent server replay is acknowledged without duplicating local state", async () => {
    usePosStore.setState({ products: [dish([batchJson({ version: 2, remainingPortions: 3 })])] });
    rpcMock.mockResolvedValue({
      data: { ok: true, idempotent: true, batch: batchJson({ version: 2, remainingPortions: 3 }), stocks: [] },
      error: null,
    });
    const { processPrepBatchSyncOperation } = await import("./prepBatchCloudSync");
    expect(await processPrepBatchSyncOperation(payload, { shopId: SHOP, userId: "u1" })).toBe(true);
    expect(usePosStore.getState().products[0]!.menu?.prepBatches).toHaveLength(1);
  });
});
