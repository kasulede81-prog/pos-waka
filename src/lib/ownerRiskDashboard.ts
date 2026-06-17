import type { AuditLogEntry, ReturnRecord, VoidRecord } from "../types";
import type { AuditSearchFilters } from "./auditSearch";
import { actorDisplayLabel } from "./activityNarrative";
import type { Language } from "../types";
import { t } from "./i18n";

/** Individual discount audit events at or above this UGX count as "large". */
export const LARGE_DISCOUNT_UGX_THRESHOLD = 10_000;

export type OwnerRiskCardKind =
  | "product_deletions"
  | "price_changes"
  | "large_discounts"
  | "returns"
  | "voids"
  | "expenses"
  | "back_office_failed"
  | "stock_adjustments";

export type OwnerRiskCard = {
  kind: OwnerRiskCardKind;
  count: number;
  impactUgx: number;
  staffLabels: string[];
  auditFilter: Partial<AuditSearchFilters>;
};

function staffLabel(e: AuditLogEntry, lang: Language): string {
  return e.actorName?.trim() || actorDisplayLabel(e.actorUserId, lang);
}

function uniqueStaff(entries: AuditLogEntry[], lang: Language, limit = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    const label = staffLabel(e, lang);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

function num(pl: Record<string, unknown>, key: string): number {
  const v = pl[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

export function buildOwnerRiskCards(input: {
  lang: Language;
  todayKey: string;
  todayAuditLogs: AuditLogEntry[];
  todayReturns: ReturnRecord[];
  todayVoids: VoidRecord[];
}): OwnerRiskCard[] {
  const { lang, todayKey, todayAuditLogs, todayReturns, todayVoids } = input;

  const deletions = todayAuditLogs.filter((e) => e.action === "product_remove");
  const priceChanges = todayAuditLogs.filter((e) => e.action === "price_change");
  const largeDiscounts = todayAuditLogs.filter((e) => {
    if (e.action !== "discount_given") return false;
    return num(e.payload, "discountUgx") >= LARGE_DISCOUNT_UGX_THRESHOLD;
  });
  const stockAdjusts = todayAuditLogs.filter((e) => e.action === "stock_adjust");
  const expenses = todayAuditLogs.filter(
    (e) =>
      e.action === "cash_expense_created" ||
      e.action === "cash_expense_approved" ||
      e.action === "cash_expense_voided",
  );
  const unlockFailed = todayAuditLogs.filter((e) => e.action === "back_office_unlock_failed");

  const returnsImpact = todayReturns.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0);
  const voidsImpact = todayVoids.reduce((a, v) => a + Math.max(0, v.amountUgx), 0);
  const discountImpact = largeDiscounts.reduce((a, e) => a + num(e.payload, "discountUgx"), 0);
  const expenseImpact = expenses.reduce((a, e) => a + num(e.payload, "amountUgx"), 0);

  const returnStaff = [...new Set(todayReturns.map((r) => r.actorUserId).filter(Boolean))].slice(0, 3);

  const cards: OwnerRiskCard[] = [
    {
      kind: "product_deletions",
      count: deletions.length,
      impactUgx: 0,
      staffLabels: uniqueStaff(deletions, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "product_remove" },
    },
    {
      kind: "price_changes",
      count: priceChanges.length,
      impactUgx: 0,
      staffLabels: uniqueStaff(priceChanges, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "price_change" },
    },
    {
      kind: "large_discounts",
      count: largeDiscounts.length,
      impactUgx: discountImpact,
      staffLabels: uniqueStaff(largeDiscounts, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "discount_given" },
    },
    {
      kind: "returns",
      count: todayReturns.length,
      impactUgx: returnsImpact,
      staffLabels: returnStaff.length ? returnStaff : uniqueStaff(todayAuditLogs.filter((e) => e.action === "sale_return"), lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "sale_return" },
    },
    {
      kind: "voids",
      count: todayVoids.length,
      impactUgx: voidsImpact,
      staffLabels: uniqueStaff(todayAuditLogs.filter((e) => e.action === "sale_void"), lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "sale_void" },
    },
    {
      kind: "expenses",
      count: expenses.length,
      impactUgx: expenseImpact,
      staffLabels: uniqueStaff(expenses, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "cash_expense_created" },
    },
    {
      kind: "back_office_failed",
      count: unlockFailed.length,
      impactUgx: 0,
      staffLabels: uniqueStaff(unlockFailed, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "back_office_unlock_failed" },
    },
    {
      kind: "stock_adjustments",
      count: stockAdjusts.length,
      impactUgx: 0,
      staffLabels: uniqueStaff(stockAdjusts, lang),
      auditFilter: { dateFrom: todayKey, dateTo: todayKey, action: "stock_adjust" },
    },
  ];

  return cards.filter((c) => c.count > 0);
}

export function sumOwnerRiskCardCounts(cards: OwnerRiskCard[]): number {
  return cards.reduce((sum, c) => sum + c.count, 0);
}

function payloadNum(pl: Record<string, unknown>, key: string): number {
  const v = pl[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function isRiskAuditEntry(entry: AuditLogEntry): boolean {
  switch (entry.action) {
    case "product_remove":
    case "price_change":
    case "stock_adjust":
    case "back_office_unlock_failed":
    case "cash_expense_created":
    case "cash_expense_approved":
    case "cash_expense_voided":
      return true;
    case "discount_given":
      return payloadNum(entry.payload, "discountUgx") >= LARGE_DISCOUNT_UGX_THRESHOLD;
    default:
      return false;
  }
}

/** Risk events after the owner last opened Investigation. */
export function countUnseenOwnerRiskEvents(input: {
  todayAuditLogs: AuditLogEntry[];
  todayReturns: ReturnRecord[];
  todayVoids: VoidRecord[];
  reviewedAt?: string | null;
}): number {
  const reviewedMs = input.reviewedAt ? Date.parse(input.reviewedAt) : Number.NaN;
  if (!Number.isFinite(reviewedMs)) {
    return (
      input.todayAuditLogs.filter(isRiskAuditEntry).length +
      input.todayReturns.length +
      input.todayVoids.length
    );
  }

  let count = 0;
  for (const entry of input.todayAuditLogs) {
    if (!isRiskAuditEntry(entry)) continue;
    if (Date.parse(entry.at) > reviewedMs) count += 1;
  }
  for (const record of input.todayReturns) {
    if (Date.parse(record.createdAt) > reviewedMs) count += 1;
  }
  for (const record of input.todayVoids) {
    if (Date.parse(record.createdAt) > reviewedMs) count += 1;
  }
  return count;
}

const RISK_TITLE_KEYS: Record<OwnerRiskCardKind, Parameters<typeof t>[1]> = {
  product_deletions: "ownerRiskProductDeletions",
  price_changes: "ownerRiskPriceChanges",
  large_discounts: "ownerRiskLargeDiscounts",
  returns: "ownerRiskReturns",
  voids: "ownerRiskVoids",
  expenses: "ownerRiskExpenses",
  back_office_failed: "ownerRiskBackOfficeFailed",
  stock_adjustments: "ownerRiskStockAdjustments",
};

export function ownerRiskCardTitle(lang: Language, kind: OwnerRiskCardKind): string {
  return t(lang, RISK_TITLE_KEYS[kind]);
}

export function auditCenterLinkFromFilter(filter: Partial<AuditSearchFilters>): string {
  const params = new URLSearchParams();
  if (filter.dateFrom) params.set("from", filter.dateFrom);
  if (filter.dateTo) params.set("to", filter.dateTo);
  if (filter.action && filter.action !== "all") params.set("action", filter.action);
  if (filter.actorUserId && filter.actorUserId !== "all") params.set("staff", filter.actorUserId);
  if (filter.searchText) params.set("q", filter.searchText);
  const qs = params.toString();
  return qs ? `/office/audit-center?${qs}` : "/office/audit-center";
}
