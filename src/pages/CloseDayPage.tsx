import { useCallback, useEffect, useMemo, useState } from "react";

import type { FormEvent } from "react";

import { Link } from "react-router-dom";

import { AlertTriangle, Banknote, CalendarCheck } from "lucide-react";

import type { Language } from "../types";

import { t } from "../lib/i18n";

import { activeDayCloseForDate } from "../lib/dayCloseIdempotency";

import { ensureAllActiveSalesLoaded, usePosStore } from "../store/usePosStore";

import { dateKeyKampala } from "../lib/datesUg";

import { useDrawerCashForToday } from "../hooks/useDrawerCashForDay";

import { getCompletedFinancials } from "../lib/financialMetrics";

import { useReportingSales } from "../hooks/useReportingSales";

import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";

import { PageHeader } from "../components/layout/PageHeader";

import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";

import { HistoryListCard } from "../components/shared/HistoryListCard";

import { useSessionActor } from "../context/SessionActorContext";

import { hasPermission } from "../lib/permissions";

import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";

import { downloadDayClosePdf, printDayCloseReport, shareDayClosePdf } from "../lib/dayCloseDocument";

import { dateMatchesFilter, resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";

import { CloseDayPreflightPanel } from "../components/office/CloseDayPreflightPanel";

import {

  evaluateDayClosePreflightSync,

  type DayClosePreflightSnapshot,

} from "../lib/dayCloseEnforcement";

import { dayCloseVarianceIsFlagged } from "../lib/dayCloseApprovals";

import { readSyncQueue } from "../offline/localDb";



export function CloseDayPage({ lang }: { lang: Language }) {

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

  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";

  const recordDayClose = usePosStore((s) => s.recordDayClose);

  const reopenBusinessDay = usePosStore((s) => s.reopenBusinessDay);



  const todayKey = dateKeyKampala(new Date());

  const [counted, setCounted] = useState("");

  const [doneMsg, setDoneMsg] = useState(false);

  const [closeErrorKey, setCloseErrorKey] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState("");

  const [syncOverride, setSyncOverride] = useState(false);

  const [emergencyMode, setEmergencyMode] = useState(false);

  const [emergencyReason, setEmergencyReason] = useState("");

  const [reopenReason, setReopenReason] = useState("");

  const [reopenPin, setReopenPin] = useState("");

  const [preflight, setPreflight] = useState<DayClosePreflightSnapshot | null>(null);

  const [preflightLoading, setPreflightLoading] = useState(true);

  const [historyFilter, setHistoryFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });



  const historyBounds = useMemo(() => resolveDateFilterBounds(historyFilter), [historyFilter]);

  const filteredDayCloses = useMemo(

    () => dayCloses.filter((d) => dateMatchesFilter(d.dateKey, historyBounds)),

    [dayCloses, historyBounds],

  );



  const activeCloseToday = activeDayCloseForDate(dayCloses, todayKey);

  const dayReopenHistory = preferences.dayReopenHistory ?? [];



  const drawer = useDrawerCashForToday();



  const summary = useMemo(

    () => ({

      cash: drawer.cashFromSalesUgx,

      debt: drawer.debtIssuedUgx,

      debtCollected: drawer.debtCollectedUgx,

      expectedCash: drawer.expectedDrawerCashUgx,

      total: drawer.revenueUgx,

      saleCount: getCompletedFinancials(sales, returnRecords, products, { day: todayKey }).transactionCount,

      refundsUgx: drawer.refundsUgx,

      expenseUgx: drawer.expenseUgx,

      supplierPaymentsUgx: drawer.supplierPaymentsUgx,

      openingFloatUgx: drawer.openingFloatUgx,

      adjustmentInflowsUgx: drawer.adjustmentInflowsUgx,

      adjustmentOutflowsUgx: drawer.adjustmentOutflowsUgx,

    }),

    [drawer, sales, returnRecords, products, todayKey],

  );



  const countedN = Math.max(0, Math.floor(Number(counted.replace(/\D/g, "")) || 0));

  const varianceDiff = countedN - summary.expectedCash;

  const varianceFlagged =

    counted.length > 0 && dayCloseVarianceIsFlagged(summary.expectedCash, varianceDiff, preferences);



  const refreshPreflight = useCallback(async () => {

    setPreflightLoading(true);

    const queue = await readSyncQueue();

    const state = usePosStore.getState();

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

      dateKey: todayKey,

      expectedCashUgx: summary.expectedCash,

      countedCashUgx: counted.length > 0 ? countedN : null,

      queue,

      variancePreferences: preferences,

    });

    setPreflight(result.snapshot);

    setPreflightLoading(false);

  }, [todayKey, summary.expectedCash, counted, countedN, preferences]);



  useEffect(() => {

    void refreshPreflight();

  }, [

    refreshPreflight,

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

      dateKey: todayKey,

      countedCashUgx: countedN,

      override: false,
      overrideReason: undefined,

      emergency: emergencyMode,

      emergencyReason: emergencyMode ? emergencyReason : undefined,

      managerPin: managerPin || undefined,

      syncOverride,

      varianceOverride: varianceFlagged,

    });

    if (!result.ok) {

      setCloseErrorKey(result.errorKey ?? "invalid");

      void refreshPreflight();

      return;

    }

    setCounted("");

    setManagerPin("");

    setEmergencyMode(false);

    setDoneMsg(true);

    void refreshPreflight();

    window.setTimeout(() => setDoneMsg(false), 3000);

  };



  const submitEmergency = async () => {

    setCloseErrorKey(null);

    await ensureAllActiveSalesLoaded();

    const result = await recordDayClose({

      dateKey: todayKey,

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



  const submitReopen = () => {

    setCloseErrorKey(null);

    const result = reopenBusinessDay({ dateKey: todayKey, reason: reopenReason, ownerPin: reopenPin });

    if (!result.ok) setCloseErrorKey(result.errorKey ?? "invalid");

    else {

      setReopenReason("");

      setReopenPin("");

      void refreshPreflight();

    }

  };



  const last = activeCloseToday ?? dayCloses.find((d) => d.dateKey === todayKey) ?? dayCloses[0];



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



  const canSubmitNormal =

    preflight?.canClose &&

    (!varianceFlagged || managerPin.trim().length > 0) &&

    (!preflight.requiresSyncOverride || syncOverride) &&

    !activeCloseToday;



  if (!hasPermission(actor.role, "day.close")) {

    return (

      <div className="space-y-4 pb-8">

        <PageHeader lang={lang} title={t(lang, "closeDay")} backLabel={t(lang, "officeBackToHub")} />

        <p className="text-lg text-stone-700">{t(lang, "noPermission")}</p>

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

          className="rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-black text-waka-800"

        >

          {t(lang, "dayCloseXReportBtn")}

        </Link>

      </div>



      <section className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">

        <p className="text-[11px] font-black uppercase text-stone-500">{t(lang, "dayCloseBusinessDate")}</p>

        <p className="text-lg font-black text-stone-950">{todayKey}</p>

      </section>



      <CloseDayPreflightPanel lang={lang} snapshot={preflight} loading={preflightLoading} />



      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">

        {t(lang, "closeDayTrustNote")}

      </p>



      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">

        <div className="grid grid-cols-2 gap-3">

          <div className="rounded-2xl bg-stone-50 px-3 py-3 col-span-2">

            <p className="text-[11px] font-black uppercase text-stone-500">{t(lang, "totalSales")}</p>

            <p className="mt-1 text-xl font-black text-stone-950">UGX {summary.total.toLocaleString()}</p>

          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 col-span-2">

            <p className="text-[11px] font-black uppercase text-stone-500">{t(lang, "closeDayExpectedTitle")}</p>

            <p className="mt-1 text-xl font-black text-stone-950">UGX {summary.expectedCash.toLocaleString()}</p>

          </div>

        </div>

      </section>



      {!activeCloseToday ? (

        <form onSubmit={submit} className="rounded-3xl border border-waka-200 bg-waka-50/70 p-4">

          <label className="block text-base font-black text-waka-950">{t(lang, "closeCountedCash")}</label>

          <input

            value={counted}

            onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}

            inputMode="numeric"

            className="mt-2 w-full rounded-2xl border-2 border-waka-300 bg-white px-4 py-4 text-3xl font-black"

            placeholder="0"

          />

          {counted.length > 0 ? (

            <p className="mt-2 text-sm font-bold text-stone-700">

              {t(lang, "closeLastDiff")}: UGX {varianceDiff.toLocaleString()}

              {varianceFlagged ? (

                <span className="ml-2 text-rose-700">{t(lang, "dayCloseApprovalNeeded")}</span>

              ) : null}

            </p>

          ) : null}



          {(varianceFlagged || preflight?.requiresSyncOverride) && (

            <label className="mt-4 block text-sm font-bold text-stone-800">

              {t(lang, "dayCloseVariancePinLabel")}

              <input

                type="password"

                inputMode="numeric"

                value={managerPin}

                onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 6))}

                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-xl font-black tracking-widest"

              />

            </label>

          )}



          {preflight?.requiresSyncOverride ? (

            <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-amber-900">

              <input type="checkbox" checked={syncOverride} onChange={(e) => setSyncOverride(e.target.checked)} />

              {t(lang, "dayCloseCheckCloudSyncFail")}

            </label>

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

          <input

            type="password"

            inputMode="numeric"

            value={reopenPin}

            onChange={(e) => setReopenPin(e.target.value.replace(/\D/g, "").slice(0, 6))}

            placeholder={t(lang, "dayCloseReopenOwnerPin")}

            className="mt-2 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"

          />

          <button

            type="button"

            onClick={submitReopen}

            className="mt-3 min-h-[48px] w-full rounded-2xl bg-amber-700 font-black text-white"

          >

            {t(lang, "dayCloseReopenConfirm")}

          </button>

        </section>

      ) : null}



      {!activeCloseToday ? (

        <section className="rounded-3xl border-2 border-rose-300 bg-rose-50 p-4">

          <h2 className="text-base font-black text-rose-950">{t(lang, "dayCloseEmergencyTitle")}</h2>

          <p className="mt-1 text-xs font-semibold text-rose-900">{t(lang, "dayCloseEmergencyWarning")}</p>

          <label className="mt-3 flex items-center gap-2 text-sm font-bold text-rose-950">

            <input type="checkbox" checked={emergencyMode} onChange={(e) => setEmergencyMode(e.target.checked)} />

            {t(lang, "dayCloseEmergencyConfirm")}

          </label>

          {emergencyMode ? (

            <>

              <textarea

                value={emergencyReason}

                onChange={(e) => setEmergencyReason(e.target.value)}

                className="mt-2 w-full rounded-xl border border-rose-300 px-3 py-2 text-sm"

                rows={2}

                placeholder={t(lang, "dayCloseEmergencyReason")}

              />

              <input

                type="password"

                inputMode="numeric"

                value={managerPin}

                onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 6))}

                placeholder={t(lang, "dayCloseReopenOwnerPin")}

                className="mt-2 w-full rounded-xl border border-rose-300 px-3 py-2 text-sm"

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

        <section className="rounded-3xl border border-stone-200 bg-white p-4">

          <h2 className="text-base font-black text-stone-950">{t(lang, "dayCloseReopenHistory")}</h2>

          <ul className="mt-2 space-y-2">

            {dayReopenHistory.slice(0, 10).map((r) => (

              <li key={r.id} className="text-xs font-semibold text-stone-600">

                {r.dateKey} · {r.reopenedByLabel} · {r.reason}

              </li>

            ))}

          </ul>

        </section>

      ) : null}



      {doneMsg && (

        <div className="space-y-3 rounded-2xl bg-stone-900 px-4 py-4 text-white">

          <p className="text-center text-lg font-bold">{t(lang, "closeSaved")}</p>

          {last && last.dateKey === todayKey ? (

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



      {last && last.dateKey === todayKey && activeCloseToday ? (

        <section className="rounded-3xl border-2 border-stone-200 bg-stone-50 p-5">

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

          <p className="mt-4 text-lg font-black text-stone-900">{t(lang, "closeLastDiff")}</p>

          <p className="mt-2 text-3xl font-black text-stone-800">

            UGX {last.differenceUgx.toLocaleString()}

          </p>

        </section>

      ) : null}



      {hasPermission(actor.role, "owner.cash_history") ? (

        <section className="space-y-4">

          <h2 className="text-xl font-black text-stone-900">{t(lang, "closeHistoryTitle")}</h2>

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

            empty={<p className="text-sm font-semibold text-stone-600">{t(lang, "closeHistoryTitle")}</p>}

          >

            <ul>

              {filteredDayCloses.slice(0, 20).map((d) => (

                <li key={d.id} className="border-b border-stone-100 px-3 py-3 last:border-b-0">

                  <p className="text-sm font-black text-stone-950">{d.dateKey}</p>

                  <p className="text-xs text-stone-500">

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


