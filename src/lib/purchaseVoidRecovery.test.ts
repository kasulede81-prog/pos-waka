import { describe, expect, it } from "vitest";
import type { Purchase } from "../types";
import {
  mergePurchaseRecord,
  mergePurchasesForRecovery,
  rowToPurchase,
} from "./purchaseRecovery";

const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: SUPPLIER_ID,
    supplierName: "Wholesaler",
    lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 12_000 }],
    totalCostUgx: 24_000,
    amountPaidUgx: 0,
    balanceDeltaUgx: 24_000,
    notes: "",
    createdAt: "2026-06-01T10:00:00.000Z",
    pendingSync: false,
    ...overrides,
  };
}

describe("purchaseVoidRecovery", () => {
  it("rowToPurchase parses voidedAt and voidReason", () => {
    const row = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 24_000,
      amount_paid_ugx: 0,
      balance_delta_ugx: 24_000,
      notes: "",
      lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 12_000 }],
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-01T12:00:00.000Z",
      voided_at: "2026-06-01T12:00:00.000Z",
      void_reason: "Damaged goods",
    });
    expect(row?.record.voidedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(row?.record.voidReason).toBe("Damaged goods");
  });

  it("merge prevents unvoid when local is voided and remote is active", () => {
    const local = purchase({
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "Local void",
    });
    const remote = purchase({ pendingSync: false });
    expect(mergePurchaseRecord(local, remote).voidedAt).toBe("2026-06-01T11:00:00.000Z");
  });

  it("merge applies remote void when local is still active", () => {
    const local = purchase({ pendingSync: true });
    const remote = purchase({
      voidedAt: "2026-06-01T12:00:00.000Z",
      voidReason: "Remote void",
    });
    const merged = mergePurchaseRecord(local, remote);
    expect(merged.voidedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(merged.voidReason).toBe("Remote void");
  });

  it("merge keeps newest void when both sides voided", () => {
    const local = purchase({
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "Earlier",
    });
    const remote = purchase({
      voidedAt: "2026-06-01T12:00:00.000Z",
      voidReason: "Later",
    });
    const merged = mergePurchaseRecord(local, remote);
    expect(merged.voidedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(merged.voidReason).toBe("Later");
  });

  it("mergePurchasesForRecovery preserves void across pull", () => {
    const local = [purchase({ pendingSync: true })];
    const remoteRow = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 24_000,
      amount_paid_ugx: 0,
      balance_delta_ugx: 24_000,
      notes: "",
      lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 12_000 }],
      created_at: "2026-06-01T10:00:00.000Z",
      updated_at: "2026-06-01T12:00:00.000Z",
      voided_at: "2026-06-01T12:00:00.000Z",
      void_reason: "Cloud void",
    })!;
    const merged = mergePurchasesForRecovery(local, [remoteRow]);
    expect(merged[0].voidedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});
