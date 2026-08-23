import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { actorHasPermission } from "../lib/actorAuthorization";
import { activeDayCloseForDate } from "../lib/dayCloseIdempotency";
import { dateKeyKampala } from "../lib/datesUg";
import {
  evaluateDayClosePreflightSync,
  runDayClosePreflight,
  type DayClosePreflightSnapshot,
} from "../lib/dayCloseEnforcement";
import { dayCloseVarianceIsFlagged } from "../lib/dayCloseApprovals";
import { getCompletedFinancials } from "../lib/financialMetrics";
import { buildCashPositionReport } from "../lib/cashPosition";
import {
  findUnclosedPriorBusinessDays,
  resolvePrioritizedCloseDateKey,
} from "../lib/sequentialBusinessDays";
import { readSyncQueue } from "../offline/localDb";
import { ensureAllActiveSalesLoaded, usePosStore } from "../store/usePosStore";
import { authOperatorRole } from "../lib/sessionActor";
import { useSessionActor } from "../context/SessionActorContext";
import { useDrawerCashForDay } from "./useDrawerCashForDay";
import { useReportingReturnRecords } from "./useReportingReturnRecords";
import { useReportingSales } from "./useReportingSales";
import { t } from "../lib/i18n";
import {
  clearDayCloseCashCountDraft,
  readDayCloseCashCountDraft,
  writeDayCloseCashCountDraft,
} from "../lib/dayCloseCashCountDraft";

/**
 * Phase 35.1 — shared close-day session state for the guided wizard.
 * Wraps existing preflight + recordDayClose APIs; no ledger changes.
 */
