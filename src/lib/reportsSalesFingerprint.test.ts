/**
 * POST-AUDIT-05 — reports sales fingerprint invalidates in-place sale mutations.
 */
import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine } from "../types";
import { buildSalesFingerprint, getCachedComputation } from "./computationResultCache";
import { localGetRangeSummary } from "./localReporting";

const DAY = "2026-08-12";

function line(partial: Partial<SaleLine> = {}): SaleLine {
  return {
    productId: "prod-1",
    name: "Widget",
    quantity: 1,
    unitPriceUgx: 10_000,
    unitCostUgx: 6_000,
    lineTotalUgx: 10_000,
    originalLineTotalUgx: 10_000,
    cogsUgx: 6_000,
    netRevenueUgx: 10_000,
    grossProfitUgx: 4_000,
    estimatedProfitUgx: 4_000,
    inputMode: "quantity",
    voided: false,
    ...partial,
  };
}

function sale(id: string, extra: Partial<Sale> = {}): Sale {
  const total = extra.totalUgx ?? 10_000;
  return {
    id,
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: extra.cashPaidUgx ?? total,
    debtUgx: extra.debtUgx ?? 0,
    estimatedProfitUgx: extra.estimatedProfitUgx ?? 4_000,
    discountTotalUgx: extra.discountTotalUgx ?? 0,
    paymentMethod: extra.paymentMethod ?? "cash",
    tenderCashUgx: extra.tenderCashUgx ?? total,
    pendingSync: false,
    lines: extra.lines ?? [line({ lineTotalUgx: total, netRevenueUgx: total, originalLineTotalUgx: total })],
    ...extra,
  };
}

const product: Product = {
  id: "prod-1",
  name: "Widget",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 6_000,
  stockOnHand: 20,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: `${DAY}T09:00:00.000Z`,
  version: 1,
};

function trio(middle: Partial<Sale> = {}): Sale[] {
  return [sale("sale-first"), sale("sale-middle", middle), sale("sale-last")];
}

describe("POST-AUDIT-05 reports sales fingerprint", () => {
  it("TEST 1 — financially relevant middle-sale mutation changes fingerprint", () => {
    const base = trio();
    const mutatedTotal = trio({ totalUgx: 7_000, cashPaidUgx: 7_000, tenderCashUgx: 7_000 });
    expect(base).toHaveLength(mutatedTotal.length);
    expect(base[0]?.id).toBe(mutatedTotal[0]?.id);
    expect(base[base.length - 1]?.id).toBe(mutatedTotal[mutatedTotal.length - 1]?.id);
    expect(buildSalesFingerprint(base)).not.toBe(buildSalesFingerprint(mutatedTotal));

    const voided = trio({ saleVoidedAt: `${DAY}T11:00:00.000Z` });
    expect(buildSalesFingerprint(base)).not.toBe(buildSalesFingerprint(voided));

    const lineVoid = trio({
      lines: [line({ voided: true, lineTotalUgx: 10_000, netRevenueUgx: 0, estimatedProfitUgx: 0, grossProfitUgx: 0 })],
    });
    expect(buildSalesFingerprint(base)).not.toBe(buildSalesFingerprint(lineVoid));

    const tender = trio({ paymentMethod: "mobile_money", tenderCashUgx: 0 });
    expect(buildSalesFingerprint(base)).not.toBe(buildSalesFingerprint(tender));
  });

  it("TEST 2 — cache recomputes when fingerprint changes after an in-place sale mutation", () => {
    const original = trio();
    const mutated = trio({ totalUgx: 4_000, cashPaidUgx: 4_000, tenderCashUgx: 4_000 });
    const fpOriginal = buildSalesFingerprint(original);
    const fpMutated = buildSalesFingerprint(mutated);
    expect(fpOriginal).not.toBe(fpMutated);

    let computes = 0;
    const key = "post-audit-05-localGetRangeSummary";
    const first = getCachedComputation(key, fpOriginal, () => {
      computes += 1;
      return localGetRangeSummary(original, [product], [], [], [], { kind: "day", dateKey: DAY });
    });
    const reused = getCachedComputation(key, fpOriginal, () => {
      computes += 1;
      return localGetRangeSummary(original, [product], [], [], [], { kind: "day", dateKey: DAY });
    });
    expect(computes).toBe(1);
    expect(reused).toBe(first);

    const next = getCachedComputation(key, fpMutated, () => {
      computes += 1;
      return localGetRangeSummary(mutated, [product], [], [], [], { kind: "day", dateKey: DAY });
    });
    expect(computes).toBe(2);
    expect(next).not.toBe(first);
    expect(next.summary.totalRevenueUgx).not.toBe(first.summary.totalRevenueUgx);
  });

  it("TEST 3 — presentation-only fields do not change the fingerprint", () => {
    const base = trio();
    const presentation = trio({
      pendingSync: true,
      lastSyncError: "timeout",
      updatedAt: `${DAY}T18:00:00.000Z`,
      amountPaidUgx: 50_000,
      changeGivenUgx: 40_000,
      referenceLabel: "Table 4",
      receiptSeq: 99,
      soldByUserId: "staff-other",
      receiptHeaderSnapshot: { lines: ["New Sign"] },
    });
    expect(buildSalesFingerprint(base)).toBe(buildSalesFingerprint(presentation));
  });

  it("TEST 4 — same reporting-relevant sales state yields the same fingerprint", () => {
    const a = trio({ discountTotalUgx: 500, debtUgx: 2_000, cashPaidUgx: 8_000 });
    const b = trio({ discountTotalUgx: 500, debtUgx: 2_000, cashPaidUgx: 8_000 });
    expect(buildSalesFingerprint(a)).toBe(buildSalesFingerprint(b));
    expect(buildSalesFingerprint([])).toBe("0");
    expect(buildSalesFingerprint([])).toBe(buildSalesFingerprint([]));
  });
});
