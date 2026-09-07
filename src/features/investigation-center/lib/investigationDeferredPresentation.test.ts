/**
 * IC-NEW-04 — deferred presentation must not look complete while behind.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditLogEntry, ReturnRecord, Sale } from "../../../types";
import { auditRefundIntegrity } from "../../../lib/auditRefundIntegrity";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import {
  canPresentInvestigationKpis,
  investigationRefundsPresentation,
  investigationTimelineEmptyCopyKey,
  resolveInvestigationDataCompleteness,
} from "./investigationDataCompleteness";
import { computeInvestigationKpis } from "./activityPresentation";
import {
  canPresentRefundIntegrity,
  investigationRefundIntegrityPresentation,
  resolveInvestigationSalesDependentReadiness,
} from "./investigationSalesDependentReadiness";
import {
  investigationDeferredValueCaughtUp,
  resolveInvestigationPresentationDataComplete,
  resolveInvestigationPresentationSalesDependentReady,
} from "./investigationDeferredPresentation";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function entry(id: string): AuditLogEntry {
  return {
    id,
    at: "2026-09-06T10:00:00.000Z",
    actorUserId: "staff-1",
    actorName: "Amina",
    role: "cashier",
    action: "sale_completed",
    payloadSummary: id,
    payload: {},
  };
}

function sale(id: string, total = 5000): Sale {
  return {
    id,
    status: "completed",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    lines: [
      {
        id: `${id}-l1`,
        productId: "p1",
        name: "Soda",
        quantity: 1,
        unitPriceUgx: total,
        lineTotalUgx: total,
        unitCostUgx: 0,
        estimatedProfitUgx: total,
        inputMode: "quantity",
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

function returnRec(id: string, saleId: string, amount: number): ReturnRecord {
  return {
    id,
    saleId,
    productId: "p1",
    productName: "Soda",
    quantity: 1,
    refundAmountUgx: amount,
    reason: "other",
    actorUserId: "staff-1",
    createdAt: "2026-09-06T10:00:00.000Z",
  };
}

describe("IC-NEW-04 deferred presentation readiness", () => {
  it("TEST 1 — authoritative complete / deferred empty is not presented as complete", () => {
    const authoritative = [entry("a1"), entry("a2")];
    const deferred: AuditLogEntry[] = [];
    const hydrationComplete = resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete;
    const dataComplete = resolveInvestigationPresentationDataComplete({
      hydrationComplete,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(authoritative, deferred),
    });
    expect(hydrationComplete).toBe(true);
    expect(dataComplete).toBe(false);
    expect(canPresentInvestigationKpis(dataComplete)).toBe(false);
    expect(investigationTimelineEmptyCopyKey(dataComplete)).toBe("icActivityLoading");
    expect(investigationRefundsPresentation(dataComplete)).toBe("loading");
  });

  it("TEST 2 — authoritative complete / deferred partial is not final", () => {
    const authoritative = [entry("a1"), entry("a2"), entry("a3")];
    const deferred = authoritative.slice(0, 1);
    const dataComplete = resolveInvestigationPresentationDataComplete({
      hydrationComplete: true,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(authoritative, deferred),
    });
    expect(dataComplete).toBe(false);
    expect(canPresentInvestigationKpis(dataComplete)).toBe(false);
    expect(deferred).not.toHaveLength(authoritative.length);
  });

  it("TEST 3 — deferred caught up presents complete data", () => {
    const authoritative = [entry("a1"), entry("a2")];
    const deferred = authoritative;
    const dataComplete = resolveInvestigationPresentationDataComplete({
      hydrationComplete: true,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(authoritative, deferred),
    });
    expect(dataComplete).toBe(true);
    expect(canPresentInvestigationKpis(dataComplete)).toBe(true);
    expect(investigationTimelineEmptyCopyKey(dataComplete)).toBe("auditEmpty");
  });

  it("TEST 4 — genuine empty complete dataset is a valid empty state", () => {
    const empty: AuditLogEntry[] = [];
    const dataComplete = resolveInvestigationPresentationDataComplete({
      hydrationComplete: true,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(empty, empty),
    });
    expect(dataComplete).toBe(true);
    expect(investigationTimelineEmptyCopyKey(dataComplete)).toBe("auditEmpty");
    expect(investigationRefundsPresentation(dataComplete)).toBe("ready");
  });

  it("TEST 5 — a stale deferred source is not complete for a new include-archived/date dataset", () => {
    const previousRange = [entry("old-1")];
    const nextRange = [entry("new-1"), entry("new-2")];
    const dataComplete = resolveInvestigationPresentationDataComplete({
      hydrationComplete: true,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(nextRange, previousRange),
    });
    expect(dataComplete).toBe(false);
    expect(canPresentInvestigationKpis(dataComplete)).toBe(false);
  });

  it("TEST 6 — sales-dependent readiness stays false until sales are synchronized", () => {
    const authoritative = [sale("s1"), sale("s2")];
    const deferred: Sale[] = [];
    expect(resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: false }).salesDependentReady).toBe(
      true,
    );
    const salesDependentReady = resolveInvestigationPresentationSalesDependentReady({
      salesHistoryHydrationActive: false,
      salesCaughtUp: investigationDeferredValueCaughtUp(authoritative, deferred),
    });
    expect(salesDependentReady).toBe(false);
    expect(canPresentRefundIntegrity(salesDependentReady)).toBe(false);
    expect(
      resolveInvestigationPresentationSalesDependentReady({
        salesHistoryHydrationActive: true,
        salesCaughtUp: true,
      }),
    ).toBe(false);
  });

  it("TEST 7 — stale sales/returns cannot present a false integrity OK", () => {
    const liveSales = [sale("s1", 1000)];
    const staleSales: Sale[] = [];
    const returns = [returnRec("r1", "s1", 5000)];
    const staleReport = auditRefundIntegrity({ sales: staleSales, returnRecords: returns });
    const liveReport = auditRefundIntegrity({ sales: liveSales, returnRecords: returns });
    expect(staleReport.ok).toBe(true);
    expect(liveReport.ok).toBe(false);

    const salesDependentReady = resolveInvestigationPresentationSalesDependentReady({
      salesHistoryHydrationActive: false,
      salesCaughtUp: investigationDeferredValueCaughtUp(liveSales, staleSales),
    });
    expect(salesDependentReady).toBe(false);
    expect(investigationRefundIntegrityPresentation(salesDependentReady)).toBe("loading");
    expect(canPresentRefundIntegrity(salesDependentReady)).toBe(false);
  });

  it("TEST 8 — once synchronized, KPI and integrity calculations are unchanged", () => {
    const logs = [entry("a1"), entry("a2")];
    const sales = [sale("s1", 4000)];
    const returns: ReturnRecord[] = [];
    const ready = resolveInvestigationPresentationDataComplete({
      hydrationComplete: true,
      auditLogsCaughtUp: investigationDeferredValueCaughtUp(logs, logs),
    });
    expect(ready).toBe(true);
    expect(computeInvestigationKpis(buildAuditLogSearchIndex(logs), "2026-09-06", "2026-09-06", 0)).toEqual(
      computeInvestigationKpis(buildAuditLogSearchIndex(logs), "2026-09-06", "2026-09-06", 0),
    );
    expect(auditRefundIntegrity({ sales, returnRecords: returns })).toEqual(
      auditRefundIntegrity({ sales, returnRecords: returns }),
    );
  });
});

describe("IC-NEW-04 production boundary", () => {
  it("IC-P2-04/07 helpers remain hydration-stage and sales-tail only", () => {
    const completenessSrc = src("src/features/investigation-center/lib/investigationDataCompleteness.ts");
    const readinessSrc = src("src/features/investigation-center/lib/investigationSalesDependentReadiness.ts");
    expect(completenessSrc).toContain('dataComplete: input.hydrationStage === "complete"');
    expect(readinessSrc).toContain("salesDependentReady: !input.salesHistoryHydrationActive");
    expect(completenessSrc).not.toContain("useDeferredValue");
    expect(readinessSrc).not.toContain("useDeferredValue");
  });

  it("shell presentation flags wait for deferred catch-up without removing useDeferredValue", () => {
    const storeSrc = src("src/features/investigation-center/EnterpriseInvestigationShell.tsx");
    expect(storeSrc).toContain("useDeferredValue(authoritativeAuditLogs)");
    expect(storeSrc).toContain("useDeferredValue(authoritativeSales)");
    expect(storeSrc).toContain("resolveInvestigationPresentationDataComplete");
    expect(storeSrc).toContain("resolveInvestigationPresentationSalesDependentReady");
    expect(storeSrc).toContain("collectInvestigationReturnsInRange(allReturns, dateFrom, dateTo)");
    expect(storeSrc).toContain("matchingEntries");
  });
});
