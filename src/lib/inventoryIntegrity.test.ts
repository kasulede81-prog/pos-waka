import { describe, expect, it } from "vitest";
import type { Product, StockMovement } from "../types";
import {
  applyIdempotentSaleDeductions,
  applyStockDeltas,
  isStaleStockWrite,
  mergeProductCatalogFields,
  mergeProductFromCloudPull,
  mergeProductInventory,
  movementsToDeltas,
  patchProductsWithServerStock,
  returnStockDelta,
  saleStockDeltasFromLines,
  saleStockMovementsFromSale,
  simulateConcurrentDeviceSales,
  stableInventoryMovementId,
  verifyInventoryIntegrity,
  voidStockDelta,
} from "./inventoryIntegrity";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHOP_KEY = "shop:test";

function product(
  stockOnHand: number,
  updatedAt: string,
  overrides?: Partial<Product>,
): Product {
  return {
    id: PRODUCT_ID,
    name: "Item",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 100,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt,
    version: 1,
    ...overrides,
  };
}

describe("inventoryIntegrity — stable movement ids", () => {
  it("same sale + product yields deterministic id", () => {
    const a = stableInventoryMovementId(SHOP_KEY, "sale", SALE_A, PRODUCT_ID);
    const b = stableInventoryMovementId(SHOP_KEY, "sale", SALE_A, PRODUCT_ID);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("different sales yield different ids", () => {
    const a = stableInventoryMovementId(SHOP_KEY, "sale", SALE_A, PRODUCT_ID);
    const b = stableInventoryMovementId(SHOP_KEY, "sale", SALE_B, PRODUCT_ID);
    expect(a).not.toBe(b);
  });

  it("saleStockMovementsFromSale uses stable ids", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_A,
      createdAt: "2026-05-31T10:00:00.000Z",
      lines: [
        {
          productId: PRODUCT_ID,
          name: "Coke",
          quantity: 3,
          unitPriceUgx: 1000,
          unitCostUgx: 100,
          estimatedProfitUgx: 2700,
          inputMode: "quantity",
          lineTotalUgx: 3000,
        },
      ],
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.id).toBe(stableInventoryMovementId(SHOP_KEY, "sale", SALE_A, PRODUCT_ID));
    expect(moves[0]!.deltaBaseUnits).toBe(-3);
  });
});

describe("inventoryIntegrity — cloud pull merge", () => {
  it("always uses remote stock on cloud pull", () => {
    const local = product(12, "2026-05-31T12:00:00.000Z");
    const remote = product(2, "2026-05-31T10:00:00.000Z");
    const merged = mergeProductFromCloudPull(local, remote);
    expect(merged.stockOnHand).toBe(2);
  });

  it("mergeProductInventory aliases cloud pull merge", () => {
    const local = product(12, "2026-05-31T12:00:00.000Z");
    const remote = product(2, "2026-05-31T11:00:00.000Z");
    expect(mergeProductInventory(local, remote).stockOnHand).toBe(2);
  });

  it("field-safe merge keeps local price when local version is higher", () => {
    const local = product(10, "2026-05-31T10:00:00.000Z", {
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 80,
      version: 5,
    });
    const remote = product(10, "2026-05-31T12:00:00.000Z", {
      sellingPricePerUnitUgx: 1_000,
      costPricePerUnitUgx: 200,
      version: 2,
    });
    const merged = mergeProductCatalogFields(local, remote);
    expect(merged.sellingPricePerUnitUgx).toBe(2_000);
    expect(merged.costPricePerUnitUgx).toBe(80);
  });

  it("patchProductsWithServerStock applies server quantities", () => {
    const products = [product(99, "2026-05-31T09:00:00.000Z")];
    const patched = patchProductsWithServerStock(products, [
      {
        product_id: PRODUCT_ID,
        stock_on_hand: 5,
        updated_at: "2026-05-31T11:00:00.000Z",
      },
    ]);
    expect(patched[0]!.stockOnHand).toBe(5);
    expect(patched[0]!.updatedAt).toBe("2026-05-31T11:00:00.000Z");
  });
});

