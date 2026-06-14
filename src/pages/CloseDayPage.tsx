import { useMemo, useState } from "react";
import type { FormEvent } from "react";
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
import { DateFilterBar } from "../components/shared/DateFilterBar";
import { DateFilterViewingLabel } from "../components/shared/DateFilterViewingLabel";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";
import { downloadDayClosePdf, printDayCloseReport, shareDayClosePdf } from "../lib/dayCloseDocument";
import { dateMatchesFilter, resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";

export function CloseDayPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = useReportingSales(false);
  const products = usePosStore((s) => s.products);
  const returnRecords = useReportingReturnRecords(false);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const recordDayClose = usePosStore((s) => s.recordDayClose);

  const todayKey = dateKeyKampala(new Date());
  const [counted, setCounted] = useState("");
  const [doneMsg, setDoneMsg] = useState(false);
  const [closeErrorKey, setCloseErrorKey] = useState<string | null>(null);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [historyFilter, setHistoryFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });

  const historyBounds = useMemo(() => resolveDateFilterBounds(historyFilter), [historyFilter]);
  const filteredDayCloses = useMemo(
    () => dayCloses.filter((d) => dateMatchesFilter(d.dateKey, historyBounds)),
    [dayCloses, historyBounds],
  );

  const activeCloseToday = activeDayCloseForDate(dayCloses, todayKey);

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
    }),
    [drawer, sales, returnRecords, products, todayKey],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCloseErrorKey(null);
    const n = Math.max(0, Math.floor(Number(counted.replace(/\D/g, "")) || 0));
    await ensureAllActiveSalesLoaded();
    const result = await recordDayClose({
      dateKey: todayKey,
      countedCashUgx: n,
      override: Boolean(activeCloseToday && overrideMode),
      overrideReason: activeCloseToday && overrideMode ? overrideReason : undefined,
    });
    if (!result.ok) {
      setCloseErrorKey(result.errorKey ?? "invalid");
      return;
    }
    setCounted("");
    setDoneMsg(true);
    window.setTimeout(() => setDoneMsg(false), 3000);
  };

  const last = activeCloseToday ?? dayCloses.find((d) => d.dateKey === todayKey) ?? dayCloses[0];

  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const closeVarianceFlag = (expected: number, diff: number) => {
    const exp = Math.max(1, expected);
    const absDiff = Math.abs(diff);
    return absDiff > Math.max((pct / 100) * exp, fixed);
  };

  if (!hasPermission(actor.role, "day.close")) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "closeDay")} backLabel={t(lang, "officeBackToHub")} />
        <p className="text-lg text-slate-700">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "closeDay")}
        subtitle={t(lang, "closeDaySimpleHelp")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
        {t(lang, "closeDayTrustNote")}
      </p>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-waka-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-stone-50 px-3 py-3 col-span-2">
            <p className="text-[11px] font-black uppercase text-slate-500">{t(lang, "totalSales")}</p>
            <p className="mt-1 text-xl font-black text-slate-950">UGX {summary.total.toLocaleString()}</p>
            <p className="mt-1 text-xs font-medium text-slate-600">{t(lang, "closeDayTotalSalesHint")}</p>
          </div>
          <div>
            <div className="rounded-2xl bg-stone-50 px-3 py-3">
              <p className="text-[11px] font-black uppercase text-slate-500">{t(lang, "closeSimpleCashSalesToday")}</p>
              <p className="mt-1 text-xl font-black text-slate-950">UGX {summary.cash.toLocaleString()}</p>
            </div>
          </div>
          <div className="rounded-2xl bg-amber-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-amber-700">{t(lang, "closeSimpleCreditToday")}</p>
            <p className="mt-1 text-xl font-black text-amber-900">UGX {summary.debt.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-teal-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-teal-800">{t(lang, "closeDebtCollectedToday")}</p>
            <p className="mt-1 text-xl font-black text-teal-950">UGX {summary.debtCollected.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-waka-50 px-3 py-3 col-span-2">
            <p className="text-[11px] font-black uppercase text-waka-800">{t(lang, "closeSalesCount")}</p>
            <p className="mt-1 text-xl font-black text-waka-950">{summary.saleCount}</p>
          </div>
          {summary.expenseUgx > 0 ? (
            <div className="rounded-2xl bg-rose-50 px-3 py-3 col-span-2">
              <p className="text-[11px] font-black uppercase text-rose-800">{t(lang, "closeDayExpensesToday")}</p>
              <p className="mt-1 text-xl font-black text-rose-950">UGX {summary.expenseUgx.toLocaleString()}</p>
            </div>
          ) : null}
          {summary.supplierPaymentsUgx > 0 ? (
            <div className="rounded-2xl bg-rose-50 px-3 py-3 col-span-2">
              <p className="text-[11px] font-black uppercase text-rose-800">{t(lang, "closeDaySupplierPaymentsToday")}</p>
              <p className="mt-1 text-xl font-black text-rose-950">UGX {summary.supplierPaymentsUgx.toLocaleString()}</p>
            </div>
          ) : null}
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 col-span-2">
            <p className="text-[11px] font-black uppercase text-slate-500">{t(lang, "closeDayExpectedTitle")}</p>
            <p className="mt-1 text-xl font-black text-slate-950">UGX {summary.expectedCash.toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-waka-100 bg-waka-50/80 px-3 py-3 text-sm text-stone-800">
          <p className="font-black text-stone-900">{t(lang, "closeDayExpectedFormulaIntro")}</p>
          <ul className="mt-2 space-y-1 font-semibold">
            <li>
              {t(lang, "closeDayFormulaCashSales")}: UGX {summary.cash.toLocaleString()}
            </li>
            <li>
              {t(lang, "closeDayFormulaDebtCollected")}: UGX {summary.debtCollected.toLocaleString()}
            </li>
            {summary.expenseUgx > 0 ? (
              <li>
                {t(lang, "closeDayFormulaExpenses")}: UGX {summary.expenseUgx.toLocaleString()}
              </li>
            ) : null}
            {summary.supplierPaymentsUgx > 0 ? (
              <li>
                {t(lang, "closeDayFormulaSupplierPayments")}: UGX {summary.supplierPaymentsUgx.toLocaleString()}
              </li>
            ) : null}
            {summary.refundsUgx > 0 ? (
              <li>
                {t(lang, "closeDayFormulaRefunds")}: UGX {summary.refundsUgx.toLocaleString()}
              </li>
            ) : null}
            <li className="border-t border-waka-200 pt-2 font-black text-waka-950">
              {t(lang, "closeDayFormulaEquals")}: UGX {summary.expectedCash.toLocaleString()}
            </li>
          </ul>
        </div>
      </section>

      <form onSubmit={submit} className="rounded-3xl border border-waka-200 bg-waka-50/70 p-4">
        <label className="block text-base font-black text-waka-950">{t(lang, "closeCountedCash")}</label>
        <p className="mt-1 text-sm font-medium text-waka-900">{t(lang, "closeDayCountedHelp")}</p>
        <input
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          className="mt-2 w-full rounded-2xl border-2 border-waka-300 bg-white px-4 py-4 text-3xl font-black"
          placeholder="0"
        />
        <button type="submit" className="mt-5 w-full rounded-3xl bg-waka-600 py-4 text-xl font-black text-white">
          {t(lang, "closeConfirm")}
        </button>
        {closeErrorKey === "closeDaySalesNotLoaded" ? (
          <p className="mt-3 text-center text-sm font-bold text-red-700">{t(lang, "closeDaySalesNotLoaded")}</p>
        ) : null}
        {closeErrorKey === "dayCloseAlreadyExists" ? (
          <p className="mt-3 text-center text-sm font-bold text-amber-900">{t(lang, "dayCloseAlreadyExists")}</p>
        ) : null}
        {closeErrorKey === "dayCloseOverrideReasonRequired" ? (
          <p className="mt-3 text-center text-sm font-bold text-red-700">{t(lang, "dayCloseOverrideReasonRequired")}</p>
        ) : null}
        {activeCloseToday ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-950">{t(lang, "dayCloseOverridePrompt")}</p>
            <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
              <input
                type="checkbox"
                checked={overrideMode}
                onChange={(e) => setOverrideMode(e.target.checked)}
              />
              {t(lang, "dayCloseOverrideConfirm")}
            </label>
            {overrideMode ? (
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"
                rows={2}
                placeholder={t(lang, "dayCloseOverrideReasonPlaceholder")}
              />
            ) : null}
          </div>
        ) : null}
      </form>

      {doneMsg && (
        <div className="space-y-3 rounded-2xl bg-slate-900 px-4 py-4 text-white">
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

      {last && last.dateKey === todayKey ? (
        <section className="rounded-3xl border-2 border-slate-200 bg-slate-50 p-5">
          <div className="mb-4">
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
          </div>
          <p className="text-lg font-black text-slate-900">{t(lang, "closeLastDiff")}</p>
          <p className="mt-2 text-3xl font-black text-slate-800">
            UGX {last.differenceUgx.toLocaleString()}
            <span className="ml-2 text-lg font-semibold text-slate-600">
              {last.differenceUgx === 0 ? t(lang, "closeMatch") : last.differenceUgx > 0 ? t(lang, "closeExtra") : t(lang, "closeShort")}
            </span>
          </p>
          {closeVarianceFlag(last.expectedCashUgx, last.differenceUgx) ? (
            <p className="mt-3 rounded-xl bg-rose-100 px-3 py-2 text-sm font-bold text-rose-900">{t(lang, "ownerVarianceFlag")}</p>
          ) : (
            <p className="mt-3 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-900">{t(lang, "closeDayDiffOk")}</p>
          )}
        </section>
      ) : null}

      {hasPermission(actor.role, "owner.cash_history") ? (
        <section className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">{t(lang, "closeHistoryTitle")}</h2>
          <div className="mt-3 space-y-3">
            <DateFilterBar lang={lang} value={historyFilter} onChange={setHistoryFilter} />
            <DateFilterViewingLabel lang={lang} value={historyFilter} />
          </div>
          <ul className="mt-3 space-y-3">
            {filteredDayCloses.slice(0, 20).map((d) => {
              const flag = closeVarianceFlag(d.expectedCashUgx, d.differenceUgx);
              return (
                <li key={d.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-slate-900">{d.dateKey}</span>
                    {flag ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-900">!</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {t(lang, "ownerExpectedVsCounted")}: UGX {d.expectedCashUgx.toLocaleString()} / UGX {d.countedCashUgx.toLocaleString()}
                  </p>
                  <p className="text-sm font-bold text-slate-800">
                    {t(lang, "closeHistoryDifference")}: UGX {d.differenceUgx.toLocaleString()} · {t(lang, "closeHistoryProfit")}: UGX{" "}
                    {d.profitEstimateUgx.toLocaleString()}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
