/**
 * IC-P2-02 — Refunds KPI and refund timeline are two legitimate authorities.
 * This module documents that split. It does not change counts, filters, or writers.
 */
import type { InvestigationCategory, InvestigationKpiId } from "../types";

export function investigationRefundsKpiUsesReturnRecords(): boolean {
  return true;
}

export function investigationRefundsTimelineUsesAuditEvents(): boolean {
  return true;
}

export function investigationRefundsKpiLabelKey(): string {
  return "icKpiRefunds";
}

export function investigationRefundsKpiHintKey(): string {
  return "icKpiRefundsHint";
}

export function investigationRefundsTimelineHintKey(): string {
  return "icRefundsTimelineHint";
}

export function investigationRefundsTabHintKey(): string {
  return "icRefundsTabAuthorityHint";
}

/** Timeline is showing refund-related audit events that must not be read as the KPI. */
export function shouldShowInvestigationRefundsTimelineHint(
  activeKpi: InvestigationKpiId | null,
  category: InvestigationCategory,
): boolean {
  return activeKpi === "refunds" || category === "refunds" || category === "returns";
}
