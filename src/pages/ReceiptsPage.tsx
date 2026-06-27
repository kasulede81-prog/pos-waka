import { useDeferredValue, useMemo, useState } from "react";
import { useReportingSales } from "../hooks/useReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Link, Navigate } from "react-router-dom";
import { BarChart3, FileDown, Receipt } from "lucide-react";
import type { Language, Sale, SaleLine } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
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
import { SalesHistoryRow } from "../components/receipts/SalesHistoryRow";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { sumDebtPaymentsInBounds } from "../lib/customerDebtActivity";
import { useProtectedAction } from "../hooks/useProtectedAction";
import { SalesHistoryStatGrid } from "../components/receipts/SalesHistoryStatGrid";
import { SalesHistorySecondaryChips, buildSecondaryChips } from "../components/receipts/SalesHistorySecondaryChips";
import { SalesHistoryDateFilterChips } from "../components/receipts/SalesHistoryDateFilterChips";
import { SalesHistorySearchBar } from "../components/receipts/SalesHistorySearchBar";
import { SalesHistoryAnalyticsPanel } from "../components/receipts/SalesHistoryAnalyticsPanel";
import { SalesHistorySkeletonList } from "../components/receipts/SalesHistorySkeletonList";
import { buildReceiptNumberForSale } from "../lib/receiptPrint";

function countItemsSold(sales: Sale[]): number {
  let count = 0;
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (!line.voided) count += line.quantity;
    }
  }
  return count;
}

function bestSellingProductName(sales: Sale[]): string | null {
  const map = new Map<string, number>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      map.set(line.name, (map.get(line.name) ?? 0) + line.quantity);
    }
  }
  let bestName: string | null = null;
  let bestQty = 0;
  for (const [name, qty] of map) {
    if (qty > bestQty) {
      bestQty = qty;
      bestName = name;
    }
  }
  return bestName;
}

