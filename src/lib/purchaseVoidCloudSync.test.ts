import { describe, expect, it } from "vitest";
import type { Purchase } from "../types";
import {
  buildPurchaseCloudPushPayload,
  mergePurchaseRecord,
  mergePurchasesForRecovery,
  rowToPurchase,
} from "./purchaseRecovery";

const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function basePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: SUPPLIER_ID,
    supplierName: "Wholesaler",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Rice",
        qtyBuyingUnits: 2,
        costPerBuyingUnitUgx: 12_000,
      },
    ],
    totalCostUgx: 24_000,
    amountPaidUgx: 10_000,
    balanceDeltaUgx: 14_000,
    notes: "",
    createdAt: "2026-06-01T10:00:00.000Z",
    pendingSync: true,
    ...overrides,
  };
}

describe("purchaseVoidCloudSync", () => {
  it("push payload includes voided_at and void_reason", () => {
    const purchase = basePurchase({
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "Wrong supplier",
      pendingSync: true,
    });
    const payload = buildPurchaseCloudPushPayload(purchase);
    expect(payload.voided_at).toBe("2026-06-01T11:00:00.000Z");
    expect(payload.void_reason).toBe("Wrong supplier");
    expect(payload.id).toBe(PURCHASE_ID);
  });

  it("pull parser reads voided_at and void_reason columns", () => {
    const parsed = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 24_000,
      amount_paid_ugx: 10_000,
      balance_delta_ugx: 14_000,
      notes: "",
      lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 12_000 }],
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-01T11:00:00.000Z",
      voided_at: "2026-06-01T11:00:00.000Z",
      void_reason: "Duplicate entry",
    });
    expect(parsed?.record.voidedAt).toBe("2026-06-01T11:00:00.000Z");
    expect(parsed?.record.voidReason).toBe("Duplicate entry");
  });

  it("pull parser falls back to metadata void fields", () => {
    const parsed = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 24_000,
      amount_paid_ugx: 0,
      balance_delta_ugx: 24_000,
      notes: "",
      lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 1000 }],
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-01T11:00:00.000Z",
      metadata: { voidedAt: "2026-06-01T11:30:00.000Z", voidReason: "Legacy metadata" },
    });
    expect(parsed?.record.voidedAt).toBe("2026-06-01T11:30:00.000Z");
    expect(parsed?.record.voidReason).toBe("Legacy metadata");
  });

  it("merge keeps voided cloud state over active local", () => {
    const local = basePurchase({ pendingSync: true });
    const remote = basePurchase({
      voidedAt: "2026-06-01T12:00:00.000Z",
      voidReason: "Synced void",
      pendingSync: false,
    });
    const merged = mergePurchaseRecord(local, remote);
    expect(merged.voidedAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("duplicate void sync is idempotent in merge", () => {
    const voided = basePurchase({
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "First void",
      pendingSync: false,
    });
    const replay = basePurchase({
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "First void",
      pendingSync: false,
    });
    const merged = mergePurchasesForRecovery([voided], [
      { record: replay, updatedAt: "2026-06-01T11:00:00.000Z" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].voidedAt).toBe("2026-06-01T11:00:00.000Z");
  });
});
