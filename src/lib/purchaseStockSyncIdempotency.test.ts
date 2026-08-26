import { describe, expect, it } from "vitest";
import type { Product, Purchase } from "../types";
import { purchaseLineBaseUnitsIn } from "./purchaseLineSync";
import {
  isPurchaseStockLineSynced,
  purchaseStockLinesNeedingCloudPush,
  purchaseStockSyncNote,
  simulatePurchaseStockDeliveryAttempts,
  simulateShopPushProductStock,
  withPurchaseStockLineSynced,
  type SimulatedProductStockRow,
} from "./purchaseStockSyncIdempotency";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const coke: Product = {
  id: PRODUCT_A,
  name: "Coca-Cola",
  sellingPricePerUnitUgx: 1000,
  costPricePerUnitUgx: 500,
  stockOnHand: 10,
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

describe("purchaseStockSyncIdempotency R1", () => {
  it("T5 conversion: 1 crate @ rate 24 → delta 24 once", () => {
    const p = purchase();
    const delta = purchaseLineBaseUnitsIn(coke, p.lines[0]!);
    expect(delta).toBe(24);
    const needing = purchaseStockLinesNeedingCloudPush(p, [coke]);
    expect(needing).toEqual([
      {
        productId: PRODUCT_A,
        delta: 24,
        note: purchaseStockSyncNote(PURCHASE_ID),
        line: p.lines[0]!,
      },
    ]);

    const initial: SimulatedProductStockRow = {
      stockOnHand: 10,
      updatedAt: "2026-08-26T10:00:00.000Z",
      lastStockNote: null,
    };
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const after = simulatePurchaseStockDeliveryAttempts(
      initial,
      [
        {
          delta: 24,
          note,
          baseUpdatedAt: initial.updatedAt,
          baseStockOnHand: 10,
        },
        // Duplicate queue path / retry with stale base (certified bug pattern)
        {
          delta: 24,
          note,
          baseUpdatedAt: initial.updatedAt,
          baseStockOnHand: 10,
        },
      ],
      ["2026-08-26T10:02:00.000Z", "2026-08-26T10:02:01.000Z", "2026-08-26T10:02:02.000Z"],
    );
    expect(after.stockOnHand).toBe(34); // 10 + 24, not 10 + 48
  });

  it("T1 dual queue delivery applies stock once", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    const initial: SimulatedProductStockRow = {
      stockOnHand: 10,
      updatedAt: "t0",
      lastStockNote: null,
    };
    const after = simulatePurchaseStockDeliveryAttempts(
      initial,
      [
        { delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
        { delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      ],
      ["t1", "t2", "t3"],
    );
    expect(after.stockOnHand).toBe(11);
    expect(after.lastStockNote).toBe(note);
  });

  it("T2 retry after successful application stays +delta", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    let row: SimulatedProductStockRow = {
      stockOnHand: 10,
      updatedAt: "t0",
      lastStockNote: null,
    };
    const first = simulateShopPushProductStock(
      row,
      { delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t1",
    );
    expect(first.result.ok).toBe(true);
    row = first.row;
    expect(row.stockOnHand).toBe(11);

    const retry = simulateShopPushProductStock(
      row,
      { delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t2",
    );
    expect(retry.result.ok).toBe(true);
    if (retry.result.ok) expect(retry.result.idempotent).toBe(true);
    expect(retry.row.stockOnHand).toBe(11);
  });

  it("T3 stale_version recovery cannot re-apply same purchase delta", () => {
    const note = purchaseStockSyncNote(PURCHASE_ID);
    // Op A already applied.
    let row: SimulatedProductStockRow = {
      stockOnHand: 11,
      updatedAt: "t1",
      lastStockNote: note,
    };
    // Op B still has pre-purchase base → would have been stale then retried with same delta.
    const stale = simulateShopPushProductStock(
      row,
      { delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t2",
    );
    // Idempotency wins BEFORE stale rejection.
    expect(stale.result).toEqual({
      ok: true,
      idempotent: true,
      stockOnHand: 11,
      updatedAt: "t1",
    });
    expect(stale.row.stockOnHand).toBe(11);

    // Even if note check were skipped and stale retry ran, simulator still ends at 11:
    const afterRetryPath = simulatePurchaseStockDeliveryAttempts(
      {
        stockOnHand: 11,
        updatedAt: "t1",
        lastStockNote: note,
      },
      [{ delta: 1, note, baseUpdatedAt: "t0", baseStockOnHand: 10 }],
      ["t2", "t3"],
    );
    expect(afterRetryPath.stockOnHand).toBe(11);
  });

  it("T4 partial bundle: line A once, line B eventually once", () => {
    const p = purchase({
      lines: [
        { productId: PRODUCT_A, name: "Coca-Cola", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 1000 },
        { productId: PRODUCT_B, name: "Water", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 500 },
      ],
    });

    const noteA = purchaseStockSyncNote(PURCHASE_ID);
    const noteB = purchaseStockSyncNote(PURCHASE_ID);

    // First attempt: A succeeds, B fails (not pushed) — mark A locally.
    let local = withPurchaseStockLineSynced(p, PRODUCT_A, "t1");
    expect(isPurchaseStockLineSynced(local, PRODUCT_A)).toBe(true);
    expect(isPurchaseStockLineSynced(local, PRODUCT_B)).toBe(false);

    let rowA: SimulatedProductStockRow = {
      stockOnHand: 10,
      updatedAt: "t0",
      lastStockNote: null,
    };
    const pushA1 = simulateShopPushProductStock(
      rowA,
      { delta: 24, note: noteA, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t1",
    );
    rowA = pushA1.row;
    expect(rowA.stockOnHand).toBe(34);

    // Retry bundle: A skipped by local marker; B applies once.
    const needingRetry = purchaseStockLinesNeedingCloudPush(local, [coke, water]);
    expect(needingRetry.map((x) => x.productId)).toEqual([PRODUCT_B]);
    expect(needingRetry[0]!.delta).toBe(2);

    // Even if A were pushed again (legacy dual op), server stays at 34.
    const pushA2 = simulateShopPushProductStock(
      rowA,
      { delta: 24, note: noteA, baseUpdatedAt: "t0", baseStockOnHand: 10 },
      "t2",
    );
    expect(pushA2.result.ok && pushA2.result.idempotent).toBe(true);
    expect(pushA2.row.stockOnHand).toBe(34);

    let rowB: SimulatedProductStockRow = {
      stockOnHand: 5,
      updatedAt: "t0",
      lastStockNote: null,
    };
    const pushB = simulateShopPushProductStock(
      rowB,
      { delta: 2, note: noteB, baseUpdatedAt: "t0", baseStockOnHand: 5 },
      "t3",
    );
    expect(pushB.row.stockOnHand).toBe(7);

    local = withPurchaseStockLineSynced(local, PRODUCT_B, "t3");
    expect(local.stockSyncedAt).toBeTruthy();
    expect(purchaseStockLinesNeedingCloudPush(local, [coke, water])).toEqual([]);
  });

  it("T6 markers do not invent extra purchase/supplier facts", () => {
    const p = purchase({ balanceDeltaUgx: 5_000, amountPaidUgx: 7_000, totalCostUgx: 12_000 });
    const marked = withPurchaseStockLineSynced(p, PRODUCT_A);
    expect(marked.id).toBe(p.id);
    expect(marked.lines).toHaveLength(1);
    expect(marked.balanceDeltaUgx).toBe(5_000);
    expect(marked.amountPaidUgx).toBe(7_000);
    expect(marked.totalCostUgx).toBe(12_000);
    expect(marked.stockSyncedProductIds).toEqual([PRODUCT_A]);
  });
});
