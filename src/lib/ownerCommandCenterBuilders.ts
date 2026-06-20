/**
 * Extended owner command center builders — derived from existing store data only.
 */

import type {
  AuditLogEntry,
  CashDrawerAdjustment,
  CashExpense,
  Customer,
  DayCloseSummary,
  DayDrawerOpen,
  DebtPayment,
  InventoryCountSession,
  Language,
  Product,
  Purchase,
  ReturnRecord,
  Sale,
  ShiftRecord,
  StockMovement,
  Supplier,
  SupplierPayment,
  VoidRecord,
} from "../types";
import { actorDisplayLabel } from "./activityNarrative";
import { sumCashExpensesInBounds } from "./cashReconciliation";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { sumDebtPaymentsInBounds, sumCreditIssuedInBounds } from "./customerDebtActivity";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";
import {
  addDaysToDateKey,
  dateMatchesFilter,
  enumerateDaysInBounds,
  revenueSalesInBounds,
  revenueSalesInBoundsFromIndex,
  returnsInBounds,
  type DateFilterBounds,
} from "./dateFilters";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancialsFromScoped, type RevenueSalesIndex } from "./financialMetrics";
import { buildInventoryCountVarianceReport } from "./inventoryCount";
import { isLowStock } from "./sellingEngine";
import { listSyncConflicts } from "./syncConflictLog";
import { readSyncCheckpoints } from "./syncCheckpoints";
import { countUnsyncedSales } from "../offline/cloudSync";
import type { SyncHealthMeta } from "./syncMeta";
import { LARGE_DISCOUNT_UGX_THRESHOLD } from "./ownerRiskDashboard";
import type { AttentionItem, ShiftAccountabilityRow } from "./ownerCommandCenter";
import type { OwnerDashboardIntegritySnapshot } from "./ownerDashboardIntegrityCache";
import { buildPostRestoreValidationSnapshot } from "./postRestoreValidation";
import { analyzeSnapshotTrim } from "./snapshotTrimDiagnostics";
import type { PersistedSnapshot } from "../offline/localDb";

export type CashAdjustmentFeedRow = {
  id: string;
  actorLabel: string;
  occurredAt: string;
  amountUgx: number;
  type: string;
  note: string;
  direction: "in" | "out";
};

export type FloatVerificationFeedRow = {
  shiftId: string;
  cashierLabel: string;
  verifierLabel: string | null;
  expectedUgx: number | null;
  countedUgx: number | null;
  varianceUgx: number;
  at: string;
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

function shiftInBounds(shift: ShiftRecord, bounds: DateFilterBounds): boolean {
  return dateMatchesFilter(dateKeyKampala(shift.startAt), bounds);
}

function adjustmentInBounds(adj: CashDrawerAdjustment, bounds: DateFilterBounds): boolean {
  if (adj.deletedAt) return false;
  return dateMatchesFilter(dateKeyKampala(adj.occurredAt), bounds);
}

function filterAuditLogsInBounds(logs: AuditLogEntry[], bounds: DateFilterBounds): AuditLogEntry[] {
  return logs.filter((e) => dateMatchesFilter(dateKeyKampala(e.at), bounds));
}

function filterVoidsInBounds(voids: VoidRecord[], bounds: DateFilterBounds): VoidRecord[] {
  return voids.filter((v) => dateMatchesFilter(dateKeyKampala(v.createdAt), bounds));
}

export const LARGE_CASH_WITHDRAWAL_UGX = 50_000;
export const HIGH_REFUND_COUNT_THRESHOLD = 3;

export type OwnerLiveOperationsSnapshot = {
  openShiftCount: number;
  activeCashierCount: number;
  activeCashierLabels: string[];
  dayDrawerOpen: boolean;
  openingFloatUgx: number | null;
  devicesOnline: number;
  devicesStale: number;
  lastSyncAt: string | null;
  unsyncedOperations: number;
  pendingQueueOps: number;
  queueHealth: SyncHealthMeta["queueHealth"];
};

export type StaffControlRow = ShiftAccountabilityRow & {
  salesUgx: number;
  debtCollectedUgx: number;
  voidCount: number;
  returnCount: number;
  discountCount: number;
  floatMismatchCount: number;
  stockAdjustCount: number;
  riskScore: number;
  riskTier: "trusted" | "review" | "offender";
};

export type FinancialTrendComparison = {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  pctRevenue: number | null;
  pctProfit: number | null;
};

export type OwnerFinancialExtended = {
  revenueUgx: number;
  profitUgx: number;
  transactionCount: number;
  debtCollectedUgx: number;
  receivablesUgx: number;
  payablesUgx: number;
  expensesTodayUgx: number;
  expensesPeriodUgx: number;
  expensesPriorPeriodUgx: number;
  purchasesUgx: number;
  debtIssuedUgx: number;
  topSuppliers: Array<{ id: string; name: string; balanceOwedUgx: number }>;
  paymentMix: {
    cashUgx: number;
    mobileMoneyUgx: number;
    atmUgx: number;
    creditUgx: number;
    mixedUgx: number;
    otherUgx: number;
  };
  trendVsPriorDay: FinancialTrendComparison | null;
  trendVsPriorWeek: FinancialTrendComparison | null;
  trendVsPriorMonth: FinancialTrendComparison | null;
};

export type InventoryMoverRow = {
  productId: string;
  name: string;
  qty: number;
  revenueUgx: number;
};

export type OwnerInventoryExtended = {
  negativeStock: Product[];
  outOfStockCount: number;
  lowStockCount: number;
  pendingCountSessions: InventoryCountSession[];
  expiringCount: number;
  topNegative: Product[];
  inventoryValueUgx: number;
  countVarianceCount: number;
  countVarianceCostUgx: number;
  fastMovers: InventoryMoverRow[];
  slowMovers: InventoryMoverRow[];
  writeOffValueUgx: number;
};

export type CashAccountabilityRow = {
  userId: string;
  label: string;
  shortageUgx: number;
  shortageCount: number;
};

export type OwnerCashExtended = {
  primaryDayKey: string;
  isPeriodRange: boolean;
  drawerOpen: DayDrawerOpen | null;
  openingFloatUgx: number | null;
  openedByLabel: string | null;
  periodExpectedCashUgx: number;
  latestCountedCashUgx: number | null;
  latestDayVarianceUgx: number | null;
  latestCountDayKey: string;
  shortageShiftCount: number;
  overageShiftCount: number;
  floatMismatchCount: number;
  shiftVariances: Array<{
    shiftId: string;
    label: string;
    diffUgx: number;
    at: string;
    kind: "shortage" | "overage";
  }>;
  adjustmentFeed: Array<{
    id: string;
    actorLabel: string;
    occurredAt: string;
    amountUgx: number;
    type: string;
    note: string;
    direction: "in" | "out";
  }>;
  floatVerificationFeed: Array<{
    shiftId: string;
    cashierLabel: string;
    verifierLabel: string | null;
    expectedUgx: number | null;
    countedUgx: number | null;
    varianceUgx: number;
    at: string;
  }>;
  adjustmentsInPeriod: { inflowUgx: number; outflowUgx: number; count: number };
  hasUnresolvedVariance: boolean;
  ownerInjectionsUgx: number;
  ownerWithdrawalsUgx: number;
  bankDepositsUgx: number;
  safeTransfersInUgx: number;
  safeTransfersOutUgx: number;
  cashExpensesUgx: number;
  topCashierShortages: CashAccountabilityRow[];
  accountabilityRanking: CashAccountabilityRow[];
};

function pctChange(current: number, prior: number): number | null {
  if (prior <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - prior) / prior) * 100);
}

