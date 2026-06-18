import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, SaleLine } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { usePosStore } from "../store/usePosStore";
import { returnRestocksInventory } from "./returnPolicy";
import {
  initInventorySyncChannel,
  resetInventorySyncChannelForTests,
} from "./inventorySyncChannel";

const ACCOUNT = "sb:cross-tab-test";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class MockBroadcastChannel {
  static readonly instances = new Map<string, Set<MockBroadcastChannel>>();
  readonly name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.instances.has(name)) {
      MockBroadcastChannel.instances.set(name, new Set());
    }
    MockBroadcastChannel.instances.get(name)!.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.instances.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    MockBroadcastChannel.instances.get(this.name)?.delete(this);
  }
}

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 1,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const cartLine: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 10_000,
  estimatedProfitUgx: 7_000,
  stockVersionAtAdd: 1,
};

function seedStore(stockOnHand: number, version: number) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [{ ...baseProduct, stockOnHand, version }],
    customers: [],
    sales: [],
    draftLines: [{ ...cartLine, stockVersionAtAdd: version }],
    draftCartDiscountUgx: 0,
    returnRecords: [],
    stockMovements: [],
    voidRecords: [],
  });
}

describe("crossTabSaleProtection", () => {
  beforeEach(() => {
    setActiveAccountKey(ACCOUNT);
    MockBroadcastChannel.instances.clear();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    initInventorySyncChannel((msg) => usePosStore.getState().applyRemoteInventorySync(msg));
  });

  afterEach(() => {
    resetInventorySyncChannelForTests();
    setActiveAccountKey(null);
    vi.unstubAllGlobals();
  });

  it("second tab receives stock update after sale in first tab", () => {
    seedStore(1, 1);

    usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
      changeGivenUgx: 0,
    });

    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(0);
    expect(usePosStore.getState().products[0]!.version).toBe(2);
  });

  it("aborts sale when stock was sold in another tab (version mismatch)", () => {
    seedStore(0, 2);
    usePosStore.setState({
      draftLines: [{ ...cartLine, stockVersionAtAdd: 1 }],
    });

    const result = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
      changeGivenUgx: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe("stockChangedAnotherWindow");
    expect(usePosStore.getState().sales).toHaveLength(0);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(0);
  });

  it("applyRemoteInventorySync prevents oversell after peer sale", () => {
    seedStore(1, 1);

    usePosStore.getState().applyRemoteInventorySync({
      accountKey: ACCOUNT,
      type: "sale_completed",
      productId: PRODUCT_ID,
      newStock: 0,
      version: 2,
      timestamp: Date.now(),
      tabId: "foreign-tab",
    });

    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(0);
    expect(usePosStore.getState().products[0]!.version).toBe(2);

    const result = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
      changeGivenUgx: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe("stockChangedAnotherWindow");
  });

  it("damaged return does not restock locally", () => {
    seedStore(5, 1);
    usePosStore.setState({ sales: [] });

    const result = usePosStore.getState().returnProduct({
      saleId: null,
      productId: PRODUCT_ID,
      quantity: 2,
      refundAmountUgx: 5_000,
      reason: "damaged",
      note: "box crushed",
    });

    expect(result.ok).toBe(true);
    expect(returnRestocksInventory("damaged")).toBe(false);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(5);
    expect(usePosStore.getState().products[0]!.version).toBe(1);
  });

  it("wrong_item return restocks locally", () => {
    seedStore(5, 1);

    const result = usePosStore.getState().returnProduct({
      saleId: null,
      productId: PRODUCT_ID,
      quantity: 2,
      refundAmountUgx: 5_000,
      reason: "wrong_item",
      note: "linked",
    });

    expect(result.ok).toBe(true);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(7);
    expect(usePosStore.getState().products[0]!.version).toBe(2);
  });
});
