import { useDeferredValue, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { CashDrawerAdjustmentType, Language } from "../types";
import { CASH_DRAWER_ADJUSTMENT_TYPES } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useReportingSales } from "../hooks/useReportingSales";
import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";
import {
  buildCashPositionReport,
  cashPositionVariance,
  type CashPositionPaymentKey,
  type CashPositionReconciliation,
} from "../lib/cashPosition";
import {
  downloadCashPositionCsv,
  downloadCashPositionExcel,
  downloadCashPositionPdf,
  printCashPositionReport,
} from "../lib/cashPositionExport";
import { cashDrawerAdjustmentTypeLabel } from "../lib/cashDrawerLedger";
import { receiptPrintActionLabel } from "../lib/printActionLabels";
import { timedComputation } from "../lib/performanceMetrics";
import { buildSalesFingerprint, getCachedComputation } from "../lib/computationResultCache";

function paymentLabel(lang: Language, key: CashPositionPaymentKey): string {
  const labels: Record<CashPositionPaymentKey, string> = {
    cash: t(lang, "cashPositionPayCash"),
    mobile_money: t(lang, "cashPositionPayMobile"),
    card: t(lang, "cashPositionPayCard"),
    bank_transfer: t(lang, "cashPositionPayBank"),
    credit: t(lang, "cashPositionPayCredit"),
  };
  return labels[key];
}

