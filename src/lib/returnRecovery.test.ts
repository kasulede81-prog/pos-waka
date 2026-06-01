import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale } from "../types";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { getCompletedFinancials } from "./financialMetrics";
import { mergeReturnRecordsForRecovery, rowToReturnRecord } from "./returnRecovery";

const DAY = "2026-05-31";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RETURN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const products: Product[] = [
  {
    id: PRODUCT_ID,
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 1_000,
    stockOnHand: 49,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
  },
];

function completedSaleAfterReturn(): Sale {
  return {
    id: SALE_ID,
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:30:00.000Z`,
    subtotalUgx: 10_000,
    totalUgx: 5_000,
    cashPaidUgx: 5_000,
    debtUgx: 0,
    estimatedProfitUgx: 4_000,
    voidedTotalUgx: 5_000,
    lines: [
      {
        id: "line-1",
        productId: PRODUCT_ID,
        name: "Item",
        quantity: 1,
        unitPriceUgx: 10_000,
        unitCostUgx: 1_000,
        estimatedProfitUgx: 9_000,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
        lineTotalUgx: 10_000,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

function cloudReturnRow(): Record<string, unknown> {
  return {
    id: RETURN_ID,
    shop_id: "shop-1",
    sale_id: SALE_ID,
    product_id: PRODUCT_ID,
    quantity: 1,
    refund_amount_ugx: 5_000,
    reason: "other",
    note: null,
    created_by: "user-1",
    created_at: `${DAY}T11:00:00.000Z`,
    updated_at: `${DAY}T11:00:00.000Z`,
    metadata: { productName: "Item", actorName: "Owner", wakaClient: true },
  };
}

describe("returnRecovery — row mapping", () => {
  it("maps sale_returns row to ReturnRecord", () => {
    const parsed = rowToReturnRecord(cloudReturnRow());
    expect(parsed).not.toBeNull();
    expect(parsed!.record.id).toBe(RETURN_ID);
    expect(parsed!.record.saleId).toBe(SALE_ID);
    expect(parsed!.record.productId).toBe(PRODUCT_ID);
    expect(parsed!.record.refundAmountUgx).toBe(5_000);
    expect(parsed!.record.productName).toBe("Item");
  });
});

describe("returnRecovery — device recovery totals", () => {
  it("new device with cloud returns matches source device revenue, profit, and expected cash", () => {
    const sale = completedSaleAfterReturn();
    const returnRec: ReturnRecord = rowToReturnRecord(cloudReturnRow())!.record;
    const sourceFin = getCompletedFinancials([sale], [returnRec], products, { day: DAY });
    const sourceDrawer = getDrawerCashForDayInput({
      sales: [sale],
      returns: [returnRec],
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });

    const recoveredReturns = mergeReturnRecordsForRecovery([], [rowToReturnRecord(cloudReturnRow())!]);
    expect(recoveredReturns).toHaveLength(1);

    const recoveredFin = getCompletedFinancials([sale], recoveredReturns, products, { day: DAY });
    const recoveredDrawer = getDrawerCashForDayInput({
      sales: [sale],
      returns: recoveredReturns,
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });

    expect(recoveredFin.revenueUgx).toBe(sourceFin.revenueUgx);
    expect(recoveredFin.profitUgx).toBe(sourceFin.profitUgx);
    expect(recoveredFin.cashCollectedUgx).toBe(sourceFin.cashCollectedUgx);
    expect(recoveredDrawer.expectedDrawerCashUgx).toBe(sourceDrawer.expectedDrawerCashUgx);
    expect(recoveredFin.revenueUgx).toBe(5_000);
  });

  it("merge prefers newer cloud row when local is stale", () => {
    const stale: ReturnRecord = {
      id: RETURN_ID,
      saleId: SALE_ID,
      productId: PRODUCT_ID,
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 1_000,
      reason: "other",
      actorUserId: "u1",
      createdAt: `${DAY}T11:00:00.000Z`,
    };
    const cloud = rowToReturnRecord({
      ...cloudReturnRow(),
      refund_amount_ugx: 5_000,
      updated_at: `${DAY}T12:00:00.000Z`,
    })!;

    const merged = mergeReturnRecordsForRecovery([stale], [cloud]);
    expect(merged[0]!.refundAmountUgx).toBe(5_000);
  });
});
