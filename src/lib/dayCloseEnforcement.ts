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

export type DayClosePreflightSnapshot = {
  dateKey: string;
  items: DayClosePreflightItem[];
  openShifts: OpenShiftPreflightRow[];
  hospitalitySessions: HospitalityPreflightRow[];
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

function countPendingSync(rows: { pendingSync?: boolean }[]): number {
  return rows.filter((r) => r.pendingSync).length;
}

export function collectOpenShifts(
  shifts: ShiftRecord[] | undefined,
  deviceLabelsById?: Record<string, string>,
): OpenShiftPreflightRow[] {
  return (shifts ?? [])
    .filter((sh) => !sh.endAt)
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
): HospitalityPreflightRow[] {
  if (!floor) return [];
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
  const openShifts = collectOpenShifts(shifts);
  const hospitalitySessions = collectHospitalityBlockers(state.preferences.hospitalityFloor, state.sales);
  const pendingSync = collectPendingSyncBreakdown(state, input.queue ?? []);

  const hasDraft = state.draftLines.length > 0;
  const activePending = state.activePendingSaleId
    ? state.sales.find((s) => s.id === state.activePendingSaleId && s.status === "pending")
    : null;
  const orphanPending = state.sales.some((s) => s.status === "pending");
  const hasPendingSales = hasDraft || Boolean(activePending) || orphanPending;

  const v2 = isFormulaV2(state.preferences);
  const dayOpen = activeDayDrawerOpenForDate(state.dayDrawerOpens, dateKey);
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
      : getDeviceOnline());

  const counted = input.countedCashUgx;
  const hasCount = counted != null && counted >= 0;

  const items: DayClosePreflightItem[] = [
    {
      id: "day_open",
      status: v2 ? (dayOpen ? "pass" : "fail") : "pass",
      labelKey: "dayCloseCheckDayOpen",
      detailKey: v2 && !dayOpen ? "dayCloseCheckDayOpenFail" : undefined,
      navigateTo: "/office/day-open",
      blockClose: v2 && !dayOpen,
    },
    {
      id: "drawer_open",
      status: v2 ? (dayOpen ? "pass" : "fail") : "pass",
      labelKey: "dayCloseCheckDrawerOpen",
      navigateTo: "/office/day-open",
      blockClose: false,
    },
    {
      id: "sequential_days",
      status: unclosedPrior.length === 0 ? "pass" : "fail",
      labelKey: "dayCloseCheckSequential",
      detailKey: unclosedPrior.length > 0 ? "dayCloseCheckSequentialFail" : undefined,
      navigateTo: "/close-day",
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
  if (v2 && !dayOpen) blockReasons.push("day_not_open");
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
