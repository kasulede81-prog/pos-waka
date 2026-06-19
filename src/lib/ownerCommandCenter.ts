/**
 * Owner command center — surfaces existing store data (no new ledger math).
 */

import type {
  AuditLogEntry,
  CashDrawerAdjustment,
  Customer,
  DayCloseSummary,
  DayDrawerOpen,
  InventoryCountSession,
  Language,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  Supplier,
  VoidRecord,
} from "../types";
import { actorDisplayLabel } from "./activityNarrative";
import { dateKeyKampala } from "./datesUg";
import {
  dateMatchesFilter,
  type DateFilterBounds,
  revenueSalesInBounds,
  returnsInBounds,
} from "./dateFilters";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";
import { collectDayDrawerOpenDiagnostics } from "./dayDrawerOpenDiagnostics";
import { sumDebtPaymentsInBounds } from "./customerDebtActivity";
import { isLowStock } from "./sellingEngine";
import { buildInventoryCountVarianceReport } from "./inventoryCount";
import type { OwnerAlert } from "./ownerAlerts";
import {
  auditCenterLinkFromFilter,
  ownerRiskCardTitle,
  type OwnerRiskCard,
} from "./ownerRiskDashboard";
import {
  evaluateDebtIntegrityStatus,
  evaluateInventoryIntegrityStatus,
  type ReadinessStatus,
} from "./productionReadiness";
import { computeSyncSalesStats } from "../offline/cloudSync";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import type { StockMovement } from "../types";
import type { DebtPayment } from "../types";

export type AttentionSeverity = "critical" | "warning" | "information";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  titleKey: string;
  titleVars?: Record<string, string | number>;
  detailKey?: string;
  detailVars?: Record<string, string | number>;
  amountUgx?: number | null;
  actorLabel?: string | null;
  timestamp?: string | null;
  actionTo: string;
  actionLabelKey: string;
};

export type IntegritySignalStatus = "green" | "warning" | "critical";

export type IntegritySignal = {
  id: string;
  labelKey: string;
  status: IntegritySignalStatus;
  detailKey: string;
  detailVars?: Record<string, string | number>;
  actionTo: string;
};

export type ShiftAccountabilityRow = {
  userId: string;
  label: string;
  hasActiveShift: boolean;
  latestOpeningVarianceUgx: number | null;
  latestClosingVarianceUgx: number | null;
  verifiedByLabel: string | null;
  shortageCount: number;
  overageCount: number;
  cumulativeShortageUgx: number;
  cumulativeOverageUgx: number;
  isRepeatOffender: boolean;
};

export type OwnerCashControlSnapshot = {
  primaryDayKey: string;
  drawerOpen: DayDrawerOpen | null;
  openingFloatUgx: number | null;
  openedByLabel: string | null;
  expectedCashUgx: number;
  countedCashUgx: number | null;
  dayVarianceUgx: number | null;
  shiftVariances: Array<{
    shiftId: string;
    label: string;
    diffUgx: number;
    at: string;
    kind: "shortage" | "overage";
  }>;
  floatMismatches: Array<{
    shiftId: string;
    label: string;
    varianceUgx: number;
    verifiedByLabel: string | null;
    at: string;
  }>;
  adjustmentsInPeriod: { inflowUgx: number; outflowUgx: number; count: number };
  hasUnresolvedVariance: boolean;
};

export type OwnerInventoryRiskSnapshot = {
  negativeStock: Product[];
  outOfStockCount: number;
  lowStockCount: number;
  pendingCountSessions: InventoryCountSession[];
  expiringCount: number;
  topNegative: Product[];
};

export type OwnerFinancialSnapshot = {
  debtCollectedUgx: number;
  receivablesUgx: number;
  payablesUgx: number;
  paymentMix: {
    cashUgx: number;
    mobileMoneyUgx: number;
    atmUgx: number;
    creditUgx: number;
    mixedUgx: number;
    otherUgx: number;
  };
};

