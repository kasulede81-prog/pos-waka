/**
 * Owner command center — surfaces existing store data (no new ledger math).
 */

import type {
  AuditLogEntry,
  CashDrawerAdjustment,
  CashExpense,
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
  revenueSalesInBoundsFromIndex,
  returnsInBounds,
} from "./dateFilters";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";
import { sumDebtPaymentsInBounds } from "./customerDebtActivity";
import { sumCashExpensesInBounds } from "./cashReconciliation";
import { isLowStock } from "./sellingEngine";
import { buildInventoryCountVarianceReport } from "./inventoryCount";
import type { OwnerAlert } from "./ownerAlerts";
import type { OwnerAlertAcknowledgement } from "./ownerAlertAcknowledgement";
import {
  auditCenterLinkFromFilter,
  ownerRiskCardTitle,
  type OwnerRiskCard,
} from "./ownerRiskDashboard";
import type { OwnerDashboardIntegritySnapshot } from "./ownerDashboardIntegrityCache";
import type { DebtPayment, StockMovement } from "../types";

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
  acknowledgeable?: boolean;
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
  lifetimeShortageCount: number;
  lifetimeShortageUgx: number;
  shortageCount30d: number;
  isRepeatOffender: boolean;
};

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

export type OwnerCashControlSnapshot = {
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
  adjustmentFeed: CashAdjustmentFeedRow[];
  floatVerificationFeed: FloatVerificationFeedRow[];
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
  expensesTodayUgx: number;
  expensesPeriodUgx: number;
  expensesPriorPeriodUgx: number;
  topSuppliers: Array<{ id: string; name: string; balanceOwedUgx: number }>;
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
  cashExpenses: CashExpense[];
  debtPayments: DebtPayment[];
  stockMovements: StockMovement[];
  inventoryCountSessions: InventoryCountSession[];
  auditLogs: AuditLogEntry[];
  voidRecords: VoidRecord[];
  returnRecords: ReturnRecord[];
  ownerAlertsResolved: OwnerAlert[];
  riskCards: OwnerRiskCard[];
  acknowledgements: OwnerAlertAcknowledgement[];
  expectedCashUgx: number;
  pharmacyMode: boolean;
  syncPendingCount: number;
  syncErrorCount: number;
};

type ReadinessStatus = "pass" | "warning" | "fail";

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

function resolveOwnerAlertAction(alert: OwnerAlert): { actionTo: string; actionLabelKey: string } {
  if (alert.id === "low-stock" || alert.id.startsWith("fast-burn")) {
    return { actionTo: "/stock", actionLabelKey: "ownerAttentionActionStock" };
  }
  if (alert.id.startsWith("variance-") || alert.id === "cash-short-today") {
    return { actionTo: "/close-day", actionLabelKey: "ownerAttentionActionClose" };
  }
  if (alert.id === "debt-high") {
    return { actionTo: "/customers", actionLabelKey: "ownerAttentionActionDebts" };
  }
  if (
    alert.id === "stock-movements" ||
    alert.id === "products-removed-review" ||
    alert.id.startsWith("manual-stock")
  ) {
    return { actionTo: "/stock", actionLabelKey: "ownerAttentionActionStock" };
  }
  if (alert.id === "refunds-many") {
    return { actionTo: "/office/audit-center", actionLabelKey: "ownerAttentionActionInvestigate" };
  }
  return { actionTo: "/office/audit-center", actionLabelKey: "ownerAttentionActionReview" };
}

