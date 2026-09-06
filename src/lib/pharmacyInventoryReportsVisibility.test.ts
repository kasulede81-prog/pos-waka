import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reportsInventoryCostPresentation } from "../features/business-analytics/lib/analyticsPageView";
import {
  computePharmacyInventoryReports,
  presentPharmacyInventoryReports,
} from "./pharmacyInventoryReports";
import { resolveProfitVisibility } from "./profitVisibility";
import { resolveSessionActor, type SessionActor } from "./sessionActor";
import type { Product, UserRole } from "../types";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const STARTER: SubscriptionSnapshot = {
  kind: "remote",
  row: {
    id: "1",
    organization_id: "o1",
    shop_id: "s1",
    plan_code: "starter",
    status: "active",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    max_pos_users: null,
    max_shops: null,
    max_devices: null,
  } as RemoteSubscriptionRow,
};

function actor(role: UserRole): SessionActor {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: `${role}@waka.invalid` } as never,
    email: `${role}@waka.invalid`,
    shopMemberRole: role,
    preferences: {} as never,
  });
}

function product(partial: Partial<Product> & Pick<Product, "id" | "name" | "costPricePerUnitUgx" | "stockOnHand">): Product {
  return {
    sellingPricePerUnitUgx: 8_000,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "Medicine",
    sku: partial.id,
    minimumStockAlert: 1,
    updatedAt: "2026-09-01T09:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const nearExpiry = new Date();
nearExpiry.setDate(nearExpiry.getDate() + 20);

const products: Product[] = [
  product({
    id: "med-stock",
    name: "Paracetamol",
    costPricePerUnitUgx: 12_345,
    stockOnHand: 4,
  }),
  product({
    id: "med-expired",
    name: "Expired Syrup",
    costPricePerUnitUgx: 9_876,
    stockOnHand: 2,
    expiryDate: "2000-01-01",
  }),
  product({
    id: "med-near",
    name: "Near Expiry Capsule",
    costPricePerUnitUgx: 8_888,
    stockOnHand: 1,
    expiryDate: nearExpiry.toISOString().slice(0, 10),
  }),
];

function protectedNumbers(snapshot: ReturnType<typeof computePharmacyInventoryReports>): number[] {
  return [
    snapshot.inventoryValueUgx,
    snapshot.expiryLossUgx,
    snapshot.nearExpiryValueUgx,
    snapshot.expiredValueUgx,
    ...snapshot.topMedicines.map((row) => row.valueUgx),
  ].filter((n) => n > 0);
}

function viewContainsProtectedNumber(
  view: ReturnType<typeof presentPharmacyInventoryReports>,
  snapshot: ReturnType<typeof computePharmacyInventoryReports>,
): boolean {
  const json = JSON.stringify(view);
  return protectedNumbers(snapshot).some((n) => json.includes(String(n)));
}

describe("REAUDIT-P2-02 pharmacy inventory reports cost respects reports.profit", () => {
  it("TEST 1 — reports.view without reports.profit keeps the report and hides cost/value", () => {
    const visibility = resolveProfitVisibility({
      role: "cashier",
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: ["reports.view"],
    });
    expect(visibility.canProfit).toBe(false);

    const snapshot = computePharmacyInventoryReports(products);
    expect(snapshot.inventoryValueUgx).toBeGreaterThan(0);
    expect(snapshot.expiryLossUgx).toBeGreaterThan(0);
    expect(snapshot.nearExpiryValueUgx).toBeGreaterThan(0);
    expect(snapshot.topMedicines.some((row) => row.valueUgx > 0)).toBe(true);

    const view = presentPharmacyInventoryReports(snapshot, visibility.canProfit);
    expect(view.inventoryValue.visible).toBe(false);
    expect(view.expiryLoss.visible).toBe(false);
    expect(view.nearExpiryValue.visible).toBe(false);
    expect(view.expiredValue.visible).toBe(false);
    expect(view.topMedicines.every((row) => !("valueUgx" in row))).toBe(true);
    expect(viewContainsProtectedNumber(view, snapshot)).toBe(false);

    expect(view.medicineCount).toBe(snapshot.medicineCount);
    expect(view.batchCount).toBe(snapshot.batchCount);
    expect(view.controlledCount).toBe(snapshot.controlledCount);
    expect(view.topMedicines.map((row) => row.name)).toEqual(snapshot.topMedicines.map((row) => row.name));
    expect(view.slowMovers.map((row) => row.stockOnHand)).toEqual(snapshot.slowMovers.map((row) => row.stockOnHand));
  });

  it("TEST 2 — reports.view + reports.profit keeps existing monetary values", () => {
    const owner = actor("owner");
    const visibility = resolveProfitVisibility({
      role: owner.role,
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: owner.permissions,
    });
    expect(visibility.canProfit).toBe(true);

    const snapshot = computePharmacyInventoryReports(products);
    const view = presentPharmacyInventoryReports(snapshot, visibility.canProfit);
    expect(view.inventoryValue).toEqual({ visible: true, valueUgx: snapshot.inventoryValueUgx });
    expect(view.expiryLoss).toEqual({ visible: true, valueUgx: snapshot.expiryLossUgx });
    expect(view.nearExpiryValue).toEqual({ visible: true, valueUgx: snapshot.nearExpiryValueUgx });
    expect(view.expiredValue).toEqual({ visible: true, valueUgx: snapshot.expiredValueUgx });
    expect(view.topMedicines.map((row) => row.valueUgx)).toEqual(snapshot.topMedicines.map((row) => row.valueUgx));
    expect(reportsInventoryCostPresentation(true, snapshot.inventoryValueUgx)).toEqual({
      visible: true,
      valueUgx: snapshot.inventoryValueUgx,
    });
  });

  it("TEST 3 — missing or ambiguous profit permission is fail-closed", () => {
    const snapshot = computePharmacyInventoryReports(products);
    expect(presentPharmacyInventoryReports(snapshot, undefined).inventoryValue.visible).toBe(false);
    expect(presentPharmacyInventoryReports(snapshot, null).inventoryValue.visible).toBe(false);
    expect(viewContainsProtectedNumber(presentPharmacyInventoryReports(snapshot, undefined), snapshot)).toBe(false);
    expect(reportsInventoryCostPresentation(false, snapshot.inventoryValueUgx)).toEqual({ visible: false });
  });

  it("TEST 4 — every protected monetary field is stripped from the presented model", () => {
    const snapshot = computePharmacyInventoryReports(products);
    const view = presentPharmacyInventoryReports(snapshot, false);
    expect("valueUgx" in view.inventoryValue).toBe(false);
    expect("valueUgx" in view.expiryLoss).toBe(false);
    expect("valueUgx" in view.nearExpiryValue).toBe(false);
    expect("valueUgx" in view.expiredValue).toBe(false);
    for (const row of view.topMedicines) {
      expect(row).not.toHaveProperty("valueUgx");
    }
    for (const row of view.slowMovers) {
      expect(row).not.toHaveProperty("valueUgx");
    }
    const json = JSON.stringify(view);
    expect(json).not.toContain(String(snapshot.inventoryValueUgx));
    expect(json).not.toContain(String(snapshot.expiryLossUgx));
    expect(json).not.toContain(String(snapshot.nearExpiryValueUgx));
    expect(json).not.toContain(String(snapshot.expiredValueUgx));
    for (const row of snapshot.topMedicines) {
      expect(json).not.toContain(String(row.valueUgx));
    }
  });
});

describe("REAUDIT-P2-02 source wiring", () => {
  it("page uses the canonical profit visibility + presentation path", () => {
    const page = src("src/pages/PharmacyInventoryReportsPage.tsx");
    expect(page).toContain("resolveProfitVisibility");
    expect(page).toContain("presentPharmacyInventoryReports");
    expect(page).toContain("computePharmacyInventoryReports");
    expect(page).not.toMatch(/formatUgx\(report\.(inventoryValueUgx|expiryLossUgx|nearExpiryValueUgx)/);
    expect(page).toContain("m.valueUgx != null");

    const helper = src("src/lib/pharmacyInventoryReports.ts");
    expect(helper).toContain("reportsInventoryCostPresentation");
    expect(helper).toContain("canProfit === true");

    const app = src("src/App.tsx");
    const inventoryRoute = app.slice(app.indexOf('path="pharmacy/reports/inventory"'));
    expect(inventoryRoute).toContain('permission="reports.view"');
    expect(inventoryRoute.slice(0, 400)).not.toContain('permission="reports.profit"');
  });
});
