import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BarChart3, HandCoins, Wallet } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useReportingReturnRecords } from "../hooks/useReportingReturnRecords";
import { useShopReportBundle } from "../hooks/useShopReporting";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { dateKeyKampala } from "../lib/datesUg";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { isSingleDayFilter, selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { buildDailyReportText, shareText } from "../lib/reportExport";
import { downloadDailyReportPdf } from "../lib/dailyReportPdf";
import {
  downloadPharmacyExpiryCsv,
  downloadPharmacyExpiryPdf,
} from "../lib/pharmacyDocumentExports";
import {
  downloadWholesaleDebtorListPdf,
  downloadWholesaleReceivablesCsv,
  downloadWholesaleReceivablesPdf,
  wholesaleReceivablesRows,
} from "../lib/wholesaleDocumentExports";
import {
  downloadHospitalityKitchenPdf,
  downloadHospitalityTablePdf,
  downloadHospitalityWaiterPdf,
} from "../lib/hospitalityDocumentExports";
import { PageHeader } from "../components/layout/PageHeader";
import { computeHospitalityReports } from "../lib/hospitalityReports";
import { isHospitalityMode, totalOpenTablesPendingUgx } from "../lib/hospitality";
import { activeSessions } from "../lib/hospitalityStats";
import { computePharmacyExpiryReport } from "../lib/pharmacyReports";
import { isPharmacyMode } from "../lib/pharmacy";
import { isWholesaleMode } from "../lib/wholesale";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import { ExpiryStatusBadge } from "../components/pharmacy/ExpiryStatusBadge";
import { StockMovementsPanel } from "../components/stock/StockMovementsPanel";
import { HorizontalTabBar } from "../components/shared/HorizontalTabBar";
import { MonthlyReportsPanel } from "../components/reports/MonthlyReportsPanel";
import { ProfitPage } from "./ProfitPage";

type ReportTab = "summary" | "profit" | "monthly" | "products";

function parseReportTab(raw: string | null, canProfit: boolean): ReportTab {
  if (raw === "profit" && canProfit) return "profit";
  if (raw === "monthly") return "monthly";
  if (raw === "products") return "products";
  return "summary";
}

export function ReportsPage({ lang }: { lang: Language }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const purchases = usePosStore((s) => s.purchases);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const {
    filter,
    setFilter,
    bounds,
    includeArchived,
    setIncludeArchived,
    archiveNotice,
    archivedSalesCount,
    needsArchive,
  } = useReportingDateFilter();
  const [reportHint, setReportHint] = useState<string | null>(null);
  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = useReportingReturnRecords(includeArchived);
  const report = useShopReportBundle(filter, includeArchived);
  const reportDayKey = selectedDayKeyForFilter(filter) ?? dateKeyKampala(new Date());
  const showDailyExport = isSingleDayFilter(filter);
  const canViewReports = hasPermission(actor.role, "reports.view");

  const canProfit = hasEffectivePermission(actor.role, "reports.profit", snapshot, authMode);
  const canPurchasesView = hasPermission(actor.role, "purchases.view");
  const canSuppliersView = hasPermission(actor.role, "suppliers.view");

  const purchasesTodayUgx = useMemo(() => {
    const dk = reportDayKey;
    return purchases.filter((p) => dateKeyKampala(p.createdAt) === dk).reduce((a, p) => a + p.totalCostUgx, 0);
  }, [purchases, reportDayKey]);

  const preferences = usePosStore((s) => s.preferences);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const wholesaleMode = isWholesaleMode(preferences.businessType);
  const hospitalityReports = useMemo(() => {
    if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) return null;
    const { fromKey, toKey } = bounds;
    return computeHospitalityReports(sales, products, { fromKey, toKey }, {
      floor: preferences.hospitalityFloor,
      staffAccounts: preferences.staffAccounts,
    });
  }, [
    preferences.businessType,
    preferences.hospitalityModeEnabled,
    preferences.hospitalityFloor,
    preferences.staffAccounts,
    bounds,
    sales,
    products,
  ]);

  const hospitalityOpenBills = useMemo(() => {
    if (!hospitalityReports || !preferences.hospitalityFloor) return null;
    const open = activeSessions(preferences.hospitalityFloor);
    return {
      count: open.length,
      totalUgx: totalOpenTablesPendingUgx(sales, preferences.hospitalityFloor),
    };
  }, [hospitalityReports, preferences.hospitalityFloor, sales]);

  const pharmacyExpiryReport = useMemo(() => {
    if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) return null;
    return computePharmacyExpiryReport(products);
  }, [preferences.businessType, preferences.pharmacyModeEnabled, products]);

  const receivablesByAccount = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of customers) {
      totals.set(c.name, c.debtBalanceUgx);
    }
    return [...totals.entries()]
      .map(([name, debt]) => ({ name, debt }))
      .filter((row) => row.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 10);
  }, [customers]);

  const activeTab = parseReportTab(searchParams.get("tab"), canProfit);
  const reportTabs = useMemo(
    () => [
      { id: "summary", label: t(lang, "reportsTabSummary") },
      ...(canProfit ? [{ id: "profit", label: t(lang, "reportsTabProfit") }] : []),
      { id: "monthly", label: t(lang, "reportsTabMonthly") },
      { id: "products", label: t(lang, "reportsTabProducts") },
    ],
    [lang, canProfit],
  );
  const setActiveTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  if (!canViewReports) {
    return <Navigate to="/" replace />;
  }

  const totals = {
    revenue: report.revenue,
    cash: report.cash,
    profit: report.profit,
    debt: report.debt,
    count: report.count,
  };
  const topProducts = report.topProducts;
  const weakProducts = report.slowProducts;
  const last7DayBars = report.dailyTrend;
  const debtOutstanding = report.debtOutstanding;
  const supplierDebtTotal = report.supplierDebtTotal;
  const stockValueAtCost = report.stockValueAtCost;
  const marginLeaders = report.marginLeaders.map((r) => ({
    name: r.name,
    revenue: r.revenueUgx,
    profit: r.profitUgx,
    pct: r.revenueUgx > 0 ? r.profitUgx / r.revenueUgx : 0,
  }));

  const pharmacyExpirySection =
    pharmacyExpiryReport && !wholesaleMode ? (
      <section className="space-y-4 rounded-3xl border border-emerald-200 bg-emerald-50/40 p-4">
        <h2 className="text-lg font-black text-emerald-950">{t(lang, "pharmacyReportsTitle")}</h2>
        <p className="text-sm font-semibold text-stone-700">{t(lang, "pharmacyReportsPrimaryHint")}</p>
        <div>
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "pharmacyReportsExpiring")}</p>
          <p className="mt-1 text-sm font-semibold text-stone-700">
            {t(lang, "pharmacyReportsExpiringValue")}: UGX {pharmacyExpiryReport.expiringValueUgx.toLocaleString()}
          </p>
          {pharmacyExpiryReport.expiring.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {pharmacyExpiryReport.expiring.slice(0, 20).map((row) => (
                <li key={row.productId} className="flex justify-between gap-2 font-medium">
                  <span className="min-w-0 truncate">
                    {products.find((p) => p.id === row.productId)
                      ? formatMedicineFullLabel(products.find((p) => p.id === row.productId)!)
                      : row.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-stone-600">
                    {products.find((p) => p.id === row.productId) ? (
                      <ExpiryStatusBadge lang={lang} product={products.find((p) => p.id === row.productId)!} compact />
                    ) : null}
                    {row.expiryDate}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm font-medium text-stone-500">{t(lang, "pharmacyReportsNoExpiring")}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-black uppercase text-red-700">{t(lang, "pharmacyReportsExpired")}</p>
          <p className="mt-1 text-sm font-semibold text-stone-700">
            {t(lang, "pharmacyReportsExpiredValue")}: UGX {pharmacyExpiryReport.expiredValueUgx.toLocaleString()}
          </p>
          {pharmacyExpiryReport.expired.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {pharmacyExpiryReport.expired.slice(0, 20).map((row) => (
                <li key={row.productId} className="flex justify-between gap-2 font-medium text-red-900">
                  <span className="min-w-0 truncate">
                    {products.find((p) => p.id === row.productId)
                      ? formatMedicineFullLabel(products.find((p) => p.id === row.productId)!)
                      : row.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {products.find((p) => p.id === row.productId) ? (
                      <ExpiryStatusBadge lang={lang} product={products.find((p) => p.id === row.productId)!} compact />
                    ) : null}
                    {row.expiryDate}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm font-medium text-stone-500">{t(lang, "pharmacyReportsNoExpired")}</p>
          )}
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3">
          <p className="text-sm font-black text-stone-900">{t(lang, "pharmacyReportsMovementTitle")}</p>
          <div className="mt-2">
            <StockMovementsPanel lang={lang} movements={stockMovements} pharmacyMode />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white"
            onClick={() => void downloadPharmacyExpiryPdf(lang, products)}
          >
            {t(lang, "pharmacyExportPdf")}
          </button>
          <button
            type="button"
            className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-900"
            onClick={() => void downloadPharmacyExpiryCsv(products)}
          >
            {t(lang, "pharmacyExportCsv")}
          </button>
        </div>
      </section>
    ) : null;

  const wholesaleSection = wholesaleMode ? (
    <section className="space-y-4 rounded-3xl border border-indigo-200 bg-indigo-50/40 p-4">
      <h2 className="text-lg font-black text-indigo-950">{t(lang, "wholesaleReportsHubTitle")}</h2>
      <p className="text-sm font-semibold text-stone-700">{t(lang, "wholesaleReportsPrimaryHint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsReceivables")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {debtOutstanding.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsInvoiceVolume")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">{totals.count}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsWarehouseValue")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {stockValueAtCost.toLocaleString()}</p>
        </article>
      </div>
      <div className="rounded-2xl border border-indigo-100 bg-white p-3">
        <p className="text-sm font-black text-slate-900">{t(lang, "wholesaleReportsLargestDebtors")}</p>
        {receivablesByAccount.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t(lang, "wholesaleDashNoInvoices")}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {receivablesByAccount.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-2 font-semibold">
                <span className="truncate">{row.name}</span>
                <span>UGX {row.debt.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-3">
        <p className="text-sm font-black text-stone-900">{t(lang, "wholesaleReportsMovementTitle")}</p>
        <div className="mt-2">
          <StockMovementsPanel lang={lang} movements={stockMovements} wholesaleMode />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-black text-white"
          onClick={() => {
            const rows = wholesaleReceivablesRows(customers);
            void downloadWholesaleReceivablesPdf(lang, rows, debtOutstanding);
          }}
        >
          {t(lang, "wholesaleExportReceivablesPdf")}
        </button>
        <button
          type="button"
          className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-900"
          onClick={() => void downloadWholesaleReceivablesCsv(wholesaleReceivablesRows(customers))}
        >
          {t(lang, "wholesaleExportReceivablesCsv")}
        </button>
        <button
          type="button"
          className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-900"
          onClick={() => void downloadWholesaleDebtorListPdf(lang, wholesaleReceivablesRows(customers))}
        >
          {t(lang, "wholesaleExportDebtorsPdf")}
        </button>
      </div>
    </section>
  ) : null;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        lang={lang}
        title={wholesaleMode ? t(lang, "wholesaleReportsHubTitle") : pharmacyMode ? t(lang, "pharmacyReportsHubTitle") : t(lang, "reports")}
        backLabel={t(lang, "officeBackToHub")}
      />

      <HistoryHeroCard
        lang={lang}
        filter={filter}
        onFilterChange={setFilter}
        metrics={[
          {
            label: t(lang, "receiptsRangeRevenue"),
            icon: BarChart3,
            value: `UGX ${totals.revenue.toLocaleString()}`,
          },
          canProfit
            ? {
                label: t(lang, "estimatedProfit"),
                icon: Wallet,
                value: `UGX ${totals.profit.toLocaleString()}`,
                hint: t(lang, "estimatedProfitHint"),
              }
            : {
                label: t(lang, "cashInHand"),
                icon: Wallet,
                value: `UGX ${totals.cash.toLocaleString()}`,
              },
          {
            label: t(lang, "salesCount"),
            icon: HandCoins,
            value: String(totals.count),
            hint: `${t(lang, "debtToday")}: UGX ${totals.debt.toLocaleString()}`,
          },
        ]}
      />
      {archiveNotice ? (
        <DateFilterArchiveNotice
          lang={lang}
          archivedCount={archivedSalesCount}
          onEnableArchived={() => setIncludeArchived(true)}
        />
      ) : null}
      {needsArchive && includeArchived && archivedSalesCount > 0 ? (
        <p className="text-xs font-semibold text-slate-600">{t(lang, "dateFilterArchiveIncluded")}</p>
      ) : null}
      {needsArchive && archivedSalesCount === 0 ? (
        <p className="text-xs font-semibold text-amber-800">{t(lang, "dateFilterArchiveEmpty")}</p>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <HorizontalTabBar
        tabs={reportTabs}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel={t(lang, "reports")}
      />

      {activeTab === "summary" ? (
        <>
      {pharmacyMode && pharmacyExpirySection ? pharmacyExpirySection : null}
      {wholesaleSection}

      {hospitalityReports ? (
        <section className="space-y-4 rounded-3xl border border-waka-200 bg-waka-50/40 p-4">
          <h2 className="text-lg font-black text-waka-950">{t(lang, "hospitalityReportsTitle")}</h2>
          <p className="text-sm font-semibold text-stone-700">
            {hospitalityReports.completedBillCount} bills · UGX {hospitalityReports.totalRevenueUgx.toLocaleString()} ·{" "}
            {t(lang, "hospitalityReportsAvgBill")} UGX {hospitalityReports.avgBillUgx.toLocaleString()}
          </p>
          {hospitalityOpenBills && hospitalityOpenBills.count > 0 ? (
            <article className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
              <p className="text-xs font-black uppercase text-amber-900">{t(lang, "hospitalityReportsOpenBills")}</p>
              <p className="mt-1 text-lg font-black text-amber-950">
                {hospitalityOpenBills.count} · UGX {hospitalityOpenBills.totalUgx.toLocaleString()}
              </p>
            </article>
          ) : null}
          {hospitalityReports.waiters.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsWaiters")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {hospitalityReports.waiters.slice(0, 5).map((w) => (
                  <li key={w.waiterId} className="flex justify-between font-medium">
                    <span>{w.label}</span>
                    <span>
                      {w.billCount} · UGX {w.revenueUgx.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports.categoryMix.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsMix")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {hospitalityReports.categoryMix.map((row) => (
                  <li key={row.kind} className="flex justify-between font-medium capitalize">
                    <span>{row.kind}</span>
                    <span>UGX {row.revenueUgx.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports.peakHours.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsPeak")}</p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                {hospitalityReports.peakHours
                  .slice()
                  .sort((a, b) => b.revenueUgx - a.revenueUgx)
                  .slice(0, 6)
                  .map((h) => (
                    <li key={h.hour} className="rounded-full bg-white px-3 py-1 ring-1 ring-stone-200">
                      {h.label}: {h.billCount}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports.tables.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase text-stone-500">{t(lang, "hospitalityReportsTableRevenue")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {hospitalityReports.tables.slice(0, 5).map((row) => (
                  <li key={row.label} className="flex justify-between font-medium">
                    <span className="truncate">{row.label}</span>
                    <span>UGX {row.revenueUgx.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hospitalityReports ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="rounded-xl bg-waka-700 px-3 py-2 text-xs font-black text-white"
                onClick={() => void downloadHospitalityWaiterPdf(lang, hospitalityReports)}
              >
                {t(lang, "hospitalityExportWaiterPdf")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-waka-300 bg-white px-3 py-2 text-xs font-black text-waka-900"
                onClick={() => void downloadHospitalityKitchenPdf(lang, hospitalityReports)}
              >
                {t(lang, "hospitalityExportKitchenPdf")}
              </button>
              <button
                type="button"
                className="rounded-xl border border-waka-300 bg-white px-3 py-2 text-xs font-black text-waka-900"
                onClick={() => void downloadHospitalityTablePdf(lang, hospitalityReports)}
              >
                {t(lang, "hospitalityExportTablePdf")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {showDailyExport ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">{t(lang, "exportReportHeading")}</p>
          {reportHint ? <p className="mt-2 text-sm text-slate-600">{reportHint}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="rounded-2xl bg-waka-600 px-4 py-3 text-sm font-bold text-white"
              onClick={() => {
                const dk = reportDayKey;
                void downloadDailyReportPdf({
                  lang,
                  dateKey: dk,
                  shopName: preferences.shopDisplayName?.trim() || "Waka POS",
                  sales,
                  products,
                  returnRecords,
                  debtPayments,
                  cashExpenses,
                  topProducts: report.topProducts,
                }).then((ok) => setReportHint(ok ? t(lang, "monthlyReportDownloadOk") : t(lang, "monthlyReportDownloadFail")));
              }}
            >
              {t(lang, "dailyReportDownloadPdf")}
            </button>
            <button
              type="button"
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"
              onClick={() => {
                const dk = reportDayKey;
                const text = buildDailyReportText(lang, dk, sales, products, returnRecords, debtPayments, cashExpenses);
                void navigator.clipboard.writeText(text).then(
                  () => {
                    setReportHint(t(lang, "reportCopied"));
                    window.setTimeout(() => setReportHint(null), 3500);
                  },
                  () => setReportHint(t(lang, "reportCopyInstead")),
                );
              }}
            >
              {t(lang, "reportCopyDay")}
            </button>
            <button
              type="button"
              className="rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800"
              onClick={async () => {
                const dk = reportDayKey;
                const text = buildDailyReportText(lang, dk, sales, products, returnRecords, debtPayments, cashExpenses);
                const ok = await shareText(text, t(lang, "appName"));
                setReportHint(ok ? t(lang, "reportShared") : t(lang, "reportCopyInstead"));
                window.setTimeout(() => setReportHint(null), 3500);
              }}
            >
              {t(lang, "reportShareDay")}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t(lang, "exportReportFooter")}</p>
        </section>
      ) : null}

      <section className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">{t(lang, "reportsWeekTrend")}</p>
        <div className="mt-4 flex h-28 items-end justify-between gap-1 px-1">
          {last7DayBars.map((b) => (
            <div key={b.day} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className="w-full max-w-[2.25rem] rounded-t-lg bg-gradient-to-t from-slate-800 to-slate-600"
                style={{ height: b.barPx }}
                title={`UGX ${b.total.toLocaleString()}`}
              />
              <span className="text-[10px] font-bold text-slate-500">{b.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border bg-amber-50/50 p-4 ring-1 ring-amber-100">
        <p className="text-sm font-semibold text-amber-950">{t(lang, "reportsDebtOutstanding")}</p>
        <p className="mt-1 text-2xl font-black text-amber-900">UGX {debtOutstanding.toLocaleString()}</p>
      </section>
        </>
      ) : null}

      {activeTab === "profit" && canProfit ? (
        <>
      {canPurchasesView || canSuppliersView || canProfit ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {canPurchasesView ? (
            <article className="rounded-3xl border border-waka-100 bg-waka-50/40 p-4">
              <p className="text-xs font-semibold text-waka-900">{t(lang, "reportsPurchasesToday")}</p>
              <p className="mt-1 text-2xl font-black text-waka-950">UGX {purchasesTodayUgx.toLocaleString()}</p>
            </article>
          ) : null}
          {canSuppliersView ? (
            <article className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">{t(lang, "reportsSupplierDebt")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">UGX {supplierDebtTotal.toLocaleString()}</p>
            </article>
          ) : null}
          {canProfit ? (
            <article className="rounded-3xl border border-slate-200 bg-white p-4 sm:col-span-2">
              <p className="text-xs text-slate-500">{t(lang, "reportsStockValue")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">UGX {stockValueAtCost.toLocaleString()}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      {canProfit && marginLeaders.length > 0 ? (
        <section className="rounded-3xl border bg-white p-4">
          <p className="font-semibold text-slate-800">{t(lang, "reportsBestMargins")}</p>
          <p className="mt-1 text-xs text-slate-500">{t(lang, "reportsMarginHint")}</p>
          <ul className="mt-3 space-y-2">
            {marginLeaders.map((r) => (
              <li key={r.name} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="text-waka-700">
                  UGX {r.profit.toLocaleString()}
                  <span className="text-slate-500"> ({Math.round(r.pct * 100)}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canProfit ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">{t(lang, "expensesFutureTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{t(lang, "expensesFutureHint")}</p>
        </section>
      ) : null}

      <ProfitPage lang={lang} embedded />
        </>
      ) : null}

      {activeTab === "monthly" ? <MonthlyReportsPanel lang={lang} /> : null}

      {activeTab === "products" ? (
        <>
      <section className={`rounded-3xl border bg-white p-4 ${pharmacyMode ? "opacity-90" : ""}`}>
        <p className="font-semibold text-slate-800">
          {pharmacyMode ? t(lang, "pharmacyReportsTopMedicines") : wholesaleMode ? t(lang, "wholesaleReportsTopAccounts") : t(lang, "topProducts")}
        </p>
        {topProducts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {topProducts.map((p) => (
              <li key={p.productId || p.name} className="flex justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-slate-600">UGX {p.revenueUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canProfit && weakProducts.length > 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-800">{t(lang, "reportsWeakSellers")}</p>
          <ul className="mt-3 space-y-2">
            {weakProducts.map((p) => (
              <li key={p.productId || p.name} className="flex justify-between text-sm">
                <span className="font-medium text-slate-700">{p.name}</span>
                <span className="text-slate-500">UGX {p.revenueUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-3xl border bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">{t(lang, "stockRemainingHint")}</p>
        <ul className="mt-2 space-y-1">
          {products.slice(0, 12).map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{p.name}</span>
              <span>
                {p.stockOnHand} {p.baseUnit}
              </span>
            </li>
          ))}
        </ul>
      </section>
        </>
      ) : null}
    </div>
  );
}
