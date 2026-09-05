import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { getProductBatches } from "./pharmacyBatches";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { releaseRestockSubmit, submitRestockOnce } from "./restockSubmitGuard";
import { buildRestockPurchaseLines, type RestockLineDraft } from "./restockPurchaseLines";
import { WALK_IN_SUPPLIER_ID } from "./walkInSupplier";
import { usePosStore } from "../store/usePosStore";
import type { BusinessType, Product } from "../types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function retailProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "retail-soda",
    name: "Soda",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 600,
    stockOnHand: 8,
    baseUnit: "bottle",
    sellingMode: "unit",
    category: "Drinks",
    sku: "SODA-1",
    minimumStockAlert: 2,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
    pharmacyMaster: { batchTracked: false, expiryTracked: false },
    ...overrides,
  };
}

function batchMedicine(overrides: Partial<Product> = {}): Product {
  return {
    id: "med-para",
    name: "Paracetamol",
    sellingPricePerUnitUgx: 500,
    costPricePerUnitUgx: 200,
    stockOnHand: 10,
    baseUnit: "tablet",
    buyingUnit: "pack",
    conversionRate: 1,
    sellingMode: "unit",
    category: "Analgesics",
    sku: "PARA-1",
    minimumStockAlert: 4,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
    pharmacyMaster: { batchTracked: true, expiryTracked: true },
    ...overrides,
  };
}

const PHARMACY_CTX = {
  businessType: "pharmacy" as BusinessType,
  pharmacyModeEnabled: true,
};

const RETAIL_CTX = {
  businessType: "kiosk_duka" as BusinessType,
  pharmacyModeEnabled: false,
};

function batchRow(overrides: Partial<RestockLineDraft> = {}): RestockLineDraft {
  return {
    productId: "med-para",
    qtyBuyingStr: "5",
    costPerBuyingStr: "200",
    batchNumber: "ABC123",
    expiryDate: "2027-04-30",
    ...overrides,
  };
}

function retailRow(overrides: Partial<RestockLineDraft> = {}): RestockLineDraft {
  return {
    productId: "retail-soda",
    qtyBuyingStr: "5",
    costPerBuyingStr: "600",
    ...overrides,
  };
}

function seedStore(products: Product[], role: "owner" | "cashier" | "stock_keeper" = "owner") {
  setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: `${role}:1`, role, displayName: role },
    products,
    purchases: [],
    stockMovements: [],
    archivedStockMovements: [],
    suppliers: [],
    preferences: {
      ...createDefaultPreferences(),
      businessType: "pharmacy",
      pharmacyModeEnabled: true,
    },
  });
}

function receiveViaRestockPath(
  rows: RestockLineDraft[],
  products: Product[],
  lock = { current: false },
) {
  const built = buildRestockPurchaseLines(rows, products, PHARMACY_CTX);
  if (!built.ok) return { started: false as const, errorKey: built.errorKey, lock };
  const attempt = submitRestockOnce(lock, () =>
    usePosStore.getState().recordPurchase({
      supplierId: WALK_IN_SUPPLIER_ID,
      supplierName: "Town",
      lines: built.lines,
      amountPaidUgx: built.lines.reduce((sum, ln) => sum + ln.qtyBuyingUnits * ln.costPerBuyingUnitUgx, 0),
    }),
  );
  return { ...attempt, lock };
}

