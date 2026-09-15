import { describe, expect, it } from "vitest";
import { buildEntityParityRows } from "./cloudTrustCenter";

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
