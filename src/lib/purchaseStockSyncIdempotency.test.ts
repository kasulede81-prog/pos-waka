import { describe, expect, it } from "vitest";
import type { Product, Purchase } from "../types";
import { purchaseLineBaseUnitsIn } from "./purchaseLineSync";
import {
  isPurchaseStockLineSynced,
  purchaseStockLinesNeedingCloudPush,
  purchaseStockOperationKey,
  purchaseStockSyncNote,
  simulateConcurrentPurchaseStockPushes,
  simulatePurchaseStockDeliveryAttempts,
  simulateShopPushProductStock,
  simulateUnrelatedStockNoteOverwrite,
  withPurchaseStockLineSynced,
  type SimulatedProductStockRow,
} from "./purchaseStockSyncIdempotency";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PURCHASE_ID_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const coke: Product = {
  id: PRODUCT_A,
  name: "Coca-Cola",
  sellingPricePerUnitUgx: 1000,
  costPricePerUnitUgx: 500,
  stockOnHand: 100,
  baseUnit: "bottle",
  sellingMode: "unit",
  buyingUnit: "crate",
  conversionRate: 24,
  category: "Drinks",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-08-26T10:00:00.000Z",
  version: 1,
};

const water: Product = {
  ...coke,
  id: PRODUCT_B,
  name: "Water",
  buyingUnit: null,
  conversionRate: 1,
  stockOnHand: 5,
};

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    supplierName: "Town",
    lines: [
      {
        productId: PRODUCT_A,
        name: "Coca-Cola",
        qtyBuyingUnits: 1,
        costPerBuyingUnitUgx: 12_000,
      },
    ],
    totalCostUgx: 12_000,
    amountPaidUgx: 12_000,
    balanceDeltaUgx: 0,
    notes: "",
    createdAt: "2026-08-26T10:01:00.000Z",
    pendingSync: true,
    ...overrides,
  };
}

function emptyRow(stock = 100): SimulatedProductStockRow {
  return {
    stockOnHand: stock,
    updatedAt: "t0",
    lastStockNote: null,
    appliedPurchaseOps: new Set(),
  };
}