describe("INV-B5 restock hub batch receive", () => {
  const medicine = batchMedicine();
  const soda = retailProduct();

  beforeEach(() => {
    seedStore([medicine, soda]);
  });

  it("A — batch-tracked receive supplies batchReceive to recordPurchase", () => {
    const built = buildRestockPurchaseLines([batchRow()], [medicine], PHARMACY_CTX);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]!.batchReceive).toEqual({
      batchNumber: "ABC123",
      expiryDate: "2027-04-30",
      quantityBase: 5,
      unitCostUgx: 200,
      manufactureDate: null,
      purchaseInvoice: null,
      location: null,
    });
  });

  it("B — stock increases exactly once (10 + 5 = 15)", () => {
    const result = receiveViaRestockPath([batchRow()], [medicine]);
    expect(result.started).toBe(true);
    if (!result.started) return;
    expect(result.result.ok).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === "med-para")!.stockOnHand).toBe(15);
  });

  it("C — exactly one purchase record", () => {
    receiveViaRestockPath([batchRow()], [medicine]);
    expect(usePosStore.getState().purchases).toHaveLength(1);
    expect(usePosStore.getState().purchases[0]!.lines).toHaveLength(1);
    expect(usePosStore.getState().purchases[0]!.lines[0]!.productId).toBe("med-para");
  });

  it("D — exactly one purchase_in movement", () => {
    receiveViaRestockPath([batchRow()], [medicine]);
    const moves = usePosStore.getState().stockMovements.filter((m) => m.kind === "purchase_in");
    expect(moves).toHaveLength(1);
    expect(moves[0]!.productId).toBe("med-para");
    expect(moves[0]!.deltaBaseUnits).toBe(5);
  });

  it("E — batch quantity matches received base units", () => {
    receiveViaRestockPath([batchRow()], [medicine]);
    const batches = getProductBatches(usePosStore.getState().products.find((p) => p.id === "med-para")!);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.batchNumber).toBe("ABC123");
    expect(batches[0]!.expiryDate).toBe("2027-04-30");
    expect(batches[0]!.quantityReceived).toBe(5);
    expect(batches[0]!.quantityRemaining).toBe(5);
  });

  it("E — pack conversion uses base units once (2 packs of 10 → +20)", () => {
    const packed = batchMedicine({ conversionRate: 10, stockOnHand: 10 });
    seedStore([packed]);
    const built = buildRestockPurchaseLines(
      [batchRow({ qtyBuyingStr: "2", costPerBuyingStr: "2000" })],
      [packed],
      PHARMACY_CTX,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]!.qtyBuyingUnits).toBe(2);
    expect(built.lines[0]!.batchReceive?.quantityBase).toBe(20);
    expect(built.lines[0]!.batchReceive?.unitCostUgx).toBe(200);

    const result = receiveViaRestockPath([batchRow({ qtyBuyingStr: "2", costPerBuyingStr: "2000" })], [packed]);
    expect(result.started && result.result.ok).toBe(true);
    const next = usePosStore.getState().products.find((p) => p.id === "med-para")!;
    expect(next.stockOnHand).toBe(30);
    expect(getProductBatches(next)[0]!.quantityRemaining).toBe(20);
    expect(usePosStore.getState().stockMovements.filter((m) => m.kind === "purchase_in")).toHaveLength(1);
    expect(usePosStore.getState().stockMovements[0]!.deltaBaseUnits).toBe(20);
  });

  it("G — retail / non-batch receiving stays qty+cost only", () => {
    const built = buildRestockPurchaseLines([retailRow()], [soda], PHARMACY_CTX);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]!.batchReceive).toBeUndefined();
    expect(built.lines[0]).toEqual({
      productId: "retail-soda",
      qtyBuyingUnits: 5,
      costPerBuyingUnitUgx: 600,
    });

    const result = receiveViaRestockPath([retailRow()], [soda]);
    expect(result.started && result.result.ok).toBe(true);
    expect(usePosStore.getState().products.find((p) => p.id === "retail-soda")!.stockOnHand).toBe(13);
    expect(getProductBatches(usePosStore.getState().products.find((p) => p.id === "retail-soda")!)).toHaveLength(0);
  });

  it("G — non-pharmacy RestockPage does not require batch fields", () => {
    const built = buildRestockPurchaseLines([batchRow({ batchNumber: "", expiryDate: "" })], [medicine], RETAIL_CTX);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]!.batchReceive).toBeUndefined();
  });

  it("H — mixed retail + batch-tracked lines keep per-line batch data", () => {
    const second = batchMedicine({ id: "med-amox", name: "Amoxicillin", stockOnHand: 3 });
    seedStore([medicine, soda, second]);
    const built = buildRestockPurchaseLines(
      [
        retailRow(),
        batchRow(),
        batchRow({
          productId: "med-amox",
          qtyBuyingStr: "4",
          costPerBuyingStr: "300",
          batchNumber: "AMX-9",
          expiryDate: "2028-01-15",
        }),
      ],
      [medicine, soda, second],
      PHARMACY_CTX,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines).toHaveLength(3);
    expect(built.lines[0]!.batchReceive).toBeUndefined();
    expect(built.lines[1]!.batchReceive?.batchNumber).toBe("ABC123");
    expect(built.lines[2]!.batchReceive?.batchNumber).toBe("AMX-9");
    expect(built.lines[2]!.batchReceive?.expiryDate).toBe("2028-01-15");

    const result = receiveViaRestockPath(
      [
        retailRow(),
        batchRow(),
        batchRow({
          productId: "med-amox",
          qtyBuyingStr: "4",
          costPerBuyingStr: "300",
          batchNumber: "AMX-9",
          expiryDate: "2028-01-15",
        }),
      ],
      [medicine, soda, second],
    );
    expect(result.started && result.result.ok).toBe(true);
    const state = usePosStore.getState();
    expect(state.purchases).toHaveLength(1);
    expect(state.stockMovements.filter((m) => m.kind === "purchase_in")).toHaveLength(3);
    expect(state.products.find((p) => p.id === "retail-soda")!.stockOnHand).toBe(13);
    expect(state.products.find((p) => p.id === "med-para")!.stockOnHand).toBe(15);
    expect(state.products.find((p) => p.id === "med-amox")!.stockOnHand).toBe(7);
    expect(getProductBatches(state.products.find((p) => p.id === "med-para")!)[0]!.batchNumber).toBe("ABC123");
    expect(getProductBatches(state.products.find((p) => p.id === "med-amox")!)[0]!.batchNumber).toBe("AMX-9");
  });

  it("I — missing batch number prevents submit and does not take the lock", () => {
    const lock = { current: false };
    const result = receiveViaRestockPath([batchRow({ batchNumber: "   " })], [medicine], lock);
    expect(result).toMatchObject({ started: false, errorKey: "pharmacyBatchNumberRequired" });
    expect(lock.current).toBe(false);
    expect(usePosStore.getState().purchases).toHaveLength(0);
    expect(usePosStore.getState().products.find((p) => p.id === "med-para")!.stockOnHand).toBe(10);
  });

  it("I — missing expiry prevents submit", () => {
    const result = receiveViaRestockPath([batchRow({ expiryDate: "" })], [medicine]);
    expect(result).toMatchObject({ started: false, errorKey: "pharmacyExpiryDateRequired" });
    expect(usePosStore.getState().purchases).toHaveLength(0);
  });

  it("I — zero / empty quantity is rejected before lock", () => {
    const lock = { current: false };
    const result = receiveViaRestockPath([batchRow({ qtyBuyingStr: "0" })], [medicine], lock);
    expect(result).toMatchObject({ started: false, errorKey: "restockAddLineHint" });
    expect(lock.current).toBe(false);
  });

  it("J — double submit produces only one purchase", () => {
    const built = buildRestockPurchaseLines([batchRow()], [medicine], PHARMACY_CTX);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const lock = { current: false };
    const mutate = () =>
      usePosStore.getState().recordPurchase({
        supplierId: WALK_IN_SUPPLIER_ID,
        supplierName: "Town",
        lines: built.lines,
        amountPaidUgx: 1000,
      });
    expect(submitRestockOnce(lock, mutate).started).toBe(true);
    expect(submitRestockOnce(lock, mutate).started).toBe(false);
    expect(usePosStore.getState().purchases).toHaveLength(1);
    expect(usePosStore.getState().products.find((p) => p.id === "med-para")!.stockOnHand).toBe(15);
  });

  it("K — unauthorized cashier cannot receive", () => {
    seedStore([medicine], "cashier");
    const result = receiveViaRestockPath([batchRow()], [medicine]);
    expect(result.started).toBe(true);
    if (!result.started) return;
    expect(result.result.ok).toBe(false);
    expect(usePosStore.getState().purchases).toHaveLength(0);
    expect(usePosStore.getState().products.find((p) => p.id === "med-para")!.stockOnHand).toBe(10);
  });

  it("L — successful receive marks the purchase pending_purchases path, not a second stock queue", () => {
    receiveViaRestockPath([batchRow()], [medicine]);
    const purchase = usePosStore.getState().purchases[0]!;
    expect(purchase.pendingSync).toBe(true);
    expect(usePosStore.getState().stockMovements).toHaveLength(1);
    expect(usePosStore.getState().stockMovements[0]!.kind).toBe("purchase_in");
    expect(src("src/pages/RestockPage.tsx")).not.toMatch(/adjustStock\s*\(/);
    expect(src("src/pages/RestockPage.tsx")).not.toContain("pending_stock_updates");
    expect(src("src/lib/restockPurchaseLines.ts")).not.toContain("pending_stock_updates");
  });

  it("M — failed valid submission can be retried", () => {
    const built = buildRestockPurchaseLines([batchRow()], [medicine], PHARMACY_CTX);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const lock = { current: false };
    let attempt = 0;
    const mutate = () => {
      attempt += 1;
      if (attempt === 1) return { ok: false as const, errorKey: "restockSaveError" };
      return usePosStore.getState().recordPurchase({
        supplierId: WALK_IN_SUPPLIER_ID,
        supplierName: "Town",
        lines: built.lines,
        amountPaidUgx: 1000,
      });
    };
    expect(submitRestockOnce(lock, mutate)).toEqual({
      started: true,
      result: { ok: false, errorKey: "restockSaveError" },
    });
    expect(lock.current).toBe(false);
    const retry = submitRestockOnce(lock, mutate);
    expect(retry.started).toBe(true);
    if (!retry.started) return;
    expect(retry.result.ok).toBe(true);
    expect(usePosStore.getState().purchases).toHaveLength(1);
    releaseRestockSubmit(lock);
    expect(submitRestockOnce(lock, mutate).started).toBe(true);
    expect(usePosStore.getState().purchases).toHaveLength(2);
  });
});

