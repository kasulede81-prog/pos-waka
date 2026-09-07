/**
 * IC-P2-01 — honest investigation result totals vs bounded display.
 * Filter all → count all → slice for presentation. Export uses the full match set.
 */
import type { AuditLogEntry, Language, Product, Customer, ReturnRecord, Supplier } from "../../../types";
import { dateKeyKampala } from "../../../lib/datesUg";
import {
  AUDIT_FILTER_RESULT_LIMIT,
  filterAuditLogsIndexed,
  groupAuditByStaff,
  type AuditLogSearchIndex,
  type AuditSearchFilters,
} from "../../../lib/auditSearch";
import type { InvestigationCategory, InvestigationKpiId } from "../types";
import { applyKpiFilter, matchesCategory, shouldHideFromInvestigationCenter } from "./activityPresentation";

export const INVESTIGATION_PAGE_SIZE = AUDIT_FILTER_RESULT_LIMIT;
export const INVESTIGATION_RETURNS_PAGE_SIZE = 25;
export const INVESTIGATION_INTEGRITY_PAGE_SIZE = 8;
export const INVESTIGATION_SHIFTS_PAGE_SIZE = 10;
export const INVESTIGATION_SHARE_ENTRY_LIMIT = 40;

export type InvestigationResultPage<T = AuditLogEntry> = {
  displayed: T[];
  total: number;
  shown: number;
  hasMore: boolean;
};

export type InvestigationPresentationFilters = {
  category: InvestigationCategory;
  activeKpi: InvestigationKpiId | null;
  todayKey: string;
};

export function applyInvestigationResultFilters(
  entries: AuditLogEntry[],
  presentation: InvestigationPresentationFilters,
): AuditLogEntry[] {
  let rows = entries.filter((entry) => !shouldHideFromInvestigationCenter(entry));
  rows = rows.filter((entry) => matchesCategory(entry, presentation.category));
  return applyKpiFilter(rows, presentation.activeKpi, presentation.todayKey);
}

/** Full matching set after search + hide/category/KPI. This is the count and export authority. */
export function collectInvestigationMatches(
  index: AuditLogSearchIndex,
  searchFilters: AuditSearchFilters,
  presentation: InvestigationPresentationFilters,
  ctx?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
    lang?: Language;
  },
): AuditLogEntry[] {
  const base = filterAuditLogsIndexed(index, searchFilters, ctx, Number.MAX_SAFE_INTEGER);
  return applyInvestigationResultFilters(base, presentation);
}

export function paginateInvestigationResults<T>(
  matching: readonly T[],
  visibleCount: number,
): InvestigationResultPage<T> {
  const total = matching.length;
  const shown = total === 0 ? 0 : Math.min(Math.max(visibleCount, 0), total);
  return {
    displayed: matching.slice(0, shown),
    total,
    shown,
    hasMore: shown < total,
  };
}

/** Staff groups from the complete matching set — never from a timeline presentation page. */
export function collectInvestigationStaffGroups(matchingEntries: readonly AuditLogEntry[]) {
  return groupAuditByStaff(matchingEntries as AuditLogEntry[]);
}

/** Date-scoped shifts. Presentation slice happens after this. */
export function collectInvestigationShiftsInRange<T extends { startAt: string }>(
  shifts: readonly T[],
  dateFrom: string,
  dateTo: string,
): T[] {
  return shifts.filter((s) => {
    const key = dateKeyKampala(s.startAt);
    return key >= dateFrom && key <= dateTo;
  });
}

/** Date-scoped Return Records, newest first. Presentation slice happens after this. */
export function collectInvestigationReturnsInRange(
  records: readonly ReturnRecord[],
  dateFrom: string,
  dateTo: string,
): ReturnRecord[] {
  return records
    .filter((r) => {
      const key = dateKeyKampala(r.createdAt);
      return key >= dateFrom && key <= dateTo;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function nextInvestigationVisibleCount(
  currentVisible: number,
  total: number,
  pageSize: number = INVESTIGATION_PAGE_SIZE,
): number {
  if (total <= 0) return pageSize;
  return Math.min(Math.max(currentVisible, 0) + pageSize, total);
}

export function resetInvestigationVisibleCount(pageSize: number = INVESTIGATION_PAGE_SIZE): number {
  return pageSize;
}

export function investigationResultScopeKey(input: {
  dateFrom: string;
  dateTo: string;
  actorUserId: string;
  action: string;
  productId: string;
  customerId: string;
  supplierId: string;
  searchText: string;
  category: string;
  activeKpi: string | null;
  includeArchived: boolean;
}): string {
  return [
    input.dateFrom,
    input.dateTo,
    input.actorUserId,
    input.action,
    input.productId,
    input.customerId,
    input.supplierId,
    input.searchText,
    input.category,
    input.activeKpi ?? "",
    input.includeArchived ? "1" : "0",
  ].join("|");
}

export function investigationShareSlice<T>(entries: T[], limit: number = INVESTIGATION_SHARE_ENTRY_LIMIT): T[] {
  return entries.slice(0, limit);
}
