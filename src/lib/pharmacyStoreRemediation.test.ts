import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { Product } from "../types";

const EXPIRED_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const expiredMed: Product = {
  id: EXPIRED_ID,
  name: "Expired Tabs",
  sellingMode: "unit",
  baseUnit: "tablet",
  sellingPricePerUnitUgx: 500,
  costPricePerUnitUgx: 200,
  stockOnHand: 4,
  minimumStockAlert: 2,
  category: "General",
  sku: "",
  expiryDate: "2020-06-01",
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

function seedPharmacyOwner() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [expiredMed],
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "pharmacy",
      pharmacyModeEnabled: true,
    },
    stockMovements: [],
    auditLogs: [],
  });
}

describe("pharmacy quickAddProduct", () => {
  beforeEach(() => {
    seedPharmacyOwner();
    usePosStore.setState({ products: [] });
  });

  it("rejects pharmacy add without buy price", () => {
    const r = usePosStore.getState().quickAddProduct({
      name: "New Med",
      priceUgx: 1000,
      stockQty: 10,
      category: "Pain",
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyBuyPriceRequired");
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("rejects pharmacy add without opening stock", () => {
    const r = usePosStore.getState().quickAddProduct({
      name: "New Med",
      priceUgx: 1000,
      stockQty: 0,
      category: "Pain",
      costPricePerUnitUgx: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyOpeningStockRequired");
  });

  it("adds medicine with explicit buy price", () => {
    const r = usePosStore.getState().quickAddProduct({
      name: "New Med",
      priceUgx: 1000,
      stockQty: 10,
      category: "Pain",
      costPricePerUnitUgx: 600,
      baseUnit: "tablet",
    });
    expect(r.ok).toBe(true);
    const p = usePosStore.getState().products[0]!;
    expect(p.costPricePerUnitUgx).toBe(600);
    expect(p.sellingPricePerUnitUgx).toBe(1000);
  });

  it("retail still guesses cost when omitted", () => {
    usePosStore.setState({
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "kiosk_duka",
        pharmacyModeEnabled: false,
      },
    });
    const r = usePosStore.getState().quickAddProduct({
      name: "Soda",
      priceUgx: 1000,
      stockQty: 5,
      category: "Drinks",
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products[0]!.costPricePerUnitUgx).toBe(720);
  });
});

describe("pharmacy updateProduct cost", () => {
  beforeEach(() => seedPharmacyOwner());

  it("owner updates buy price per unit", () => {
    const r = usePosStore.getState().updateProduct(EXPIRED_ID, {
      costPricePerUnitUgx: 250,
    });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products[0]!.costPricePerUnitUgx).toBe(250);
  });
});

describe("writeOffExpiredStock", () => {
  beforeEach(() => seedPharmacyOwner());

  it("owner write-off reduces stock and audits loss", () => {
    const r = usePosStore.getState().writeOffExpiredStock({ productId: EXPIRED_ID });
    expect(r.ok).toBe(true);
    expect(r.lossValueUgx).toBe(800);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(0);
    const mov = usePosStore.getState().stockMovements.find((m) => m.kind === "adjust_expired_writeoff");
    expect(mov?.deltaBaseUnits).toBe(-4);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "expired_stock_writeoff")).toBe(true);
  });

  it("cashier cannot write off", () => {
    usePosStore.setState({
      sessionActor: { userId: "c:1", role: "cashier", displayName: "Cashier" },
    });
    const r = usePosStore.getState().writeOffExpiredStock({ productId: EXPIRED_ID });
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(4);
  });
});
