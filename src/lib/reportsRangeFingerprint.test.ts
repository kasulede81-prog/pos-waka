/**
 * NEW-02 — Reports range cache fingerprints expenses and products by consumed content.
 * POST-AUDIT-05 sales fingerprint is left intact.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CashExpense, Product } from "../types";
import {
  buildReportingExpensesFingerprint,
  buildReportingProductsFingerprint,
  buildSalesFingerprint,
  getCachedComputation,
} from "./computationResultCache";
import { monthKeyKampala } from "./datesUg";
import { localGetRangeSummary } from "./localReporting";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const DAY = "2026-08-12";

function expense(partial: Partial<CashExpense> & Pick<CashExpense, "id">): CashExpense {
  return {
    category: "transport",
    amountUgx: 8_000,
    description: "boda",
    paidOn: DAY,
    createdAt: `${DAY}T10:00:00.000Z`,
    createdByUserId: "owner",
    pendingSync: false,
    approvalStatus: "pending",
    deletedAt: null,
    ...partial,
  };
}

function product(partial: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Widget",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 40_000,
    stockOnHand: 10,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
    ...partial,
  };
}

describe("NEW-02 reports expense / product range fingerprints", () => {
  it("TEST 1 — expense approval changes fingerprint at the same length", () => {
    const pending = expense({ id: "e1", approvalStatus: "pending" });
    const approved = { ...pending, approvalStatus: "approved" as const };
    expect([approved]).toHaveLength(1);
    expect(buildReportingExpensesFingerprint([approved])).not.toBe(buildReportingExpensesFingerprint([pending]));
  });

  it("TEST 2 — expense void (deletedAt) changes fingerprint at the same length", () => {
    const live = expense({ id: "e1", approvalStatus: "approved", deletedAt: null });
    const voided = { ...live, deletedAt: `${DAY}T15:00:00.000Z` };
    expect([voided]).toHaveLength(1);
    expect(buildReportingExpensesFingerprint([voided])).not.toBe(buildReportingExpensesFingerprint([live]));
  });

  it("TEST 3 — expense amount change changes fingerprint", () => {
    const a = expense({ id: "e1", approvalStatus: "approved", amountUgx: 8_000 });
    const b = { ...a, amountUgx: 12_000 };
    expect(buildReportingExpensesFingerprint([b])).not.toBe(buildReportingExpensesFingerprint([a]));
  });

  it("TEST 4 — paidOn reporting-boundary change changes fingerprint", () => {
    const inRange = expense({ id: "e1", approvalStatus: "approved", paidOn: "2026-08-12" });
    const outOfRange = { ...inRange, paidOn: "2026-07-01" };
    expect(buildReportingExpensesFingerprint([outOfRange])).not.toBe(buildReportingExpensesFingerprint([inRange]));
  });

  it("TEST 5 — product cost change changes fingerprint", () => {
    const a = product({ costPricePerUnitUgx: 40_000 });
    const b = { ...a, costPricePerUnitUgx: 80_000 };
    expect([b]).toHaveLength(1);
    expect(buildReportingProductsFingerprint([b])).not.toBe(buildReportingProductsFingerprint([a]));
  });

  it("TEST 6 — product stock change changes fingerprint", () => {
    const a = product({ stockOnHand: 10 });
    const b = { ...a, stockOnHand: 5 };
    expect(buildReportingProductsFingerprint([b])).not.toBe(buildReportingProductsFingerprint([a]));
  });

  it("TEST 7 — minimum-stock and pack-cost fields change fingerprint (consumed by inventory insights)", () => {
    const base = product();
    expect(buildReportingProductsFingerprint([{ ...base, minimumStockAlert: 8 }])).not.toBe(
      buildReportingProductsFingerprint([base]),
    );
    expect(buildReportingProductsFingerprint([{ ...base, buyingPackCostUgx: 200_000 }])).not.toBe(
      buildReportingProductsFingerprint([base]),
    );
    expect(buildReportingProductsFingerprint([{ ...base, conversionRate: 20 }])).not.toBe(
      buildReportingProductsFingerprint([base]),
    );
    expect(buildReportingProductsFingerprint([{ ...base, packCostUnitsDepleted: 3 }])).not.toBe(
      buildReportingProductsFingerprint([base]),
    );
  });

  it("TEST 8 — irrelevant expense fields do not change fingerprint", () => {
    const a = expense({ id: "e1", approvalStatus: "approved", description: "boda", pendingSync: false });
    const b = { ...a, description: "lunch", pendingSync: true, category: "rent" };
    expect(buildReportingExpensesFingerprint([b])).toBe(buildReportingExpensesFingerprint([a]));
  });

  it("TEST 9 — irrelevant product fields do not change fingerprint", () => {
    const a = product();
    const b = {
      ...a,
      name: "Renamed",
      sku: "SKU-9",
      category: "Other",
      version: 9,
      updatedAt: `${DAY}T18:00:00.000Z`,
      expiryDate: "2027-01-01",
    };
    expect(buildReportingProductsFingerprint([b])).toBe(buildReportingProductsFingerprint([a]));
  });

  it("TEST 10 — repeated fingerprints are deterministic", () => {
    const expenses = [expense({ id: "e1", approvalStatus: "approved" })];
    const products = [product()];
    expect(buildReportingExpensesFingerprint(expenses)).toBe(buildReportingExpensesFingerprint(expenses));
    expect(buildReportingProductsFingerprint(products)).toBe(buildReportingProductsFingerprint(products));
    expect(buildReportingExpensesFingerprint([])).toBe("0");
    expect(buildReportingProductsFingerprint([])).toBe("0");
  });

  it("TEST 11 — same-length collections with different relevant content differ", () => {
    const e1 = expense({ id: "e1", approvalStatus: "approved", amountUgx: 1_000 });
    const e2 = expense({ id: "e2", approvalStatus: "approved", amountUgx: 9_000 });
    expect([e1]).toHaveLength(1);
    expect(buildReportingExpensesFingerprint([e2])).not.toBe(buildReportingExpensesFingerprint([e1]));
    expect(buildReportingProductsFingerprint([product({ id: "p-b" })])).not.toBe(
      buildReportingProductsFingerprint([product({ id: "p-a" })]),
    );
  });

  it("TEST 12 — POST-AUDIT-05 sales fingerprint helper is unchanged and still used by Reports", () => {
    const cache = src("src/lib/computationResultCache.ts");
    expect(cache).toContain("export function buildSalesFingerprint");
    expect(cache).toContain("saleReportingToken");
    const hook = src("src/hooks/useShopReporting.ts");
    expect(hook).toContain("buildSalesFingerprint(sales)");
    expect(hook).toContain("buildReportingProductsFingerprint(products)");
    expect(hook).toContain("buildReportingExpensesFingerprint(cashExpenses)");
    const fpLine = hook
      .split("\n")
      .find((line) => line.includes("buildSalesFingerprint(sales)") && line.includes("buildReporting"));
    expect(fpLine).toBeTruthy();
    expect(fpLine).not.toContain("products.length");
    expect(fpLine).not.toContain("cashExpenses.length");
    expect(buildSalesFingerprint([])).toBe("0");
  });

  it("same length + approved expense recomputes monthly cached expensesUgx", () => {
    const month = monthKeyKampala(new Date());
    const paidOn = `${month}-01`;
    const pending = expense({ id: "e-cache", approvalStatus: "pending", amountUgx: 8_000, paidOn });
    const approved = { ...pending, approvalStatus: "approved" as const };
    expect([approved]).toHaveLength(1);
    const fpPending = `sales0:${buildReportingProductsFingerprint([])}:0:0:0:${buildReportingExpensesFingerprint([pending])}:month`;
    const fpApproved = `sales0:${buildReportingProductsFingerprint([])}:0:0:0:${buildReportingExpensesFingerprint([approved])}:month`;
    expect(fpApproved).not.toBe(fpPending);

    const filter = { kind: "preset" as const, preset: "this_month" as const };
    let computes = 0;
    const key = "new-02-localGetRangeSummary-expenses";
    const first = getCachedComputation(key, fpPending, () => {
      computes += 1;
      return localGetRangeSummary([], [], [], [], [], filter, [pending]);
    });
    const reused = getCachedComputation(key, fpPending, () => {
      computes += 1;
      return localGetRangeSummary([], [], [], [], [], filter, [pending]);
    });
    expect(computes).toBe(1);
    expect(reused).toBe(first);
    expect("expensesUgx" in first.summary && first.summary.expensesUgx).toBe(0);

    const next = getCachedComputation(key, fpApproved, () => {
      computes += 1;
      return localGetRangeSummary([], [], [], [], [], filter, [approved]);
    });
    expect(computes).toBe(2);
    expect(next).not.toBe(first);
    expect("expensesUgx" in next.summary && next.summary.expensesUgx).toBe(8_000);
  });

  it("same length + product cost edit recomputes cached stockValueAtCost", () => {
    const cheap = product({ costPricePerUnitUgx: 40_000, stockOnHand: 10 });
    const costly = { ...cheap, costPricePerUnitUgx: 80_000 };
    expect([costly]).toHaveLength(1);
    const fpCheap = `sales0:${buildReportingProductsFingerprint([cheap])}:0:0:0:0:day`;
    const fpCostly = `sales0:${buildReportingProductsFingerprint([costly])}:0:0:0:0:day`;
    expect(fpCostly).not.toBe(fpCheap);

    const filter = { kind: "day" as const, dateKey: DAY };
    let computes = 0;
    const key = "new-02-localGetRangeSummary-products";
    const first = getCachedComputation(key, fpCheap, () => {
      computes += 1;
      return localGetRangeSummary([], [cheap], [], [], [], filter);
    });
    expect(computes).toBe(1);
    const next = getCachedComputation(key, fpCostly, () => {
      computes += 1;
      return localGetRangeSummary([], [costly], [], [], [], filter);
    });
    expect(computes).toBe(2);
    expect(next).not.toBe(first);
    expect(next.inventory.stockValueAtCostUgx).not.toBe(first.inventory.stockValueAtCostUgx);
  });
});