function financialForBounds(
  sales: Sale[],
  returnRecords: ReturnRecord[],
  products: Product[],
  bounds: DateFilterBounds,
  salesIndex?: RevenueSalesIndex,
): { revenueUgx: number; profitUgx: number; transactionCount: number } {
  const scopedSales = salesIndex
    ? revenueSalesInBoundsFromIndex(salesIndex, bounds)
    : revenueSalesInBounds(sales, bounds);
  const scopedReturns = returnsInBounds(returnRecords, bounds);
  const fin = getCompletedFinancialsFromScoped(scopedSales, scopedReturns, products);
  return {
    revenueUgx: fin.revenueUgx,
    profitUgx: fin.profitUgx,
    transactionCount: fin.transactionCount,
  };
}

export function buildLiveOperationsSnapshot(input: {
  shifts: ShiftRecord[];
  dayDrawerOpens: DayDrawerOpen[];
  primaryDayKey: string;
  syncPendingCount: number;
  syncHealth: SyncHealthMeta;
  devicesOnline?: number;
  devicesStale?: number;
}): OwnerLiveOperationsSnapshot {
  const openShifts = input.shifts.filter((s) => !s.endAt);
  const activeLabels = [...new Set(openShifts.map((s) => s.actorName ?? actorDisplayLabel(s.actorUserId, "en")))];
  const drawer = activeDayDrawerOpenForDate(input.dayDrawerOpens, input.primaryDayKey);
  const cp = readSyncCheckpoints();
  const unsyncedSales = countUnsyncedSales();
  const lastSyncAt = cp.lastSalesSyncAt ?? input.syncHealth.lastSuccessAt ?? null;

  return {
    openShiftCount: openShifts.length,
    activeCashierCount: activeLabels.length,
    activeCashierLabels: activeLabels.slice(0, 5),
    dayDrawerOpen: drawer != null,
    openingFloatUgx: drawer?.openingFloatUgx ?? null,
    devicesOnline: input.devicesOnline ?? 0,
    devicesStale: input.devicesStale ?? 0,
    lastSyncAt,
    unsyncedOperations: unsyncedSales + input.syncPendingCount,
    pendingQueueOps: input.syncPendingCount,
    queueHealth: input.syncHealth.queueHealth,
  };
}