export function CashPositionPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "day.close");
  const sales = useReportingSales(false);
  const returnRecords = useReportingReturnRecords(false);
  const products = usePosStore((s) => s.products);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);
  const formulaVersion = usePosStore((s) => s.preferences.cashDrawerFormulaVersion ?? "v1");
  const addCashDrawerAdjustment = usePosStore((s) => s.addCashDrawerAdjustment);
  const preferences = usePosStore((s) => s.preferences);

  const [physicalCount, setPhysicalCount] = useState("");
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [movementType, setMovementType] = useState<CashDrawerAdjustmentType>("owner_injection");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [movementMsg, setMovementMsg] = useState<string | null>(null);

  const todayKey = dateKeyKampala(new Date());
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const generalLabel = t(lang, "uncategorized");

  const report = useMemo(() => {
    const fp = `${todayKey}:${buildSalesFingerprint(sales)}:${returnRecords.length}:${debtPayments.length}:${cashExpenses.length}:${supplierPayments.length}:${cashDrawerAdjustments.length}:${dayDrawerOpens.length}:${formulaVersion}`;
    return getCachedComputation("buildCashPositionReport", fp, () =>
      timedComputation("buildCashPositionReport", () =>
        buildCashPositionReport({
          lang,
          dayKey: todayKey,
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
          formulaVersion,
          staffAccounts: preferences.staffAccounts ?? [],
          generalCategoryLabel: generalLabel,
        }),
      ),
    );
  }, [
    lang,
    todayKey,
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
    formulaVersion,
    preferences.staffAccounts,
    generalLabel,
  ]);
  const displayReport = useDeferredValue(report);

  const actualUgx = Math.max(0, Math.floor(Number(physicalCount.replace(/\D/g, "")) || 0));
  const hasActual = physicalCount.replace(/\D/g, "").length > 0;
  const variance = hasActual
    ? cashPositionVariance(displayReport.cashPosition.expectedCashUgx, actualUgx)
    : null;

  const exportReconciliation: CashPositionReconciliation | null = hasActual && variance
    ? {
        physicalCountUgx: actualUgx,
        varianceUgx: variance.varianceUgx,
        varianceKind: variance.kind,
      }
    : null;

  const showExportHint = (ok: boolean) => {
    setExportHint(ok ? t(lang, "cashPositionExportOk") : t(lang, "cashPositionExportFail"));
    window.setTimeout(() => setExportHint(null), 3500);
  };

  const runExport = async (kind: "pdf" | "csv" | "excel") => {
    setExportBusy(true);
    try {
      const ok =
        kind === "pdf"
          ? await downloadCashPositionPdf(lang, displayReport, exportReconciliation)
          : kind === "csv"
            ? await downloadCashPositionCsv(displayReport, exportReconciliation)
            : await downloadCashPositionExcel(displayReport, exportReconciliation);
      showExportHint(ok);
    } finally {
      setExportBusy(false);
    }
  };

  const runPrint = async () => {
    setExportBusy(true);
    try {
      const ok = await printCashPositionReport(lang, displayReport, exportReconciliation);
      showExportHint(ok);
    } finally {
      setExportBusy(false);
    }
  };

  const submitMovement = () => {
    const amountUgx = Math.floor(Number(movementAmount.replace(/\D/g, "")) || 0);
    if (amountUgx <= 0) return;
    const result = addCashDrawerAdjustment({
      type: movementType,
      amountUgx,
      note: movementNote.trim(),
    });
    if (result.ok) {
      setMovementAmount("");
      setMovementNote("");
      setMovementMsg(t(lang, "cashPositionMovementSaved"));
      window.setTimeout(() => setMovementMsg(null), 3000);
    }
  };

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  const varianceCardClass =
    variance?.kind === "balanced"
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : variance?.kind === "shortage"
        ? "border-rose-300 bg-rose-50 text-rose-950"
        : variance?.kind === "excess"
          ? "border-sky-300 bg-sky-50 text-sky-950"
          : "border-stone-200 bg-stone-50 text-stone-800";

  const isStale = displayReport !== report;

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        lang={lang}
        title={t(lang, "cashPositionTitle")}
        subtitle={t(lang, "cashPositionSub")}
        backFallback="/office"
        backLabel={t(lang, "officeBackToHub")}
      />

      <p className="text-sm font-semibold text-stone-600">
        {t(lang, "cashPositionToday")}: <span className="font-black text-stone-900">{todayKey}</span>
        {isStale ? (
          <span className="ml-2 text-xs font-bold text-waka-700">{t(lang, "loading")}</span>
        ) : null}
      </p>

      {/* Section 1: Today summary */}
      <section className="rounded-3xl border-2 border-stone-900 bg-gradient-to-br from-stone-900 to-stone-700 p-5 text-white shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "cashPositionSectionToday")}</p>
        <p className="mt-1 text-xs font-semibold text-white/70">{t(lang, "cashPositionTotalSales")}</p>
        <p className="mt-1 text-4xl font-black sm:text-5xl">UGX {displayReport.summary.totalSalesUgx.toLocaleString()}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/10 px-3 py-3">
            <p className="text-[10px] font-black uppercase text-white/70">{t(lang, "cashPositionTransactions")}</p>
            <p className="mt-1 text-2xl font-black">{displayReport.summary.transactionCount}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-3">
            <p className="text-[10px] font-black uppercase text-white/70">{t(lang, "cashPositionItemsSold")}</p>
            <p className="mt-1 text-2xl font-black">{displayReport.summary.itemsSold.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {/* Section 2: Payment breakdown */}
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "cashPositionSectionPayments")}</h2>
        {displayReport.paymentMethods.length === 0 && displayReport.paymentAdjustmentUgx === 0 ? (
          <p className="mt-3 text-base font-medium text-stone-500">{t(lang, "cashPositionNoSalesToday")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {displayReport.paymentMethods.map((row) => (
              <li key={row.key} className="rounded-2xl bg-stone-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black uppercase text-stone-800">{paymentLabel(lang, row.key)}</p>
                    <p className="mt-1 text-xs font-semibold text-stone-500">
                      {row.transactionCount} {t(lang, "cashPositionTransactions").toLowerCase()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-stone-900">UGX {row.amountUgx.toLocaleString()}</p>
                    <p className="text-sm font-bold text-waka-700">{row.percent}%</p>
                  </div>
                </div>
              </li>
            ))}
            {displayReport.paymentAdjustmentUgx !== 0 ? (
              <li className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-amber-950">{t(lang, "cashPositionPaymentAdjustment")}</p>
                  </div>
                  <p className="text-xl font-black text-amber-950">
                    UGX {displayReport.paymentAdjustmentUgx.toLocaleString()}
                  </p>
                </div>
              </li>
            ) : null}
          </ul>
        )}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3">
          <span className="text-sm font-black text-stone-800">{t(lang, "cashPositionGrandTotal")}</span>
          <span className="text-xl font-black text-stone-900">UGX {displayReport.summary.totalSalesUgx.toLocaleString()}</span>
        </div>
      </section>

      {/* Section 3: Cash position */}
      <section className="rounded-3xl border-2 border-waka-200 bg-gradient-to-br from-waka-50 to-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-waka-950">{t(lang, "cashPositionSectionCash")}</h2>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "cashPositionCashHint")}</p>
        <dl className="mt-4 space-y-3">
          {displayReport.cashPosition.openingFloatUgx > 0 ? (
            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
              <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionOpeningFloat")}</dt>
              <dd className="text-lg font-black text-stone-900">
                UGX {displayReport.cashPosition.openingFloatUgx.toLocaleString()}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionCashSales")}</dt>
            <dd className="text-lg font-black text-stone-900">
              UGX {displayReport.cashPosition.cashSalesUgx.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionDebtCollected")}</dt>
            <dd className="text-lg font-black text-teal-800">
              + UGX {displayReport.cashPosition.debtCollectedUgx.toLocaleString()}
            </dd>
          </div>
          {displayReport.cashPosition.adjustmentInflowsUgx > 0 ? (
            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
              <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionCashAdded")}</dt>
              <dd className="text-lg font-black text-teal-800">
                + UGX {displayReport.cashPosition.adjustmentInflowsUgx.toLocaleString()}
              </dd>
            </div>
          ) : null}
          {displayReport.cashPosition.adjustmentOutflowsUgx > 0 ? (
            <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
              <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionCashRemoved")}</dt>
              <dd className="text-lg font-black text-rose-800">
                − UGX {displayReport.cashPosition.adjustmentOutflowsUgx.toLocaleString()}
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionSupplierPayments")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.supplierPaymentsUgx.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionExpenses")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.expensesUgx.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionRefunds")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.refundsUgx.toLocaleString()}
            </dd>
          </div>
        </dl>
        {Object.keys(displayReport.adjustmentBreakdown).length > 0 ? (
          <div className="mt-4 rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <p className="text-xs font-black uppercase tracking-wide text-stone-500">
              {t(lang, "cashPositionAdjustmentBreakdown")}
            </p>
            <ul className="mt-2 space-y-1">
              {Object.entries(displayReport.adjustmentBreakdown).map(([type, amount]) =>
                amount && amount > 0 ? (
                  <li key={type} className="flex justify-between text-sm font-semibold text-stone-700">
                    <span>{cashDrawerAdjustmentTypeLabel(lang, type as import("../types").CashDrawerAdjustmentType)}</span>
                    <span>UGX {amount.toLocaleString()}</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 rounded-2xl bg-waka-600 px-4 py-4 text-white">
          <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "cashPositionExpectedCash")}</p>
          <p className="mt-1 text-3xl font-black">UGX {displayReport.cashPosition.expectedCashUgx.toLocaleString()}</p>
        </div>
      </section>

      {/* Record cash drawer movement */}
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "cashPositionRecordMovement")}</h2>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "cashPositionRecordMovementHint")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "cashPositionMovementType")}
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as CashDrawerAdjustmentType)}
              className="mt-2 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold"
            >
              {CASH_DRAWER_ADJUSTMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {cashDrawerAdjustmentTypeLabel(lang, type)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "cashPositionMovementAmount")}
            <input
              value={movementAmount}
              onChange={(e) => setMovementAmount(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              placeholder="0"
              className="mt-2 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 px-4 py-3 text-xl font-black"
            />
          </label>
          <label className="block text-sm font-bold text-stone-800 sm:col-span-2">
            {t(lang, "cashPositionMovementNote")}
            <input
              value={movementNote}
              onChange={(e) => setMovementNote(e.target.value.slice(0, 120))}
              className="mt-2 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={submitMovement}
          disabled={!movementAmount.replace(/\D/g, "")}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto"
        >
          {t(lang, "save")}
        </button>
        {movementMsg ? (
          <p className="mt-3 text-sm font-bold text-waka-800">{movementMsg}</p>
        ) : null}
      </section>

      {/* Section 4: Category sales */}
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "cashPositionSectionCategories")}</h2>
        {displayReport.categories.length === 0 ? (
          <p className="mt-3 text-base font-medium text-stone-500">{t(lang, "cashPositionNoSalesToday")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {displayReport.categories.map((row) => (
              <li key={row.categoryKey} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                <div>
                  <p className="font-bold text-stone-900">{row.categoryLabel}</p>
                  <p className="text-xs font-semibold text-stone-500">{row.percent}%</p>
                </div>
                <p className="text-lg font-black text-waka-800">UGX {row.amountUgx.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 5: Cashier performance */}
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "cashPositionSectionCashiers")}</h2>
        {displayReport.cashiers.length === 0 ? (
          <p className="mt-3 text-base font-medium text-stone-500">{t(lang, "cashPositionNoSalesToday")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {displayReport.cashiers.map((row) => (
              <li key={row.cashierId} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                <div>
                  <p className="font-bold text-stone-900">{row.name}</p>
                  <p className="text-xs font-semibold text-stone-500">
                    {row.transactionCount} {t(lang, "cashPositionTransactions").toLowerCase()}
                  </p>
                </div>
                <p className="text-lg font-black text-stone-900">UGX {row.salesUgx.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 6: End of day reconciliation */}
      <section className="rounded-3xl border-2 border-amber-200 bg-amber-50/80 p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-amber-950">{t(lang, "cashPositionSectionReconcile")}</h2>
        <p className="mt-1 text-sm font-medium text-amber-900/90">{t(lang, "cashPositionReconcileHint")}</p>
        <label className="mt-4 block text-sm font-black text-amber-950">{t(lang, "cashPositionPhysicalCount")}</label>
        <input
          value={physicalCount}
          onChange={(e) => setPhysicalCount(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          placeholder="0"
          className="mt-2 w-full rounded-2xl border-2 border-amber-300 bg-white px-4 py-4 text-3xl font-black text-stone-900"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-amber-200">
            <p className="text-xs font-black uppercase text-stone-500">{t(lang, "cashPositionExpectedLabel")}</p>
            <p className="mt-1 text-2xl font-black text-stone-900">
              UGX {displayReport.cashPosition.expectedCashUgx.toLocaleString()}
            </p>
          </div>
          {hasActual ? (
            <div className={`rounded-2xl border-2 px-4 py-3 ${varianceCardClass}`}>
              <p className="text-xs font-black uppercase">{t(lang, "cashPositionActualLabel")}</p>
              <p className="mt-1 text-2xl font-black">UGX {actualUgx.toLocaleString()}</p>
              {variance ? (
                <p className="mt-2 text-sm font-black">
                  {t(lang, "cashPositionVariance")}:{" "}
                  {variance.varianceUgx >= 0 ? "+" : ""}
                  UGX {variance.varianceUgx.toLocaleString()}
                  {" · "}
                  {variance.kind === "balanced"
                    ? t(lang, "cashPositionBalanced")
                    : variance.kind === "shortage"
                      ? t(lang, "cashPositionShortage")
                      : t(lang, "cashPositionExcess")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Section 7: Export */}
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "cashPositionSectionExport")}</h2>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "cashPositionExportHint")}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void runPrint()}
            className="min-h-[48px] rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {receiptPrintActionLabel(lang)}
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void runExport("pdf")}
            className="min-h-[48px] rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {t(lang, "cashPositionExportPdf")}
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void runExport("csv")}
            className="min-h-[48px] rounded-2xl border-2 border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-900 disabled:opacity-60"
          >
            {t(lang, "cashPositionExportCsv")}
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void runExport("excel")}
            className="min-h-[48px] rounded-2xl border-2 border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-900 disabled:opacity-60"
          >
            {t(lang, "cashPositionExportExcel")}
          </button>
        </div>
        {exportHint ? (
          <p className="mt-3 text-center text-sm font-bold text-waka-800">{exportHint}</p>
        ) : null}
      </section>
    </div>
  );
}
