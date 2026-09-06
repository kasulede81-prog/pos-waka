/**
 * IC-P2-02 — Refunds KPI (ReturnRecords) vs refund timeline (audit events).
 * Honesty only: authorities stay split; copy must not treat them as one number.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../../types";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import { t } from "../../../lib/i18n";
import { applyKpiFilter, computeInvestigationKpis } from "./activityPresentation";
import { resolveKpiTabTarget } from "../registry/investigationCatalog";
import { collectInvestigationMatches } from "./investigationResultScope";
import {
  investigationRefundsKpiHintKey,
  investigationRefundsKpiLabelKey,
  investigationRefundsKpiUsesReturnRecords,
  investigationRefundsTabHintKey,
  investigationRefundsTimelineHintKey,
  investigationRefundsTimelineUsesAuditEvents,
  shouldShowInvestigationRefundsTimelineHint,
} from "./investigationRefundAuthority";

function entry(partial: Partial<AuditLogEntry> & Pick<AuditLogEntry, "id" | "action">): AuditLogEntry {
  return {
    at: "2026-09-06T10:00:00.000Z",
    actorUserId: "staff-1",
    actorName: "Amina",
    role: "cashier",
    payloadSummary: "test",
    payload: {},
    ...partial,
  };
}

describe("IC-P2-02 investigation refund authority honesty", () => {
  it("keeps ReturnRecord KPI authority separate from audit timeline authority", () => {
    expect(investigationRefundsKpiUsesReturnRecords()).toBe(true);
    expect(investigationRefundsTimelineUsesAuditEvents()).toBe(true);
    expect(resolveKpiTabTarget("refunds")).toBe("refunds");
  });

  it("KPI value is the injected ReturnRecord count, not sale_return audit count", () => {
    const index = buildAuditLogSearchIndex([
      entry({ id: "a1", action: "sale_return" }),
      entry({ id: "a2", action: "sale_return" }),
      entry({ id: "a3", action: "sale_completed" }),
    ]);
    const cards = computeInvestigationKpis(index, "2026-09-06", "2026-09-06", 5);
    const refunds = cards.find((c) => c.id === "refunds");
    expect(refunds?.value).toBe(5);
    expect(refunds?.labelKey).toBe(investigationRefundsKpiLabelKey());
    expect(refunds?.hintKey).toBe(investigationRefundsKpiHintKey());
  });

  it("refunds KPI filter and category keep audit sale_return / sale_refund only", () => {
    const rows = [
      entry({ id: "r", action: "sale_return" }),
      entry({ id: "f", action: "sale_refund" }),
      entry({ id: "v", action: "sale_void" }),
      entry({ id: "s", action: "sale_completed" }),
    ];
    const filtered = applyKpiFilter(rows, "refunds", "2026-09-06");
    expect(filtered.map((e) => e.action)).toEqual(["sale_return", "sale_refund"]);

    const matches = collectInvestigationMatches(
      buildAuditLogSearchIndex(rows),
      { dateFrom: "2026-09-06", dateTo: "2026-09-06", actorUserId: "all", action: "all", searchText: "" },
      { category: "all", activeKpi: "refunds", todayKey: "2026-09-06" },
    );
    expect(matches.map((e) => e.action).sort()).toEqual(["sale_refund", "sale_return"]);
  });

  it("timeline honesty hint appears for refunds KPI or refund/return categories", () => {
    expect(shouldShowInvestigationRefundsTimelineHint("refunds", "all")).toBe(true);
    expect(shouldShowInvestigationRefundsTimelineHint(null, "refunds")).toBe(true);
    expect(shouldShowInvestigationRefundsTimelineHint(null, "returns")).toBe(true);
    expect(shouldShowInvestigationRefundsTimelineHint("sales", "sales")).toBe(false);
    expect(shouldShowInvestigationRefundsTimelineHint(null, "all")).toBe(false);
  });

  it("copy distinguishes return records from refund audit events", () => {
    const kpi = t("en", investigationRefundsKpiLabelKey()).toLowerCase();
    const hint = t("en", investigationRefundsKpiHintKey()).toLowerCase();
    const timeline = t("en", investigationRefundsTimelineHintKey()).toLowerCase();
    const tab = t("en", investigationRefundsTabHintKey()).toLowerCase();
    expect(kpi).toContain("return record");
    expect(hint).toContain("return record");
    expect(hint).toContain("audit");
    expect(timeline).toContain("audit");
    expect(timeline).toContain("return record");
    expect(tab).toContain("return record");
    expect(tab).toContain("audit");
  });
});
