/**
 * Commercial day-close preflight — hard stops before business day can close.
 */

import type {
  DayCloseSummary,
  DayDrawerOpen,
  HospitalityFloorState,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  ShopPreferences,
  SyncOperation,
} from "../types";
import { activeDayDrawerOpenForDate, isFormulaV2 } from "./dayDrawerOpen";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { getDeviceOnline } from "./deviceOnline";
import { activeSessions, sessionBillTotal, sessionDisplayLabel } from "./hospitalityStats";
import { readSyncHealthMeta } from "./syncMeta";
import { findUnclosedPriorBusinessDays } from "./sequentialBusinessDays";
import { readSyncQueue } from "../offline/localDb";
import { dayCloseVarianceIsFlagged } from "./dayCloseApprovals";
import { dateKeyKampala, saleReportingDayKey } from "./datesUg";

export type DayClosePreflightItemId =
  | "day_open"
  | "drawer_open"
  | "no_open_shifts"
  | "no_hospitality"
  | "no_pending_sales"
  | "inventory_sync"
  | "cloud_sync"
  | "sequential_days"
  | "cash_counted"
  | "ready";

export type DayClosePreflightItemStatus = "pass" | "fail" | "warn" | "pending";

export type OpenShiftPreflightRow = {
  shiftId: string;
  actorUserId: string;
  actorName: string;
  role: string;
  startAt: string;
  deviceLabel: string;
};

export type HospitalityPreflightRow = {
  sessionId: string;
  label: string;
  waiterLabel: string | null;
  status: string;
  amountUgx: number;
  tableId: string | null;
};

export type DayClosePreflightItem = {
  id: DayClosePreflightItemId;
  status: DayClosePreflightItemStatus;
  labelKey: string;
  detailKey?: string;
  navigateTo?: string;
  blockClose: boolean;
  allowEmergencyOverride?: boolean;
};

export type PendingSyncBreakdown = {
  total: number;
  sales: number;
  returns: number;
  inventory: number;
  hospitality: number;
  dayCloses: number;
  shifts: number;
  staff: number;
  cashAdjustments: number;
  cashExpenses: number;
  dayDrawerOpens: number;
  purchases: number;
  queueOps: number;
  other: number;
};

export type PendingSalePreflightRow = {
  saleId: string;
  label: string;
  createdAt: string;
  totalUgx: number;
};

export type DayClosePreflightSnapshot = {
  dateKey: string;
  items: DayClosePreflightItem[];
  openShifts: OpenShiftPreflightRow[];
  hospitalitySessions: HospitalityPreflightRow[];
  pendingSales: PendingSalePreflightRow[];
  pendingSync: PendingSyncBreakdown;
  expectedCashUgx: number;
  canClose: boolean;
  requiresVarianceApproval: boolean;
  requiresSyncOverride: boolean;
  requiresManagerApproval: boolean;
  blockReasons: string[];
  warnings: string[];
};

export type DayClosePreflightState = {
  draftLines: { length: number };
  activePendingSaleId: string | null;
  sales: Sale[];
  preferences: Pick<ShopPreferences, "shifts" | "hospitalityFloor" | "cashDrawerFormulaVersion">;
  dayCloses: DayCloseSummary[];
  dayDrawerOpens: DayDrawerOpen[];
  products: Product[];
  returnRecords: ReturnRecord[];
  cashDrawerAdjustments: { pendingSync?: boolean }[];
  cashExpenses: { pendingSync?: boolean; deletedAt?: string | null }[];
  inventoryCountSessions: { pendingSync?: boolean; status?: string }[];
};

const STALE_RECONCILIATION_MS = 15 * 60_000;

function dateHasBusinessActivity(
  dateKey: string,
  sales: Sale[],
  shifts: ShiftRecord[],
  dayDrawerOpens: DayDrawerOpen[],
): boolean {
  for (const sale of sales) {
    if (saleReportingDayKey(sale) === dateKey) return true;
  }
  for (const sh of shifts) {
    if (dateKeyKampala(sh.startAt) === dateKey) return true;
  }
  for (const row of dayDrawerOpens) {
    if (!row.deletedAt && row.status !== "voided" && row.dateKey === dateKey) return true;
  }
  return false;
}

