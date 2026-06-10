/**
 * P0 Release Gate — programmatic E2E verification (no UI).
 * Mirrors manual QA scenarios from the verification pass.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import type { Product, SaleLine } from "../types";
import { computeDraftCheckoutTotals } from "./draftCart";
import {
  hasEffectivePermission,
  maxStaffAccountsForTier,
  resolveEffectivePlanTier,
  type RemoteSubscriptionRow,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";
import { localGetRangeSummary } from "./localReporting";
import { usePosStore } from "../store/usePosStore";
import { t } from "./i18n";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Soap",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 0,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T08:00:00.000Z",
  version: 1,
};

const line: SaleLine = {
  id: "line-1",
  productId: PRODUCT_ID,
  name: "Soap",
  inputMode: "quantity",
  quantity: 1,
  unitPriceUgx: 10_000,
  unitCostUgx: 3_000,
  lineTotalUgx: 10_000,
  estimatedProfitUgx: 7_000,
  updatedAt: "2026-06-02T10:00:00.000Z",
};

function businessTrialSnapshot(): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "1",
      organization_id: "o1",
      shop_id: "s1",
      plan_code: "business",
      status: "trial",
      trial_ends_at: "2026-07-01T00:00:00.000Z",
      current_period_start: null,
      current_period_end: null,
      max_pos_users: 3,
      max_shops: 1,
      max_devices: 3,
    } as RemoteSubscriptionRow,
  };
}

describe("P0-1 Discounted pending sale E2E", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      products: [{ ...baseProduct, stockOnHand: 20 }],
      customers: [],
      sales: [],
      draftLines: [line],
      draftCartDiscountUgx: 3_000,
      activePendingSaleId: null,
    });
  });

  it("hold → resume → payable identical to held total", () => {
    const beforeHold = computeDraftCheckoutTotals(
      usePosStore.getState().draftLines,
      usePosStore.getState().draftCartDiscountUgx,
    ).payableUgx;

    const save = usePosStore.getState().savePendingSale();
    expect(save.ok).toBe(true);

    const held = usePosStore.getState().sales.find((s) => s.id === save.saleId);
    expect(held?.totalUgx).toBe(beforeHold);

    usePosStore.getState().resumePendingSale(save.saleId!);
    const afterResume = computeDraftCheckoutTotals(
      usePosStore.getState().draftLines,
      usePosStore.getState().draftCartDiscountUgx,
    ).payableUgx;

    expect(afterResume).toBe(beforeHold);
    expect(afterResume).toBe(held?.totalUgx);
  });
});

describe("P0-2 Hospitality settlement failure (store path)", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "waiter:1", role: "waiter", displayName: "Waiter" },
      products: [baseProduct],
      draftLines: [line],
      draftCartDiscountUgx: 0,
      activePendingSaleId: "pending-table-1",
    });
  });

  it("finalizeDraftSale returns noStock when stock exhausted", () => {
    const res = usePosStore.getState().finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: "cash",
      amountPaidUgx: 10_000,
      changeGivenUgx: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("noStock");
    expect(t("en", res.errorKey!)).toBeTruthy();
    expect(t("en", "tableSettleFailed")).toContain("settle");
  });
});

describe("P0-3 Business trial account gates", () => {
  const snap = businessTrialSnapshot();

  it("resolves to business tier", () => {
    expect(resolveEffectivePlanTier(snap)).toBe("business");
  });

  it("allows staff creation quota", () => {
    expect(maxStaffAccountsForTier(resolveEffectivePlanTier(snap))).toBe(3);
  });

  it("unlocks owner dashboard, profit, shop settings", () => {
    expect(hasEffectivePermission("owner", "owner.dashboard", snap, "supabase")).toBe(true);
    expect(hasEffectivePermission("owner", "reports.profit", snap, "supabase")).toBe(true);
    expect(hasEffectivePermission("owner", "settings.shop", snap, "supabase")).toBe(true);
  });
});

describe("P0-4 Credit permissions", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "cashier:1", role: "cashier", displayName: "Cashier" },
      products: [{ ...baseProduct, stockOnHand: 10 }],
      customers: [],
      sales: [],
      draftLines: [line],
      draftCartDiscountUgx: 0,
    });
  });

  it("cashier debt finalize rejected with forbidden", () => {
    const res = usePosStore.getState().finalizeDraftSale({
      debtUgx: 10_000,
      paymentMethod: "credit",
      amountPaidUgx: 0,
      changeGivenUgx: 0,
      customerName: "Test Customer",
    });
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("forbidden");
    expect(usePosStore.getState().sales).toHaveLength(0);
  });
});

describe("P0-6 Monthly trend accuracy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("month chart spans month-to-date with correct daily values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));

    const products = [{ ...baseProduct, stockOnHand: 10 }];
    const sales = [
      {
        id: "s1",
        status: "completed" as const,
        createdAt: "2026-06-03T10:00:00.000Z",
        updatedAt: "2026-06-03T10:00:00.000Z",
        subtotalUgx: 50_000,
        totalUgx: 50_000,
        cashPaidUgx: 50_000,
        debtUgx: 0,
        estimatedProfitUgx: 40_000,
        pendingSync: false,
        lines: [{ ...line, lineTotalUgx: 50_000, quantity: 5 }],
      },
      {
        id: "s2",
        status: "completed" as const,
        createdAt: "2026-06-12T09:00:00.000Z",
        updatedAt: "2026-06-12T09:00:00.000Z",
        subtotalUgx: 20_000,
        totalUgx: 20_000,
        cashPaidUgx: 20_000,
        debtUgx: 0,
        estimatedProfitUgx: 14_000,
        pendingSync: false,
        lines: [{ ...line, lineTotalUgx: 20_000, quantity: 2 }],
      },
    ];

    const bundle = localGetRangeSummary(sales, products, [], [], [], {
      kind: "preset",
      preset: "this_month",
    });

    expect(bundle.dailyTrend).toHaveLength(12);
    expect(bundle.dailyTrend[0]?.day).toBe("2026-06-01");
    expect(bundle.dailyTrend[11]?.day).toBe("2026-06-12");
    expect(bundle.dailyTrend.find((d) => d.day === "2026-06-03")?.revenueUgx).toBe(50_000);
    expect(bundle.dailyTrend.find((d) => d.day === "2026-06-12")?.revenueUgx).toBe(20_000);
    expect(bundle.summary.totalRevenueUgx).toBe(70_000);
  });
});

describe("P0-7 Expense persistence contract", () => {
  it("incremental persist and bootstrap include cashExpense bucket", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const inc = readFileSync(resolve(process.cwd(), "src/offline/incrementalPersist.ts"), "utf8");
    const ent = readFileSync(resolve(process.cwd(), "src/offline/entityStore.ts"), "utf8");
    const store = readFileSync(resolve(process.cwd(), "src/store/usePosStore.ts"), "utf8");
    expect(inc).toContain('persistArrayDelta("cashExpense"');
    expect(ent).toContain("cashExpense");
    expect(store).toMatch(/getEntitiesByBucket(<CashExpense>)?\("cashExpense"\)/);
  });
});
