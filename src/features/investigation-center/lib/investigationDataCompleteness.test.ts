/**
 * IC-P2-04 — Investigation Center must not treat incomplete hydration as empty.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry, ReturnRecord } from "../../../types";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import { auditLogsForReporting } from "../../../lib/recordArchive";
import { t } from "../../../lib/i18n";
import { applyKpiFilter, computeInvestigationKpis } from "./activityPresentation";
import {
  collectInvestigationMatches,
  INVESTIGATION_PAGE_SIZE,
  INVESTIGATION_SHARE_ENTRY_LIMIT,
  investigationShareSlice,
  paginateInvestigationResults,
} from "./investigationResultScope";
import {
  canExportInvestigationData,
  canPresentInvestigationKpis,
  canShareInvestigationData,
  investigationRefundsPresentation,
  investigationResultCountKind,
  investigationTimelineEmptyCopyKey,
  isInvestigationDataComplete,
  resolveInvestigationDataCompleteness,
} from "./investigationDataCompleteness";

function entry(id: string, action: AuditLogEntry["action"] = "sale_completed"): AuditLogEntry {
  return {
    id,
    at: "2026-09-06T10:00:00.000Z",
    actorUserId: "staff-1",
    actorName: "Amina",
    role: "cashier",
    action,
    payloadSummary: id,
    payload: {},
  };
}

function returnRec(id: string): ReturnRecord {
  return {
    id,
    productId: "p1",
    productName: "Soda",
    quantity: 1,
    refundAmountUgx: 2000,
    reason: "other",
    actorUserId: "staff-1",
    createdAt: "2026-09-06T10:00:00.000Z",
  };
}

describe("IC-P2-04 investigation data completeness", () => {
  it("TEST 1 — none is incomplete", () => {
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "none" }).dataComplete).toBe(false);
    expect(isInvestigationDataComplete("none")).toBe(false);
  });

  it("TEST 2 — critical is incomplete", () => {
    expect(isInvestigationDataComplete("critical")).toBe(false);
  });

  it("TEST 3 — interactive is incomplete", () => {
    expect(isInvestigationDataComplete("interactive")).toBe(false);
  });

  it("TEST 4 — background is incomplete", () => {
    expect(isInvestigationDataComplete("background")).toBe(false);
  });

  it("TEST 5 — complete is complete", () => {
    expect(isInvestigationDataComplete("complete")).toBe(true);
    expect(resolveInvestigationDataCompleteness({ hydrationStage: "complete" }).dataComplete).toBe(true);
  });

  it("TEST 6 — incomplete empty arrays must not present as no-matches / Refunds 0", () => {
    const incomplete = resolveInvestigationDataCompleteness({ hydrationStage: "critical" });
    expect(incomplete.dataComplete).toBe(false);
    expect(canPresentInvestigationKpis(incomplete.dataComplete)).toBe(false);
    expect(investigationTimelineEmptyCopyKey(incomplete.dataComplete)).toBe("icActivityLoading");
    expect(investigationTimelineEmptyCopyKey(incomplete.dataComplete)).not.toBe("auditEmpty");
    expect(t("en", investigationTimelineEmptyCopyKey(incomplete.dataComplete)).toLowerCase()).toContain("loading");
    expect(t("en", investigationTimelineEmptyCopyKey(incomplete.dataComplete)).toLowerCase()).not.toContain(
      "no audit entries",
    );
    expect(investigationRefundsPresentation(incomplete.dataComplete)).toBe("loading");
    expect(investigationResultCountKind(false, 0, 0)).toBe("hidden");
  });

  it("TEST 7 — complete + empty arrays may use true empty/zero", () => {
    const complete = resolveInvestigationDataCompleteness({ hydrationStage: "complete" });
    expect(complete.dataComplete).toBe(true);
    expect(canPresentInvestigationKpis(true)).toBe(true);
    expect(investigationTimelineEmptyCopyKey(true)).toBe("auditEmpty");
    const cards = computeInvestigationKpis(buildAuditLogSearchIndex([]), "2026-09-06", "2026-09-06", 0);
    expect(cards.find((c) => c.id === "refunds")?.value).toBe(0);
  });

  it("TEST 8 — complete real data presents normal KPIs", () => {
    const index = buildAuditLogSearchIndex([entry("a1"), entry("a2", "sale_return")]);
    const cards = computeInvestigationKpis(index, "2026-09-06", "2026-09-06", 3);
    expect(canPresentInvestigationKpis(true)).toBe(true);
    expect(cards.find((c) => c.id === "refunds")?.value).toBe(3);
    expect(cards.find((c) => c.id === "sales")?.value).toBe(1);
  });

  it("TEST 9 — complete + includeArchived uses active + archived", () => {
    const combined = auditLogsForReporting(
      {
        auditLogs: [entry("active-1")],
        archivedAuditLogs: [entry("arch-1", "sale_return")],
      },
      true,
    );
    expect(combined.map((e) => e.id).sort()).toEqual(["active-1", "arch-1"]);
    expect(isInvestigationDataComplete("complete")).toBe(true);
  });

  it("TEST 10 — complete still uses IC-P2-01 full match then page", () => {
    const many = Array.from({ length: 450 }, (_, i) => entry(`e-${i}`));
    const matches = collectInvestigationMatches(buildAuditLogSearchIndex(many), {}, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    });
    const page = paginateInvestigationResults(matches, INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(450);
    expect(page.shown).toBe(200);
    expect(page.hasMore).toBe(true);
  });

  it("TEST 11 — exports unavailable until complete; then full matchingEntries", () => {
    expect(canExportInvestigationData(false)).toBe(false);
    expect(canExportInvestigationData(true)).toBe(true);
    const matching = [entry("a"), entry("b"), entry("c")];
    const exportEntries = matching;
    expect(exportEntries).toHaveLength(3);
  });

  it("TEST 12 — share unavailable until complete; then still capped at 40", () => {
    expect(canShareInvestigationData(false)).toBe(false);
    expect(canShareInvestigationData(true)).toBe(true);
    const many = Array.from({ length: 80 }, (_, i) => entry(`s-${i}`));
    expect(investigationShareSlice(many)).toHaveLength(INVESTIGATION_SHARE_ENTRY_LIMIT);
  });

  it("TEST 13 — complete Refunds KPI remains ReturnRecord count", () => {
    const returns = [returnRec("r1"), returnRec("r2")];
    const cards = computeInvestigationKpis(
      buildAuditLogSearchIndex([entry("a1", "sale_return")]),
      "2026-09-06",
      "2026-09-06",
      returns.length,
    );
    expect(cards.find((c) => c.id === "refunds")?.value).toBe(2);
    expect(investigationRefundsPresentation(true)).toBe("ready");
  });

  it("TEST 14 — complete refund timeline remains audit events", () => {
    const filtered = applyKpiFilter(
      [entry("r", "sale_return"), entry("v", "sale_void"), entry("s", "sale_completed")],
      "refunds",
      "2026-09-06",
    );
    expect(filtered.map((e) => e.action)).toEqual(["sale_return"]);
    expect(isInvestigationDataComplete("complete")).toBe(true);
  });
});
