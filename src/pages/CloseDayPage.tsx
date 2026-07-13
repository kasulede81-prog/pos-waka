import { actorHasPermission } from "../lib/actorAuthorization";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FormEvent } from "react";

import { Link, useSearchParams } from "react-router-dom";

import { AlertTriangle, Banknote, CalendarCheck } from "lucide-react";

import type { Language } from "../types";

import { t, tTemplate } from "../lib/i18n";

import { activeDayCloseForDate } from "../lib/dayCloseIdempotency";

import { ensureAllActiveSalesLoaded, usePosStore } from "../store/usePosStore";

import { dateKeyKampala } from "../lib/datesUg";

import { useDrawerCashForDay } from "../hooks/useDrawerCashForDay";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";

import { getCompletedFinancials } from "../lib/financialMetrics";

import { useReportingSales } from "../hooks/useReportingSales";

import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";

import { PageHeader } from "../components/layout/PageHeader";
import { EnterpriseApprovalPinPad } from "../components/auth/EnterpriseApprovalPinPad";

import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";

import { HistoryListCard } from "../components/shared/HistoryListCard";

import { useSessionActor } from "../context/SessionActorContext";



import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";

import { downloadDayClosePdf, printDayCloseReport, shareDayClosePdf } from "../lib/dayCloseDocument";