describe("inventoryIntegrity — stale detection", () => {
  it("flags stale when server stock changed after base snapshot", () => {
    expect(
      isStaleStockWrite({
        serverStockOnHand: 7,
        serverUpdatedAt: "2026-05-31T11:00:00.000Z",
        baseStockOnHand: 10,
        baseUpdatedAt: "2026-05-31T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows write when server unchanged since base", () => {
    expect(
      isStaleStockWrite({
        serverStockOnHand: 10,
        serverUpdatedAt: "2026-05-31T10:30:00.000Z",
        baseStockOnHand: 10,
        baseUpdatedAt: "2026-05-31T10:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("inventoryIntegrity — concurrent sales (scenario A)", () => {
  it("two devices selling same product yields correct final stock", () => {
    const { finalStock } = simulateConcurrentDeviceSales({
      initialStock: 100,
      deviceASaleQty: 3,
      deviceBSaleQty: 5,
      deviceACompletedAt: "2026-05-31T10:00:00.000Z",
      deviceBCompletedAt: "2026-05-31T10:05:00.000Z",
      productId: PRODUCT_ID,
      saleAId: SALE_A,
      saleBId: SALE_B,
    });
    expect(finalStock).toBe(92);
  });

  it("scenario A: stock 5, sell 3 + 3 → cloud ledger  -1 (allows negative in math)", () => {
    const { finalStock } = simulateConcurrentDeviceSales({
      initialStock: 5,
      deviceASaleQty: 3,
      deviceBSaleQty: 3,
      deviceACompletedAt: "2026-05-31T10:00:00.000Z",
      deviceBCompletedAt: "2026-05-31T10:01:00.000Z",
      saleAId: SALE_A,
      saleBId: SALE_B,
    });
    expect(finalStock).toBe(0);
  });
});

describe("inventoryIntegrity — idempotent replay (scenarios B/D)", () => {
  it("duplicate sync replay deducts once per sale+product", () => {
    const stock = applyIdempotentSaleDeductions(50, [
      { saleId: SALE_A, productId: PRODUCT_ID, quantity: 4, at: "2026-05-31T10:00:00.000Z" },
    ]);
    expect(stock).toBe(46);
  });

  it("ten retries of same sale still one deduction", () => {
    const sales = Array.from({ length: 10 }, () => ({
      saleId: SALE_A,
      productId: PRODUCT_ID,
      quantity: 2,
      at: "2026-05-31T10:00:00.000Z",
    }));
    expect(applyIdempotentSaleDeductions(20, sales)).toBe(18);
  });

  it("two sales same product both apply once", () => {
    const stock = applyIdempotentSaleDeductions(10, [
      { saleId: SALE_A, productId: PRODUCT_ID, quantity: 3, at: "2026-05-31T10:00:00.000Z" },
      { saleId: SALE_B, productId: PRODUCT_ID, quantity: 3, at: "2026-05-31T10:01:00.000Z" },
    ]);
    expect(stock).toBe(4);
  });
});

describe("inventoryIntegrity — offline recovery movements", () => {
  it("sale + void + return + purchase across movements", () => {
    const initial = 50;
    const deltas = [
      ...saleStockDeltasFromLines(SALE_A, [{ productId: PRODUCT_ID, quantity: 4 }], "2026-05-31T10:00:00.000Z"),
      voidStockDelta("void-1", PRODUCT_ID, 1, "2026-05-31T10:30:00.000Z"),
      returnStockDelta("ret-1", PRODUCT_ID, 2, "2026-05-31T11:00:00.000Z"),
      {
        productId: PRODUCT_ID,
        delta: 10,
        at: "2026-05-31T12:00:00.000Z",
        kind: "purchase_in" as const,
        refId: "purchase-1",
      },
    ];
    expect(applyStockDeltas(initial, deltas)).toBe(59);
  });

  it("7-day offline replay: queued sales converge on reconnect", () => {
    const opening = 100;
    const offlineSales = [
      { saleId: SALE_A, productId: PRODUCT_ID, quantity: 2, at: "2026-06-01T10:00:00.000Z" },
      { saleId: SALE_B, productId: PRODUCT_ID, quantity: 5, at: "2026-06-07T18:00:00.000Z" },
    ];
    const afterSync = applyIdempotentSaleDeductions(opening, offlineSales);
    expect(afterSync).toBe(93);
  });
});

describe("inventoryIntegrity — verification", () => {
  it("detects mismatch between recorded stock and movement ledger", () => {
    const products = [product(8, "2026-05-31T12:00:00.000Z")];
    const movements: StockMovement[] = [
      {
        id: stableInventoryMovementId(SHOP_KEY, "sale", SALE_A, PRODUCT_ID),
        at: "2026-05-31T10:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Item",
        deltaBaseUnits: -5,
        kind: "sale_out",
        summary: "Sale",
        refId: SALE_A,
        supplierId: null,
      },
    ];
    const { ok, mismatches } = verifyInventoryIntegrity({
      products,
      movements,
      openingStockByProduct: { [PRODUCT_ID]: 15 },
    });
    expect(ok).toBe(false);
    expect(mismatches[0]!.expectedFromMovements).toBe(10);
  });

  it("passes when recorded stock matches movement ledger", () => {
    const movements: StockMovement[] = [
      {
        id: "m1",
        at: "2026-05-31T10:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "Item",
        deltaBaseUnits: -3,
        kind: "sale_out",
        summary: "Sale",
        refId: SALE_A,
        supplierId: null,
      },
    ];
    const { ok } = verifyInventoryIntegrity({
      products: [product(7, "2026-05-31T11:00:00.000Z")],
      movements,
      openingStockByProduct: { [PRODUCT_ID]: 10 },
    });
    expect(ok).toBe(true);
  });
});

describe("inventoryIntegrity — movementsToDeltas", () => {
  it("converts local movement ledger to deltas", () => {
    const deltas = movementsToDeltas([
      {
        id: "1",
        at: "2026-05-31T10:00:00.000Z",
        productId: PRODUCT_ID,
        productName: "X",
        deltaBaseUnits: -2,
        kind: "sale_out",
        summary: "",
        refId: SALE_A,
        supplierId: null,
      },
    ]);
    expect(deltas[0]!.delta).toBe(-2);
  });
});
