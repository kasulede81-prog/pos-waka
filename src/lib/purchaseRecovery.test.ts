import { describe, expect, it } from "vitest";
import type { Product, Purchase, Supplier, SupplierPayment } from "../types";
import {
  inventoryValueAtCostUgx,
  mergePurchaseRecoveryBundle,
  mergePurchasesForRecovery,
  reconcileSuppliersFromPurchaseHistory,
  rowToPurchase,
  rowToSupplier,
  rowToSupplierPayment,
} from "./purchaseRecovery";
import {
  buyingUnitsToBaseUnits,
  costPerBaseFromBuyingUnitCost,
  weightedCostAfterStockIn,
} from "./sellingEngine";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PAYMENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Rice",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 1_000,
  stockOnHand: 10,
  baseUnit: "kg",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function productAfterRestock(): Product {
  const line = { productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 12_000 };
  const baseIn = buyingUnitsToBaseUnits(baseProduct, line.qtyBuyingUnits);
  const incomingCostPerBase = costPerBaseFromBuyingUnitCost(baseProduct, line.costPerBuyingUnitUgx);
  return {
    ...baseProduct,
    stockOnHand: baseProduct.stockOnHand + baseIn,
    costPricePerUnitUgx: weightedCostAfterStockIn(
      baseProduct.stockOnHand,
      baseProduct.costPricePerUnitUgx,
      baseIn,
      incomingCostPerBase,
    ),
    version: 2,
  };
}

function sourcePurchase(): Purchase {
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
    createdAt: "2026-05-31T10:00:00.000Z",
    pendingSync: false,
  };
}

function sourceSupplier(): Supplier {
  return {
    id: SUPPLIER_ID,
    name: "Wholesaler",
    phone: "0700",
    location: "Kampala",
    notes: "",
    balanceOwedUgx: 14_000,
    totalPurchasesUgx: 24_000,
    lastSupplyAt: "2026-05-31T10:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    version: 2,
  };
}

function cloudPurchaseRow(): Record<string, unknown> {
  return {
    id: PURCHASE_ID,
    shop_id: "shop-1",
    supplier_id: SUPPLIER_ID,
    supplier_name: "Wholesaler",
    total_cost_ugx: 24_000,
    amount_paid_ugx: 10_000,
    balance_delta_ugx: 14_000,
    notes: "",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Rice",
        qtyBuyingUnits: 2,
        costPerBuyingUnitUgx: 12_000,
      },
    ],
    created_at: "2026-05-31T10:00:00.000Z",
    updated_at: "2026-05-31T10:00:00.000Z",
    metadata: { wakaClient: true },
  };
}

describe("purchaseRecovery — row mapping", () => {
  it("maps shop_purchases row to Purchase", () => {
    const parsed = rowToPurchase(cloudPurchaseRow());
    expect(parsed).not.toBeNull();
    expect(parsed!.record.id).toBe(PURCHASE_ID);
    expect(parsed!.record.lines).toHaveLength(1);
    expect(parsed!.record.totalCostUgx).toBe(24_000);
  });

  it("maps shop_suppliers row to Supplier", () => {
    const parsed = rowToSupplier({
      id: SUPPLIER_ID,
      name: "Wholesaler",
      phone: "0700",
      location: "Kampala",
      notes: "",
      balance_owed_ugx: 14_000,
      total_purchases_ugx: 24_000,
      last_supply_at: "2026-05-31T10:00:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-31T10:00:00.000Z",
    });
    expect(parsed?.record.name).toBe("Wholesaler");
    expect(parsed?.record.balanceOwedUgx).toBe(14_000);
  });

  it("maps shop_supplier_payments row", () => {
    const parsed = rowToSupplierPayment({
      id: PAYMENT_ID,
      supplier_id: SUPPLIER_ID,
      amount_ugx: 5_000,
      created_at: "2026-05-31T12:00:00.000Z",
    });
    expect(parsed?.amountUgx).toBe(5_000);
  });
});

describe("purchaseRecovery — device recovery parity", () => {
  it("cloud merge restores purchase history and supplier balance matching source device", () => {
    const product = productAfterRestock();
    const purchase = sourcePurchase();
    const supplier = sourceSupplier();

    const sourceValue = inventoryValueAtCostUgx([product]);
    const sourceOwed = supplier.balanceOwedUgx;

    const recovered = mergePurchaseRecoveryBundle(
      { purchases: [], suppliers: [], supplierPayments: [] },
      {
        purchaseCloudRows: [rowToPurchase(cloudPurchaseRow())!],
        supplierCloudRows: [],
        supplierPayments: [],
      },
    );

    expect(recovered.purchases).toHaveLength(1);
    expect(recovered.purchases[0].totalCostUgx).toBe(purchase.totalCostUgx);
    expect(recovered.suppliers).toHaveLength(1);
    expect(recovered.suppliers[0].balanceOwedUgx).toBe(sourceOwed);
    expect(recovered.suppliers[0].totalPurchasesUgx).toBe(24_000);

    const newDeviceProducts = [product];
    const newDeviceValue = inventoryValueAtCostUgx(newDeviceProducts);
    expect(newDeviceValue).toBe(sourceValue);
  });

  it("reconcile applies supplier payments after purchases", () => {
    const purchase = sourcePurchase();
    const payment: SupplierPayment = {
      id: PAYMENT_ID,
      supplierId: SUPPLIER_ID,
      amountUgx: 5_000,
      createdAt: "2026-05-31T12:00:00.000Z",
      pendingSync: false,
    };
    const suppliers = reconcileSuppliersFromPurchaseHistory([sourceSupplier()], [purchase], [payment]);
    expect(suppliers[0].balanceOwedUgx).toBe(9_000);
  });

  it("mergePurchasesForRecovery keeps newer cloud row", () => {
    const local: Purchase[] = [
      { ...sourcePurchase(), totalCostUgx: 1, pendingSync: true },
    ];
    const remote = rowToPurchase(cloudPurchaseRow())!;
    const merged = mergePurchasesForRecovery(local, [remote]);
    expect(merged[0].totalCostUgx).toBe(24_000);
    expect(merged[0].pendingSync).toBe(false);
  });
});
