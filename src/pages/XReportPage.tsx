import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { buildXReportSnapshot } from "../lib/xReport";
import { downloadXReportCsv, downloadXReportPdf, printXReport, shareXReportPdf } from "../lib/xReportExport";
import { PageHeader } from "../components/layout/PageHeader";
import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";
import { hasPermission } from "../lib/permissions";
import { useSessionActor } from "../context/SessionActorContext";

export function XReportPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = usePosStore((s) => s.sales);
  const products = usePosStore((s) => s.products);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const cashDrawerAdjustments = usePosStore((s) => s.cashDrawerAdjustments);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const preferences = usePosStore((s) => s.preferences);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

  const todayKey = dateKeyKampala(new Date());
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";

  const snapshot = useMemo(
    () =>
      buildXReportSnapshot({
        dateKey: todayKey,
        shopName,
        sales,
        returns: returnRecords,
        products,
        voidRecords,
        cashExpenses,
        debtPayments,
        supplierPayments,
        cashDrawerAdjustments,
        dayDrawerOpens,
        shifts,
        preferences,
      }),
    [
      todayKey,
      shopName,
      sales,
      returnRecords,
      products,
      voidRecords,
      cashExpenses,
      debtPayments,
      supplierPayments,
      cashDrawerAdjustments,
      dayDrawerOpens,
      shifts,
      preferences,
    ],
  );

  if (!hasPermission(actor.role, "reports.view")) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "xReportTitle")} backFallback="/office/cash-drawer" />
        <p className="text-lg text-stone-700">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "xReportTitle")}
        subtitle={`${t(lang, "xReportDate")}: ${todayKey}`}
        backLabel={t(lang, "officeBackToHub")}
        backFallback="/office/cash-drawer"
      />

      <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950">
        {t(lang, "xReportTitle")} — {t(lang, "closeDay")} {todayKey}. {t(lang, "closeDayTrustNote")}
      </p>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
        <DocumentActionsBar
          lang={lang}
          onPrint={() => void printXReport(lang, snapshot)}
          onDownloadPdf={() =>
            void downloadXReportPdf(lang, snapshot).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))
          }
          onSharePdf={() =>
            void shareXReportPdf(lang, snapshot).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))
          }
        />
        <button
          type="button"
          onClick={() => downloadXReportCsv(snapshot)}
          className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-stone-200 font-bold text-stone-800"
        >
          {t(lang, "xReportExportCsv")}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2 rounded-2xl bg-stone-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-stone-500">{t(lang, "totalSales")}</p>
            <p className="mt-1 text-xl font-black">UGX {snapshot.totalSalesUgx.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-stone-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-stone-500">{t(lang, "xReportCash")}</p>
            <p className="mt-1 text-lg font-black">UGX {snapshot.payments.cashUgx.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-teal-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase text-teal-800">{t(lang, "xReportMoMo")}</p>
            <p className="mt-1 text-lg font-black">UGX {snapshot.payments.mobileMoneyUgx.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-waka-50 px-3 py-3 col-span-2">
            <p className="text-[11px] font-black uppercase text-waka-800">{t(lang, "closeDayExpectedTitle")}</p>
            <p className="mt-1 text-xl font-black">UGX {snapshot.expectedDrawerCashUgx.toLocaleString()}</p>
          </div>
        </div>
      </section>

      <Link
        to="/close-day"
        className="flex min-h-[48px] items-center justify-center rounded-2xl bg-waka-600 font-black text-white"
      >
        {t(lang, "closeDay")}
      </Link>
    </div>
  );
}
