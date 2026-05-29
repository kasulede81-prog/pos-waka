import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import {
  buildMonthlyBusinessReport,
  downloadMonthlyReportPdf,
  downloadMonthlyReportWord,
  downloadTextFile,
  formatMonthlyReportPlain,
  monthlyReportToCsv,
  printMonthlyReport,
} from "../lib/monthlyBusinessReport";
import { dateKeyKampala } from "../lib/datesUg";

function currentMonthKey(): string {
  return dateKeyKampala(new Date()).slice(0, 7);
}

function monthOptions(count = 18): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    out.push(key);
  }
  return out;
}

export function MonthlyReportsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "reports.view");
  const [includeArchived, setIncludeArchived] = useState(true);
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = useReportingReturnRecords(includeArchived);
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);

  const months = useMemo(() => monthOptions(), []);

  const report = useMemo(
    () =>
      buildMonthlyBusinessReport({
        monthKey,
        shopName: preferences.shopDisplayName?.trim() || "Waka POS",
        sales,
        returnRecords,
        products,
        staffAccounts: preferences.staffAccounts ?? [],
      }),
    [monthKey, preferences.shopDisplayName, preferences.staffAccounts, sales, returnRecords, products],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  if (!canView) {
    return <Navigate to="/office" replace />;
  }

  const downloadCsv = () => {
    const ok = downloadTextFile(`waka-monthly-${monthKey}.csv`, monthlyReportToCsv(report), "text/csv;charset=utf-8");
    showToast(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
  };

  const downloadExcel = () => {
    const ok = downloadTextFile(
      `waka-monthly-${monthKey}.xls`,
      monthlyReportToCsv(report),
      "application/vnd.ms-excel;charset=utf-8",
    );
    showToast(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
  };

  const downloadWord = () => {
    const ok = downloadMonthlyReportWord(lang, report);
    showToast(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const ok = await downloadMonthlyReportPdf(lang, report);
      showToast(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail"));
    } catch {
      showToast(t(lang, "monthlyReportDownloadFail"));
    } finally {
      setBusy(false);
    }
  };

  const printReport = () => {
    const ok = printMonthlyReport(lang, report);
    showToast(ok ? t(lang, "monthlyReportPrintOk") : t(lang, "monthlyReportPrintFail"));
  };

  const shareText = async () => {
    const body = formatMonthlyReportPlain(lang, report);
    try {
      await navigator.clipboard.writeText(body);
      showToast(t(lang, "monthlyReportCopyOk"));
    } catch {
      showToast(t(lang, "monthlyReportCopyFail"));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "monthlyReportTitle")}
        subtitle={t(lang, "monthlyReportSub")}
        backFallback="/office"
        backLabel={t(lang, "officeBackToHub")}
      />

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <label className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <span className="text-sm font-bold text-stone-700">{t(lang, "monthlyReportPickMonth")}</span>
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-bold"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <section className="rounded-3xl border border-waka-100 bg-waka-50/50 p-5">
        <p className="text-sm font-bold text-stone-600">{t(lang, "monthlyReportPreview")}</p>
        <p className="mt-2 text-2xl font-black text-waka-950">UGX {report.totalSalesUgx.toLocaleString()}</p>
        <p className="text-sm font-semibold text-stone-700">
          {t(lang, "monthlyReportTransactions")}: {report.transactionCount} · {t(lang, "estimatedProfit")}: UGX{" "}
          {report.profitUgx.toLocaleString()}
        </p>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void downloadPdf()}
          className="min-h-[48px] rounded-2xl bg-waka-600 py-3 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? "…" : t(lang, "monthlyReportDownloadPdf")}
        </button>
        <button
          type="button"
          onClick={printReport}
          className="min-h-[48px] rounded-2xl border-2 border-waka-600 bg-white py-3 text-sm font-black text-waka-900"
        >
          {t(lang, "monthlyReportPrint")}
        </button>
        <button
          type="button"
          onClick={downloadExcel}
          className="min-h-[48px] rounded-2xl border-2 border-waka-600 bg-white py-3 text-sm font-black text-waka-900"
        >
          {t(lang, "monthlyReportDownloadExcel")}
        </button>
        <button
          type="button"
          onClick={downloadWord}
          className="min-h-[48px] rounded-2xl border-2 border-stone-300 bg-white py-3 text-sm font-black text-stone-800"
        >
          {t(lang, "monthlyReportDownloadWord")}
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="min-h-[48px] rounded-2xl border-2 border-stone-300 bg-white py-3 text-sm font-black text-stone-800 sm:col-span-2"
        >
          {t(lang, "monthlyReportDownloadCsv")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => void shareText()}
        className="min-h-[44px] w-full rounded-2xl border border-stone-200 py-2.5 text-sm font-bold text-stone-700"
      >
        {t(lang, "monthlyReportCopyText")}
      </button>

      {toast ? (
        <p className="fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] left-4 right-4 z-50 rounded-2xl bg-stone-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