export function buildSyncConflictAttentionItems(): AttentionItem[] {
  const conflicts = listSyncConflicts({ unacknowledgedOnly: true });
  if (conflicts.length === 0) return [];
  const latest = conflicts[0];
  return [
    {
      id: "sync-conflicts",
      severity: conflicts.length >= 3 ? "critical" : "warning",
      titleKey: "ownerAttentionSyncConflicts",
      titleVars: { count: conflicts.length },
      timestamp: latest?.at ?? null,
      actionTo: "/settings/sync-conflicts",
      actionLabelKey: "ownerAttentionActionConflicts",
      acknowledgeable: true,
    },
  ];
}

export function buildQueueHealthAttentionItems(
  syncHealth: SyncHealthMeta,
  pendingCount: number,
): AttentionItem[] {
  const degraded =
    syncHealth.queueHealth === "degraded" || syncHealth.queueHealth === "backing_off";
  if (!degraded && pendingCount < 20) return [];
  return [
    {
      id: "queue-health",
      severity: degraded ? "critical" : "warning",
      titleKey: degraded ? "ownerAttentionQueueDegraded" : "ownerAttentionQueueBacklog",
      titleVars: { count: pendingCount },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionSync",
      acknowledgeable: true,
    },
  ];
}

export function buildStaleDeviceAttentionItems(staleCount: number): AttentionItem[] {
  if (staleCount <= 0) return [];
  return [
    {
      id: "stale-devices",
      severity: staleCount >= 2 ? "critical" : "warning",
      titleKey: "ownerAttentionStaleDevices",
      titleVars: { count: staleCount },
      actionTo: "/settings/devices",
      actionLabelKey: "ownerAttentionActionDevices",
      acknowledgeable: true,
    },
  ];
}

export function buildDayCloseVarianceAttentionItems(
  dayCloses: DayCloseSummary[],
  bounds: DateFilterBounds,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const close of dayCloses) {
    if (close.supersededAt) continue;
    if (!dateMatchesFilter(close.dateKey, bounds)) continue;
    const diff = close.differenceUgx;
    if (diff == null || diff === 0) continue;
    items.push({
      id: `day-close-var-${close.dateKey}`,
      severity: Math.abs(diff) >= 10_000 ? "critical" : "warning",
      titleKey: "ownerAttentionDayCloseVariance",
      titleVars: { day: close.dateKey },
      amountUgx: Math.abs(diff),
      timestamp: close.createdAt ?? null,
      actionTo: "/close-day",
      actionLabelKey: "ownerAttentionActionClose",
    });
  }
  return items;
}

export function buildRepeatOffenderAttentionItems(rows: ShiftAccountabilityRow[]): AttentionItem[] {
  const offenders = rows.filter((r) => r.isRepeatOffender);
  if (offenders.length === 0) return [];
  const top = offenders[0]!;
  return [
    {
      id: "repeat-offender-cashiers",
      severity: offenders.length >= 2 ? "critical" : "warning",
      titleKey: "ownerAttentionRepeatOffenders",
      titleVars: { count: offenders.length, name: top.label },
      amountUgx: top.cumulativeShortageUgx,
      actorLabel: top.label,
      actionTo: "/office/open-shifts",
      actionLabelKey: "ownerAttentionActionShifts",
      acknowledgeable: true,
    },
  ];
}

export function buildLargeWithdrawalAttentionItems(
  adjustments: CashDrawerAdjustment[],
  bounds: DateFilterBounds,
  lang: Language,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const adj of adjustments) {
    if (!adjustmentInBounds(adj, bounds)) continue;
    if (adj.type !== "owner_withdrawal" && adj.type !== "cash_removed") continue;
    if (adj.amountUgx < LARGE_CASH_WITHDRAWAL_UGX) continue;
    items.push({
      id: `large-withdrawal-${adj.id}`,
      severity: adj.amountUgx >= 100_000 ? "critical" : "warning",
      titleKey: "ownerAttentionLargeWithdrawal",
      titleVars: { name: adj.actorName ?? actorDisplayLabel(adj.actorUserId, lang) },
      amountUgx: adj.amountUgx,
      actorLabel: adj.actorName ?? actorDisplayLabel(adj.actorUserId, lang),
      timestamp: adj.occurredAt,
      actionTo: "/office/cash-position",
      actionLabelKey: "ownerAttentionActionCash",
    });
  }
  return items;
}

export function buildHighRefundAttentionItems(
  returnRecords: ReturnRecord[],
  bounds: DateFilterBounds,
): AttentionItem[] {
  const inPeriod = returnsInBounds(returnRecords, bounds);
  if (inPeriod.length < HIGH_REFUND_COUNT_THRESHOLD) return [];
  const impact = inPeriod.reduce((s, r) => s + Math.max(0, r.refundAmountUgx), 0);
  return [
    {
      id: "high-refunds",
      severity: inPeriod.length >= 5 || impact >= 50_000 ? "critical" : "warning",
      titleKey: "ownerAttentionHighRefunds",
      titleVars: { count: inPeriod.length },
      amountUgx: impact,
      timestamp: inPeriod[0]?.createdAt ?? null,
      actionTo: "/office/audit-center",
      actionLabelKey: "ownerAttentionActionInvestigate",
      acknowledgeable: true,
    },
  ];
}