describe("purchaseStockSyncIdempotency R2", () => {
  it("T1 normal purchase: N → N+D", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      emptyRow(100),
      [{ productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 }],
      ["t1"],
    );
    expect(after.stockOnHand).toBe(101);
    expect(after.appliedPurchaseOps.has(purchaseStockOperationKey(PURCHASE_ID, PRODUCT_A))).toBe(true);
  });

  it("T2 immediate duplicate stays N+D", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      emptyRow(100),
      [
        { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
        { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      ],
      ["t1", "t2", "t3"],
    );
    expect(after.stockOnHand).toBe(101);
  });

  it("T3 CRITICAL: delayed duplicate after unrelated note overwrite stays once", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    let row = emptyRow(100);
    const first = simulateShopPushProductStock(
      row,
      { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t1",
    );
    expect(first.row.stockOnHand).toBe(124);
    row = first.row;

    // Later adjustment/count/P2 overwrites lastStockNote (R1R hole).
    row = simulateUnrelatedStockNoteOverwrite(row, "count", -2, "t2");
    expect(row.lastStockNote).toBe("count");
    expect(row.stockOnHand).toBe(122);
    expect(row.appliedPurchaseOps.has(purchaseStockOperationKey(PURCHASE_ID, PRODUCT_A))).toBe(true);

    // Delayed P1 replay must NOT re-apply +24.
    const replay = simulateShopPushProductStock(
      row,
      { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t3",
    );
    expect(replay.result.ok && replay.result.idempotent).toBe(true);
    expect(replay.row.stockOnHand).toBe(122);

    // Later different purchase P2 still applies.
    const note2 = purchaseStockSyncNote(PURCHASE_ID_2);
    const p2 = simulateShopPushProductStock(
      replay.row,
      { productId: PRODUCT_A, delta: 1, note: note2, baseUpdatedAt: "t2", baseStockOnHand: 122 },
      "t4",
    );
    expect(p2.row.stockOnHand).toBe(123);
  });

  it("T4 crash after server apply (no client marker) replay is idempotent", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const server = simulateShopPushProductStock(
      emptyRow(100),
      { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t1",
    );
    // Client never wrote stockSyncedProductIds — full replay.
    const restart = simulateShopPushProductStock(
      server.row,
      { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t2",
    );
    expect(restart.result.ok && restart.result.idempotent).toBe(true);
    expect(restart.row.stockOnHand).toBe(101);
  });

  it("T5 concurrent duplicate requests → exactly one effect", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulateConcurrentPurchaseStockPushes(
      emptyRow(100),
      { productId: PRODUCT_A, delta: 5, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t1",
      "t2",
    );
    expect(after.stockOnHand).toBe(105);
  });

  it("T6 genuine stale then apply once", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    let row = emptyRow(100);
    // Unrelated op changed stock first (no purchase key).
    row = simulateUnrelatedStockNoteOverwrite(row, "adjust", 3, "t1");
    expect(row.stockOnHand).toBe(103);

    const stale = simulateShopPushProductStock(
      row,
      { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t2",
    );
    expect(stale.result.ok).toBe(false);
    if (stale.result.ok) throw new Error("expected stale");

    // Client adopts server and retries with same delta/note.
    const retry = simulateShopPushProductStock(
      row,
      {
        productId: PRODUCT_A,
        delta: 1,
        note,
        baseUpdatedAt: stale.result.serverUpdatedAt,
        baseStockOnHand: stale.result.serverStockOnHand,
      },
      "t3",
    );
    expect(retry.row.stockOnHand).toBe(104);
    const again = simulateShopPushProductStock(
      retry.row,
      {
        productId: PRODUCT_A,
        delta: 1,
        note,
        baseUpdatedAt: retry.row.updatedAt,
        baseStockOnHand: retry.row.stockOnHand,
      },
      "t4",
    );
    expect(again.result.ok && again.result.idempotent).toBe(true);
    expect(again.row.stockOnHand).toBe(104);
  });

  it("T7 partial bundle: A once, B eventually once", () => {
    const p = purchase({
      lines: [
        { productId: PRODUCT_A, name: "Coca-Cola", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 1000 },
        { productId: PRODUCT_B, name: "Water", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 500 },
      ],
    });
    const note = purchaseStockSyncNote(PURCHASE_ID);

    let local = withPurchaseStockLineSynced(p, PRODUCT_A, "t1");
    expect(isPurchaseStockLineSynced(local, PRODUCT_A)).toBe(true);
    expect(isPurchaseStockLineSynced(local, PRODUCT_B)).toBe(false);

    let rowA = emptyRow(10);
    rowA = simulateShopPushProductStock(
      rowA,
      { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t1",
    ).row;
    expect(rowA.stockOnHand).toBe(34);

    const needing = purchaseStockLinesNeedingCloudPush(local, [coke, water]);
    expect(needing.map((x) => x.productId)).toEqual([PRODUCT_B]);
    expect(needing[0]!.delta).toBe(2);

    // A replay after note overwrite still safe.
    rowA = simulateUnrelatedStockNoteOverwrite(rowA, "void", 0, "t2");
    const aReplay = simulateShopPushProductStock(
      rowA,
      { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t3",
    );
    expect(aReplay.row.stockOnHand).toBe(34);

    let rowB = emptyRow(5);
    rowB = simulateShopPushProductStock(
      rowB,
      { productId: PRODUCT_B, delta: 2, note, baseUpdatedAt: "t0", baseStockOnHand: 5 },
      "t4",
    ).row;
    expect(rowB.stockOnHand).toBe(7);

    local = withPurchaseStockLineSynced(local, PRODUCT_B, "t4");
    expect(purchaseStockLinesNeedingCloudPush(local, [coke, water])).toEqual([]);
  });

  it("T8 legacy dual queue both delivered → one effect", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      emptyRow(100),
      [
        // pending_stock_updates then pending_purchases
        { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
        { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      ],
      ["t1", "t2", "t3"],
    );
    expect(after.stockOnHand).toBe(101);
  });

  it("T9 same-product multi-line aggregates to +24 once", () => {
    const p = purchase({
      lines: [
        { productId: PRODUCT_A, name: "Coca-Cola", qtyBuyingUnits: 10, costPerBuyingUnitUgx: 500, unitMode: "base_units" },
        { productId: PRODUCT_A, name: "Coca-Cola", qtyBuyingUnits: 14, costPerBuyingUnitUgx: 500, unitMode: "base_units" },
      ],
      totalCostUgx: 12_000,
    });
    const needing = purchaseStockLinesNeedingCloudPush(p, [coke]);
    expect(needing).toHaveLength(1);
    expect(needing[0]!.delta).toBe(24);

    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      emptyRow(100),
      [
        { productId: PRODUCT_A, delta: needing[0]!.delta, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
        { productId: PRODUCT_A, delta: needing[0]!.delta, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      ],
      ["t1", "t2"],
    );
    expect(after.stockOnHand).toBe(124);
  });

  it("T10 conversion 1 crate × 24 → +24 once not +48", () => {
    const p = purchase();
    expect(purchaseLineBaseUnitsIn(coke, p.lines[0]!)).toBe(24);
    const needing = purchaseStockLinesNeedingCloudPush(p, [coke]);
    expect(needing[0]!.delta).toBe(24);

    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      emptyRow(100),
      [
        { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
        { productId: PRODUCT_A, delta: 24, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      ],
      ["t1", "t2", "t3"],
    );
    expect(after.stockOnHand).toBe(124);
  });

  it("T11 purchase/payable fields unchanged by markers", () => {
    const p = purchase({ balanceDeltaUgx: 5_000, amountPaidUgx: 7_000, totalCostUgx: 12_000 });
    const marked = withPurchaseStockLineSynced(p, PRODUCT_A);
    expect(marked.balanceDeltaUgx).toBe(5_000);
    expect(marked.amountPaidUgx).toBe(7_000);
    expect(marked.totalCostUgx).toBe(12_000);
    expect(marked.lines).toHaveLength(1);
  });

  it("T12 non-purchase stock does not collide with purchase keys", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    let row = emptyRow(100);
    row = simulateShopPushProductStock(
      row,
      { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t1",
    ).row;
    expect(row.stockOnHand).toBe(101);

    // Adjustment uses non-purchase note — applies and overwrites lastStockNote.
    row = simulateUnrelatedStockNoteOverwrite(row, "count", -5, "t2");
    expect(row.stockOnHand).toBe(96);
    expect(row.lastStockNote).toBe("count");

    // Purchase still recognized via durable key; adjustment is not blocked from existing.
    const replay = simulateShopPushProductStock(
      row,
      { productId: PRODUCT_A, delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 100 },
      "t3",
    );
    expect(replay.row.stockOnHand).toBe(96);
  });
});
