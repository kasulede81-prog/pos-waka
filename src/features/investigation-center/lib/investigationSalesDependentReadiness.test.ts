/**
 * IC-P2-07 — sales-tail hydration must not present false refund integrity/detail.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditLogEntry, ReturnRecord, Sale } from "../../../types";
import { auditRefundIntegrity } from "../../../lib/auditRefundIntegrity";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import { t } from "../../../lib/i18n";
import { applyKpiFilter, computeInvestigationKpis } from "./activityPresentation";
import {
  collectInvestigationMatches,
  INVESTIGATION_PAGE_SIZE,
  paginateInvestigationResults,
} from "./investigationResultScope";
import {
  isInvestigationDataComplete,
  resolveInvestigationDataCompleteness,
} from "./investigationDataCompleteness";
import {
  canPresentRefundIntegrity,
  investigationRefundIntegrityPresentation,
  investigationRefundTracePresentation,
  resolveInvestigationSalesDependentReadiness,
} from "./investigationSalesDependentReadiness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function sale(id: string, total: number): Sale {
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
        id: "line-1",
        productId: "p1",
        name: "Soda",
        quantity: 1,
        unitPriceUgx: total,
        unitCostUgx: 100,
        lineTotalUgx: total,
        estimatedProfitUgx: total - 100,
        inputMode: "quantity",
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
  };
}

function returnRec(id: string, saleId: string, refund: number): ReturnRecord {
  return {
    id,
    saleId,
    productId: "p1",
    productName: "Soda",
    quantity: 1,
    refundAmountUgx: refund,
    reason: "other",
    actorUserId: "staff-1",
    createdAt: "2026-09-06T11:00:00.000Z",
  };
}

function audit(id: string, action: AuditLogEntry["action"] = "sale_return"): AuditLogEntry {
  return {
    id,
    at: "2026-09-06T11:00:00.000Z",
    actorUserId: "staff-1",
    actorName: "Amina",
    role: "cashier",
    action,
    payloadSummary: id,
    payload: {},
  };
}

describe("IC-P2-07 sales-dependent refund readiness", () => {
  it("TEST 1 — remainder complete + sales tail active does not reopen IC-P2-04", () => {
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
    expect(isInvestigationDataComplete("complete")).toBe(true);
    expect(resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: true }).salesDependentReady).toBe(
      false,
    );
  });

  it("TEST 2 — Refunds KPI stays ReturnRecord-authoritative while sales tail is active", () => {
    const cards = computeInvestigationKpis(
      buildAuditLogSearchIndex([audit("a1", "sale_return")]),
      "2026-09-06",
      "2026-09-06",
      2,
    );
    expect(cards.find((c) => c.id === "refunds")?.value).toBe(2);
    expect(resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: true }).salesDependentReady).toBe(
      false,
    );
  });

  it("TEST 3 — Return records remain ReturnRecord-authoritative while sales tail is active", () => {
    const returns = [returnRec("r1", "missing-sale", 1500)];
    expect(returns[0]?.refundAmountUgx).toBe(1500);
    expect(returns[0]?.productName).toBe("Soda");
    expect(canPresentRefundIntegrity(false)).toBe(false);
  });

  it("TEST 4 — timeline remains audit-authoritative while sales tail is active", () => {
    const filtered = applyKpiFilter([audit("r", "sale_return"), audit("s", "sale_completed")], "refunds", "2026-09-06");
    expect(filtered.map((e) => e.action)).toEqual(["sale_return"]);
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
  });

  it("TEST 5 — sales-dependent integrity/detail must not present a false final result while tail is active", () => {
    const incompleteSales: Sale[] = [];
    const returns = [returnRec("r1", "s1", 999_999)];
    const raw = auditRefundIntegrity({ sales: incompleteSales, returnRecords: returns });
    expect(raw.ok).toBe(true);
    expect(raw.salesScanned).toBe(0);
    expect(investigationRefundIntegrityPresentation(false)).toBe("loading");
    expect(investigationRefundIntegrityPresentation(false)).not.toBe("ready");
    expect(canPresentRefundIntegrity(false)).toBe(false);
    expect(investigationRefundTracePresentation({
      salesDependentReady: false,
      saleId: "s1",
      saleFound: false,
    })).toBe("loading");
    expect(investigationRefundTracePresentation({
      salesDependentReady: false,
      saleId: "s1",
      saleFound: false,
    })).not.toBe("unlinked");
    expect(t("en", "icRefundIntegrityLoading").toLowerCase()).toContain("loading");
    expect(t("en", "icRefundTraceSaleLoading").toLowerCase()).toContain("sales");
  });

  it("TEST 6 — sales-dependent surfaces become ready after sales completion", () => {
    const ready = resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: false });
    expect(ready.salesDependentReady).toBe(true);
    const s = sale("s1", 5000);
    const returns = [returnRec("r1", "s1", 6000)];
    const report = auditRefundIntegrity({ sales: [s], returnRecords: returns });
    expect(canPresentRefundIntegrity(true)).toBe(true);
    expect(investigationRefundIntegrityPresentation(true)).toBe("ready");
    expect(report.ok).toBe(false);
    expect(investigationRefundTracePresentation({
      salesDependentReady: true,
      saleId: "s1",
      saleFound: true,
    })).toBe("ready");
  });

  it("TEST 7 — ensureAllActiveSalesLoaded remains the reporting sales loader", () => {
    const hook = src("src/hooks/useReportingSales.ts");
    expect(hook).toContain("ensureAllActiveSalesLoaded");
    expect(hook).toContain("void ensureAllActiveSalesLoaded()");
  });

  it("TEST 8 — useDeferredValue is not treated as a hydration failure", () => {
    const deferred = src("src/hooks/useDeferredReportingSales.ts");
    expect(deferred).toContain("useDeferredValue");
    expect(resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: false }).salesDependentReady).toBe(
      true,
    );
  });

  it("TEST 9 — closed-day / historical ReturnRecord amounts stay authoritative", () => {
    const rec = returnRec("r-closed", "sale-closed", 2500);
    expect(rec.refundAmountUgx).toBe(2500);
    expect(investigationRefundTracePresentation({
      salesDependentReady: true,
      saleId: rec.saleId,
      saleFound: false,
    })).toBe("unlinked");
  });

  it("TEST 10 — archived-audit IC-P2-03/05 identity is unchanged by this helper", () => {
    expect(isInvestigationDataComplete("complete")).toBe(true);
    expect(resolveInvestigationSalesDependentReadiness({ salesHistoryHydrationActive: true }).salesDependentReady).toBe(
      false,
    );
  });

  it("TEST 11 — IC-P2-01 result scope remains full-match then page", () => {
    const many = Array.from({ length: 250 }, (_, i) => audit(`e-${i}`, "sale_completed"));
    const matches = collectInvestigationMatches(buildAuditLogSearchIndex(many), {}, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    });
    const page = paginateInvestigationResults(matches, INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(250);
    expect(page.shown).toBe(200);
  });

  it("TEST 12 — IC-P2-02 refund authority remains dual", () => {
    const cards = computeInvestigationKpis(buildAuditLogSearchIndex([audit("r", "sale_return")]), "2026-09-06", "2026-09-06", 4);
    expect(cards.find((c) => c.id === "refunds")?.value).toBe(4);
    expect(applyKpiFilter([audit("r", "sale_return")], "refunds", "2026-09-06")).toHaveLength(1);
  });

  it("TEST 13 — IC-P2-04 remainder stages stay incomplete until complete", () => {
    expect(isInvestigationDataComplete("none")).toBe(false);
    expect(isInvestigationDataComplete("critical")).toBe(false);
    expect(isInvestigationDataComplete("interactive")).toBe(false);
    expect(isInvestigationDataComplete("background")).toBe(false);
    expect(isInvestigationDataComplete("complete")).toBe(true);
  });

  it("TEST 14 — IC-P2-04 helper still ignores salesHistoryHydration", () => {
    const helper = src("src/features/investigation-center/lib/investigationDataCompleteness.ts");
    expect(helper).not.toContain("salesHistoryHydration");
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
  });

  it("true unlinked return stays unlinked after sales are ready", () => {
    expect(investigationRefundTracePresentation({
      salesDependentReady: true,
      saleId: "",
      saleFound: false,
    })).toBe("unlinked");
  });
});
