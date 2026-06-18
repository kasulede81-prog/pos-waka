import { useMemo, useState } from "react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Navigate } from "react-router-dom";
import { CalendarDays, FileDown } from "lucide-react";
import type { Language, Sale, SaleLine } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";
import { VirtualizedReceiptList } from "../components/receipts/VirtualizedReceiptList";
import { returnMatchesFilter, saleMatchesFilter } from "../lib/dateFilters";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { logReceiptPdfExportAudit, logReceiptReprintAudit } from "../lib/auditReceiptLog";
import { downloadSaleReceiptPdf, printSaleReceipt } from "../lib/receiptDocuments";
import { buildSaleReceiptContext } from "../lib/receiptContextHelpers";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { ReturnReceiptActionsModal, buildReturnReceiptContext } from "../components/documents/ReturnReceiptActionsModal";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { VoidLineModal } from "../components/pos/VoidLineModal";
import { ReturnProductModal } from "../components/pos/ReturnProductModal";
import type { VoidReason } from "../types";
import { getCompletedFinancialsFromScoped, getCompletedRevenue } from "../lib/financialMetrics";
import { partitionReceiptsSales } from "../lib/receiptsGrouping";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { expenseCountsInDrawer } from "../lib/cashExpenses";
import { inventoryValueAtCostUgx } from "../lib/purchaseRecovery";
import { isCompletedSale } from "../lib/saleStatus";
import { SalesHistoryHeroCard } from "../components/receipts/SalesHistoryHeroCard";
import { SalesHistoryRow } from "../components/receipts/SalesHistoryRow";
import { SalesHistorySummaryStrip } from "../components/receipts/SalesHistorySummaryStrip";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { sumDebtPaymentsInBounds } from "../lib/customerDebtActivity";
import { useProtectedAction } from "../hooks/useProtectedAction";