export function ownerAlertToAttentionItem(alert: OwnerAlert): AttentionItem {
  const amountUgx = parseAmountFromVars(alert.detailVars);
  const route = resolveOwnerAlertAction(alert);
  return {
    id: `alert-${alert.id}`,
    severity: alertToneToSeverity(alert.tone),
    titleKey: alert.title,
    titleVars: alert.titleVars,
    detailKey: alert.detail,
    detailVars: alert.detailVars,
    amountUgx,
    actionTo: route.actionTo,
    actionLabelKey: route.actionLabelKey,
    acknowledgeable: alert.tone !== "info",
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

export function buildDrawerConflictAttentionItems(
  integrity: OwnerDashboardIntegritySnapshot,
): AttentionItem[] {
  const conflicts =
    integrity.periodDrawerDuplicateOpens > 0 ||
    integrity.periodDrawerDeviceConflicts > 0 ||
    integrity.periodDrawerUnsynced > 0;
  if (!conflicts) return [];
  return [
    {
      id: "drawer-cloud-conflict",
      severity: "critical",
      titleKey: "ownerAttentionDrawerConflict",
      titleVars: {
        conflicts: integrity.periodDrawerDuplicateOpens + integrity.periodDrawerDeviceConflicts,
      },
      actionTo: "/office/day-open",
      actionLabelKey: "ownerAttentionActionDrawer",
      acknowledgeable: true,
    },
  ];
}

export function buildSupplierOwedAttentionItems(suppliers: Supplier[]): AttentionItem[] {
  const owed = suppliers
    .filter((s) => (s.balanceOwedUgx ?? 0) > 0)
    .sort((a, b) => (b.balanceOwedUgx ?? 0) - (a.balanceOwedUgx ?? 0));
  if (owed.length === 0) return [];
  const top = owed[0]!;
  if ((top.balanceOwedUgx ?? 0) < 10_000 && owed.length === 1) return [];
  return [
    {
      id: "supplier-payables",
      severity: owed.some((s) => (s.balanceOwedUgx ?? 0) >= 100_000) ? "critical" : "warning",
      titleKey: "ownerAttentionSupplierOwed",
      titleVars: { count: owed.length, name: top.name },
      amountUgx: top.balanceOwedUgx ?? 0,
      actionTo: "/suppliers",
      actionLabelKey: "ownerAttentionActionSuppliers",
      acknowledgeable: true,
    },
  ];
}

export function buildAttentionCenter(
  input: OwnerCommandCenterInput,
  integrity: OwnerDashboardIntegritySnapshot,
): {
  critical: AttentionItem[];
  warnings: AttentionItem[];
  information: AttentionItem[];
} {
  const syncErrors = input.syncErrorCount > 0 ? input.syncErrorCount : integrity.syncStats.errorCount;
  const unsynced = input.syncPendingCount > 0 ? input.syncPendingCount : integrity.syncStats.unsyncedCount;

  const integrityItems: AttentionItem[] = [];
  if (!integrity.debtIntegrity.ok) {
    integrityItems.push({
      id: "debt-integrity",
      severity: "critical",
      titleKey: "ownerAttentionDebtIntegrity",
      titleVars: { count: integrity.debtIntegrity.mismatches.length },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionIntegrity",
      acknowledgeable: true,
    });
  }
  if (!integrity.inventoryIntegrity.ok) {
    integrityItems.push({
      id: "inventory-integrity",
      severity: "critical",
      titleKey: "ownerAttentionInventoryIntegrity",
      titleVars: { count: integrity.inventoryIntegrity.mismatches.length },
      actionTo: "/settings/health",
      actionLabelKey: "ownerAttentionActionIntegrity",
      acknowledgeable: true,
    });
  }

  const all: AttentionItem[] = [
    ...input.ownerAlertsResolved.map(ownerAlertToAttentionItem),
    ...input.riskCards.map((c) => riskCardToAttentionItem(input.lang, c, input.bounds)),
    ...buildCountVarianceAttentionItems(input.inventoryCountSessions),
    ...buildSyncAttentionItems(syncErrors, unsynced),
    ...integrityItems,
    ...buildDrawerConflictAttentionItems(integrity),
    ...buildSupplierOwedAttentionItems(input.suppliers),
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

export function buildIntegritySignals(
  integrity: OwnerDashboardIntegritySnapshot,
  bounds: DateFilterBounds,
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

  const signals: IntegritySignal[] = [
    {
      id: "debt",
      labelKey: "ownerIntegrityDebt",
      status: readinessToIntegrity(integrity.debtCheck.status),
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
      status: readinessToIntegrity(integrity.inventoryCheck.status),
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
  ];

  void bounds;
  return signals;
}

export function buildShiftAccountabilityRows(
  shifts: ShiftRecord[],
  bounds: DateFilterBounds,
  lang: Language,
  historicalStats: Map<
    string,
    {
      lifetimeShortageCount: number;
      lifetimeShortageUgx: number;
      shortageCount30d: number;
      shortageUgx30d: number;
      overageCount: number;
      cumulativeOverageUgx: number;
      floatMismatchCount: number;
    }
  >,
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
    const hist = historicalStats.get(userId) ?? {
      lifetimeShortageCount: 0,
      lifetimeShortageUgx: 0,
      shortageCount30d: 0,
      shortageUgx30d: 0,
      overageCount: 0,
      cumulativeOverageUgx: 0,
      floatMismatchCount: 0,
    };

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

    const isRepeatOffender =
      hist.lifetimeShortageCount >= 2 ||
      hist.lifetimeShortageUgx >= 10_000 ||
      hist.shortageCount30d >= 2;
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
      lifetimeShortageCount: hist.lifetimeShortageCount,
      lifetimeShortageUgx: hist.lifetimeShortageUgx,
      shortageCount30d: hist.shortageCount30d,
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
  const floatVerificationFeed: FloatVerificationFeedRow[] = [];
  let shortageShiftCount = 0;
  let overageShiftCount = 0;
  let floatMismatchCount = 0;

  for (const sh of input.shifts) {
    if (!shiftInBounds(sh, input.bounds)) continue;
    const label = sh.actorName ?? actorDisplayLabel(sh.actorUserId, input.lang);
    if (sh.cashDifferenceUgx != null && sh.cashDifferenceUgx !== 0) {
      const kind = sh.cashDifferenceUgx < 0 ? "shortage" : "overage";
      if (kind === "shortage") shortageShiftCount += 1;
      else overageShiftCount += 1;
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

  const adjustmentFeed: CashAdjustmentFeedRow[] = [];
  let inflowUgx = 0;
  let outflowUgx = 0;
  let adjCount = 0;
  for (const adj of input.cashDrawerAdjustments) {
    if (!adjustmentInBounds(adj, input.bounds)) continue;
    adjCount += 1;
    const isIn = INFLOW_ADJUSTMENT.has(adj.type);
    if (isIn) inflowUgx += adj.amountUgx;
    else outflowUgx += adj.amountUgx;
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
  cashExpenses: CashExpense[];
  bounds: DateFilterBounds;
  salesIndex?: import("./financialMetrics").RevenueSalesIndex;
}): OwnerFinancialSnapshot {
  const scopedSales = input.salesIndex
    ? revenueSalesInBoundsFromIndex(input.salesIndex, input.bounds)
    : revenueSalesInBounds(input.sales, input.bounds);
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

  const expensesPeriodUgx = sumCashExpensesInBounds(input.cashExpenses, input.bounds);
  const todayKey = dateKeyKampala(new Date());
  const expensesTodayUgx = sumCashExpensesInBounds(input.cashExpenses, {
    fromKey: todayKey,
    toKey: todayKey,
    isSingleDay: true,
  });
  const daySpan =
    Math.max(
      1,
      Math.round(
        (Date.parse(`${input.bounds.toKey}T12:00:00.000Z`) -
          Date.parse(`${input.bounds.fromKey}T12:00:00.000Z`)) /
          86400000,
      ) + 1,
    );
  const priorToKey = dateKeyKampala(new Date(Date.parse(`${input.bounds.fromKey}T12:00:00.000Z`) - 86400000));
  const priorFromKey = dateKeyKampala(
    new Date(Date.parse(`${input.bounds.fromKey}T12:00:00.000Z`) - daySpan * 86400000),
  );
  const expensesPriorPeriodUgx = sumCashExpensesInBounds(input.cashExpenses, {
    fromKey: priorFromKey,
    toKey: priorToKey,
    isSingleDay: priorFromKey === priorToKey,
  });

  const topSuppliers = [...input.suppliers]
    .filter((s) => (s.balanceOwedUgx ?? 0) > 0)
    .sort((a, b) => (b.balanceOwedUgx ?? 0) - (a.balanceOwedUgx ?? 0))
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, balanceOwedUgx: s.balanceOwedUgx ?? 0 }));

  return {
    debtCollectedUgx: sumDebtPaymentsInBounds(input.debtPayments, input.bounds),
    receivablesUgx: input.customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0),
    payablesUgx: input.suppliers.reduce((sum, s) => sum + Math.max(0, s.balanceOwedUgx ?? 0), 0),
    expensesTodayUgx,
    expensesPeriodUgx,
    expensesPriorPeriodUgx,
    topSuppliers,
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
