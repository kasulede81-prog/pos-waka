import { useDeferredValue, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
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
} from "../lib/cashPositionExport";

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
  const preferences = usePosStore((s) => s.preferences);

  const [physicalCount, setPhysicalCount] = useState("");
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const todayKey = dateKeyKampala(new Date());
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const generalLabel = t(lang, "uncategorized");

  const report = useMemo(
    () =>
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
        staffAccounts: preferences.staffAccounts ?? [],
        generalCategoryLabel: generalLabel,
      }),
    [
      lang,
      todayKey,
      shopName,
      sales,
      products,
      returnRecords,
      debtPayments,
      cashExpenses,
      supplierPayments,
      preferences.staffAccounts,
      generalLabel,
    ],
  );
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
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionRefunds")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.refundsUgx.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionExpenses")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.expensesUgx.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-waka-100">
            <dt className="text-sm font-bold text-stone-700">{t(lang, "cashPositionSupplierPayments")}</dt>
            <dd className="text-lg font-black text-rose-800">
              − UGX {displayReport.cashPosition.supplierPaymentsUgx.toLocaleString()}
            </dd>
          </div>
        </dl>
        <div className="mt-4 rounded-2xl bg-waka-600 px-4 py-4 text-white">
          <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "cashPositionExpectedCash")}</p>
          <p className="mt-1 text-3xl font-black">UGX {displayReport.cashPosition.expectedCashUgx.toLocaleString()}</p>
        </div>
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
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
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