import { dateMatchesFilter, resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";

import { CloseDayPreflightPanel } from "../components/office/CloseDayPreflightPanel";

import {

  evaluateDayClosePreflightSync,

  runDayClosePreflight,

  type DayClosePreflightSnapshot,

} from "../lib/dayCloseEnforcement";
import { readSyncQueue } from "../offline/localDb";

import { dayCloseVarianceIsFlagged } from "../lib/dayCloseApprovals";
import { CashVarianceSummary } from "../components/cash/CashVarianceSummary";

import {
  findUnclosedPriorBusinessDays,
  resolvePrioritizedCloseDateKey,
} from "../lib/sequentialBusinessDays";



export function CloseDayPage({ lang }: { lang: Language }) {

  const [searchParams, setSearchParams] = useSearchParams();

  const actor = useSessionActor();

  const sales = useReportingSales(false);

  const products = usePosStore((s) => s.products);

  const returnRecords = useReportingReturnRecords(false);

  const dayCloses = usePosStore((s) => s.dayCloses);

  const preferences = usePosStore((s) => s.preferences);

  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);

  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const draftLines = usePosStore((s) => s.draftLines);

  const activePendingSaleId = usePosStore((s) => s.activePendingSaleId);

  const allSales = usePosStore((s) => s.sales);

  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

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

  const [counted, setCounted] = useState("");

  const [doneMsg, setDoneMsg] = useState(false);

  const [closeErrorKey, setCloseErrorKey] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState("");

  const [syncOverride, setSyncOverride] = useState(false);

  const [emergencyMode, setEmergencyMode] = useState(false);

  const [emergencyReason, setEmergencyReason] = useState("");

  const [reopenReason, setReopenReason] = useState("");

  const [preflight, setPreflight] = useState<DayClosePreflightSnapshot | null>(null);

  const [preflightLoading, setPreflightLoading] = useState(true);

  const [historyFilter, setHistoryFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });

  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem("waka-close-day-prefill");
      const prefillDate = sessionStorage.getItem("waka-close-day-prefill-date");
      if (prefill && (!prefillDate || prefillDate === closeDateKey)) {
        setCounted(prefill.replace(/\D/g, "").slice(0, 12));
        sessionStorage.removeItem("waka-close-day-prefill");
        sessionStorage.removeItem("waka-close-day-prefill-date");
      }
    } catch {
      /* ignore */
    }
  }, [closeDateKey]);

  useEffect(() => {
    if (window.location.hash !== "#cash-count") return;
    window.requestAnimationFrame(() => {
      document.getElementById("cash-count")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [closeDateKey, preflightLoading]);



  const historyBounds = useMemo(() => resolveDateFilterBounds(historyFilter), [historyFilter]);

  const filteredDayCloses = useMemo(

    () => dayCloses.filter((d) => dateMatchesFilter(d.dateKey, historyBounds)),

    [dayCloses, historyBounds],

  );



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



  const countedN = Math.max(0, Math.floor(Number(counted.replace(/\D/g, "")) || 0));

  const varianceDiff = countedN - summary.expectedCash;

  const varianceFlagged =

    counted.length > 0 && dayCloseVarianceIsFlagged(summary.expectedCash, varianceDiff, preferences);



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

      countedCashUgx: counted.length > 0 ? countedN : null,

      queue,

      variancePreferences: preferences,

    });

    setPreflight(result.snapshot);

  }, [closeDateKey, summary.expectedCash, counted, countedN, preferences]);

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

      countedCashUgx: counted.length > 0 ? countedN : null,

      variancePreferences: preferences,

    });

    setPreflight(result.snapshot);

    setPreflightLoading(false);

  }, [closeDateKey, summary.expectedCash, counted, countedN, preferences]);

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



  const submit = async (e: FormEvent) => {

    e.preventDefault();

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

      return;

    }

    setCounted("");

    setManagerPin("");

    setEmergencyMode(false);

    setDoneMsg(true);

    void refreshPreflightWithSync();

    window.setTimeout(() => setDoneMsg(false), 3000);

  };



  const submitEmergency = async () => {

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

    if (!result.ok) setCloseErrorKey(result.errorKey ?? "invalid");

    else {

      setDoneMsg(true);

      setEmergencyMode(false);

    }

  };




  const last = activeCloseToday ?? dayCloses.find((d) => d.dateKey === closeDateKey) ?? dayCloses[0];



  const pct = preferences.cashVarianceThresholdPct ?? 5;

  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;



  const closeVarianceFlag = (expected: number, diff: number) => {

    const exp = Math.max(1, expected);

    const absDiff = Math.abs(diff);

    return absDiff > Math.max((pct / 100) * exp, fixed);

  };



  const historySummary = useMemo(() => {

    let profit = 0;

    let varianceCount = 0;

    for (const d of filteredDayCloses) {

      profit += d.profitEstimateUgx;

      if (closeVarianceFlag(d.expectedCashUgx, d.differenceUgx)) varianceCount += 1;

    }

    return { count: filteredDayCloses.length, profit, varianceCount };

  }, [filteredDayCloses, pct, fixed]);



  const oldestUnclosedPriorDay = unclosedPriorDays[0] ?? null;

  const needsManagerPin =
    varianceFlagged || (Boolean(preflight?.requiresSyncOverride) && syncOverride);
  const pinConfigured =
    Boolean(preferences.backOfficePin?.trim()) ||
    (preferences.staffAccounts ?? []).some((s) => Boolean(s.pinHash || s.pin));
  const sessionCanApproveWithoutPin =
    !pinConfigured && ["owner", "manager", "supervisor"].includes(actor.role);
  const canSubmitNormal =
    preflight?.canClose &&
    (!needsManagerPin || managerPin.trim().length > 0 || sessionCanApproveWithoutPin) &&
    (!preflight?.requiresSyncOverride || syncOverride) &&
    !activeCloseToday;



  if (!actorHasPermission(actor, "day.close")) {

    return (

      <div className="space-y-4 pb-8">

        <PageHeader lang={lang} title={t(lang, "closeDay")} backLabel={t(lang, "officeBackToHub")} />

        <p className="text-lg text-muted-foreground">{t(lang, "noPermission")}</p>

      </div>

    );

  }



  const translateKey = (key: string) => (t as (l: Language, k: string) => string)(lang, key);



  return (

    <div className="space-y-4 pb-8">

      <PageHeader

        lang={lang}

        title={t(lang, "closeDay")}

        subtitle={t(lang, "closeDaySimpleHelp")}

        backLabel={t(lang, "officeBackToHub")}

        backFallback="/office/cash-drawer"

      />



      <div className="flex flex-wrap gap-2">

        <Link

          to="/office/x-report"

          className="rounded-2xl border border-border bg-card px-4 py-2 text-sm font-black text-waka-800"

        >

          {t(lang, "dayCloseXReportBtn")}

        </Link>

      </div>



      <section className="rounded-2xl border border-border bg-muted px-4 py-3">

        <p className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "dayCloseBusinessDate")}</p>

        <p className="text-lg font-black text-foreground">{closeDateKey}</p>

        {closeDateKey !== todayKey ? (
          <p className="mt-2 text-sm font-semibold text-amber-900">
            {tTemplate(lang, "closeDayPriorBanner", { date: closeDateKey, today: todayKey })}
          </p>
        ) : null}

      </section>

      {unclosedPriorDays.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-black uppercase text-amber-800">{t(lang, "closeDayPriorPicker")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unclosedPriorDays.map((dk) => (
              <button
                key={dk}
                type="button"
                disabled={oldestUnclosedPriorDay != null && dk !== oldestUnclosedPriorDay}
                onClick={() => setSearchParams({ date: dk })}
                className={
                  dk === closeDateKey
                    ? "rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white disabled:opacity-60"
                    : "rounded-xl border border-amber-300 bg-card px-3 py-2 text-sm font-bold text-amber-950 disabled:opacity-40"
                }
              >
                {dk}
              </button>
            ))}
          </div>
        </section>
      ) : null}



      <CloseDayPreflightPanel lang={lang} snapshot={preflight} loading={preflightLoading} />

      {preflight?.requiresSyncOverride ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-base font-black text-amber-950">{t(lang, "dayCloseSyncOverrideTitle")}</h2>
          <p className="mt-1 text-sm font-semibold text-amber-900">{t(lang, "dayCloseSyncOverrideBody")}</p>
          <button
            type="button"
            disabled={preflightLoading}
            onClick={() => void refreshPreflightWithSync()}
            className="mt-3 min-h-[44px] rounded-2xl border border-amber-300 bg-card px-4 text-sm font-black text-amber-950 disabled:opacity-50"
          >
            {preflightLoading ? t(lang, "dayClosePreflightLoading") : t(lang, "dayCloseSyncRetryBtn")}
          </button>
          <WakaSwitch
            className="mt-3 text-sm font-semibold text-amber-900"
            checked={syncOverride}
            onCheckedChange={setSyncOverride}
            label={t(lang, "dayCloseCheckCloudSyncFail")}
          />
        </section>
      ) : null}

      {(varianceFlagged || (Boolean(preflight?.requiresSyncOverride) && syncOverride)) &&
      !sessionCanApproveWithoutPin ? (
        <section className="rounded-3xl border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">{t(lang, "dayCloseVariancePinLabel")}</p>
          <EnterpriseApprovalPinPad
            lang={lang}
            preferences={preferences}
            persistOnSuccess
            className="mt-2"
            onApproved={(pin) => {
              setManagerPin(pin);
            }}
          />
          {managerPin.trim().length > 0 ? (
            <p className="mt-2 text-center text-sm font-bold text-emerald-700">{t(lang, "staffPinCaptured")}</p>
          ) : null}
        </section>
      ) : null}

      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">

        {t(lang, "closeDayTrustNote")}

      </p>



      <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">

        <div className="grid grid-cols-2 gap-3">

          <div className="rounded-2xl bg-muted px-3 py-3 col-span-2">

            <p className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "totalSales")}</p>

            <p className="mt-1 text-xl font-black text-foreground">UGX {summary.total.toLocaleString()}</p>

          </div>

          <div className="rounded-2xl border border-border bg-muted px-3 py-3 col-span-2">

            <p className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "closeDayExpectedTitle")}</p>

            <p className="mt-1 text-xl font-black text-foreground">UGX {summary.expectedCash.toLocaleString()}</p>

          </div>

        </div>

      </section>



      {!activeCloseToday ? (

        <form id="cash-count" onSubmit={submit} className="rounded-3xl border border-waka-200 bg-waka-50/70 p-4 scroll-mt-24">

          <label className="block text-base font-black text-waka-950">{t(lang, "closeCountedCash")}</label>

          <input

            value={counted}

            onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}

            inputMode="numeric"

            className="mt-2 w-full rounded-2xl border-2 border-waka-300 bg-card px-4 py-4 text-3xl font-black"

            placeholder="0"

          />

          {counted.length > 0 ? (
            <CashVarianceSummary
              lang={lang}
              expectedCashUgx={summary.expectedCash}
              countedCashUgx={countedN}
              preferences={preferences}
              context="day_close"
              showSettingsLink
              diagnosticEvent="day_close_preview"
              className="mt-4"
            />
          ) : null}

          <button

            type="submit"

            disabled={!canSubmitNormal && !emergencyMode}

            className="mt-5 w-full rounded-3xl bg-waka-600 py-4 text-xl font-black text-white disabled:opacity-40"

          >

            {t(lang, "closeConfirm")}

          </button>



          {closeErrorKey ? (

            <p className="mt-3 text-center text-sm font-bold text-red-700">{translateKey(closeErrorKey)}</p>

          ) : null}

        </form>

      ) : null}



      {activeCloseToday && actor.role === "owner" ? (

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">

          <h2 className="text-base font-black text-amber-950">{t(lang, "dayCloseReopenTitle")}</h2>

          <input

            value={reopenReason}

            onChange={(e) => setReopenReason(e.target.value)}

            placeholder={t(lang, "dayCloseReopenReason")}

            className="mt-3 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"

          />

          <EnterpriseApprovalPinPad
            lang={lang}
            preferences={preferences}
            disabled={!reopenReason.trim()}
            className="mt-3"
            onApproved={async (pin) => {
              setCloseErrorKey(null);
              const result = await reopenBusinessDay({ dateKey: closeDateKey, reason: reopenReason, ownerPin: pin });
              if (!result.ok) {
                setCloseErrorKey(result.errorKey ?? "invalid");
                return false;
              }
              setReopenReason("");
              void refreshPreflightWithSync();
              return true;
            }}
          />

        </section>

      ) : null}



      {!activeCloseToday ? (

        <section className="rounded-3xl border-2 border-rose-300 bg-rose-50 p-4">

          <h2 className="text-base font-black text-rose-950">{t(lang, "dayCloseEmergencyTitle")}</h2>

          <p className="mt-1 text-xs font-semibold text-rose-900">{t(lang, "dayCloseEmergencyWarning")}</p>

          <WakaSwitch
            className="mt-3 text-sm font-bold text-rose-950"
            checked={emergencyMode}
            onCheckedChange={setEmergencyMode}
            label={t(lang, "dayCloseEmergencyConfirm")}
          />

          {emergencyMode ? (

            <>

              <textarea

                value={emergencyReason}

                onChange={(e) => setEmergencyReason(e.target.value)}

                className="mt-2 w-full rounded-xl border border-rose-300 px-3 py-2 text-sm"

                rows={2}

                placeholder={t(lang, "dayCloseEmergencyReason")}

              />

              <EnterpriseApprovalPinPad
                lang={lang}
                preferences={preferences}
                disabled={!emergencyReason.trim()}
                className="mt-3"
                onApproved={(pin) => {
                  setManagerPin(pin);
                }}
              />

              <button

                type="button"

                onClick={() => void submitEmergency()}

                className="mt-3 min-h-[52px] w-full rounded-2xl bg-rose-700 font-black text-white"

              >

                {t(lang, "dayCloseEmergencyConfirm")}

              </button>

            </>

          ) : null}

        </section>

      ) : null}



      {dayReopenHistory.length > 0 ? (

        <section className="rounded-3xl border border-border bg-card p-4">

          <h2 className="text-base font-black text-foreground">{t(lang, "dayCloseReopenHistory")}</h2>

          <ul className="mt-2 space-y-2">

            {dayReopenHistory.slice(0, 10).map((r) => (

              <li key={r.id} className="text-xs font-semibold text-muted-foreground">

                {r.dateKey} · {r.reopenedByLabel} · {r.reason}

              </li>

            ))}

          </ul>

        </section>

      ) : null}



      {doneMsg && (

        <div className="space-y-3 rounded-2xl bg-foreground px-4 py-4 text-background">

          <p className="text-center text-lg font-bold">{t(lang, "closeSaved")}</p>

          {last && last.dateKey === closeDateKey ? (

            <DocumentActionsBar

              lang={lang}

              compact

              onPrint={() => void printDayCloseReport(lang, last, shopName)}

              onDownloadPdf={() =>

                void downloadDayClosePdf(lang, last, shopName).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))

              }

              onSharePdf={() =>

                void shareDayClosePdf(lang, last, shopName).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))

              }

            />

          ) : null}

        </div>

      )}



      {last && last.dateKey === closeDateKey && activeCloseToday ? (

        <section className="rounded-3xl border-2 border-border bg-muted p-5">

          <DocumentActionsBar

            lang={lang}

            onPrint={() => void printDayCloseReport(lang, last, shopName)}

            onDownloadPdf={() =>

              void downloadDayClosePdf(lang, last, shopName).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))

            }

            onSharePdf={() =>

              void shareDayClosePdf(lang, last, shopName).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))

            }

          />

          <p className="mt-4 text-lg font-black text-foreground">{t(lang, "closeLastDiff")}</p>

          <p className="mt-2 text-3xl font-black text-foreground">

            UGX {last.differenceUgx.toLocaleString()}

          </p>

        </section>

      ) : null}



      {actorHasPermission(actor, "owner.cash_history") ? (

        <section className="space-y-4">

          <h2 className="text-xl font-black text-foreground">{t(lang, "closeHistoryTitle")}</h2>

          <HistoryHeroCard

            lang={lang}

            filter={historyFilter}

            onFilterChange={setHistoryFilter}

            metrics={[

              { label: t(lang, "closeHistoryTitle"), icon: CalendarCheck, value: String(historySummary.count) },

              { label: t(lang, "closeHistoryProfit"), icon: Banknote, value: `UGX ${historySummary.profit.toLocaleString()}` },

              { label: t(lang, "ownerVarianceFlag"), icon: AlertTriangle, value: String(historySummary.varianceCount) },

            ]}

          />

          <HistoryListCard

            isEmpty={filteredDayCloses.length === 0}

            empty={<p className="text-sm font-semibold text-muted-foreground">{t(lang, "closeHistoryTitle")}</p>}

          >

            <ul>

              {filteredDayCloses.slice(0, 20).map((d) => (

                <li key={d.id} className="border-b border-border px-3 py-3 last:border-b-0">

                  <p className="text-sm font-black text-foreground">{d.dateKey}</p>

                  <p className="text-xs text-muted-foreground">

                    UGX {d.expectedCashUgx.toLocaleString()} / {d.countedCashUgx.toLocaleString()}

                  </p>

                </li>

              ))}

            </ul>

          </HistoryListCard>

        </section>

      ) : null}

    </div>

  );

}