export type OwnerCommandCenterInput = {
  lang: Language;
  bounds: DateFilterBounds;
  sales: Sale[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  shifts: ShiftRecord[];
  dayCloses: DayCloseSummary[];
  dayDrawerOpens: DayDrawerOpen[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  debtPayments: DebtPayment[];
  stockMovements: StockMovement[];
  inventoryCountSessions: InventoryCountSession[];
  auditLogs: AuditLogEntry[];
  voidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  ownerAlertsResolved: OwnerAlert[];
  riskCards: OwnerRiskCard[];
  expectedCashUgx: number;
  pharmacyMode: boolean;
  syncPendingCount: number;
  syncErrorCount: number;
};

function alertToneToSeverity(tone: OwnerAlert["tone"]): AttentionSeverity {
  if (tone === "danger") return "critical";
  if (tone === "warn") return "warning";
  return "information";
}

function readinessToIntegrity(status: ReadinessStatus): IntegritySignalStatus {
  if (status === "fail") return "critical";
  if (status === "warning") return "warning";
  return "green";
}

function shiftInBounds(shift: ShiftRecord, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(dateKeyKampala(shift.startAt), bounds);
}

function adjustmentInBounds(adj: CashDrawerAdjustment, bounds: DateFilterBounds): boolean {
  if (adj.deletedAt) return false;
  return dateMatchesFilter(dateKeyKampala(adj.occurredAt), bounds);
}

function parseAmountFromVars(vars?: Record<string, string | number>): number | null {
  if (!vars?.amount) return null;
  const raw = vars.amount;
  if (typeof raw === "number") return raw;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function ownerAlertToAttentionItem(alert: OwnerAlert): AttentionItem {
  const amountUgx = parseAmountFromVars(alert.detailVars);
  return {
    id: `alert-${alert.id}`,
    severity: alertToneToSeverity(alert.tone),
    titleKey: alert.title,
    titleVars: alert.titleVars,
    detailKey: alert.detail,
    detailVars: alert.detailVars,
    amountUgx,
    actionTo: "/office/audit-center",
    actionLabelKey: "ownerAttentionActionReview",
  };
}

export function riskCardToAttentionItem(lang: Language, card: OwnerRiskCard, bounds: DateFilterBounds): AttentionItem {
  const severity: AttentionSeverity =
    card.kind === "back_office_failed" || card.kind === "voids" ? "warning" : "warning";
  const fromKey = card.auditFilter.dateFrom ?? bounds.fromKey;
  const toKey = card.auditFilter.dateTo ?? bounds.toKey;
  return {
    id: `risk-${card.kind}`,
    severity: card.impactUgx >= 50_000 ? "critical" : severity,
    titleKey: "ownerAttentionRiskCardTitle",
    titleVars: { title: ownerRiskCardTitle(lang, card.kind), count: card.count },
    amountUgx: card.impactUgx > 0 ? card.impactUgx : null,
    actorLabel: card.staffLabels.length > 0 ? card.staffLabels.join(", ") : null,
    actionTo: auditCenterLinkFromFilter({ ...card.auditFilter, dateFrom: fromKey, dateTo: toKey }),
    actionLabelKey: "ownerAttentionActionInvestigate",
  };
}

export function buildShiftShortageAttentionItems(
  shifts: ShiftRecord[],
  bounds: DateFilterBounds,
  lang: Language,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const sh of shifts) {
    if (!shiftInBounds(sh, bounds)) continue;
    const diff = sh.cashDifferenceUgx;
    if (diff == null || diff >= 0) continue;
    items.push({
      id: `shift-short-${sh.id}`,
      severity: Math.abs(diff) >= 10_000 ? "critical" : "warning",
      titleKey: "ownerAttentionShiftShortage",
      titleVars: { name: sh.actorName ?? actorDisplayLabel(sh.actorUserId, lang) },
      amountUgx: Math.abs(diff),
      actorLabel: sh.actorName ?? actorDisplayLabel(sh.actorUserId, lang),
      timestamp: sh.endAt ?? sh.startAt,
      actionTo: "/office/open-shifts",
      actionLabelKey: "ownerAttentionActionShifts",
    });
  }
  return items;
}

export function buildFloatMismatchAttentionItems(
  shifts: ShiftRecord[],
  bounds: DateFilterBounds,
  lang: Language,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const sh of shifts) {
    if (!shiftInBounds(sh, bounds)) continue;
    const v = sh.verificationVarianceUgx;
    if (v == null || v === 0) continue;
    items.push({
      id: `float-mismatch-${sh.id}`,
      severity: Math.abs(v) >= 5_000 ? "critical" : "warning",
      titleKey: "ownerAttentionFloatMismatch",
      titleVars: { name: sh.actorName ?? actorDisplayLabel(sh.actorUserId, lang) },
      amountUgx: Math.abs(v),
      actorLabel: sh.actorName ?? actorDisplayLabel(sh.actorUserId, lang),
      timestamp: sh.verifiedAt ?? sh.startAt,
      detailKey: "ownerAttentionFloatVerifiedBy",
      detailVars: { name: sh.verifiedByLabel ?? "—" },
      actionTo: auditCenterLinkFromFilter({
        dateFrom: dateKeyKampala(sh.startAt),
        dateTo: dateKeyKampala(sh.startAt),
        action: "shift_float_mismatch",
      }),
      actionLabelKey: "ownerAttentionActionAudit",
    });
  }
  return items;
}

export function buildNegativeStockAttentionItems(products: Product[]): AttentionItem[] {
  const negative = products.filter((p) => p.stockOnHand < 0);
  if (negative.length === 0) return [];
  const top = negative.slice(0, 3).map((p) => p.name).join(", ");
  return [
    {
      id: "negative-stock",
      severity: "critical",
      titleKey: "ownerAttentionNegativeStock",
      titleVars: { count: negative.length },
      detailKey: "ownerAttentionNegativeStockDetail",
      detailVars: { names: top },
      actionTo: "/stock",
      actionLabelKey: "ownerAttentionActionStock",
    },
  ];
}

export function buildCountVarianceAttentionItems(sessions: InventoryCountSession[]): AttentionItem[] {
  const pending = sessions.filter((s) => s.status === "submitted" || s.status === "counting");
  const items: AttentionItem[] = [];
  for (const sess of pending) {
    const report = buildInventoryCountVarianceReport(sess);
    const severity: AttentionSeverity =
      Math.abs(report.varianceCostUgx) >= 50_000 ? "critical" : "warning";
    items.push({
      id: `count-${sess.id}`,
      severity,
      titleKey: "ownerAttentionCountVariance",
      titleVars: { n: sess.sessionNumber },
      amountUgx: Math.abs(report.varianceCostUgx),
      actorLabel: sess.submittedByName ?? sess.startedByName ?? null,
      timestamp: sess.submittedAt ?? sess.startedAt,
      actionTo: `/stock/count/${sess.id}`,
      actionLabelKey: "ownerAttentionActionCount",
    });
  }
  return items;
}

export function buildSyncAttentionItems(syncErrorCount: number, unsyncedCount: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (syncErrorCount > 0) {
    items.push({
      id: "sync-errors",
      severity: "critical",
      titleKey: "ownerAttentionSyncErrors",
      titleVars: { count: syncErrorCount },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionSync",
    });
  }
  if (unsyncedCount >= 5) {
    items.push({
      id: "unsynced-sales",
      severity: unsyncedCount >= 20 ? "critical" : "warning",
      titleKey: "ownerAttentionUnsyncedSales",
      titleVars: { count: unsyncedCount },
      actionTo: "/office/backup",
      actionLabelKey: "ownerAttentionActionSync",
    });
  }
  return items;
}

export function buildIntegrityAttentionItems(input: {
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  products: Product[];
  stockMovements: StockMovement[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const debt = verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, { heal: false });
  if (!debt.ok) {
    items.push({
      id: "debt-integrity",
      severity: "critical",
      titleKey: "ownerAttentionDebtIntegrity",
      titleVars: { count: debt.mismatches.length },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionIntegrity",
    });
  }
  const inv = verifyInventoryIntegrity({ products: input.products, movements: input.stockMovements });
  if (!inv.ok) {
    items.push({
      id: "inventory-integrity",
      severity: "critical",
      titleKey: "ownerAttentionInventoryIntegrity",
      titleVars: { count: inv.mismatches.length },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionIntegrity",
    });
  }
  return items;
}

export function buildAttentionCenter(input: OwnerCommandCenterInput): {
  critical: AttentionItem[];
  warnings: AttentionItem[];
  information: AttentionItem[];
} {
  const { unsyncedCount, errorCount } = computeSyncSalesStats(input.sales);
  const syncErrors = input.syncErrorCount > 0 ? input.syncErrorCount : errorCount;
  const unsynced = input.syncPendingCount > 0 ? input.syncPendingCount : unsyncedCount;

  const all: AttentionItem[] = [
    ...input.ownerAlertsResolved.map(ownerAlertToAttentionItem),
    ...input.riskCards.map((c) => riskCardToAttentionItem(input.lang, c, input.bounds)),
    ...buildShiftShortageAttentionItems(input.shifts, input.bounds, input.lang),
    ...buildFloatMismatchAttentionItems(input.shifts, input.bounds, input.lang),
    ...buildNegativeStockAttentionItems(input.products),
    ...buildCountVarianceAttentionItems(input.inventoryCountSessions),
    ...buildSyncAttentionItems(syncErrors, unsynced),
    ...buildIntegrityAttentionItems(input),
  ];

  const seen = new Set<string>();
  const unique = all.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return {
    critical: unique.filter((i) => i.severity === "critical"),
    warnings: unique.filter((i) => i.severity === "warning"),
    information: unique.filter((i) => i.severity === "information"),
  };
}

export function buildIntegritySignals(input: {
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  products: Product[];
  stockMovements: StockMovement[];
  dayDrawerOpens: DayDrawerOpen[];
  shifts: ShiftRecord[];
  todayKey: string;
  syncPendingCount: number;
  syncErrorCount: number;
}): IntegritySignal[] {
  const debtCheck = evaluateDebtIntegrityStatus(input.customers, input.sales, input.debtPayments);
  const invCheck = evaluateInventoryIntegrityStatus({
    products: input.products,
    stockMovements: input.stockMovements,
  });
  const { unsyncedCount, errorCount } = computeSyncSalesStats(input.sales);
  const syncErr = input.syncErrorCount || errorCount;
  const pending = input.syncPendingCount || unsyncedCount;

  const drawerDiag = collectDayDrawerOpenDiagnostics(input.dayDrawerOpens, input.shifts, input.todayKey);
  const drawerConflict =
    drawerDiag.duplicateOpenCount > 0 ||
    drawerDiag.conflictingDeviceCount > 1 ||
    drawerDiag.unsyncedCount > 0;

  const signals: IntegritySignal[] = [
    {
      id: "debt",
      labelKey: "ownerIntegrityDebt",
      status: readinessToIntegrity(debtCheck.status),
      detailKey: debtCheck.status === "pass" ? "ownerIntegrityOk" : "ownerIntegrityDebtDetail",
      detailVars: { count: debtCheck.status === "pass" ? 0 : Number.parseInt(debtCheck.detail, 10) || 1 },
      actionTo: "/settings/health",
    },
    {
      id: "inventory",
      labelKey: "ownerIntegrityInventory",
      status: readinessToIntegrity(invCheck.status),
      detailKey: invCheck.status === "pass" ? "ownerIntegrityOk" : "ownerIntegrityInventoryDetail",
      detailVars: { count: invCheck.status === "pass" ? 0 : Number.parseInt(invCheck.detail, 10) || 1 },
      actionTo: "/settings/health",
    },
    {
      id: "sync",
      labelKey: "ownerIntegritySync",
      status: syncErr > 0 ? "critical" : pending > 10 ? "warning" : "green",
      detailKey:
        syncErr > 0
          ? "ownerIntegritySyncErrors"
          : pending > 0
            ? "ownerIntegritySyncPending"
            : "ownerIntegrityOk",
      detailVars: { count: syncErr || pending },
      actionTo: "/office/backup",
    },
    {
      id: "queue",
      labelKey: "ownerIntegrityQueue",
      status: pending > 50 ? "warning" : pending > 0 ? "warning" : "green",
      detailKey: pending > 0 ? "ownerIntegrityQueuePending" : "ownerIntegrityOk",
      detailVars: { count: pending },
      actionTo: "/settings/health",
    },
    {
      id: "drawer",
      labelKey: "ownerIntegrityDrawer",
      status: drawerConflict || drawerDiag.verificationMismatchCount > 0 ? "critical" : "green",
      detailKey:
        drawerDiag.verificationMismatchCount > 0
          ? "ownerIntegrityDrawerMismatch"
          : drawerConflict
            ? "ownerIntegrityDrawerConflict"
            : "ownerIntegrityOk",
      detailVars: {
        mismatches: drawerDiag.verificationMismatchCount,
        conflicts: drawerDiag.duplicateOpenCount + drawerDiag.conflictingDeviceCount,
      },
      actionTo: "/office/day-open",
    },
  ];

  return signals;
}

export function buildShiftAccountabilityRows(
  shifts: ShiftRecord[],
  bounds: DateFilterBounds,
  lang: Language,
): ShiftAccountabilityRow[] {
  const inPeriod = shifts.filter((s) => shiftInBounds(s, bounds));
  const byUser = new Map<string, ShiftRecord[]>();
  for (const sh of inPeriod) {
    const uid = sh.actorUserId || "unknown";
    const list = byUser.get(uid) ?? [];
    list.push(sh);
    byUser.set(uid, list);
  }

  const rows: ShiftAccountabilityRow[] = [];
  for (const [userId, userShifts] of byUser) {
    userShifts.sort((a, b) => b.startAt.localeCompare(a.startAt));
    let shortageCount = 0;
    let overageCount = 0;
    let cumulativeShortageUgx = 0;
    let cumulativeOverageUgx = 0;
    let latestOpening: number | null = null;
    let latestClosing: number | null = null;
    let verifiedBy: string | null = null;
    const hasActiveShift = userShifts.some((s) => !s.endAt);

    for (const sh of userShifts) {
      const diff = sh.cashDifferenceUgx;
      if (diff != null) {
        if (diff < 0) {
          shortageCount += 1;
          cumulativeShortageUgx += Math.abs(diff);
        } else if (diff > 0) {
          overageCount += 1;
          cumulativeOverageUgx += diff;
        }
        if (latestClosing == null) latestClosing = diff;
      }
      if (sh.verificationVarianceUgx != null && latestOpening == null) {
        latestOpening = sh.verificationVarianceUgx;
        verifiedBy = sh.verifiedByLabel ?? null;
      }
    }

    const isRepeatOffender = shortageCount >= 2 || cumulativeShortageUgx >= 10_000;
    rows.push({
      userId,
      label: userShifts[0]?.actorName ?? actorDisplayLabel(userId, lang),
      hasActiveShift,
      latestOpeningVarianceUgx: latestOpening,
      latestClosingVarianceUgx: latestClosing,
      verifiedByLabel: verifiedBy,
      shortageCount,
      overageCount,
      cumulativeShortageUgx,
      cumulativeOverageUgx,
      isRepeatOffender,
    });
  }

  return rows.sort(
    (a, b) =>
      (b.isRepeatOffender ? 1 : 0) - (a.isRepeatOffender ? 1 : 0) ||
      b.cumulativeShortageUgx - a.cumulativeShortageUgx ||
      b.shortageCount - a.shortageCount,
  );
}

const INFLOW_ADJUSTMENT = new Set([
  "owner_injection",
  "safe_transfer_in",
  "cash_added",
  "float_replenishment",
]);

export function buildCashControlSnapshot(input: {
  bounds: DateFilterBounds;
  primaryDayKey: string;
  dayDrawerOpens: DayDrawerOpen[];
  dayCloses: DayCloseSummary[];
  shifts: ShiftRecord[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  expectedCashUgx: number;
  lang: Language;
}): OwnerCashControlSnapshot {
  const drawerOpen = activeDayDrawerOpenForDate(input.dayDrawerOpens, input.primaryDayKey);
  const close = input.dayCloses.find((c) => c.dateKey === input.primaryDayKey && !c.supersededAt);

  const shiftVariances: OwnerCashControlSnapshot["shiftVariances"] = [];
  const floatMismatches: OwnerCashControlSnapshot["floatMismatches"] = [];

  for (const sh of input.shifts) {
    if (!shiftInBounds(sh, input.bounds)) continue;
    const label = sh.actorName ?? actorDisplayLabel(sh.actorUserId, input.lang);
    if (sh.cashDifferenceUgx != null && sh.cashDifferenceUgx !== 0) {
      shiftVariances.push({
        shiftId: sh.id,
        label,
        diffUgx: sh.cashDifferenceUgx,
        at: sh.endAt ?? sh.startAt,
        kind: sh.cashDifferenceUgx < 0 ? "shortage" : "overage",
      });
    }
    if (sh.verificationVarianceUgx != null && sh.verificationVarianceUgx !== 0) {
      floatMismatches.push({
        shiftId: sh.id,
        label,
        varianceUgx: sh.verificationVarianceUgx,
        verifiedByLabel: sh.verifiedByLabel ?? null,
        at: sh.verifiedAt ?? sh.startAt,
      });
    }
  }

  shiftVariances.sort((a, b) => Math.abs(b.diffUgx) - Math.abs(a.diffUgx));
  floatMismatches.sort((a, b) => Math.abs(b.varianceUgx) - Math.abs(a.varianceUgx));

  let inflowUgx = 0;
  let outflowUgx = 0;
  let adjCount = 0;
  for (const adj of input.cashDrawerAdjustments) {
    if (!adjustmentInBounds(adj, input.bounds)) continue;
    adjCount += 1;
    if (INFLOW_ADJUSTMENT.has(adj.type)) inflowUgx += adj.amountUgx;
    else outflowUgx += adj.amountUgx;
  }

  const dayVarianceUgx = close?.differenceUgx ?? null;
  const hasUnresolvedVariance =
    (dayVarianceUgx != null && dayVarianceUgx !== 0) ||
    shiftVariances.some((s) => s.kind === "shortage") ||
    floatMismatches.length > 0;

  return {
    primaryDayKey: input.primaryDayKey,
    drawerOpen,
    openingFloatUgx: drawerOpen?.openingFloatUgx ?? null,
    openedByLabel: drawerOpen?.countedByLabel ?? null,
    expectedCashUgx: input.expectedCashUgx,
    countedCashUgx: close?.countedCashUgx ?? null,
    dayVarianceUgx,
    shiftVariances: shiftVariances.slice(0, 8),
    floatMismatches: floatMismatches.slice(0, 6),
    adjustmentsInPeriod: { inflowUgx, outflowUgx, count: adjCount },
    hasUnresolvedVariance,
  };
}

export function buildInventoryRiskSnapshot(
  products: Product[],
  sessions: InventoryCountSession[],
  pharmacyMode: boolean,
): OwnerInventoryRiskSnapshot {
  const negativeStock = products.filter((p) => p.stockOnHand < 0);
  const outOfStockCount = products.filter((p) => p.stockOnHand <= 0).length;
  const lowStockCount = products.filter((p) => isLowStock(p)).length;
  const pendingCountSessions = sessions.filter(
    (s) => s.status === "submitted" || s.status === "counting" || s.status === "approved",
  );
  const expiringCount = pharmacyMode
    ? products.filter((p) => p.expiryDate && new Date(p.expiryDate).getTime() <= Date.now() + 30 * 86400000).length
    : 0;

  return {
    negativeStock,
    outOfStockCount,
    lowStockCount,
    pendingCountSessions,
    expiringCount,
    topNegative: negativeStock.slice(0, 5),
  };
}

export function buildFinancialSnapshot(input: {
  sales: Sale[];
  customers: Customer[];
  suppliers: Supplier[];
  debtPayments: DebtPayment[];
  bounds: DateFilterBounds;
}): OwnerFinancialSnapshot {
  const scopedSales = revenueSalesInBounds(input.sales, input.bounds);
  const mix = {
    cashUgx: 0,
    mobileMoneyUgx: 0,
    atmUgx: 0,
    creditUgx: 0,
    mixedUgx: 0,
    otherUgx: 0,
  };

  for (const s of scopedSales) {
    const amt = s.totalUgx;
    const method = s.paymentMethod ?? (s.debtUgx > 0 ? "credit" : "cash");
    if (method === "cash") mix.cashUgx += amt;
    else if (method === "mobile_money") mix.mobileMoneyUgx += amt;
    else if (method === "atm") mix.atmUgx += amt;
    else if (method === "credit") mix.creditUgx += amt;
    else if (method === "mixed") mix.mixedUgx += amt;
    else mix.otherUgx += amt;
  }

  return {
    debtCollectedUgx: sumDebtPaymentsInBounds(input.debtPayments, input.bounds),
    receivablesUgx: input.customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0),
    payablesUgx: input.suppliers.reduce((sum, s) => sum + Math.max(0, s.balanceOwedUgx ?? 0), 0),
    paymentMix: mix,
  };
}

export function filterAuditLogsInBounds(logs: AuditLogEntry[], bounds: DateFilterBounds): AuditLogEntry[] {
  return logs.filter((e) => dateMatchesFilter(dateKeyKampala(e.at), bounds));
}

export function filterVoidsInBounds(voids: VoidRecord[], bounds: DateFilterBounds): VoidRecord[] {
  return voids.filter((v) => dateMatchesFilter(dateKeyKampala(v.createdAt), bounds));
}

export function filterReturnsInBounds(returns: ReturnRecord[], bounds: DateFilterBounds): ReturnRecord[] {
  return returnsInBounds(returns, bounds);
}

export function primaryDayKeyForBounds(bounds: DateFilterBounds): string {
  return bounds.toKey;
}
