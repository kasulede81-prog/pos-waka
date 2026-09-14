import { describe, expect, it, vi } from "vitest";
import { buildEntityParityRows } from "./cloudTrustCenter";

// Distinct count per table, so a mis-mapped destructure (e.g. two entities
// swapped when `fetchCloudEntityCounts` was rewritten to run its 16 count
// queries via `Promise.all` instead of sequential `await`s, to fix
// certification taking far longer than necessary on a slow connection)
// would fail this test instead of silently returning the wrong number for
// the wrong entity.
const TABLE_COUNTS: Record<string, number> = {
  products: 11,
  customers: 22,
  sales: 33,
  sale_returns: 44,
  customer_debt_payments: 55,
  expenses: 66,
  shop_suppliers: 77,
  shop_purchases: 88,
  shop_supplier_payments: 99,
  shop_cash_drawer_adjustments: 111,
  shop_day_drawer_opens: 122,
  shop_shifts: 133,
  shop_day_closes: 144,
  shop_inventory_count_sessions: 155,
  shop_stock_movements: 166,
  audit_logs: 177,
};

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve: (v: { count: number; error: null }) => void) =>
          resolve({ count: TABLE_COUNTS[table] ?? 0, error: null }),
      };
      return builder;
    },
    rpc: async () => ({ data: [], error: null }),
  },
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: async () => ({ organizationId: "org-1", shopId: "shop-1" }),
}));

describe("fetchCloudEntityCounts — each entity maps to its own table's count", () => {
  it("returns the correct count for every entity, not swapped by the parallelized query rewrite", async () => {
    const { fetchCloudEntityCounts } = await import("./cloudTrustCenter");
    const { counts, errors } = await fetchCloudEntityCounts();

    expect(errors).toEqual({});
    expect(counts).toEqual({
      products: 11,
      customers: 22,
      sales: 33,
      returns: 44,
      debtPayments: 55,
      expenses: 66,
      suppliers: 77,
      purchases: 88,
      supplierPayments: 99,
      cashAdjustments: 111,
      dayOpens: 122,
      shifts: 133,
      dayCloses: 144,
      inventoryCounts: 155,
      stockMovements: 166,
      auditLogs: 177,
      staff: 0,
    });
  });
});

describe("cloudTrustCenter", () => {
  it("marks rows as matching when cloud and local counts agree", () => {
    const local = {
      products: 5,
      customers: 2,
      sales: 10,
      returns: 1,
      debtPayments: 1,
      expenses: 1,
      suppliers: 1,
      purchases: 1,
      supplierPayments: 0,
      cashAdjustments: 1,
      dayOpens: 1,
      shifts: 1,
      dayCloses: 1,
      inventoryCounts: 1,
      stockMovements: 3,
      staff: 2,
      auditLogs: 4,
    };
    const rows = buildEntityParityRows({ cloud: { ...local }, local });
    expect(rows.every((r) => r.match)).toBe(true);
  });

  it("marks mismatch when cloud and local differ", () => {
    const rows = buildEntityParityRows({
      cloud: {
        products: 5,
        customers: 0,
        sales: 0,
        returns: 0,
        debtPayments: 0,
        expenses: 0,
        suppliers: 0,
        purchases: 0,
        supplierPayments: 0,
        cashAdjustments: 0,
        dayOpens: 0,
        shifts: 0,
        dayCloses: 0,
        inventoryCounts: 0,
        stockMovements: 0,
        staff: 0,
        auditLogs: 0,
      },
      local: {
        products: 3,
        customers: 0,
        sales: 0,
        returns: 0,
        debtPayments: 0,
        expenses: 0,
        suppliers: 0,
        purchases: 0,
        supplierPayments: 0,
        cashAdjustments: 0,
        dayOpens: 0,
        shifts: 0,
        dayCloses: 0,
        inventoryCounts: 0,
        stockMovements: 0,
        staff: 0,
        auditLogs: 0,
      },
    });
    expect(rows.find((r) => r.id === "products")?.match).toBe(false);
  });
});
