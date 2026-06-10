import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Product, Purchase, StockMovement, Supplier, SupplierPayment } from "../types";
import { buildCashPositionReport } from "./cashPosition";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import {
  diffSupplierEdit,
  isPurchaseVoided,
  lastSupplyAtForSupplier,
  supplierTotalsAfterPurchaseVoid,
  validatePurchaseVoidStock,
} from "./purchaseCorrections";
import { buildSupplierStatement } from "./purchaseReporting";

const DAY = "2026-06-15";
const SUPPLIER_ID = "sup-1";
const PRODUCT_ID = "prod-1";
const PURCHASE_ID = "pur-1";

function purchase(partial?: Partial<Purchase>): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: SUPPLIER_ID,
    supplierName: "Mukwano",
    lines: [{ productId: PRODUCT_ID, name: "Soda", qtyBuyingUnits: 10, costPerBuyingUnitUgx: 1_000 }],
    totalCostUgx: 10_000,
    amountPaidUgx: 4_000,
    balanceDeltaUgx: 6_000,
    notes: "",
    createdAt: `${DAY}T10:00:00.000Z`,
    pendingSync: false,
    ...partial,
  };
}

describe("purchase void reversal", () => {
  const products: Product[] = [
    {
      id: PRODUCT_ID,
      name: "Soda",
      sellingPricePerUnitUgx: 2_000,
      costPricePerUnitUgx: 1_000,
      stockOnHand: 20,
      baseUnit: "pcs",
      sellingMode: "unit",
      category: "Drinks",
      sku: "",
      minimumStockAlert: 5,
      updatedAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    },
  ];

  const movements: StockMovement[] = [
    {
      id: "m1",
      at: `${DAY}T10:00:00.000Z`,
      productId: PRODUCT_ID,
      productName: "Soda",
      deltaBaseUnits: 10,
      kind: "purchase_in",
      summary: "Restock",
      refId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
    },
  ];

  it("validates stock can be reversed", () => {
    const check = validatePurchaseVoidStock(PURCHASE_ID, products, movements);
    expect(check.ok).toBe(true);
    expect(check.deltas.get(PRODUCT_ID)).toBe(10);
  });

  it("rejects void when stock insufficient", () => {
    const lowStock = [{ ...products[0]!, stockOnHand: 5 }];
    expect(validatePurchaseVoidStock(PURCHASE_ID, lowStock, movements).ok).toBe(false);
  });

  it("marks voided purchases", () => {
    expect(isPurchaseVoided(purchase())).toBe(false);
    expect(isPurchaseVoided(purchase({ voidedAt: `${DAY}T11:00:00.000Z` }))).toBe(true);
  });
});

describe("supplier balance reversal", () => {
  const supplier: Supplier = {
    id: SUPPLIER_ID,
    name: "Mukwano",
    phone: "",
    location: "",
    notes: "",
    balanceOwedUgx: 12_000,
    totalPurchasesUgx: 50_000,
    lastSupplyAt: `${DAY}T10:00:00.000Z`,
    createdAt: "2026-01-01T00:00:00.000Z",
    version: 2,
  };

  it("reverses balance and lifetime purchases", () => {
    const p = purchase({ balanceDeltaUgx: 6_000, totalCostUgx: 10_000 });
    const next = supplierTotalsAfterPurchaseVoid(supplier, p);
    expect(next.balanceOwedUgx).toBe(6_000);
    expect(next.totalPurchasesUgx).toBe(40_000);
  });

  it("excludes voided purchases from statement", () => {
    const active = purchase({ id: "p-active", createdAt: `${DAY}T09:00:00.000Z`, balanceDeltaUgx: 5_000, totalCostUgx: 5_000 });
    const voided = purchase({
      id: "p-void",
      voidedAt: `${DAY}T12:00:00.000Z`,
      createdAt: `${DAY}T10:00:00.000Z`,
      balanceDeltaUgx: 6_000,
      totalCostUgx: 10_000,
    });
    const statement = buildSupplierStatement(SUPPLIER_ID, "Mukwano", [active, voided], []);
    expect(statement).toHaveLength(1);
    expect(statement[0]?.runningBalanceUgx).toBe(5_000);
  });

  it("recalculates last supply after void", () => {
    const older = purchase({ id: "p-old", createdAt: `${DAY}T08:00:00.000Z` });
    const newer = purchase({ id: "p-new", createdAt: `${DAY}T12:00:00.000Z`, voidedAt: `${DAY}T13:00:00.000Z` });
    expect(lastSupplyAtForSupplier(SUPPLIER_ID, [older, newer])).toBe(`${DAY}T08:00:00.000Z`);
  });
});

