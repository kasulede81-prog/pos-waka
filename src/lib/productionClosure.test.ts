import { describe, expect, it, beforeEach } from "vitest";
import type { Product, SaleLine, StockMovement } from "../types";
import {
  openingStockMovementFromProduct,
  saleStockMovementsFromSale,
  stableInventoryMovementId,
  verifyInventoryIntegrity,
} from "./inventoryIntegrity";
import {
  ACTIVE_STOCK_MOVEMENT_CAP,
  mergeStockMovementsWithArchive,
} from "./stockMovementLedger";
import {
  clearFinancialHydrationLog,
  hydrateSaleFinancialsFromCloud,
  hydrateSaleLineFinancialsFromCloud,
  lineContributesToProfit,
  readFinancialHydrationLog,
} from "./saleLineFinancialHydration";
import { decodeSaleLineFromCloud } from "./saleLineCloudCodec";
import { flagLegacyFinancialLine, repairLegacySaleFinancials } from "./legacyFinancialRepair";

const SHOP_KEY = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function qtyLine(overrides: Partial<SaleLine> & Pick<SaleLine, "quantity" | "lineTotalUgx">): SaleLine {
  return {
    productId: PRODUCT_ID,
    name: "Item",
    inputMode: "quantity",
    unitPriceUgx: overrides.lineTotalUgx / overrides.quantity,
    unitCostUgx: 100,
    estimatedProfitUgx: overrides.lineTotalUgx - 100 * overrides.quantity,
    moneyAmountUgx: null,
    ...overrides,
  };
}

function moneyLine(amount: number): SaleLine {
  return {
    productId: PRODUCT_ID,
    name: "Item",
    inputMode: "money",
    quantity: 1,
    unitPriceUgx: amount,
    unitCostUgx: 100,
    lineTotalUgx: amount,
    moneyAmountUgx: amount,
    estimatedProfitUgx: amount - 100,
  };
}

describe("production closure — duplicate sale line movements", () => {
  it("aggregates same product sold twice in one transaction", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 2, lineTotalUgx: 4000 }),
        qtyLine({ quantity: 3, lineTotalUgx: 6000 }),
      ],
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.deltaBaseUnits).toBe(-5);
    expect(moves[0]!.id).toBe(stableInventoryMovementId(SHOP_KEY, "sale", SALE_ID, PRODUCT_ID));
  });

  it("aggregates money mode duplicate lines", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [moneyLine(5000), moneyLine(3000)],
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.deltaBaseUnits).toBe(-2);
  });

  it("aggregates quantity mode duplicate lines", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 1.5, lineTotalUgx: 1500 }),
        qtyLine({ quantity: 0.5, lineTotalUgx: 500 }),
      ],
    });
    expect(moves[0]!.deltaBaseUnits).toBe(-2);
  });

  it("handles mixed quantity and money mode lines for different products", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 2, lineTotalUgx: 2000 }),
        { ...moneyLine(5000), productId: PRODUCT_ID_2, name: "Other" },
      ],
    });
    expect(moves).toHaveLength(2);
    expect(moves.find((m) => m.productId === PRODUCT_ID)!.deltaBaseUnits).toBe(-2);
    expect(moves.find((m) => m.productId === PRODUCT_ID_2)!.deltaBaseUnits).toBe(-1);
  });

  it("ledger matches stock deduction for duplicate lines", () => {
    const product: Product = {
      id: PRODUCT_ID,
      name: "Coke",
      sellingPricePerUnitUgx: 1000,
      costPricePerUnitUgx: 100,
      stockOnHand: 2,
      baseUnit: "pcs",
      sellingMode: "unit",
      category: "General",
      sku: "",
      minimumStockAlert: 5,
      updatedAt: "2026-06-01T09:00:00.000Z",
      version: 1,
    };
    const opening = openingStockMovementFromProduct(SHOP_KEY, { ...product, stockOnHand: 5 })!;
    const saleMoves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 2, lineTotalUgx: 2000 }),
        qtyLine({ quantity: 1, lineTotalUgx: 1000 }),
      ],
    });
    const result = verifyInventoryIntegrity({
      products: [product],
      movements: [...saleMoves, opening],
    });
    expect(result.ok).toBe(true);
  });

  it("supports fractional quantities in aggregated movement", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 0.25, lineTotalUgx: 250 }),
        qtyLine({ quantity: 0.75, lineTotalUgx: 750 }),
      ],
    });
    expect(moves[0]!.deltaBaseUnits).toBe(-1);
  });

  it("aggregates carton product lines by base units", () => {
    const moves = saleStockMovementsFromSale(SHOP_KEY, {
      id: SALE_ID,
      createdAt: "2026-06-01T10:00:00.000Z",
      lines: [
        qtyLine({ quantity: 24, lineTotalUgx: 24_000, name: "Soda carton" }),
        qtyLine({ quantity: 12, lineTotalUgx: 12_000, name: "Soda carton" }),
      ],
    });
    expect(moves[0]!.deltaBaseUnits).toBe(-36);
  });
});