/** Pending sales / draft cart blocking close for a specific business date. */
export function collectPendingSalesBlockers(
  state: DayClosePreflightState,
  dateKey: string,
): PendingSalePreflightRow[] {
  const todayKey = dateKeyKampala(new Date());
  const rows: PendingSalePreflightRow[] = [];

  if (dateKey === todayKey && state.draftLines.length > 0) {
    rows.push({
      saleId: "draft-cart",
      label: "draft_cart",
      createdAt: new Date().toISOString(),
      totalUgx: 0,
    });
  }

  if (dateKey === todayKey && state.activePendingSaleId) {
    const active = state.sales.find(
      (s) => s.id === state.activePendingSaleId && s.status === "pending",
    );
    if (active && !rows.some((r) => r.saleId === active.id)) {
      rows.push({
        saleId: active.id,
        label: active.tableSessionId ? "table_sale" : "active_pending",
        createdAt: active.createdAt,
        totalUgx: active.totalUgx ?? 0,
      });
    }
  }

  for (const sale of state.sales) {
    if (sale.status !== "pending") continue;
    if (saleReportingDayKey(sale) !== dateKey) continue;
    if (rows.some((r) => r.saleId === sale.id)) continue;
    rows.push({
      saleId: sale.id,
      label: sale.tableSessionId ? "table_sale" : "pending_sale",
      createdAt: sale.createdAt,
      totalUgx: sale.totalUgx ?? 0,
    });
  }

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function countPendingSync(rows: { pendingSync?: boolean }[]): number {
  return rows.filter((r) => r.pendingSync).length;
}

/** Open shifts that block closing a specific business day (same Kampala date as shift start). */
export function collectOpenShifts(
  shifts: ShiftRecord[] | undefined,
  deviceLabelsById?: Record<string, string>,
  closeDateKey?: string,
): OpenShiftPreflightRow[] {
  return (shifts ?? [])
    .filter((sh) => {
      if (sh.endAt) return false;
      if (closeDateKey && dateKeyKampala(sh.startAt) !== closeDateKey) return false;
      return true;
    })
    .map((sh) => ({
      shiftId: sh.id,
      actorUserId: sh.actorUserId,
      actorName: sh.actorName?.trim() || sh.actorUserId,
      role: sh.role,
      startAt: sh.startAt,
      deviceLabel: deviceLabelsById?.[sh.actorUserId] ?? "—",
    }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function collectHospitalityBlockers(
  floor: HospitalityFloorState | undefined,
  sales: Sale[],
  closeDateKey?: string,
): HospitalityPreflightRow[] {
  if (!floor) return [];
  if (closeDateKey && closeDateKey !== dateKeyKampala(new Date())) return [];
  return activeSessions(floor).map((session) => ({
    sessionId: session.id,
    label: sessionDisplayLabel(session, floor),
    waiterLabel: session.waiterLabel?.trim() || null,
    status: session.status,
    amountUgx: sessionBillTotal(session, sales),
    tableId: session.tableId ?? null,
  }));
}

export function collectPendingSyncBreakdown(
  state: DayClosePreflightState,
  queue: SyncOperation[],
): PendingSyncBreakdown {
  const byKind: Record<string, number> = {};
  for (const op of queue) {
    byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  }

  const sales = state.sales.filter((s) => s.pendingSync).length;
  const returns = state.returnRecords.filter((r) => (r as { pendingSync?: boolean }).pendingSync).length;
  const inventory =
    countPendingSync(state.inventoryCountSessions) +
    state.products.filter((p) => (p as { pendingSync?: boolean }).pendingSync).length +
    (byKind.pending_stock_updates ?? 0) +
    (byKind.pending_inventory_counts ?? 0);
  const hospitality = byKind.pending_hospitality ?? 0;
  const dayCloses = countPendingSync(state.dayCloses);
  const shifts =
    (state.preferences.shifts ?? []).filter((sh) => sh.pendingSync).length + (byKind.pending_shifts ?? 0);
  const staff = byKind.pending_staff ?? 0;
  const cashAdjustments =
    countPendingSync(state.cashDrawerAdjustments) + (byKind.pending_cash_drawer_adjustments ?? 0);
  const cashExpenses =
    state.cashExpenses.filter((e) => e.pendingSync && !e.deletedAt).length +
    (byKind.pending_cash_expenses ?? 0);
  const dayDrawerOpens =
    countPendingSync(state.dayDrawerOpens) + (byKind.pending_day_drawer_opens ?? 0);
  const purchases = byKind.pending_purchases ?? 0;
  const queueOps = queue.length;

  const known =
    sales +
    returns +
    inventory +
    hospitality +
    dayCloses +
    shifts +
    staff +
    cashAdjustments +
    cashExpenses +
    dayDrawerOpens +
    purchases;
  const other = Math.max(0, queueOps - known);

  const total =
    sales +
    returns +
    inventory +
    hospitality +
    dayCloses +
    shifts +
    staff +
    cashAdjustments +
    cashExpenses +
    dayDrawerOpens +
    purchases +
    other;

  return {
    total,
    sales,
    returns,
    inventory,
    hospitality,
    dayCloses,
    shifts,
    staff,
    cashAdjustments,
    cashExpenses,
    dayDrawerOpens,
    purchases,
    queueOps,
    other,
  };
}

export function buildDayClosePreflightSnapshot(input: {
  state: DayClosePreflightState;
  dateKey: string;
  expectedCashUgx: number;
  countedCashUgx: number | null;
  queue?: SyncOperation[];
  cloudPullStale?: boolean;
  variancePreferences?: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
}): DayClosePreflightSnapshot {
  const { state, dateKey, expectedCashUgx } = input;
  const shifts = state.preferences.shifts ?? [];
  const openShifts = collectOpenShifts(shifts, undefined, dateKey);
  const hospitalitySessions = collectHospitalityBlockers(
    state.preferences.hospitalityFloor,
    state.sales,
    dateKey,
  );
  const pendingSalesRows = collectPendingSalesBlockers(state, dateKey);
  const pendingSync = collectPendingSyncBreakdown(state, input.queue ?? []);

  const hasPendingSales = pendingSalesRows.length > 0;

  const v2 = isFormulaV2(state.preferences);
  const dayOpen = activeDayDrawerOpenForDate(state.dayDrawerOpens, dateKey);
  const todayKey = dateKeyKampala(new Date());
  const closingPastDay = dateKey < todayKey;
  const dayOpenRequired = v2 && !closingPastDay;
  const dayOpenSatisfied =
    Boolean(dayOpen) ||
    (closingPastDay && dateHasBusinessActivity(dateKey, state.sales, shifts, state.dayDrawerOpens));
  const unclosedPrior = findUnclosedPriorBusinessDays({
    targetDateKey: dateKey,
    dayCloses: state.dayCloses,
    sales: state.sales,
    shifts,
    dayDrawerOpens: state.dayDrawerOpens,
  });

  const health = readSyncHealthMeta();
  const queueUnhealthy = health.queueHealth !== "healthy" || pendingSync.total > 0;
  const cloudStale =
    input.cloudPullStale ??
    (health.lastPullAt
      ? Date.now() - new Date(health.lastPullAt).getTime() > STALE_RECONCILIATION_MS
      : false);

  const counted = input.countedCashUgx;
  const hasCount = counted != null && counted >= 0;

  const items: DayClosePreflightItem[] = [
    {
      id: "day_open",
      status: dayOpenRequired ? (dayOpenSatisfied ? "pass" : "fail") : "pass",
      labelKey: "dayCloseCheckDayOpen",
      detailKey: dayOpenRequired && !dayOpenSatisfied ? "dayCloseCheckDayOpenFail" : undefined,
      navigateTo: "/office/day-open",
      blockClose: dayOpenRequired && !dayOpenSatisfied,
    },
    {
      id: "drawer_open",
      status: dayOpenRequired ? (dayOpenSatisfied ? "pass" : "fail") : "pass",
      labelKey: "dayCloseCheckDrawerOpen",
      navigateTo: "/office/day-open",
      blockClose: false,
    },
    {
      id: "sequential_days",
      status: unclosedPrior.length === 0 ? "pass" : "fail",
      labelKey: "dayCloseCheckSequential",
      detailKey: unclosedPrior.length > 0 ? "dayCloseCheckSequentialFail" : undefined,
      navigateTo: unclosedPrior.length > 0 ? `/close-day?date=${unclosedPrior[0]}` : "/close-day",
      blockClose: unclosedPrior.length > 0,
      allowEmergencyOverride: true,
    },
    {
      id: "no_open_shifts",
      status: openShifts.length === 0 ? "pass" : "fail",
      labelKey: "dayCloseCheckNoShifts",
      detailKey: openShifts.length > 0 ? "dayCloseCheckNoShiftsFail" : undefined,
      navigateTo: "/office/open-shifts",
      blockClose: openShifts.length > 0,
    },
    {
      id: "no_hospitality",
      status: hospitalitySessions.length === 0 ? "pass" : "fail",
      labelKey: "dayCloseCheckNoHospitality",
      detailKey: hospitalitySessions.length > 0 ? "dayCloseCheckNoHospitalityFail" : undefined,
      navigateTo: "/hospitality/floor",
      blockClose: hospitalitySessions.length > 0,
    },
    {
      id: "no_pending_sales",
      status: hasPendingSales ? "fail" : "pass",
      labelKey: "dayCloseCheckNoPendingSales",
      detailKey: hasPendingSales ? "dayCloseCheckNoPendingSalesFail" : undefined,
      navigateTo: "/pos",
      blockClose: hasPendingSales,
    },
    {
      id: "inventory_sync",
      status: pendingSync.inventory > 0 ? "warn" : "pass",
      labelKey: "dayCloseCheckInventorySync",
      detailKey: pendingSync.inventory > 0 ? "dayCloseCheckInventorySyncWarn" : undefined,
      navigateTo: "/stock/count",
      blockClose: false,
    },
    {
      id: "cloud_sync",
      status: queueUnhealthy || cloudStale ? "fail" : "pass",
      labelKey: "dayCloseCheckCloudSync",
      detailKey: queueUnhealthy ? "dayCloseCheckCloudSyncFail" : undefined,
      navigateTo: "/settings",
      blockClose: queueUnhealthy || cloudStale,
      allowEmergencyOverride: true,
    },
    {
      id: "cash_counted",
      status: hasCount ? "pass" : "pending",
      labelKey: "dayCloseCheckCashCounted",
      blockClose: !hasCount,
    },
    {
      id: "ready",
      status: "pending",
      labelKey: "dayCloseCheckReady",
      blockClose: false,
    },
  ];

  const blockReasons: string[] = [];
  if (openShifts.length > 0) blockReasons.push("open_shifts");
  if (hospitalitySessions.length > 0) blockReasons.push("hospitality_sessions");
  if (hasPendingSales) blockReasons.push("pending_sales");
  if (unclosedPrior.length > 0) blockReasons.push("sequential_days");
  if (dayOpenRequired && !dayOpenSatisfied) blockReasons.push("day_not_open");
  if (queueUnhealthy || cloudStale) blockReasons.push("sync_unhealthy");
  if (!hasCount) blockReasons.push("cash_not_counted");

  const warnings: string[] = [];
  if (pendingSync.inventory > 0) warnings.push("pending_inventory_sync");

  const diff = hasCount ? (counted ?? 0) - expectedCashUgx : 0;
  const requiresVarianceApproval =
    hasCount &&
    input.variancePreferences != null &&
    dayCloseVarianceIsFlagged(expectedCashUgx, diff, input.variancePreferences);

  const requiresSyncOverride = queueUnhealthy || cloudStale;
  const hardBlock = items.some((i) => i.blockClose && i.status === "fail");
  const canClose = !hardBlock && hasCount;

  const readyIdx = items.findIndex((i) => i.id === "ready");
  if (readyIdx >= 0) {
    items[readyIdx] = {
      ...items[readyIdx]!,
      status: canClose ? "pass" : hardBlock ? "fail" : "pending",
    };
  }

  return {
    dateKey,
    items,
    openShifts,
    hospitalitySessions,
    pendingSales: pendingSalesRows,
    pendingSync,
    expectedCashUgx,
    canClose,
    requiresVarianceApproval,
    requiresSyncOverride,
    requiresManagerApproval: requiresVarianceApproval || requiresSyncOverride,
    blockReasons,
    warnings,
  };
}

export type DayClosePreflightResult = {
  ok: boolean;
  snapshot: DayClosePreflightSnapshot;
  warnings: string[];
  errorKey?: string;
  blockReasons: string[];
};

export function evaluateDayClosePreflightSync(input: {
  state: DayClosePreflightState;
  dateKey: string;
  expectedCashUgx: number;
  countedCashUgx: number | null;
  queue?: SyncOperation[];
  cloudPullStale?: boolean;
  variancePreferences?: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
}): DayClosePreflightResult {
  const snapshot = buildDayClosePreflightSnapshot(input);
  const warnings = [...snapshot.warnings];
  if (snapshot.pendingSync.total > 0) {
    warnings.push(`pending_sync_total:${snapshot.pendingSync.total}`);
  }
  return {
    ok: snapshot.canClose,
    snapshot,
    warnings,
    blockReasons: snapshot.blockReasons,
    errorKey: snapshot.canClose ? undefined : snapshot.blockReasons[0],
  };
}

export async function runDayClosePreflight(input: {
  state: DayClosePreflightState;
  dateKey: string;
  expectedCashUgx: number;
  countedCashUgx: number | null;
  variancePreferences?: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
}): Promise<DayClosePreflightResult> {
  let cloudPullStale = false;
  const queue = await readSyncQueue();

  if (getDeviceOnline()) {
    try {
      const { syncShopWithCloud } = await import("../offline/cloudSync");
      const result = await syncShopWithCloud({ pull: true });
      if (result.queueFailed > 0 || result.push.fail > 0) {
        cloudPullStale = true;
      }
    } catch {
      cloudPullStale = true;
    }
  }

  return evaluateDayClosePreflightSync({
    ...input,
    queue,
    cloudPullStale,
  });
}

export function assertDayClosePreflightPassed(
  result: DayClosePreflightResult,
  opts?: { emergency?: boolean; syncOverride?: boolean; sequentialOverride?: boolean },
): { ok: true } | { ok: false; errorKey: string; snapshot: DayClosePreflightSnapshot } {
  const { snapshot } = result;
  if (snapshot.canClose) return { ok: true };

  const bypassSync = opts?.emergency || opts?.syncOverride;
  const bypassSequential = opts?.emergency || opts?.sequentialOverride;

  const blocking = snapshot.items.filter((i) => {
    if (!i.blockClose || i.status !== "fail") return false;
    if (i.id === "cloud_sync" && bypassSync) return false;
    if (i.id === "sequential_days" && bypassSequential) return false;
    if (opts?.emergency && i.allowEmergencyOverride) return false;
    return true;
  });

  if (blocking.length === 0 && snapshot.blockReasons.includes("cash_not_counted")) {
    return { ok: false, errorKey: "dayCloseCashCountRequired", snapshot };
  }
  if (blocking.length === 0) return { ok: true };

  const first = blocking[0]!;
  const errorMap: Partial<Record<DayClosePreflightItemId, string>> = {
    no_open_shifts: "dayCloseBlockedOpenShifts",
    no_hospitality: "dayCloseBlockedHospitality",
    no_pending_sales: "dayCloseBlockedPendingSales",
    cloud_sync: "dayCloseBlockedSync",
    sequential_days: "dayCloseBlockedSequential",
    day_open: "dayDrawerNotOpen",
    cash_counted: "dayCloseCashCountRequired",
  };
  return { ok: false, errorKey: errorMap[first.id] ?? "dayClosePreflightFailed", snapshot };
}

export function activeDayCloseBlocksOperations(dayCloses: DayCloseSummary[], dateKey: string): boolean {
  return Boolean(activeDayCloseForDate(dayCloses, dateKey));
}
