import { describe, expect, it } from "vitest";
import type { AuditLogEntry, DayCloseSummary, Sale, SaleLine } from "../types";
import {
  completedSaleAdjustmentRank,
  mergeSaleFromCloudPull,
  pickAuthoritativeCompletedFinancial,
} from "./saleFinancialMerge";
import { activeDayCloseForDate, canRecordDayClose } from "./dayCloseIdempotency";
import { validateDraftDiscount } from "./discountGovernance";
import { buildArchiveForensicSummary } from "./archiveForensics";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import {
  evaluateDebtIntegrityStatus,
  evaluateInventoryIntegrityStatus,
  evaluateSyncQueueStatus,
  runProductionReadinessSelfTest,
} from "./productionReadiness";
import { createDefaultPreferences } from "../data/defaultSeed";
import { processCloudSyncOperation } from "../offline/cloudSync";

const DAY = "2026-05-31";

function line(total: number, voided = false): SaleLine {
  return {
    id: "line-1",
    productId: "p1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 100,
    estimatedProfitUgx: total - 100,
    inputMode: "quantity",
    updatedAt: `${DAY}T10:00:00.000Z`,
    lineTotalUgx: total,
    voided,
    voidedAt: voided ? `${DAY}T11:00:00.000Z` : null,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  return {
    id: "sale-1",
    status: "completed",
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.subtotalUgx ?? partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    lines: partial.lines ?? [line(partial.totalUgx)],
    estimatedProfitUgx: partial.totalUgx,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("H1 completed sale merge", () => {
  it("device A return-adjusted beats device B stale full total", () => {
    const adjusted = sale({ totalUgx: 40_000, cashPaidUgx: 40_000, subtotalUgx: 100_000 });
    const stale = sale({ totalUgx: 100_000, cashPaidUgx: 100_000, updatedAt: `${DAY}T20:00:00.000Z` });
    expect(pickAuthoritativeCompletedFinancial(stale, adjusted)).toBe(adjusted);
    const merged = mergeSaleFromCloudPull(adjusted, stale);
    expect(merged.totalUgx).toBe(40_000);
  });

  it("device A void-adjusted beats device B stale sale", () => {
    const voided = sale({
      totalUgx: 50_000,
      cashPaidUgx: 50_000,
      voidedTotalUgx: 50_000,
      subtotalUgx: 100_000,
      updatedAt: `${DAY}T11:00:00.000Z`,
    });
    const stale = sale({ totalUgx: 100_000, updatedAt: `${DAY}T19:00:00.000Z` });
    expect(completedSaleAdjustmentRank(voided)[0]).toBeGreaterThan(completedSaleAdjustmentRank(stale)[0]);
    expect(mergeSaleFromCloudPull(voided, stale).totalUgx).toBe(50_000);
  });

  it("multi-device replay: lowest adjusted total wins regardless of order", () => {
    const a = sale({ totalUgx: 70_000, voidedTotalUgx: 30_000, subtotalUgx: 100_000 });
    const b = sale({ totalUgx: 100_000, updatedAt: `${DAY}T18:00:00.000Z` });
    const c = sale({ totalUgx: 60_000, voidedTotalUgx: 40_000, subtotalUgx: 100_000 });
    const ab = mergeSaleFromCloudPull(a, b);
    const abc = mergeSaleFromCloudPull(ab, c);
    expect(abc.totalUgx).toBe(60_000);
    const cb = mergeSaleFromCloudPull(c, b);
    const cba = mergeSaleFromCloudPull(cb, a);
    expect(cba.totalUgx).toBe(60_000);
  });
});

describe("H3 day close idempotency", () => {
  const close: DayCloseSummary = {
    id: "c1",
    dateKey: DAY,
    expectedCashUgx: 100,
    countedCashUgx: 100,
    differenceUgx: 0,
    totalSalesUgx: 100,
    totalDebtUgx: 0,
    profitEstimateUgx: 10,
    createdAt: `${DAY}T22:00:00.000Z`,
  };

  it("blocks duplicate close for same day", () => {
    expect(canRecordDayClose([close], DAY)).toEqual({ ok: false, errorKey: "dayCloseAlreadyExists" });
    expect(activeDayCloseForDate([close], DAY)?.id).toBe("c1");
  });

  it("allows override and preserves superseded history", () => {
    expect(canRecordDayClose([close], DAY, true)).toEqual({ ok: true });
    const superseded = { ...close, supersededAt: `${DAY}T23:00:00.000Z` };
    const replacement: DayCloseSummary = {
      ...close,
      id: "c2",
      countedCashUgx: 90,
      differenceUgx: -10,
      replacesCloseId: close.id,
      overrideReason: "Recount",
      createdAt: `${DAY}T23:05:00.000Z`,
    };
    const all = [replacement, superseded];
    expect(activeDayCloseForDate(all, DAY)?.id).toBe("c2");
    expect(all.filter((d) => d.dateKey === DAY)).toHaveLength(2);
  });
});

describe("M1 discount governance", () => {
  const base = createDefaultPreferences();
  const prefs = { ...base, discountControlMode: "max_percent" as const, discountMaxPercentThreshold: 10 };

  it("unrestricted allows large discounts", () => {
    const r = validateDraftDiscount({
      prefs: { ...base, discountControlMode: "unrestricted" },
      role: "cashier",
      discountUgx: 50_000,
      lineSubtotalUgx: 100_000,
    });
    expect(r.ok).toBe(true);
  });

  it("max_percent blocks cashier over threshold", () => {
    const r = validateDraftDiscount({
      prefs,
      role: "cashier",
      discountUgx: 20_000,
      lineSubtotalUgx: 100_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorKey).toBe("discountExceedsMaxPercent");
  });

  it("manager_approval allows owner over threshold", () => {
    const r = validateDraftDiscount({
      prefs: { ...base, discountControlMode: "manager_approval", discountMaxPercentThreshold: 5 },
      role: "owner",
      discountUgx: 20_000,
      lineSubtotalUgx: 100_000,
    });
    expect(r.ok).toBe(true);
  });
});

describe("M2 sync unknown operation", () => {
  it("does not silently succeed for unknown kind", async () => {
    const ok = await processCloudSyncOperation({
      id: "op-unknown",
      kind: "not_a_real_kind" as "sale",
      payload: { marker: true },
      createdAt: `${DAY}T12:00:00.000Z`,
      attempts: 0,
    });
    expect(ok).toBe(false);
  });
});

describe("M3 archive forensics", () => {
  it("summarizes counts and archive age before purge", () => {
    const summary = buildArchiveForensicSummary({
      archivedSales: [sale({ totalUgx: 1000 })],
      archivedReturnRecords: [],
      archivedVoidRecords: [],
      archivedAuditLogs: [
        {
          id: "a1",
          at: "2020-01-01T00:00:00.000Z",
          actorUserId: "u",
          role: "owner",
          action: "sale_completed",
          payloadSummary: "x",
          payload: {},
        } as AuditLogEntry,
      ],
      lastArchiveRunAt: "2020-06-01T00:00:00.000Z",
      now: new Date("2026-05-31T12:00:00.000Z"),
    });
    expect(summary.salesCount).toBe(1);
    expect(summary.auditCount).toBe(1);
    expect(summary.archiveAgeDays).not.toBeNull();
  });
});

describe("H2 debt integrity visibility", () => {
  it("reports fail when stored debt diverges", () => {
    const customer = {
      id: "cust-1",
      name: "A",
      phone: "",
      location: "",
      debtBalanceUgx: 9_000,
      createdAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    };
    const credit = sale({ totalUgx: 10_000, debtUgx: 10_000, customerId: customer.id });
    const check = evaluateDebtIntegrityStatus([customer], [credit], []);
    expect(check.status).toBe("fail");
    const healed = verifyCustomerDebtIntegrity([customer], [credit], [], { heal: true });
    expect(healed.healedCount).toBe(1);
    expect(healed.customers[0]!.debtBalanceUgx).toBe(10_000);
  });
});

describe("certification gate", () => {
  it("fails when required checks fail", async () => {
    const report = await runProductionReadinessSelfTest({
      customers: [
        {
          id: "cust-1",
          name: "A",
          phone: "",
          location: "",
          debtBalanceUgx: 1_000,
          createdAt: `${DAY}T08:00:00.000Z`,
          version: 1,
        },
      ],
      sales: [sale({ totalUgx: 10_000, debtUgx: 10_000, customerId: "cust-1" })],
      debtPayments: [],
      products: [],
      stockMovements: [],
      auditLogs: [],
      syncQueue: [],
    });
    expect(report.certificationState).toBe("FAIL");
    expect(report.releaseChecklist.some((item) => item.required && !item.passed)).toBe(true);
  });

  it("stays warning when only non-required queue warning exists", () => {
    const check = evaluateSyncQueueStatus(
      Array.from({ length: 60 }, (_, i) => ({
        id: `q-${i}`,
        kind: "sale" as const,
        payload: {},
        createdAt: `${DAY}T12:00:00.000Z`,
        attempts: 0,
      })),
    );
    expect(check.status).toBe("warning");
  });
});

describe("inventory gate severity", () => {
  it("marks inventory mismatch as fail", () => {
    const check = evaluateInventoryIntegrityStatus({
      products: [
        {
          id: "p1",
          name: "Item",
          sellingMode: "unit",
          baseUnit: "ea",
          buyingUnit: null,
          conversionRate: null,
          sellingPricePerUnitUgx: 1000,
          costPricePerUnitUgx: 500,
          stockOnHand: 12,
          minimumStockAlert: 2,
          category: "General",
          sku: "",
          updatedAt: `${DAY}T09:00:00.000Z`,
          version: 1,
        },
      ],
      stockMovements: [
        {
          id: "m-inv",
          at: `${DAY}T08:00:00.000Z`,
          productId: "p1",
          productName: "Item",
          deltaBaseUnits: 5,
          kind: "purchase_in",
          summary: "restock",
        },
      ],
    });
    expect(check.status).toBe("fail");
  });
});

describe("sync queue readiness", () => {
  it("warns when queue is large", () => {
    const queue = Array.from({ length: 60 }, (_, i) => ({
      id: `q-${i}`,
      kind: "sale" as const,
      payload: {},
      createdAt: `${DAY}T12:00:00.000Z`,
      attempts: 0,
    }));
    expect(evaluateSyncQueueStatus(queue).status).toBe("warning");
  });
});