describe("cash position supplier payment impact", () => {
  const supplierPayments: SupplierPayment[] = [
    {
      id: "sp1",
      supplierId: SUPPLIER_ID,
      amountUgx: 15_000,
      createdAt: `${DAY}T16:00:00.000Z`,
      pendingSync: false,
    },
  ];

  it("reduces expected cash by supplier payments on the day", () => {
    const drawer = getDrawerCashForDayInput({
      sales: [
        {
          id: "s1",
          status: "completed",
          createdAt: `${DAY}T10:00:00.000Z`,
          updatedAt: `${DAY}T10:00:00.000Z`,
          lines: [
            {
              productId: PRODUCT_ID,
              name: "Item",
              quantity: 1,
              unitPriceUgx: 50_000,
              unitCostUgx: 500,
              lineTotalUgx: 50_000,
              estimatedProfitUgx: 49_500,
              inputMode: "quantity",
              updatedAt: `${DAY}T10:00:00.000Z`,
            },
          ],
          subtotalUgx: 50_000,
          totalUgx: 50_000,
          cashPaidUgx: 50_000,
          debtUgx: 0,
          estimatedProfitUgx: 49_500,
          pendingSync: false,
        },
      ],
      returns: [],
      products: [
        {
          id: PRODUCT_ID,
          name: "Item",
          sellingPricePerUnitUgx: 50_000,
          costPricePerUnitUgx: 500,
          stockOnHand: 10,
          baseUnit: "pcs",
          sellingMode: "unit",
          category: "General",
          sku: "",
          minimumStockAlert: 1,
          updatedAt: `${DAY}T08:00:00.000Z`,
          version: 1,
        },
      ],
      debtPayments: [],
      cashExpenses: [],
      supplierPayments,
      day: DAY,
    });

    expect(drawer.supplierPaymentsUgx).toBe(15_000);
    expect(drawer.expectedDrawerCashUgx).toBe(35_000);
  });
});

describe("close day parity", () => {
  it("cash position expected cash matches drawer input with supplier payments", () => {
    const sales = [
      {
        id: "s1",
        status: "completed" as const,
        createdAt: `${DAY}T10:00:00.000Z`,
        updatedAt: `${DAY}T10:00:00.000Z`,
        lines: [
          {
            productId: PRODUCT_ID,
            name: "Item",
            quantity: 1,
            unitPriceUgx: 100_000,
            unitCostUgx: 500,
            lineTotalUgx: 100_000,
            estimatedProfitUgx: 99_500,
            inputMode: "quantity" as const,
            updatedAt: `${DAY}T10:00:00.000Z`,
          },
        ],
        subtotalUgx: 100_000,
        totalUgx: 100_000,
        cashPaidUgx: 80_000,
        debtUgx: 20_000,
        estimatedProfitUgx: 99_500,
        pendingSync: false,
      },
    ];
    const supplierPayments: SupplierPayment[] = [
      { id: "sp1", supplierId: SUPPLIER_ID, amountUgx: 5_000, createdAt: `${DAY}T14:00:00.000Z`, pendingSync: false },
    ];
    const cashExpenses = [
      {
        id: "e1",
        amountUgx: 3_000,
        category: "Lunch",
        description: "",
        paidOn: DAY,
        createdAt: `${DAY}T11:00:00.000Z`,
        createdByUserId: "u1",
        pendingSync: false,
        deletedAt: null,
      },
    ];
    const products = [
      {
        id: PRODUCT_ID,
        name: "Item",
        sellingPricePerUnitUgx: 100_000,
        costPricePerUnitUgx: 500,
        stockOnHand: 10,
        baseUnit: "pcs",
        sellingMode: "unit" as const,
        category: "General",
        sku: "",
        minimumStockAlert: 1,
        updatedAt: `${DAY}T08:00:00.000Z`,
        version: 1,
      },
    ];

    const drawer = getDrawerCashForDayInput({
      sales,
      returns: [],
      products,
      debtPayments: [{ id: "dp1", customerId: "c1", amountUgx: 10_000, createdAt: `${DAY}T15:00:00.000Z` }],
      cashExpenses,
      supplierPayments,
      day: DAY,
    });

    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales,
      products,
      returnRecords: [],
      debtPayments: [{ id: "dp1", customerId: "c1", amountUgx: 10_000, createdAt: `${DAY}T15:00:00.000Z` }],
      cashExpenses,
      supplierPayments,
      staffAccounts: [],
      generalCategoryLabel: "General",
    });

    expect(report.cashPosition.supplierPaymentsUgx).toBe(drawer.supplierPaymentsUgx);
    expect(report.cashPosition.expectedCashUgx).toBe(drawer.expectedDrawerCashUgx);
    expect(drawer.expectedDrawerCashUgx).toBe(82_000);
  });
});

describe("supplier edit audit", () => {
  it("diffs changed fields only", () => {
    const changes = diffSupplierEdit(
      { name: "Mukwano", phone: "0700", location: "Kampala", notes: "" },
      { phone: "0700123456", notes: "Delivers Tuesday" },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]?.field).toBe("phone");
    expect(changes[1]?.field).toBe("notes");
  });

  it("returns empty when nothing changed", () => {
    const changes = diffSupplierEdit(
      { name: "Mukwano", phone: "0700", location: "", notes: "" },
      { phone: "0700" },
    );
    expect(changes).toHaveLength(0);
  });

  it("supports audit payload shape", () => {
    const changes = diffSupplierEdit(
      { name: "Old Name", phone: "", location: "", notes: "" },
      { name: "New Name" },
    );
    const payload = {
      supplierId: SUPPLIER_ID,
      changes: changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
    };
    const entry: AuditLogEntry = {
      id: "a1",
      at: `${DAY}T10:00:00.000Z`,
      deviceId: "d1",
      actorUserId: "u1",
      actorName: "Owner",
      role: "owner",
      action: "supplier_edit",
      payloadSummary: "Updated supplier",
      payload,
    };
    expect(entry.payload.changes).toEqual([{ field: "name", before: "Old Name", after: "New Name" }]);
  });
});