export function useEndOfDayCloseSession(lang: Language) {
  const [searchParams, setSearchParams] = useSearchParams();
  const actor = useSessionActor();
  const sales = useReportingSales(false);
  const products = usePosStore((s) => s.products);
  const returnRecords = useReportingReturnRecords(false);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const draftLines = usePosStore((s) => s.draftLines);
  const activePendingSaleId = usePosStore((s) => s.activePendingSaleId);
  const allSales = usePosStore((s) => s.sales);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const staffAccounts = usePosStore((s) => s.preferences.staffAccounts ?? []);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const recordDayClose = usePosStore((s) => s.recordDayClose);
  const reopenBusinessDay = usePosStore((s) => s.reopenBusinessDay);

  const todayKey = dateKeyKampala(new Date());
  const closeDateKey = useMemo(
    () =>
      resolvePrioritizedCloseDateKey({
        preferredDateKey: searchParams.get("date"),
        todayDateKey: todayKey,
        dayCloses,
        sales: allSales,
        shifts,
        dayDrawerOpens,
      }),
    [searchParams, todayKey, dayCloses, allSales, shifts, dayDrawerOpens],
  );

  const unclosedPriorDays = useMemo(
    () =>
      findUnclosedPriorBusinessDays({
        targetDateKey: todayKey,
        dayCloses,
        sales: allSales,
        shifts,
        dayDrawerOpens,
      }),
    [todayKey, dayCloses, allSales, shifts, dayDrawerOpens],
  );

  const [counted, setCountedState] = useState("");
  const countedDateRef = useRef<string | null>(null);
  if (countedDateRef.current !== closeDateKey) {
    countedDateRef.current = closeDateKey;
    const draft = readDayCloseCashCountDraft(closeDateKey) ?? "";
    if (draft !== counted) {
      setCountedState(draft);
    }
  }
  const setCounted = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, 12);
      setCountedState(digits);
      writeDayCloseCashCountDraft(closeDateKey, digits);
    },
    [closeDateKey],
  );
  const [doneMsg, setDoneMsg] = useState(false);
  const [closeErrorKey, setCloseErrorKey] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState("");
  const [syncOverride, setSyncOverride] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [preflight, setPreflight] = useState<DayClosePreflightSnapshot | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);

  const activeCloseToday = activeDayCloseForDate(dayCloses, closeDateKey);
  const dayReopenHistory = preferences.dayReopenHistory ?? [];
  const drawer = useDrawerCashForDay(closeDateKey);

  const summary = useMemo(
    () => ({
      cash: drawer.cashFromSalesUgx,
      debt: drawer.debtIssuedUgx,
      debtCollected: drawer.debtCollectedUgx,
      expectedCash: drawer.expectedDrawerCashUgx,
      total: drawer.revenueUgx,
      saleCount: getCompletedFinancials(sales, returnRecords, products, { day: closeDateKey }).transactionCount,
      refundsUgx: drawer.refundsUgx,
      expenseUgx: drawer.expenseUgx,
      supplierPaymentsUgx: drawer.supplierPaymentsUgx,
      openingFloatUgx: drawer.openingFloatUgx,
      adjustmentInflowsUgx: drawer.adjustmentInflowsUgx,
      adjustmentOutflowsUgx: drawer.adjustmentOutflowsUgx,
    }),
    [drawer, sales, returnRecords, products, closeDateKey],
  );

  const countedDigits = counted.replace(/\D/g, "") || readDayCloseCashCountDraft(closeDateKey) || "";
  const countedN = Math.max(0, Math.floor(Number(countedDigits) || 0));
  const varianceDiff = countedN - summary.expectedCash;
  const varianceFlagged =
    countedDigits.length > 0 && dayCloseVarianceIsFlagged(summary.expectedCash, varianceDiff, preferences);

  const tenderReport = useMemo(
    () =>
      buildCashPositionReport({
        lang,
        dayKey: closeDateKey,
        shopName,
        sales,
        products,
        returnRecords,
        debtPayments,
        cashExpenses,
        supplierPayments,
        cashDrawerAdjustments,
        shifts,
        dayDrawerOpens,
        formulaVersion: preferences.cashDrawerFormulaVersion ?? "v1",
        staffAccounts,
        generalCategoryLabel: t(lang, "uncategorized") || "General",
      }),
    [
      lang,
      closeDateKey,
      shopName,
      sales,
      products,
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments,
      shifts,
      dayDrawerOpens,
      preferences.cashDrawerFormulaVersion,
      staffAccounts,
    ],
  );

  const refreshPreflightQuick = useCallback(async () => {
    const state = usePosStore.getState();
    const queue = await readSyncQueue();
    const result = evaluateDayClosePreflightSync({
      state: {
        draftLines: state.draftLines,
        activePendingSaleId: state.activePendingSaleId,
        sales: state.sales,
        preferences: state.preferences,
        dayCloses: state.dayCloses,
        dayDrawerOpens: state.dayDrawerOpens,
        products: state.products,
        returnRecords: state.returnRecords,
        cashDrawerAdjustments: state.cashDrawerAdjustments,
        cashExpenses: state.cashExpenses,
        inventoryCountSessions: state.inventoryCountSessions,
      },
      dateKey: closeDateKey,
      expectedCashUgx: summary.expectedCash,
      countedCashUgx: countedDigits.length > 0 ? countedN : null,
      queue,
      variancePreferences: preferences,
    });
    setPreflight(result.snapshot);
  }, [closeDateKey, summary.expectedCash, countedDigits, countedN, preferences]);

  const refreshPreflightWithSync = useCallback(async () => {
    setPreflightLoading(true);
    const state = usePosStore.getState();
    const result = await runDayClosePreflight({
      state: {
        draftLines: state.draftLines,
        activePendingSaleId: state.activePendingSaleId,
        sales: state.sales,
        preferences: state.preferences,
        dayCloses: state.dayCloses,
        dayDrawerOpens: state.dayDrawerOpens,
        products: state.products,
        returnRecords: state.returnRecords,
        cashDrawerAdjustments: state.cashDrawerAdjustments,
        cashExpenses: state.cashExpenses,
        inventoryCountSessions: state.inventoryCountSessions,
      },
      dateKey: closeDateKey,
      expectedCashUgx: summary.expectedCash,
      countedCashUgx: countedDigits.length > 0 ? countedN : null,
      variancePreferences: preferences,
    });
    setPreflight(result.snapshot);
    setPreflightLoading(false);
  }, [closeDateKey, summary.expectedCash, countedDigits, countedN, preferences]);

  const initialSyncDone = useRef(false);
  useEffect(() => {
    initialSyncDone.current = false;
  }, [closeDateKey]);

  useEffect(() => {
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      void refreshPreflightWithSync();
      return;
    }
    void refreshPreflightQuick();
  }, [
    refreshPreflightQuick,
    refreshPreflightWithSync,
    draftLines.length,
    activePendingSaleId,
    allSales.length,
    dayCloses.length,
    dayDrawerOpens.length,
    cashDrawerAdjustments.length,
  ]);

  const submitClose = useCallback(async () => {
    setCloseErrorKey(null);
    await ensureAllActiveSalesLoaded();
    const result = await recordDayClose({
      dateKey: closeDateKey,
      countedCashUgx: countedN,
      override: false,
      overrideReason: undefined,
      emergency: emergencyMode,
      emergencyReason: emergencyMode ? emergencyReason : undefined,
      managerPin: managerPin || undefined,
      syncOverride,
      varianceOverride: varianceFlagged && managerPin.trim().length > 0,
    });
    if (!result.ok) {
      setCloseErrorKey(result.errorKey ?? "invalid");
      void refreshPreflightWithSync();
      return false;
    }
    setCounted("");
    clearDayCloseCashCountDraft(closeDateKey);
    setManagerPin("");
    setEmergencyMode(false);
    setDoneMsg(true);
    void refreshPreflightWithSync();
    window.setTimeout(() => setDoneMsg(false), 3000);
    return true;
  }, [
    closeDateKey,
    countedN,
    emergencyMode,
    emergencyReason,
    managerPin,
    recordDayClose,
    refreshPreflightWithSync,
    syncOverride,
    varianceFlagged,
  ]);

  const submitEmergency = useCallback(async () => {
    setCloseErrorKey(null);
    await ensureAllActiveSalesLoaded();
    const result = await recordDayClose({
      dateKey: closeDateKey,
      countedCashUgx: countedN,
      emergency: true,
      emergencyReason,
      managerPin,
      syncOverride: true,
      sequentialOverride: true,
      varianceOverride: true,
    });
    if (!result.ok) {
      setCloseErrorKey(result.errorKey ?? "invalid");
      return false;
    }
    setCounted("");
    clearDayCloseCashCountDraft(closeDateKey);
    setDoneMsg(true);
    setEmergencyMode(false);
    return true;
  }, [closeDateKey, countedN, emergencyReason, managerPin, recordDayClose]);

  const needsManagerPin =
    varianceFlagged || (Boolean(preflight?.requiresSyncOverride) && syncOverride);
  const pinConfigured =
    Boolean(preferences.backOfficePin?.trim()) ||
    (preferences.staffAccounts ?? []).some((s) => Boolean(s.pinHash || s.pin));
  const sessionCanApproveWithoutPin =
    !pinConfigured && ["owner", "manager", "supervisor"].includes(authOperatorRole(actor));
  const canSubmitNormal = Boolean(
    preflight?.canClose &&
      (!needsManagerPin || managerPin.trim().length > 0 || sessionCanApproveWithoutPin) &&
      (!preflight?.requiresSyncOverride || syncOverride) &&
      !activeCloseToday,
  );

  const last = activeCloseToday ?? dayCloses.find((d) => d.dateKey === closeDateKey) ?? dayCloses[0];
  const oldestUnclosedPriorDay = unclosedPriorDays[0] ?? null;
  const canAccess = actorHasPermission(actor, "day.close");

  return {
    lang,
    actor,
    canAccess,
    preferences,
    shopName,
    todayKey,
    closeDateKey,
    setCloseDateKey: (dk: string) => setSearchParams({ date: dk }),
    unclosedPriorDays,
    oldestUnclosedPriorDay,
    counted,
    setCounted,
    countedN,
    varianceDiff,
    varianceFlagged,
    summary,
    tenderReport,
    drawer,
    preflight,
    preflightLoading,
    refreshPreflightWithSync,
    syncOverride,
    setSyncOverride,
    managerPin,
    setManagerPin,
    needsManagerPin,
    sessionCanApproveWithoutPin,
    canSubmitNormal,
    emergencyMode,
    setEmergencyMode,
    emergencyReason,
    setEmergencyReason,
    submitClose,
    submitEmergency,
    closeErrorKey,
    setCloseErrorKey,
    doneMsg,
    activeCloseToday,
    last,
    dayReopenHistory,
    reopenReason,
    setReopenReason,
    reopenBusinessDay,
    dayCloses,
  };
}

export type EndOfDayCloseSession = ReturnType<typeof useEndOfDayCloseSession>;