describe("production closure — movement archive integrity", () => {
  it("archives overflow instead of deleting and integrity includes archived rows", () => {
    const existing: StockMovement[] = [];
    const incoming: StockMovement[] = [];
    for (let i = 0; i < ACTIVE_STOCK_MOVEMENT_CAP + 50; i++) {
      incoming.push({
        id: `move-${i}`,
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        productId: PRODUCT_ID,
        productName: "Item",
        deltaBaseUnits: -1,
        kind: "sale_out",
        summary: "Sale",
        refId: `sale-${i}`,
        supplierId: null,
      });
    }
    const merged = mergeStockMovementsWithArchive(existing, incoming, []);
    expect(merged.stockMovements.length).toBe(ACTIVE_STOCK_MOVEMENT_CAP);
    expect(merged.archivedStockMovements.length).toBe(50);

    const product: Product = {
      id: PRODUCT_ID,
      name: "Item",
      sellingPricePerUnitUgx: 1000,
      costPricePerUnitUgx: 100,
      stockOnHand: 0,
      baseUnit: "pcs",
      sellingMode: "unit",
      category: "General",
      sku: "",
      minimumStockAlert: 5,
      updatedAt: "2026-06-01T09:00:00.000Z",
      version: 1,
    };
    const opening = openingStockMovementFromProduct(SHOP_KEY, {
      ...product,
      stockOnHand: incoming.length,
    })!;
    const result = verifyInventoryIntegrity({
      products: [product],
      movements: merged.stockMovements,
      archivedMovements: [opening, ...merged.archivedStockMovements],
    });
    expect(result.ok).toBe(true);
  });
});

describe("production closure — opening stock movement", () => {
  it("creates opening stock movement for new product with stock", () => {
    const product: Product = {
      id: PRODUCT_ID,
      name: "New SKU",
      sellingPricePerUnitUgx: 2000,
      costPricePerUnitUgx: 500,
      stockOnHand: 10,
      baseUnit: "pcs",
      sellingMode: "unit",
      category: "General",
      sku: "",
      minimumStockAlert: 5,
      updatedAt: "2026-06-01T10:00:00.000Z",
      version: 1,
    };
    const movement = openingStockMovementFromProduct(SHOP_KEY, product);
    expect(movement).not.toBeNull();
    expect(movement!.kind).toBe("opening_stock");
    expect(movement!.deltaBaseUnits).toBe(10);
    const result = verifyInventoryIntegrity({ products: [product], movements: [movement!] });
    expect(result.ok).toBe(true);
  });

  it("skips opening movement when stock is zero", () => {
    const movement = openingStockMovementFromProduct(SHOP_KEY, {
      id: PRODUCT_ID,
      name: "Empty",
      stockOnHand: 0,
      updatedAt: "2026-06-01T10:00:00.000Z",
    });
    expect(movement).toBeNull();
  });
});

describe("production closure — cloud financial hydration", () => {
  beforeEach(() => clearFinancialHydrationLog());

  it("flags missing financial snapshot instead of zero COGS profit", () => {
    const line = decodeSaleLineFromCloud({
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price_ugx: 1000,
      line_total_ugx: 2000,
      line_input_mode: "quantity",
      metadata: { name: "Item" },
    });
    const result = hydrateSaleLineFinancialsFromCloud(line, { saleId: SALE_ID });
    expect(result.status).toBe("needs_repair");
    expect(result.line.financialDataStatus).toBe("needs_repair");
    expect(lineContributesToProfit(result.line)).toBe(false);
    expect(readFinancialHydrationLog()[0]?.status).toBe("needs_repair");
  });

  it("repairs from unit cost when snapshot partial", () => {
    const line = decodeSaleLineFromCloud({
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price_ugx: 1000,
      line_total_ugx: 2000,
      line_input_mode: "quantity",
      metadata: { name: "Item", unitCostUgx: 300 },
    });
    const result = hydrateSaleLineFinancialsFromCloud(line);
    expect(result.status).toBe("repaired");
    expect(result.line.cogsUgx).toBe(600);
  });

  it("flags legacy zero-cost inflated profit pattern at sale level", () => {
    const sale = hydrateSaleFinancialsFromCloud({
      id: SALE_ID,
      status: "completed",
      lines: [
        decodeSaleLineFromCloud({
          product_id: PRODUCT_ID,
          quantity: 1,
          unit_price_ugx: 5000,
          line_total_ugx: 5000,
          line_input_mode: "quantity",
          metadata: { name: "Legacy", unitCostUgx: 0, estimatedProfitUgx: 5000 },
        }),
      ],
      subtotalUgx: 5000,
      totalUgx: 5000,
      cashPaidUgx: 5000,
      debtUgx: 0,
      estimatedProfitUgx: 5000,
      createdAt: "2026-06-01T10:00:00.000Z",
      pendingSync: false,
      lastSyncError: null,
      customerId: null,
      soldByUserId: null,
    });
    expect(sale.legacyFinancialData).toBe(true);
    expect(sale.lines[0]!.financialDataStatus).toBe("legacy");
  });
});

describe("production closure — legacy financial repair", () => {
  it("never fabricates profit on legacy migrated lines", () => {
    const line = flagLegacyFinancialLine({
      productId: PRODUCT_ID,
      name: "Old",
      inputMode: "quantity",
      quantity: 2,
      unitPriceUgx: 1000,
      unitCostUgx: 0,
      lineTotalUgx: 2000,
      estimatedProfitUgx: 2000,
      moneyAmountUgx: null,
    });
    expect(line.financialDataStatus).toBe("legacy");
    expect(line.estimatedProfitUgx).toBe(0);

    const sale = repairLegacySaleFinancials({
      id: SALE_ID,
      status: "completed",
      lines: [line],
      subtotalUgx: 2000,
      totalUgx: 2000,
      cashPaidUgx: 2000,
      debtUgx: 0,
      estimatedProfitUgx: 2000,
      createdAt: "2026-06-01T10:00:00.000Z",
      pendingSync: false,
      lastSyncError: null,
      customerId: null,
      soldByUserId: null,
    });
    expect(sale.legacyFinancialData).toBe(true);
    expect(sale.estimatedProfitUgx).toBe(0);
  });
});