export function ReceiptsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { runProtected } = useProtectedAction();
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
  const sales = useDeferredReportingSales(includeArchived);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const allReturns = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const preferences = usePosStore((s) => s.preferences);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const { authMode, snapshot } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const term = hospitalityMode ? ht : pharmacyMode ? pt : null;
  const canVoid = hasPermission(actor.role, "sale_void");
  const { canProfit, canShopWideFinancials } = resolveProfitVisibility({ role: actor.role, snapshot, authMode });
  const showProfit = canProfit;
  const showShopSummaries = canShopWideFinancials;
  const products = usePosStore((s) => s.products);
  const voidSaleLine = usePosStore((s) => s.voidSaleLine);
  const returnProduct = usePosStore((s) => s.returnProduct);
  const [showCancelled, setShowCancelled] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ sale: Sale; lineIndex: number; line: SaleLine } | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnReceiptCtx, setReturnReceiptCtx] = useState<import("../lib/receiptDocuments").ReturnReceiptContext | null>(null);

  const shopLabel = preferences.shopDisplayName?.trim() || undefined;
  const customers = usePosStore((s) => s.customers);
  const staffAccounts = preferences.staffAccounts ?? [];

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffAccounts) {
      map.set(s.id, s.name);
    }
    return map;
  }, [staffAccounts]);

  const soldByLabel = (sale: Sale): string => {
    const id = sale.soldByUserId ?? "";
    if (!id) return t(lang, "role_owner");
    if (id.startsWith("staff:")) {
      const staffId = id.slice("staff:".length);
      return staffNameById.get(staffId) ?? t(lang, "role_cashier");
    }
    return t(lang, "role_owner");
  };

  const customerNameFor = (sale: Sale): string => {
    if (sale.receiptCustomerName?.trim()) return sale.receiptCustomerName.trim();
    const cust = sale.customerId ? customers.find((c) => c.id === sale.customerId) : null;
    return cust?.name?.trim() || t(lang, "salesHistoryWalkIn");
  };

  const receiptCtxFor = (sale: Sale) => {
    const cust = sale.customerId ? customers.find((c) => c.id === sale.customerId) : null;
    return buildSaleReceiptContext({
      lang,
      sale,
      allSales: sales,
      preferences,
      products,
      actor,
      customerName: sale.receiptCustomerName ?? cust?.name ?? null,
      customerPhone: sale.receiptCustomerPhone ?? cust?.phone ?? null,
      customerBalanceUgx: cust?.debtBalanceUgx ?? null,
      planTier: receiptPlanTier,
    });
  };

  const printSale = (sale: Sale) => {
    const ctx = receiptCtxFor(sale);
    void printSaleReceipt(ctx).then((result) => {
      if (result.ok) logReceiptReprintAudit(sale, ctx.receiptNumber);
      else window.alert(t(lang, "receiptPrintBlocked"));
    });
  };

  const receiptPdfSale = (sale: Sale) => {
    const ctx = receiptCtxFor(sale);
    void downloadSaleReceiptPdf(ctx).then((ok) => {
      if (ok) logReceiptPdfExportAudit(sale, ctx.receiptNumber);
      else window.alert(t(lang, "receiptPdfFailed"));
    });
  };

  const filteredInRange = useMemo(() => {
    const inRange = sales.filter((s) => saleMatchesFilter(s, bounds));
    if (actor.role !== "cashier") return inRange;
    return inRange.filter((s) => s.soldByUserId && s.soldByUserId === actor.userId);
  }, [sales, bounds, actor.role, actor.userId]);

  const partitioned = useMemo(() => partitionReceiptsSales(filteredInRange), [filteredInRange]);

  const filteredReturns = useMemo(
    () => allReturns.filter((r) => returnMatchesFilter(r, bounds)),
    [allReturns, bounds],
  );

  const rangeFinancials = useMemo(
    () =>
      getCompletedFinancialsFromScoped(partitioned.completed, filteredReturns, products, {
        skipProfit: !showProfit,
      }),
    [partitioned.completed, filteredReturns, products, showProfit],
  );

  const rangeRevenueUgx = useMemo(
    () => getCompletedRevenue(partitioned.completed, filteredReturns, products),
    [partitioned.completed, filteredReturns, products],
  );

  const listSales = useMemo(() => {
    const primary = [...partitioned.completed, ...partitioned.pending];
    primary.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return primary;
  }, [partitioned.completed, partitioned.pending]);

  const sparklinePoints = useMemo(() => {
    if (!showProfit) return [];
    const dayMap = new Map<string, Sale[]>();
    for (const sale of partitioned.completed) {
      const key = dateKeyKampala(sale.createdAt);
      const bucket = dayMap.get(key);
      if (bucket) bucket.push(sale);
      else dayMap.set(key, [sale]);
    }
    const keys = [...dayMap.keys()].sort();
    return keys.map((dayKey) => {
      const daySales = dayMap.get(dayKey) ?? [];
      const dayReturns = allReturns.filter((r) => dateKeyKampala(r.createdAt) === dayKey);
      return getCompletedFinancialsFromScoped(daySales, dayReturns, products).profitUgx;
    });
  }, [partitioned.completed, allReturns, products, showProfit]);

  const selectedDay = selectedDayKeyForFilter(filter);
  const isSingleDay = selectedDay != null;

  const expensesUgx = useMemo(() => {
    const visible = cashExpenses.filter((e) => !e.deletedAt && expenseCountsInDrawer(e));
    const inRange = visible.filter((e) => {
      if (isSingleDay) return e.paidOn === selectedDay;
      const paidOn = e.paidOn;
      return paidOn >= bounds.fromKey && paidOn <= bounds.toKey;
    });
    return inRange.reduce((sum, e) => sum + e.amountUgx, 0);
  }, [cashExpenses, bounds.fromKey, bounds.toKey, isSingleDay, selectedDay]);

  const stockValueUgx = useMemo(() => inventoryValueAtCostUgx(products), [products]);

  const debtCollectedUgx = useMemo(
    () => sumDebtPaymentsInBounds(debtPayments, bounds),
    [debtPayments, bounds],
  );

  const totalDebtUgx = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0),
    [customers],
  );

  const canViewDebts = hasPermission(actor.role, "customers.view");

  const syncErrorCount = countSalesWithSyncErrors();

  if (!hasPermission(actor.role, "receipts.view")) {
    return <Navigate to="/" replace />;
  }

  const onDownloadAll = async () => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    await saveSalesListPdf({
      sales: partitioned.completed,
      title: t(lang, "receiptsPdfAllTitle"),
      subtitle: shopLabel,
      fileStem: `waka-past-sales-all-${dateKeyKampala(new Date())}`,
    });
  };

  const hasAnyInRange = filteredInRange.length > 0;
  const salesHeroLabel = isSingleDay ? t(lang, "salesHistoryTodaySales") : t(lang, "salesHistorySalesInRange");
  const expensesLabel = isSingleDay ? t(lang, "salesHistoryTodayExpenses") : t(lang, "salesHistoryExpensesInRange");

  const renderSaleRow = (sale: Sale, index: number) => (
    <SalesHistoryRow
      key={sale.id}
      lang={lang}
      sale={sale}
      allSales={sales}
      returnRecords={allReturns}
      customerName={customerNameFor(sale)}
      cashierLabel={soldByLabel(sale)}
      canVoid={canVoid && isCompletedSale(sale)}
      toneIndex={index}
      onPrint={printSale}
      onReceiptPdf={(sale) => void runProtected("export_data", () => receiptPdfSale(sale))}
      onReturn={(sale) => void runProtected("refund_sale", () => setReturnSale(sale))}
      onVoidLine={(s, lineIndex, line) =>
        void runProtected("void_sale", () => setVoidTarget({ sale: s, lineIndex, line }))
      }
    />
  );

  return (
    <div className="space-y-4 pb-8 md:pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{term ? term("receipts") : t(lang, "receipts")}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">{term ? term("receiptsHint") : t(lang, "receiptsHint")}</p>
        </div>
        {partitioned.completed.length > 0 ? (
          <button
            type="button"
            onClick={() => void runProtected("export_data", onDownloadAll)}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-waka-200 bg-white px-3 text-xs font-black text-waka-800 shadow-sm transition-waka active:bg-waka-50"
            title={t(lang, "receiptsDownloadPdf")}
          >
            <FileDown className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{t(lang, "receiptsDownloadPdf")}</span>
          </button>
        ) : null}
      </div>

      {syncErrorCount > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {tTemplate(lang, "syncErrorCount", { count: String(syncErrorCount) })} — {t(lang, "syncErrorBanner")}
        </p>
      ) : null}

      {sales.length > 0 ? (
        <>
          <SalesHistoryHeroCard
            lang={lang}
            salesLabel={salesHeroLabel}
            salesUgx={rangeRevenueUgx}
            profitUgx={showProfit ? rangeFinancials.profitUgx : null}
            showProfit={showProfit}
            showShopDebt={showShopSummaries}
            showReportsLink={showShopSummaries}
            totalDebtUgx={totalDebtUgx}
            showDebtsLink={canViewDebts}
            filter={filter}
            onFilterChange={setFilter}
            sparklinePoints={sparklinePoints}
          />

          {archiveNotice ? (
            <DateFilterArchiveNotice
              lang={lang}
              archivedCount={archivedSalesCount}
              onEnableArchived={() => setIncludeArchived(true)}
            />
          ) : null}
          {needsArchive && includeArchived && archivedSalesCount > 0 ? (
            <p className="text-xs font-semibold text-stone-600">{t(lang, "dateFilterArchiveIncluded")}</p>
          ) : null}
          {needsArchive && archivedSalesCount === 0 ? (
            <p className="text-xs font-semibold text-amber-800">{t(lang, "dateFilterArchiveEmpty")}</p>
          ) : null}
        </>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {sales.length > 0 && !hasAnyInRange ? (
        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm font-bold text-stone-600">
          {t(lang, "receiptsNoSalesInRange")}
        </p>
      ) : null}

      {sales.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-stone-300" />
          <p className="mt-2 text-sm font-bold text-slate-500">{t(lang, "noSalesYet")}</p>
        </div>
      ) : null}

      {listSales.length > 0 ? (
        <section className="rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <h3 className="text-base font-black text-slate-950">{t(lang, "salesHistoryRecentSales")}</h3>
            <p className="text-xs font-bold text-slate-500">
              {tTemplate(lang, "receiptsDayGroupMeta", {
                count: String(listSales.length),
                amount: rangeRevenueUgx.toLocaleString(),
              })}
            </p>
          </div>
          <VirtualizedReceiptList
            items={listSales}
            getKey={(sale) => sale.id}
            renderItem={(sale, index) => renderSaleRow(sale, index)}
            estimateRowPx={76}
          />
        </section>
      ) : null}

      {hasAnyInRange ? (
        <SalesHistorySummaryStrip
          lang={lang}
          cashSalesUgx={rangeFinancials.cashCollectedUgx}
          debtCollectedUgx={debtCollectedUgx}
          expensesUgx={expensesUgx}
          expensesLabel={expensesLabel}
          stockValueUgx={stockValueUgx}
          showShopSummaries={showShopSummaries}
        />
      ) : null}

      {partitioned.cancelled.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            className="px-1 text-sm font-bold text-stone-500 underline-offset-2 hover:underline"
          >
            {showCancelled ? t(lang, "receiptsHideCancelled") : t(lang, "receiptsShowCancelled")} ({partitioned.cancelled.length})
          </button>
          {showCancelled ? (
            <div className="rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm">
              {partitioned.cancelled.map((sale, index) => renderSaleRow(sale, index))}
            </div>
          ) : null}
        </section>
      ) : null}

      <VoidLineModal
        lang={lang}
        open={voidTarget !== null}
        line={voidTarget?.line ?? null}
        onClose={() => setVoidTarget(null)}
        onConfirm={(reason: VoidReason, note) => {
          if (!voidTarget) return;
          voidSaleLine({
            saleId: voidTarget.sale.id,
            lineIndex: voidTarget.lineIndex,
            reason,
            note,
          });
          setVoidTarget(null);
        }}
      />

      <ReturnProductModal
        lang={lang}
        open={returnSale !== null}
        sale={returnSale}
        products={products}
        returnRecords={allReturns}
        actorRole={actor.role}
        onClose={() => setReturnSale(null)}
        onConfirm={(input) => {
          const r = returnProduct(input);
          if (!r.ok) return r;
          if (r.returnRecord) {
            const sale = returnSale;
            const cust = sale?.customerId ? customers.find((c) => c.id === sale.customerId) : null;
            setReturnReceiptCtx(
              buildReturnReceiptContext({
                shopName: shopLabel || "Waka POS",
                returnRecord: r.returnRecord,
                sale,
                cashier: sale ? soldByLabel(sale) : actor.displayName?.trim() || t(lang, "role_owner"),
                customerName: cust?.name ?? null,
              }),
            );
            setReturnSale(null);
          }
          return r;
        }}
      />

      <ReturnReceiptActionsModal
        lang={lang}
        open={returnReceiptCtx !== null}
        ctx={returnReceiptCtx}
        onClose={() => setReturnReceiptCtx(null)}
      />
    </div>
  );
}
