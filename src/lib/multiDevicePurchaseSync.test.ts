import { describe, expect, it } from "vitest";
import type { Product, Purchase, Supplier, SupplierPayment } from "../types";
import {
  mergePurchaseRecoveryBundle,
  mergePurchasesForRecovery,
  reconcileSuppliersFromPurchaseHistory,
  rowToPurchase,
} from "./purchaseRecovery";
import { computeVoidStockDeltas, purchaseLineBaseUnitsIn } from "./purchaseLineSync";
import { supplierTotalsAfterPurchaseVoid } from "./purchaseCorrections";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const product: Product = {
  id: PRODUCT_ID,
  name: "Rice",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 1_000,
  stockOnHand: 10,
  baseUnit: "kg",
  sellingMode: "unit",
  buyingUnit: "sack",
  conversionRate: 50,
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T09:00:00.000Z",
  version: 1,
};

function activePurchase(): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: SUPPLIER_ID,
    supplierName: "Wholesaler",
    lines: [{ productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 50_000 }],
    totalCostUgx: 50_000,
    amountPaidUgx: 20_000,
    balanceDeltaUgx: 30_000,
    notes: "",
    createdAt: "2026-06-01T10:00:00.000Z",
    pendingSync: false,
    preVoidCloudSynced: true,
  };
}

function supplierFromPurchase(p: Purchase): Supplier {
  return {
    id: SUPPLIER_ID,
    name: "Wholesaler",
    phone: "",
    location: "",
    notes: "",
    balanceOwedUgx: p.balanceDeltaUgx,
    totalPurchasesUgx: p.totalCostUgx,
    lastSupplyAt: p.createdAt,
    createdAt: "2026-06-01T00:00:00.000Z",
    version: 1,
  };
}

/** Simulates server stock after purchase push then void reversal. */
function simulateServerStock(initial: number, purchase: Purchase, voided: boolean): number {
  let stock = initial;
  for (const line of purchase.lines) {
    stock += purchaseLineBaseUnitsIn(product, line);
  }
  if (voided) {
    for (const { delta } of computeVoidStockDeltas(purchase, [product])) {
      stock += delta;
    }
  }
  return stock;
}

describe("multiDevicePurchaseSync", () => {
  it("device B receives purchase from device A after cloud pull", () => {
    const purchase = activePurchase();
    const cloudRow = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 50_000,
      amount_paid_ugx: 20_000,
      balance_delta_ugx: 30_000,
      notes: "",
      lines: purchase.lines,
      created_at: purchase.createdAt,
      updated_at: purchase.createdAt,
    })!;

    const deviceB = mergePurchaseRecoveryBundle(
      { purchases: [], suppliers: [], supplierPayments: [] },
      { purchaseCloudRows: [cloudRow], supplierCloudRows: [], supplierPayments: [] },
    );

    expect(deviceB.purchases).toHaveLength(1);
    expect(deviceB.suppliers[0].balanceOwedUgx).toBe(30_000);
    expect(deviceB.suppliers[0].totalPurchasesUgx).toBe(50_000);
  });

  it("device B converges to void state after device A voids and syncs", () => {
    const deviceA = activePurchase();
    const voided = {
      ...deviceA,
      voidedAt: "2026-06-01T11:00:00.000Z",
      voidReason: "Wrong invoice",
      pendingSync: false,
    };

    const deviceBLocal = [activePurchase()];
    const cloudVoidRow = rowToPurchase({
      id: PURCHASE_ID,
      supplier_id: SUPPLIER_ID,
      supplier_name: "Wholesaler",
      total_cost_ugx: 50_000,
      amount_paid_ugx: 20_000,
      balance_delta_ugx: 30_000,
      notes: "",
      lines: deviceA.lines,
      created_at: deviceA.createdAt,
      updated_at: voided.voidedAt!,
      voided_at: voided.voidedAt,
      void_reason: voided.voidReason,
    })!;

    const merged = mergePurchasesForRecovery(deviceBLocal, [cloudVoidRow]);
    expect(merged[0].voidedAt).toBe(voided.voidedAt);

    const supplierBefore = supplierFromPurchase(deviceA);
    const supplierAfterVoid = supplierTotalsAfterPurchaseVoid(supplierBefore, deviceA);
    const reconciled = reconcileSuppliersFromPurchaseHistory(
      [supplierBefore],
      merged,
      [] as SupplierPayment[],
    );
    expect(reconciled[0].balanceOwedUgx).toBe(supplierAfterVoid.balanceOwedUgx);
    expect(reconciled[0].totalPurchasesUgx).toBe(0);
  });

  it("stock converges on server after purchase then void", () => {
    const purchase = activePurchase();
    const initialStock = 10;
    const afterPurchase = simulateServerStock(initialStock, purchase, false);
    expect(afterPurchase).toBe(60);
    const afterVoid = simulateServerStock(initialStock, purchase, true);
    expect(afterVoid).toBe(10);
  });

  it("supplier balance and purchase state stay consistent across merge", () => {
    const purchase = activePurchase();
    const payment: SupplierPayment = {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      supplierId: SUPPLIER_ID,
      amountUgx: 10_000,
      createdAt: "2026-06-01T10:30:00.000Z",
      pendingSync: false,
    };
    const bundle = mergePurchaseRecoveryBundle(
      { purchases: [purchase], suppliers: [supplierFromPurchase(purchase)], supplierPayments: [payment] },
      { purchaseCloudRows: [], supplierCloudRows: [], supplierPayments: [] },
    );
    expect(bundle.suppliers[0].balanceOwedUgx).toBe(20_000);
    expect(bundle.purchases[0].totalCostUgx).toBe(50_000);
  });
});