function computeRiskScore(input: {
  shortageCount: number;
  cumulativeShortageUgx: number;
  returnCount: number;
  voidCount: number;
  discountCount: number;
  floatMismatchCount: number;
  stockAdjustCount: number;
  isRepeatOffender: boolean;
}): number {
  let score = 0;
  score += input.shortageCount * 12;
  score += Math.min(40, Math.floor(input.cumulativeShortageUgx / 2000));
  score += input.returnCount * 8;
  score += input.voidCount * 10;
  score += input.discountCount * 6;
  score += input.floatMismatchCount * 14;
  score += input.stockAdjustCount * 4;
  if (input.isRepeatOffender) score += 20;
  return Math.min(100, score);
}

function auditNum(pl: Record<string, unknown>, key: string): number {
  const v = pl[key];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
}

function riskTierFromScore(score: number, isRepeatOffender: boolean): StaffControlRow["riskTier"] {
  if (isRepeatOffender || score >= 40) return "offender";
  if (score >= 15) return "review";
  return "trusted";
}

function trendComparison(
  current: { revenueUgx: number; profitUgx: number; transactionCount: number },
  prior: { revenueUgx: number; profitUgx: number; transactionCount: number },
): FinancialTrendComparison {
  return {
    revenueUgx: prior.revenueUgx,
    profitUgx: prior.profitUgx,
    transactionCount: prior.transactionCount,
    pctRevenue: pctChange(current.revenueUgx, prior.revenueUgx),
    pctProfit: pctChange(current.profitUgx, prior.profitUgx),
  };
}

const INFLOW_ADJUSTMENT = new Set([
  "owner_injection",
  "safe_transfer_in",
  "cash_added",
  "float_replenishment",
]);