describe("INV-B5 source wiring", () => {
  it("RestockPage builds lines through the helper and passes them to recordPurchase", () => {
    const page = src("src/pages/RestockPage.tsx");
    expect(page).toContain("buildRestockPurchaseLines");
    expect(page).toContain("submitRestockOnce");
    expect(page).toContain("lines: built.lines");
    expect(page).toContain("shouldTrackBatchesForProduct");
    expect(page).toContain("batchTracked=");
    expect(page.indexOf("buildRestockPurchaseLines")).toBeLessThan(page.indexOf("submitRestockOnce"));
    expect(page).not.toMatch(/adjustStock\s*\(/);

    const helper = src("src/lib/restockPurchaseLines.ts");
    expect(helper).toContain("shouldTrackBatchesForProduct");
    expect(helper).toContain("batchReceive");
    expect(helper).toContain("quantityBase");
    expect(helper).toContain("buyingUnitsToBaseUnits");
    expect(helper).not.toContain("adjustStock");

    const card = src("src/components/stock/RestockLineCard.tsx");
    expect(card).toContain("BatchReceiveExtension");
    expect(card).toContain("batchTracked");
  });

  it("does not invent placeholder batch identity", () => {
    const helper = src("src/lib/restockPurchaseLines.ts");
    expect(helper).not.toMatch(/batchNumber:\s*["']UNKNOWN/);
    expect(helper).not.toMatch(/batchNumber:\s*["']—/);
    expect(helper).not.toMatch(/batchNumber:\s*crypto\.randomUUID/);
  });
});
