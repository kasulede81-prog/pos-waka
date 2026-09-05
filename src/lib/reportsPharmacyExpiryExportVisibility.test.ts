import { describe, expect, it } from "vitest";
import { buildPharmacyExpiryPdfBlob, pharmacyExpiryCsv } from "./pharmacyDocumentExports";
import { actorCanSeeInventoryCostValue } from "./inventoryFinancialVisibility";
import { t } from "./i18n";
import { resolveProfitVisibility } from "./profitVisibility";
import { resolveSessionActor, type SessionActor } from "./sessionActor";
import type { UserRole, Product } from "../types";
import type { RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";

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

function canProfitFor(role: UserRole): boolean {
  const session = actor(role);
  return resolveProfitVisibility({
    role: session.role,
    snapshot: STARTER,
    authMode: "supabase",
    actorPermissions: session.permissions,
  }).canProfit;
}

const med: Product = {
  id: "m-exp",
  name: "Amoxil Capsule",
  sellingMode: "unit",
  category: "Medicine",
  sellingPricePerUnitUgx: 800,
  costPricePerUnitUgx: 47_313,
  stockOnHand: 3,
  baseUnit: "cap",
  minimumStockAlert: 1,
  sku: "AMX-1",
  expiryDate: "2026-10-01",
  updatedAt: "2026-01-01",
  version: 1,
};

const STOCK_VALUE = 47_313 * 3;

function csvHasCost(csv: string): boolean {
  return (
    csv.includes("value_ugx") ||
    csv.includes(String(STOCK_VALUE)) ||
    csv.includes(String(med.costPricePerUnitUgx))
  );
}

function pdfHasCost(text: string): boolean {
  return (
    text.includes("value_ugx") ||
    text.includes(String(STOCK_VALUE)) ||
    text.includes(STOCK_VALUE.toLocaleString()) ||
    text.includes(String(med.costPricePerUnitUgx)) ||
    text.includes(med.costPricePerUnitUgx.toLocaleString())
  );
}

describe("RPT-P2-03 pharmacy expiry export cost visibility", () => {
  it("TEST 1 — CSV without reports.profit omits cost/value and keeps operational fields", () => {
    expect(canProfitFor("cashier")).toBe(false);
    const csv = pharmacyExpiryCsv([med], { includeCost: canProfitFor("cashier") });
    expect(csvHasCost(csv)).toBe(false);
    expect(csv).toContain("product,expiry_date,status,qty");
    expect(csv).not.toContain("value_ugx");
    expect(csv).toContain("Amoxil Capsule");
    expect(csv).toContain("2026-10-01");
    expect(csv).toContain("expiring");
    expect(csv).toContain(",3");
  });

  it("TEST 2 — CSV with reports.profit keeps value_ugx", () => {
    expect(canProfitFor("owner")).toBe(true);
    const csv = pharmacyExpiryCsv([med], { includeCost: canProfitFor("owner") });
    expect(csv).toContain("product,expiry_date,status,qty,value_ugx");
    expect(csv).toContain(String(STOCK_VALUE));
    expect(csv).toContain("Amoxil Capsule");
  });

  it("TEST 3 — PDF without reports.profit omits cost/value and keeps operational fields", async () => {
    const blob = buildPharmacyExpiryPdfBlob("en", [med], { includeCost: canProfitFor("cashier") });
    const text = await blob.text();
    expect(pdfHasCost(text)).toBe(false);
    expect(text).not.toContain(t("en", "pharmacyReportsExpiringValue"));
    expect(text).toContain(t("en", "pharmacyExpiryExportTitle"));
    expect(text).toContain("Amoxil Capsule");
    expect(text).toContain("2026-10-01");
  });

  it("TEST 4 — PDF with reports.profit keeps existing financial values", async () => {
    const blob = buildPharmacyExpiryPdfBlob("en", [med], { includeCost: canProfitFor("owner") });
    const text = await blob.text();
    expect(text).toContain(`UGX ${STOCK_VALUE.toLocaleString()}`);
    expect(text).toContain("Amoxil Capsule");
  });

  it("TEST 5 — missing includeCost is fail-closed", () => {
    expect(csvHasCost(pharmacyExpiryCsv([med]))).toBe(false);
    expect(csvHasCost(pharmacyExpiryCsv([med], {}))).toBe(false);
    expect(csvHasCost(pharmacyExpiryCsv([med], { includeCost: undefined }))).toBe(false);
  });

  it("TEST 6 — stock.adjust does not grant Reports expiry cost", () => {
    const keeper = actor("stock_keeper");
    expect(actorCanSeeInventoryCostValue(keeper, STARTER, "supabase")).toBe(true);
    const visibility = resolveProfitVisibility({
      role: keeper.role,
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: keeper.permissions,
    });
    expect(visibility.canProfit).toBe(false);
    const csv = pharmacyExpiryCsv([med], { includeCost: visibility.canProfit });
    expect(csvHasCost(csv)).toBe(false);
  });

  it("TEST 7 — no reports.profit and no stock.adjust still omits cost", () => {
    const visibility = resolveProfitVisibility({
      role: "cashier",
      snapshot: STARTER,
      authMode: "supabase",
      actorPermissions: actor("cashier").permissions,
    });
    expect(visibility.canProfit).toBe(false);
    expect(actorCanSeeInventoryCostValue(actor("cashier"), STARTER, "supabase")).toBe(false);
    expect(csvHasCost(pharmacyExpiryCsv([med], { includeCost: visibility.canProfit }))).toBe(false);
  });
});