export function buildStaffControlRows(
  baseRows: ShiftAccountabilityRow[],
  sales: Sale[],
  voidRecords: VoidRecord[],
  returnRecords: ReturnRecord[],
  auditLogs: AuditLogEntry[],
  bounds: DateFilterBounds,
): StaffControlRow[] {
  const scopedSales = revenueSalesInBounds(sales, bounds);
  const scopedVoids = filterVoidsInBounds(voidRecords, bounds);
  const scopedReturns = returnsInBounds(returnRecords, bounds);
  const scopedAudit = filterAuditLogsInBounds(auditLogs, bounds);

  const salesByUser = new Map<string, number>();
  for (const s of scopedSales) {
    const uid = s.soldByUserId ?? "unknown";
    salesByUser.set(uid, (salesByUser.get(uid) ?? 0) + s.totalUgx);
  }

  const debtByUser = new Map<string, number>();
  for (const e of scopedAudit) {
    if (e.action !== "debt_payment") continue;
    const uid = e.actorUserId ?? "unknown";
    debtByUser.set(uid, (debtByUser.get(uid) ?? 0) + auditNum(e.payload as Record<string, unknown>, "amountUgx"));
  }

  const voidsByUser = new Map<string, number>();
  for (const v of scopedVoids) {
    const uid = v.actorUserId ?? "unknown";
    voidsByUser.set(uid, (voidsByUser.get(uid) ?? 0) + 1);
  }

  const returnsByUser = new Map<string, number>();
  for (const r of scopedReturns) {
    const uid = r.actorUserId ?? "unknown";
    returnsByUser.set(uid, (returnsByUser.get(uid) ?? 0) + 1);
  }

  const discountsByUser = new Map<string, number>();
  const stockAdjByUser = new Map<string, number>();
  for (const e of scopedAudit) {
    const uid = e.actorUserId ?? "unknown";
    if (
      e.action === "discount_given" &&
      auditNum(e.payload as Record<string, unknown>, "discountUgx") >= LARGE_DISCOUNT_UGX_THRESHOLD
    ) {
      discountsByUser.set(uid, (discountsByUser.get(uid) ?? 0) + 1);
    }
    if (e.action === "stock_adjust") {
      stockAdjByUser.set(uid, (stockAdjByUser.get(uid) ?? 0) + 1);
    }
  }

  return baseRows
    .map((row) => {
      const floatMismatchCount = row.latestOpeningVarianceUgx != null ? 1 : 0;
      const riskScore = computeRiskScore({
        shortageCount: row.shortageCount,
        cumulativeShortageUgx: row.cumulativeShortageUgx,
        returnCount: returnsByUser.get(row.userId) ?? 0,
        voidCount: voidsByUser.get(row.userId) ?? 0,
        discountCount: discountsByUser.get(row.userId) ?? 0,
        floatMismatchCount,
        stockAdjustCount: stockAdjByUser.get(row.userId) ?? 0,
        isRepeatOffender: row.isRepeatOffender,
      });
      return {
        ...row,
        salesUgx: salesByUser.get(row.userId) ?? 0,
        debtCollectedUgx: debtByUser.get(row.userId) ?? 0,
        voidCount: voidsByUser.get(row.userId) ?? 0,
        returnCount: returnsByUser.get(row.userId) ?? 0,
        discountCount: discountsByUser.get(row.userId) ?? 0,
        floatMismatchCount,
        stockAdjustCount: stockAdjByUser.get(row.userId) ?? 0,
        riskScore,
        riskTier: riskTierFromScore(riskScore, row.isRepeatOffender),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || b.cumulativeShortageUgx - a.cumulativeShortageUgx);
}

export function buildCashControlExtended(input: {
  bounds: DateFilterBounds;
  primaryDayKey: string;
  dayDrawerOpens: DayDrawerOpen[];
  dayCloses: DayCloseSummary[];
  shifts: ShiftRecord[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  cashExpenses: CashExpense[];
  expectedCashUgx: number;
  lang: Language;
}): OwnerCashExtended {
  const drawerOpen = activeDayDrawerOpenForDate(input.dayDrawerOpens, input.primaryDayKey);
  const close = input.dayCloses.find((c) => c.dateKey === input.primaryDayKey && !c.supersededAt);

  const shiftVariances: OwnerCashExtended["shiftVariances"] = [];
  const floatVerificationFeed: FloatVerificationFeedRow[] = [];
  const shortageByUser = new Map<string, CashAccountabilityRow>();
  let shortageShiftCount = 0;
  let overageShiftCount = 0;
  let floatMismatchCount = 0;

  for (const sh of input.shifts) {
    if (!shiftInBounds(sh, input.bounds)) continue;
    const label = sh.actorName ?? actorDisplayLabel(sh.actorUserId, input.lang);
    if (sh.cashDifferenceUgx != null && sh.cashDifferenceUgx !== 0) {
      const kind = sh.cashDifferenceUgx < 0 ? "shortage" : "overage";
      if (kind === "shortage") {
        shortageShiftCount += 1;
        const uid = sh.actorUserId || "unknown";
        const prev = shortageByUser.get(uid);
        const add = Math.abs(sh.cashDifferenceUgx);
        shortageByUser.set(uid, {
          userId: uid,
          label,
          shortageUgx: (prev?.shortageUgx ?? 0) + add,
          shortageCount: (prev?.shortageCount ?? 0) + 1,
        });
      } else overageShiftCount += 1;
      shiftVariances.push({
        shiftId: sh.id,
        label,
        diffUgx: sh.cashDifferenceUgx,
        at: sh.endAt ?? sh.startAt,
        kind,
      });
    }
    if (sh.verificationVarianceUgx != null && sh.verificationVarianceUgx !== 0) {
      floatMismatchCount += 1;
      floatVerificationFeed.push({
        shiftId: sh.id,
        cashierLabel: label,
        verifierLabel: sh.verifiedByLabel ?? null,
        expectedUgx: sh.segmentBaselineUgx ?? null,
        countedUgx: sh.verifiedFloatUgx ?? null,
        varianceUgx: sh.verificationVarianceUgx,
        at: sh.verifiedAt ?? sh.startAt,
      });
    }
  }

  shiftVariances.sort((a, b) => Math.abs(b.diffUgx) - Math.abs(a.diffUgx));
  const accountabilityRanking = [...shortageByUser.values()].sort((a, b) => b.shortageUgx - a.shortageUgx);

  const adjustmentFeed: CashAdjustmentFeedRow[] = [];
  let inflowUgx = 0;
  let outflowUgx = 0;
  let adjCount = 0;
  let ownerInjectionsUgx = 0;
  let ownerWithdrawalsUgx = 0;
  let bankDepositsUgx = 0;
  let safeTransfersInUgx = 0;
  let safeTransfersOutUgx = 0;

  for (const adj of input.cashDrawerAdjustments) {
    if (!adjustmentInBounds(adj, input.bounds)) continue;
    adjCount += 1;
    const isIn = INFLOW_ADJUSTMENT.has(adj.type);
    if (isIn) inflowUgx += adj.amountUgx;
    else outflowUgx += adj.amountUgx;
    if (adj.type === "owner_injection") ownerInjectionsUgx += adj.amountUgx;
    if (adj.type === "owner_withdrawal" || adj.type === "cash_removed") ownerWithdrawalsUgx += adj.amountUgx;
    if (adj.type === "bank_deposit") bankDepositsUgx += adj.amountUgx;
    if (adj.type === "safe_transfer_in") safeTransfersInUgx += adj.amountUgx;
    if (adj.type === "safe_transfer_out") safeTransfersOutUgx += adj.amountUgx;
    adjustmentFeed.push({
      id: adj.id,
      actorLabel: adj.actorName ?? actorDisplayLabel(adj.actorUserId, input.lang),
      occurredAt: adj.occurredAt,
      amountUgx: adj.amountUgx,
      type: adj.type,
      note: adj.note,
      direction: isIn ? "in" : "out",
    });
  }
  adjustmentFeed.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const cashExpensesUgx = sumCashExpensesInBounds(input.cashExpenses, input.bounds);
  const latestDayVarianceUgx = close?.differenceUgx ?? null;
  const hasUnresolvedVariance =
    (latestDayVarianceUgx != null && latestDayVarianceUgx !== 0) ||
    shortageShiftCount > 0 ||
    floatMismatchCount > 0;

  return {
    primaryDayKey: input.primaryDayKey,
    isPeriodRange: !input.bounds.isSingleDay,
    drawerOpen,
    openingFloatUgx: drawerOpen?.openingFloatUgx ?? null,
    openedByLabel: drawerOpen?.countedByLabel ?? null,
    periodExpectedCashUgx: input.expectedCashUgx,
    latestCountedCashUgx: close?.countedCashUgx ?? null,
    latestDayVarianceUgx,
    latestCountDayKey: input.primaryDayKey,
    shortageShiftCount,
    overageShiftCount,
    floatMismatchCount,
    shiftVariances: shiftVariances.slice(0, 8),
    adjustmentFeed: adjustmentFeed.slice(0, 8),
    floatVerificationFeed: floatVerificationFeed.slice(0, 8),
    adjustmentsInPeriod: { inflowUgx, outflowUgx, count: adjCount },
    hasUnresolvedVariance,
    ownerInjectionsUgx,
    ownerWithdrawalsUgx,
    bankDepositsUgx,
    safeTransfersInUgx,
    safeTransfersOutUgx,
    cashExpensesUgx,
    topCashierShortages: accountabilityRanking.slice(0, 5),
    accountabilityRanking,
  };
}

export function buildInventoryExtended(
  products: Product[],
  sessions: InventoryCountSession[],
  pharmacyMode: boolean,
  sales: Sale[],
  bounds: DateFilterBounds,
  auditLogs: AuditLogEntry[],
): OwnerInventoryExtended {
  const negativeStock = products.filter((p) => p.stockOnHand < 0);
  const outOfStockCount = products.filter((p) => p.stockOnHand <= 0).length;
  const lowStockCount = products.filter((p) => isLowStock(p)).length;
  const pendingCountSessions = sessions.filter(
    (s) => s.status === "submitted" || s.status === "counting" || s.status === "approved",
  );
  const expiringCount = pharmacyMode
    ? products.filter((p) => p.expiryDate && new Date(p.expiryDate).getTime() <= Date.now() + 30 * 86400000).length
    : 0;

  let countVarianceCount = 0;
  let countVarianceCostUgx = 0;
  for (const sess of sessions) {
    if (sess.status !== "submitted" && sess.status !== "approved") continue;
    const report = buildInventoryCountVarianceReport(sess);
    if (report.varianceCostUgx !== 0) {
      countVarianceCount += 1;
      countVarianceCostUgx += Math.abs(report.varianceCostUgx);
    }
  }

  const productQty = new Map<string, { name: string; qty: number; revenueUgx: number }>();
  for (const s of revenueSalesInBounds(sales, bounds)) {
    for (const line of s.lines) {
      if (line.voided) continue;
      const cur = productQty.get(line.productId) ?? { name: line.name, qty: 0, revenueUgx: 0 };
      cur.qty += line.quantity;
      cur.revenueUgx += line.lineTotalUgx;
      productQty.set(line.productId, cur);
    }
  }

  const movers: InventoryMoverRow[] = [...productQty.entries()].map(([productId, v]) => ({
    productId,
    name: v.name,
    qty: v.qty,
    revenueUgx: v.revenueUgx,
  }));
  const fastMovers = [...movers].sort((a, b) => b.qty - a.qty).slice(0, 5);
  const slowMovers = [...movers].filter((m) => m.qty > 0).sort((a, b) => a.qty - b.qty).slice(0, 5);

  let writeOffValueUgx = 0;
  for (const e of filterAuditLogsInBounds(auditLogs, bounds)) {
    if (e.action === "expired_stock_writeoff") {
      writeOffValueUgx += auditNum(e.payload as Record<string, unknown>, "lossValueUgx");
    }
  }

  return {
    negativeStock,
    outOfStockCount,
    lowStockCount,
    pendingCountSessions,
    expiringCount,
    topNegative: negativeStock.slice(0, 5),
    inventoryValueUgx: inventoryValueAtCostUgx(products),
    countVarianceCount,
    countVarianceCostUgx,
    fastMovers,
    slowMovers,
    writeOffValueUgx,
  };
}

export function buildFinancialExtended(input: {
  sales: Sale[];
  returnRecords: ReturnRecord[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: Purchase[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  bounds: DateFilterBounds;
  salesIndex?: RevenueSalesIndex;
}): OwnerFinancialExtended {
  const current = financialForBounds(
    input.sales,
    input.returnRecords,
    input.products,
    input.bounds,
    input.salesIndex,
  );

  const mix = {
    cashUgx: 0,
    mobileMoneyUgx: 0,
    atmUgx: 0,
    creditUgx: 0,
    mixedUgx: 0,
    otherUgx: 0,
  };
  const scopedSales = input.salesIndex
    ? revenueSalesInBoundsFromIndex(input.salesIndex, input.bounds)
    : revenueSalesInBounds(input.sales, input.bounds);
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

  const expensesPeriodUgx = sumCashExpensesInBounds(input.cashExpenses, input.bounds);
  const todayKey = dateKeyKampala(new Date());
  const expensesTodayUgx = sumCashExpensesInBounds(input.cashExpenses, {
    fromKey: todayKey,
    toKey: todayKey,
    isSingleDay: true,
  });

  const daySpan = enumerateDaysInBounds(input.bounds).length;
  const priorToKey = addDaysToDateKey(input.bounds.fromKey, -1);
  const priorFromKey = addDaysToDateKey(input.bounds.fromKey, -daySpan);
  const priorPeriodBounds = {
    fromKey: priorFromKey,
    toKey: priorToKey,
    isSingleDay: priorFromKey === priorToKey,
  };
  const expensesPriorPeriodUgx = sumCashExpensesInBounds(input.cashExpenses, priorPeriodBounds);

  const priorDayBounds = { fromKey: priorToKey, toKey: priorToKey, isSingleDay: true };
  const priorWeekBounds = {
    fromKey: addDaysToDateKey(input.bounds.fromKey, -7),
    toKey: priorToKey,
    isSingleDay: false,
  };
  const priorMonthBounds = {
    fromKey: addDaysToDateKey(input.bounds.fromKey, -30),
    toKey: priorToKey,
    isSingleDay: false,
  };

  const priorDay = financialForBounds(input.sales, input.returnRecords, input.products, priorDayBounds, input.salesIndex);
  const priorWeek = financialForBounds(input.sales, input.returnRecords, input.products, priorWeekBounds, input.salesIndex);
  const priorMonth = financialForBounds(input.sales, input.returnRecords, input.products, priorMonthBounds, input.salesIndex);

  let purchasesUgx = 0;
  for (const p of input.purchases) {
    if (p.voidedAt) continue;
    if (!dateMatchesFilter(dateKeyKampala(p.createdAt), input.bounds)) continue;
    purchasesUgx += p.totalCostUgx;
  }

  const topSuppliers = [...input.suppliers]
    .filter((s) => (s.balanceOwedUgx ?? 0) > 0)
    .sort((a, b) => (b.balanceOwedUgx ?? 0) - (a.balanceOwedUgx ?? 0))
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, balanceOwedUgx: s.balanceOwedUgx ?? 0 }));

  return {
    revenueUgx: current.revenueUgx,
    profitUgx: current.profitUgx,
    transactionCount: current.transactionCount,
    debtCollectedUgx: sumDebtPaymentsInBounds(input.debtPayments, input.bounds),
    receivablesUgx: input.customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0),
    payablesUgx: input.suppliers.reduce((sum, s) => sum + Math.max(0, s.balanceOwedUgx ?? 0), 0),
    expensesTodayUgx,
    expensesPeriodUgx,
    expensesPriorPeriodUgx,
    purchasesUgx,
    debtIssuedUgx: sumCreditIssuedInBounds(input.sales, input.bounds),
    topSuppliers,
    paymentMix: mix,
    trendVsPriorDay: trendComparison(current, priorDay),
    trendVsPriorWeek: trendComparison(current, priorWeek),
    trendVsPriorMonth: trendComparison(current, priorMonth),
  };
}

export function buildExtendedIntegritySignals(
  integrity: OwnerDashboardIntegritySnapshot,
  bounds: DateFilterBounds,
  opts?: {
    staleDeviceCount?: number;
    syncConflictCount?: number;
    snapshotTrimStatus?: string;
    restoreStatus?: string;
    migrationWarning?: boolean;
  },
): IntegritySignal[] {
  const syncErr = integrity.syncErrorCount || integrity.syncStats.errorCount;
  const pending = integrity.syncPendingCount || integrity.syncStats.unsyncedCount;
  const queueDegraded =
    integrity.syncHealth.queueHealth === "degraded" || integrity.syncHealth.queueHealth === "backing_off";
  const drawerConflict =
    integrity.periodDrawerDuplicateOpens > 0 ||
    integrity.periodDrawerDeviceConflicts > 0 ||
    integrity.periodDrawerUnsynced > 0 ||
    integrity.periodVerificationMismatches > 0;
  const conflicts = opts?.syncConflictCount ?? listSyncConflicts({ unacknowledgedOnly: true }).length;
  const stale = opts?.staleDeviceCount ?? 0;
  const trimWarn =
    opts?.snapshotTrimStatus === "warn_size" ||
    opts?.snapshotTrimStatus === "trimmed_sales" ||
    opts?.snapshotTrimStatus === "trimmed_archives";
  const restoreWarn = opts?.restoreStatus === "warning" || opts?.restoreStatus === "critical";

  const signals: IntegritySignal[] = [
    {
      id: "sync-conflicts",
      labelKey: "ownerIntegritySyncConflicts",
      status: conflicts > 0 ? "critical" : "green",
      detailKey: conflicts > 0 ? "ownerIntegritySyncConflictsDetail" : "ownerIntegrityOk",
      detailVars: { count: conflicts },
      actionTo: "/settings/sync-conflicts",
    },
    {
      id: "debt",
      labelKey: "ownerIntegrityDebt",
      status:
        integrity.debtCheck.status === "fail"
          ? "critical"
          : integrity.debtCheck.status === "warning"
            ? "warning"
            : "green",
      detailKey: integrity.debtCheck.status === "pass" ? "ownerIntegrityOk" : "ownerIntegrityDebtDetail",
      detailVars: {
        count:
          integrity.debtCheck.status === "pass"
            ? 0
            : Number.parseInt(integrity.debtCheck.detail, 10) || integrity.debtIntegrity.mismatches.length,
      },
      actionTo: "/settings/health",
    },
    {
      id: "inventory",
      labelKey: "ownerIntegrityInventory",
      status:
        integrity.inventoryCheck.status === "fail"
          ? "critical"
          : integrity.inventoryCheck.status === "warning"
            ? "warning"
            : "green",
      detailKey: integrity.inventoryCheck.status === "pass" ? "ownerIntegrityOk" : "ownerIntegrityInventoryDetail",
      detailVars: {
        count:
          integrity.inventoryCheck.status === "pass"
            ? 0
            : Number.parseInt(integrity.inventoryCheck.detail, 10) || integrity.inventoryIntegrity.mismatches.length,
      },
      actionTo: "/settings/health",
    },
    {
      id: "sync",
      labelKey: "ownerIntegritySync",
      status: syncErr > 0 ? "critical" : pending > 10 || queueDegraded ? "warning" : "green",
      detailKey:
        syncErr > 0
          ? "ownerIntegritySyncErrors"
          : queueDegraded
            ? "ownerIntegrityQueueDegraded"
            : pending > 0
              ? "ownerIntegritySyncPending"
              : "ownerIntegrityOk",
      detailVars: { count: syncErr || pending },
      actionTo: "/settings/health",
    },
    {
      id: "queue",
      labelKey: "ownerIntegrityQueue",
      status: queueDegraded ? "critical" : pending > 50 ? "warning" : pending > 0 ? "warning" : "green",
      detailKey: queueDegraded ? "ownerIntegrityQueueDegraded" : pending > 0 ? "ownerIntegrityQueuePending" : "ownerIntegrityOk",
      detailVars: { count: pending },
      actionTo: "/settings/health",
    },
    {
      id: "drawer",
      labelKey: "ownerIntegrityDrawer",
      status: drawerConflict ? "critical" : "green",
      detailKey: drawerConflict ? "ownerIntegrityDrawerConflict" : "ownerIntegrityOk",
      detailVars: {
        mismatches: integrity.periodVerificationMismatches,
        conflicts: integrity.periodDrawerDuplicateOpens + integrity.periodDrawerDeviceConflicts,
      },
      actionTo: "/office/day-open",
    },
    {
      id: "devices",
      labelKey: "ownerIntegrityDevices",
      status: stale >= 2 ? "critical" : stale > 0 ? "warning" : "green",
      detailKey: stale > 0 ? "ownerIntegrityDevicesStale" : "ownerIntegrityOk",
      detailVars: { count: stale },
      actionTo: "/settings/devices",
    },
    {
      id: "restore",
      labelKey: "ownerIntegrityRestore",
      status: restoreWarn ? "warning" : "green",
      detailKey: restoreWarn ? "ownerIntegrityRestoreWarn" : "ownerIntegrityOk",
      actionTo: "/settings/health",
    },
    {
      id: "snapshot",
      labelKey: "ownerIntegritySnapshot",
      status: trimWarn ? "warning" : "green",
      detailKey: trimWarn ? "ownerIntegritySnapshotWarn" : "ownerIntegrityOk",
      actionTo: "/settings/health",
    },
    {
      id: "migration",
      labelKey: "ownerIntegrityMigration",
      status: opts?.migrationWarning ? "warning" : "green",
      detailKey: opts?.migrationWarning ? "ownerIntegrityMigrationWarn" : "ownerIntegrityOk",
      actionTo: "/settings/health",
    },
  ];

  void bounds;
  return signals;
}

export function buildDiagnosticsHints(input: {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  stockMovements: StockMovement[];
  suppliers: Supplier[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
}): { restoreStatus: string; snapshotTrimStatus: string } {
  const postRestore = buildPostRestoreValidationSnapshot({
    products: input.products,
    stockMovements: input.stockMovements,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
  });
  return {
    restoreStatus: postRestore.overallStatus,
    snapshotTrimStatus: "ok",
  };
}

export function buildSnapshotTrimStatus(snapshot: PersistedSnapshot): string {
  return analyzeSnapshotTrim(snapshot).status;
}