function paymentMethodsSummary(lang: Language, sales: Sale[]): string {
  let cash = 0;
  let debt = 0;
  for (const s of sales) {
    cash += s.cashPaidUgx;
    debt += s.debtUgx;
  }
  const parts: string[] = [];
  if (cash > 0) parts.push(`${t(lang, "paymentMethod_cash")}: UGX ${cash.toLocaleString()}`);
  if (debt > 0) parts.push(`${t(lang, "paymentMethod_credit")}: UGX ${debt.toLocaleString()}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

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
  const rawSales = useReportingSales(includeArchived);
  const sales = useDeferredValue(rawSales);
  const salesRefreshing = rawSales !== sales;
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
  const [searchQuery, setSearchQuery] = useState("");
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

  const itemsSoldCount = useMemo(() => countItemsSold(partitioned.completed), [partitioned.completed]);

  const listSales = useMemo(() => {
    const primary = [...partitioned.completed, ...partitioned.pending];
    primary.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    const q = searchQuery.trim().toLowerCase();
    if (!q) return primary;

    return primary.filter((sale) => {
      const invoice = buildReceiptNumberForSale(sale, sales).toLowerCase();
      if (invoice.includes(q)) return true;
      if (customerNameFor(sale).toLowerCase().includes(q)) return true;
      if (soldByLabel(sale).toLowerCase().includes(q)) return true;
      return sale.lines.some((line) => line.name.toLowerCase().includes(q));
    });
  }, [partitioned.completed, partitioned.pending, searchQuery, sales, customers, staffNameById, lang]);

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

  const secondaryChips = useMemo(
    () =>
      buildSecondaryChips(lang, {
        cashSalesUgx: rangeFinancials.cashCollectedUgx,
        debtCollectedUgx,
        expensesUgx,
        expensesLabel: isSingleDay ? t(lang, "salesHistoryTodayExpenses") : t(lang, "salesHistoryExpensesInRange"),
        stockValueUgx,
        showShopSummaries,
      }),
    [lang, rangeFinancials.cashCollectedUgx, debtCollectedUgx, expensesUgx, isSingleDay, stockValueUgx, showShopSummaries],
  );

  const analyticsMetrics = useMemo(() => {
    const bestProduct = bestSellingProductName(partitioned.completed);
    const metrics = [
      { label: isSingleDay ? t(lang, "salesHistoryTodaySales") : t(lang, "salesHistorySalesInRange"), value: `UGX ${rangeRevenueUgx.toLocaleString()}` },
      ...(showProfit
        ? [{ label: t(lang, "salesHistoryProfits"), value: `UGX ${rangeFinancials.profitUgx.toLocaleString()}` }]
        : []),
      { label: t(lang, "salesHistoryCashInHand"), value: `UGX ${rangeFinancials.cashCollectedUgx.toLocaleString()}` },
      ...(showShopSummaries
        ? [
            { label: t(lang, "salesHistoryDebtCollected"), value: `UGX ${debtCollectedUgx.toLocaleString()}` },
            { label: isSingleDay ? t(lang, "salesHistoryTodayExpenses") : t(lang, "salesHistoryExpensesInRange"), value: `UGX ${expensesUgx.toLocaleString()}` },
          ]
        : []),
      { label: t(lang, "salesHistoryItemsSold"), value: String(itemsSoldCount) },
      { label: t(lang, "salesHistoryAverageSale"), value: `UGX ${rangeFinancials.averageTransactionUgx.toLocaleString()}` },
      { label: t(lang, "salesHistoryBestProduct"), value: bestProduct ?? "—" },
      { label: t(lang, "salesHistoryPaymentMethods"), value: paymentMethodsSummary(lang, partitioned.completed) },
      ...(showShopSummaries
        ? [{ label: t(lang, "salesHistoryStockValue"), value: `UGX ${stockValueUgx.toLocaleString()}` }]
        : []),
    ];
    return metrics;
  }, [
    lang,
    isSingleDay,
    rangeRevenueUgx,
    showProfit,
    rangeFinancials,
    showShopSummaries,
    debtCollectedUgx,
    expensesUgx,
    itemsSoldCount,
    partitioned.completed,
    stockValueUgx,
  ]);

  if (!hasPermission(actor.role, "receipts.view")) {
    return <Navigate to="/" replace />;
  }

  const onDownloadAll = async () => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    const { dateKeyKampala } = await import("../lib/datesUg");
    await saveSalesListPdf({
      sales: partitioned.completed,
      title: t(lang, "receiptsPdfAllTitle"),
      subtitle: shopLabel,
      fileStem: `waka-past-sales-all-${dateKeyKampala(new Date())}`,
    });
  };

  const hasAnyInRange = filteredInRange.length > 0;
  const salesHeroLabel = isSingleDay ? t(lang, "salesHistoryTodaySales") : t(lang, "salesHistorySalesInRange");
  const hasSellAccess = hasPermission(actor.role, "pos.sell");

  const renderSaleRow = (sale: Sale) => (
    <SalesHistoryRow
      key={sale.id}
      lang={lang}
      sale={sale}
      allSales={sales}
      returnRecords={allReturns}
      customerName={customerNameFor(sale)}
      cashierLabel={soldByLabel(sale)}
      canVoid={canVoid && isCompletedSale(sale)}
      onPrint={printSale}
      onReceiptPdf={(s) => void runProtected("export_data", () => receiptPdfSale(s))}
      onReturn={(s) => void runProtected("refund_sale", () => setReturnSale(s))}
      onVoidLine={(s, lineIndex, line) =>
        void runProtected("void_sale", () => setVoidTarget({ sale: s, lineIndex, line }))
      }
    />
  );

  return (
    <div className="space-y-3 pb-8 md:pb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-black tracking-tight text-stone-950 sm:text-2xl">
            {term ? term("receipts") : t(lang, "receipts")}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-stone-500 sm:text-sm">
            {term ? term("receiptsHint") : t(lang, "receiptsHint")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {partitioned.completed.length > 0 ? (
            <button
              type="button"
              onClick={() => void runProtected("export_data", onDownloadAll)}
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-waka-700 shadow-sm active:bg-stone-50"
              title={t(lang, "receiptsDownloadPdf")}
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "salesHistoryExport")}</span>
            </button>
          ) : null}
          {showShopSummaries ? (
            <Link
              to="/reports"
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-700 shadow-sm active:bg-stone-50"
            >
              <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "salesHistoryReports")}</span>
            </Link>
          ) : null}
        </div>
      </div>

      {syncErrorCount > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {tTemplate(lang, "syncErrorCount", { count: String(syncErrorCount) })} — {t(lang, "syncErrorBanner")}
        </p>
      ) : null}

      {sales.length > 0 ? (
        <>
          <SalesHistoryStatGrid
            lang={lang}
            salesLabel={salesHeroLabel}
            salesUgx={rangeRevenueUgx}
            profitUgx={showProfit ? rangeFinancials.profitUgx : null}
            showProfit={showProfit}
            itemsSold={itemsSoldCount}
            totalDebtUgx={totalDebtUgx}
            showShopDebt={showShopSummaries && canViewDebts}
          />

          {hasAnyInRange && secondaryChips.length > 0 ? (
            <SalesHistorySecondaryChips chips={secondaryChips} />
          ) : null}

          <div className="sticky top-0 z-10 -mx-3 space-y-2 bg-stone-50/95 px-3 pb-2 pt-0 backdrop-blur-sm sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
            <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
            <SalesHistorySearchBar lang={lang} value={searchQuery} onChange={setSearchQuery} />

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
          </div>

          {hasAnyInRange ? <SalesHistoryAnalyticsPanel lang={lang} metrics={analyticsMetrics} /> : null}
        </>
      ) : null}

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {sales.length > 0 && !hasAnyInRange ? (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm font-bold text-stone-600">
          {t(lang, "receiptsNoSalesInRange")}
        </p>
      ) : null}

      {sales.length === 0 && !salesRefreshing ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center">
          <Receipt className="mx-auto h-8 w-8 text-stone-300" aria-hidden />
          <p className="mt-3 text-base font-black text-stone-800">{t(lang, "salesHistoryEmptyTitle")}</p>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "salesHistoryEmptyHint")}</p>
          {hasSellAccess ? (
            <Link
              to="/pos"
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white shadow-sm active:bg-waka-700"
            >
              {t(lang, "salesHistoryStartSelling")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {salesRefreshing ? (
        <SalesHistorySkeletonList />
      ) : listSales.length > 0 ? (
        <section className="transition-opacity duration-300 ease-out">
          <VirtualizedReceiptList
            items={listSales}
            getKey={(sale) => sale.id}
            renderItem={(sale) => renderSaleRow(sale)}
          />
        </section>
      ) : hasAnyInRange && searchQuery.trim() ? (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-bold text-stone-600">
          {t(lang, "posSellNoMatch")}
        </p>
      ) : null}

      {partitioned.cancelled.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            className="px-1 text-sm font-bold text-stone-500 underline-offset-2 hover:underline"
          >
            {showCancelled ? t(lang, "receiptsHideCancelled") : t(lang, "receiptsShowCancelled")} (
            {partitioned.cancelled.length})
          </button>
          {showCancelled ? (
            <div className="space-y-2">{partitioned.cancelled.map((sale) => renderSaleRow(sale))}</div>
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
