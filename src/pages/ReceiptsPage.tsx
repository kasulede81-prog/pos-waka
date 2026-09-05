import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useReportingSales } from "../hooks/useReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { BarChart3, FileDown, Receipt, SearchX } from "lucide-react";
import { themeUi } from "../lib/themeTokens";
import { statusTokens } from "../lib/statusTokens";
import { enterpriseMotion } from "../lib/enterpriseMotion";
import clsx from "clsx";
import type { Language, Sale, SaleLine } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useSessionActor } from "../context/SessionActorContext";
import { authOperatorPermissions, authOperatorRole } from "../lib/sessionActor";
import { VirtualizedReceiptList } from "../components/receipts/VirtualizedReceiptList";
import { SalesHistoryDesktopTable } from "../components/receipts/SalesHistoryDesktopTable";
import { useWakaLayoutBand } from "../hooks/useWakaLayoutBand";
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
import { partitionReceiptsSales, revenueEligibleSales } from "../lib/receiptsGrouping";
import {
  formatSalesHistoryPaymentMethodsSummary,
  sumSalesHistoryPhysicalCashUgx,
} from "../lib/salesHistoryTender";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { expenseCountsInDrawer } from "../lib/cashExpenses";
import { inventoryValueAtCostUgx } from "../lib/purchaseRecovery";
import { isCompletedSale, isPreCompletionVoidedSale, voidedSaleHistoryNumber } from "../lib/saleStatus";
import { SalesHistoryRow } from "../components/receipts/SalesHistoryRow";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import { sumDebtPaymentsInBounds } from "../lib/customerDebtActivity";
import { useProtectedAction } from "../hooks/useProtectedAction";
import { SalesHistoryPeriodSummary } from "../components/receipts/SalesHistoryPeriodSummary";
import { SalesHistoryDateFilterChips } from "../components/receipts/SalesHistoryDateFilterChips";
import { SalesHistorySearchBar } from "../components/receipts/SalesHistorySearchBar";
import { SalesHistoryAnalyticsPanel } from "../components/receipts/SalesHistoryAnalyticsPanel";
import { SalesHistorySkeletonList } from "../components/receipts/SalesHistorySkeletonList";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { buildReceiptNumberForSale } from "../lib/receiptPrint";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "../lib/soldByLabels";
import { saleSoldByMatchesActor } from "../lib/sellerIdentity";
import { salesHistoryShowsInitialSkeleton } from "../lib/salesHistoryLoading";
import { findProductByBarcode } from "../lib/pharmacyMedicine";
import {
  detectBarcodeCapabilities,
  startBarcodeSession,
  stopBarcodeSession,
} from "../services/hardware/barcodeAdapter";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";

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


export function ReceiptsPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const desktopTable = useWakaLayoutBand() === "desktop";
  const { runProtected } = useProtectedAction();
  const [desktopActionSale, setDesktopActionSale] = useState<Sale | null>(null);
  const [cameraScanOpen, setCameraScanOpen] = useState(false);
  const [cameraScanStatus, setCameraScanStatus] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
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
  const showInitialSkeleton = salesHistoryShowsInitialSkeleton(salesRefreshing, sales.length);
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
  const canVoid = actorHasPermission(actor, "sale_void");
  const { canProfit, canShopWideFinancials } = resolveProfitVisibility({
    role: authOperatorRole(actor),
    snapshot,
    authMode,
    actorPermissions: authOperatorPermissions(actor),
  });
  const showProfit = canProfit;
  const showShopSummaries = canShopWideFinancials;
  const products = usePosStore((s) => s.products);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const voidSaleLine = usePosStore((s) => s.voidSaleLine);
  const returnProduct = usePosStore((s) => s.returnProduct);
  const [showCancelled, setShowCancelled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [voidTarget, setVoidTarget] = useState<{ sale: Sale; lineIndex: number; line: SaleLine } | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [returnReceiptCtx, setReturnReceiptCtx] = useState<import("../lib/receiptDocuments").ReturnReceiptContext | null>(null);

  useEffect(() => {
    if (!cameraScanOpen) return;
    setCameraScanStatus(t(lang, "posBarcodeStarting"));
    void startBarcodeSession("camera", {
      videoElement: cameraVideoRef.current,
      onScan: (code) => {
        const hit = findProductByBarcode(products, code);
        const name = hit?.name?.trim();
        setSearchQuery(name || code);
        void stopBarcodeSession();
        setCameraScanOpen(false);
      },
      onError: (message) => setCameraScanStatus(message),
    }).then((result) => {
      if (!result.ok) setCameraScanStatus(result.error ?? t(lang, "posBarcodeSoon"));
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [cameraScanOpen, lang, products]);

  const openCameraScan = () => {
    if (!detectBarcodeCapabilities().cameraScan) return;
    setCameraScanOpen(true);
  };

  const closeCameraScan = () => {
    void stopBarcodeSession();
    setCameraScanOpen(false);
  };

  const shopLabel = preferences.shopDisplayName?.trim() || undefined;
  const customers = usePosStore((s) => s.customers);
  const staffAccounts = preferences.staffAccounts ?? [];
  const shifts = preferences.shifts ?? [];
  const auditLogs = usePosStore((s) => s.auditLogs);

  const soldByNameByUserId = useMemo(
    () =>
      buildSoldByNameByUserId({
        staffAccounts,
        shifts,
        auditLogs,
        ownerUserId: actor.authUserId ?? (actor.userId.startsWith("staff:") ? null : actor.userId),
        ownerDisplayName: actor.displayName,
        shopDisplayName: preferences.shopDisplayName,
      }),
    [staffAccounts, shifts, auditLogs, actor.authUserId, actor.userId, actor.displayName, preferences.shopDisplayName],
  );

  const soldByLabel = (sale: Sale): string =>
    resolveSoldByUserId(lang, sale.soldByUserId, soldByNameByUserId, preferences.shopDisplayName);

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
      auditLogs,
    });
  };

  const printSale = (sale: Sale) => {
    const ctx = receiptCtxFor(sale);
    void printSaleReceipt(ctx).then((result) => {
      if (result.ok) logReceiptReprintAudit(sale, ctx.receiptNumber);
      else window.alert(result.mode === "thermal" ? (result.error ?? t(lang, "receiptPrintThermalFailed")) : t(lang, "receiptPrintBlocked"));
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
    if (authOperatorRole(actor) !== "cashier") return inRange;
    return inRange.filter((s) => saleSoldByMatchesActor(s, actor));
  }, [sales, bounds, actor]);

  const partitioned = useMemo(() => partitionReceiptsSales(filteredInRange), [filteredInRange]);

  /** KPI / financial rolls — excludes whole-bill voids; list still uses partitioned.completed. */
  const revenueSalesInRange = useMemo(
    () => revenueEligibleSales(partitioned.completed),
    [partitioned.completed],
  );

  const filteredReturns = useMemo(
    () => allReturns.filter((r) => returnMatchesFilter(r, bounds)),
    [allReturns, bounds],
  );

  const rangeFinancials = useMemo(
    () =>
      getCompletedFinancialsFromScoped(revenueSalesInRange, filteredReturns, products, {
        skipProfit: !showProfit,
      }),
    [revenueSalesInRange, filteredReturns, products, showProfit],
  );

  const rangeRevenueUgx = useMemo(
    () => getCompletedRevenue(revenueSalesInRange, filteredReturns, products),
    [revenueSalesInRange, filteredReturns, products],
  );

  const itemsSoldCount = useMemo(() => countItemsSold(revenueSalesInRange), [revenueSalesInRange]);

  /** Physical drawer cash — not cashPaidUgx (MoMo/ATM stay 0). */
  const physicalCashInHandUgx = useMemo(
    () => sumSalesHistoryPhysicalCashUgx(revenueSalesInRange),
    [revenueSalesInRange],
  );

  const listSales = useMemo(() => {
    const primary = [...partitioned.completed, ...partitioned.pending, ...partitioned.voided];
    primary.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    const q = searchQuery.trim().toLowerCase();
    if (!q) return primary;

    return primary.filter((sale) => {
      const invoice = (
        isPreCompletionVoidedSale(sale) ? voidedSaleHistoryNumber(sale) : buildReceiptNumberForSale(sale, sales)
      ).toLowerCase();
      if (invoice.includes(q)) return true;
      if (customerNameFor(sale).toLowerCase().includes(q)) return true;
      if (soldByLabel(sale).toLowerCase().includes(q)) return true;
      return sale.lines.some((line) => line.name.toLowerCase().includes(q));
    });
  }, [partitioned.completed, partitioned.pending, partitioned.voided, searchQuery, sales, customers, soldByNameByUserId, lang]);

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

  const syncErrorCount = countSalesWithSyncErrors();

  const analyticsMetrics = useMemo(() => {
    const bestProduct = bestSellingProductName(revenueSalesInRange);
    const metrics = [
      { label: t(lang, "salesHistoryCashInHand"), value: `UGX ${physicalCashInHandUgx.toLocaleString()}` },
      ...(showShopSummaries
        ? [
            { label: t(lang, "salesHistoryDebtCollected"), value: `UGX ${debtCollectedUgx.toLocaleString()}` },
            { label: isSingleDay ? t(lang, "salesHistoryTodayExpenses") : t(lang, "salesHistoryExpensesInRange"), value: `UGX ${expensesUgx.toLocaleString()}` },
          ]
        : []),
      { label: t(lang, "salesHistoryAverageSale"), value: `UGX ${rangeFinancials.averageTransactionUgx.toLocaleString()}` },
      { label: t(lang, "salesHistoryBestProduct"), value: bestProduct ?? "—" },
      { label: t(lang, "salesHistoryPaymentMethods"), value: formatSalesHistoryPaymentMethodsSummary(lang, revenueSalesInRange) },
      ...(showShopSummaries
        ? [{ label: t(lang, "salesHistoryStockValue"), value: `UGX ${stockValueUgx.toLocaleString()}` }]
        : []),
    ];
    return metrics;
  }, [
    lang,
    isSingleDay,
    rangeFinancials,
    showShopSummaries,
    debtCollectedUgx,
    expensesUgx,
    revenueSalesInRange,
    physicalCashInHandUgx,
    stockValueUgx,
  ]);

  if (!actorHasPermission(actor, "receipts.view")) {
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
  const hasSellAccess = actorHasPermission(actor, "pos.sell");

  const renderSaleRow = (sale: Sale) => (
    <SalesHistoryRow
      key={sale.id}
      lang={lang}
      sale={sale}
      allSales={sales}
      returnRecords={allReturns}
      productById={productById}
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
    <EnterprisePageContainer variant="workspace" className="sales-history-workspace">
      <div className="sales-history-header sales-history-enter flex items-start justify-between gap-3">
        <div className="min-w-0">
          <PageHeader
            lang={lang}
            title={term ? term("receipts") : t(lang, "receipts")}
            subtitle={term ? term("receiptsHint") : t(lang, "receiptsHint")}
            backFallback="/office"
            backLabel={t(lang, "officeBackToHub")}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {partitioned.completed.length > 0 ? (
            <button
              type="button"
              onClick={() => void runProtected("export_data", onDownloadAll)}
              className={clsx(themeUi.btnSecondary, "min-h-11 gap-1.5 px-3 text-sm")}
              title={t(lang, "receiptsDownloadPdf")}
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "salesHistoryExport")}</span>
            </button>
          ) : null}
          {showShopSummaries ? (
            <Link
              to="/reports"
              className={clsx(themeUi.btnGhost, "min-h-11 gap-1.5 px-3 text-sm")}
            >
              <BarChart3 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "salesHistoryReports")}</span>
            </Link>
          ) : null}
        </div>
      </div>

      {syncErrorCount > 0 ? (
        <p className={clsx(statusTokens.warning.banner, enterpriseMotion.toastEnter)}>
          {tTemplate(lang, "syncErrorCount", { count: String(syncErrorCount) })} — {t(lang, "syncErrorBanner")}
        </p>
      ) : null}

      <div className="sales-history-zone--controls sticky top-0 z-10 -mx-3 space-y-3 px-3 pb-3 pt-1 backdrop-blur-sm sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        {sales.length > 0 ? (
          <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
        ) : null}
        <IncludeArchivedFilter
          lang={lang}
          checked={includeArchived}
          onChange={setIncludeArchived}
          className="border-waka-200/70 bg-card/90 py-2 shadow-elev"
        />
        {sales.length > 0 ? (
          <>
            {archiveNotice ? (
              <DateFilterArchiveNotice
                lang={lang}
                archivedCount={archivedSalesCount}
                onEnableArchived={() => setIncludeArchived(true)}
              />
            ) : null}
            {needsArchive && includeArchived && archivedSalesCount > 0 ? (
              <p className="text-sm font-semibold text-muted-foreground">{t(lang, "dateFilterArchiveIncluded")}</p>
            ) : null}
            {needsArchive && archivedSalesCount === 0 ? (
              <p className={statusTokens.warning.banner}>{t(lang, "dateFilterArchiveEmpty")}</p>
            ) : null}
            <SalesHistorySearchBar
              lang={lang}
              value={searchQuery}
              onChange={setSearchQuery}
              onScan={openCameraScan}
            />
          </>
        ) : null}
      </div>

      {sales.length > 0 ? (
        <div className="sales-history-enter">
          <SalesHistoryPeriodSummary
            lang={lang}
            salesLabel={salesHeroLabel}
            salesUgx={rangeRevenueUgx}
            itemsSold={itemsSoldCount}
            profitUgx={showProfit ? rangeFinancials.profitUgx : null}
            showProfit={showProfit}
            compact={!desktopTable}
          />
        </div>
      ) : null}

      {sales.length > 0 && !hasAnyInRange ? (
        <EnterpriseEmptyState
          icon={Receipt}
          title={t(lang, "receiptsNoSalesInRange")}
          className="border-waka-200/70 bg-waka-50/50"
        />
      ) : null}

      {sales.length === 0 && !showInitialSkeleton ? (
        <EnterpriseEmptyState
          icon={Receipt}
          title={t(lang, "salesHistoryEmptyTitle")}
          description={t(lang, "salesHistoryEmptyHint")}
          className="border-waka-200/70 bg-waka-50/50"
          primaryAction={
            hasSellAccess
              ? { label: t(lang, "salesHistoryStartSelling"), onClick: () => navigate("/pos") }
              : undefined
          }
        />
      ) : null}

      {showInitialSkeleton ? (
        <SalesHistorySkeletonList />
      ) : listSales.length > 0 ? (
        <section className="sales-history-zone--workspace sales-history-enter">
          {desktopTable ? (
            <>
              <SalesHistoryDesktopTable
                lang={lang}
                sales={listSales}
                allSales={sales}
                customerNameFor={customerNameFor}
                cashierLabelFor={soldByLabel}
                onPrint={printSale}
                onReceiptPdf={(s) => void runProtected("export_data", () => receiptPdfSale(s))}
                onOpenActions={setDesktopActionSale}
              />
              {desktopActionSale ? (
                <SalesHistoryRow
                  lang={lang}
                  sale={desktopActionSale}
                  allSales={sales}
                  returnRecords={allReturns}
                  productById={productById}
                  customerName={customerNameFor(desktopActionSale)}
                  cashierLabel={soldByLabel(desktopActionSale)}
                  canVoid={canVoid && isCompletedSale(desktopActionSale)}
                  onPrint={printSale}
                  onReceiptPdf={(s) => void runProtected("export_data", () => receiptPdfSale(s))}
                  onReturn={(s) => void runProtected("refund_sale", () => setReturnSale(s))}
                  onVoidLine={(s, lineIndex, line) =>
                    void runProtected("void_sale", () => setVoidTarget({ sale: s, lineIndex, line }))
                  }
                  hideCard
                  forceOpenActions
                  onActionsClose={() => setDesktopActionSale(null)}
                />
              ) : null}
            </>
          ) : (
            <VirtualizedReceiptList
              items={listSales}
              getKey={(sale) => sale.id}
              renderItem={(sale) => renderSaleRow(sale)}
            />
          )}
        </section>
      ) : hasAnyInRange && searchQuery.trim() ? (
        <EnterpriseEmptyState
          icon={SearchX}
          title={t(lang, "salesHistoryNoMatchTitle")}
          description={t(lang, "salesHistoryNoMatchHint")}
          className="border-waka-200/70 bg-waka-50/50"
        />
      ) : null}

      {hasAnyInRange ? <SalesHistoryAnalyticsPanel lang={lang} metrics={analyticsMetrics} /> : null}

      {partitioned.cancelled.length > 0 ? (
        <section className={clsx(themeUi.surfaceMuted, "space-y-3 p-4")}>
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            className={clsx(
              "text-base font-bold text-muted-foreground underline-offset-2 hover:underline",
              themeUi.focusRing,
              "rounded-lg px-1",
            )}
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

      {cameraScanOpen ? (
        <AppModalOverlay className="z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-3xl bg-card p-4 shadow-2xl">
            <p className="text-lg font-black text-foreground">{t(lang, "posBarcodeSoon")}</p>
            <video ref={cameraVideoRef} className="mt-3 h-56 w-full rounded-2xl bg-black object-cover" />
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {cameraScanStatus || t(lang, "posBarcodeStarting")}
            </p>
            <button
              type="button"
              className="mt-3 min-h-[48px] w-full rounded-2xl border-2 border-border bg-card py-3 text-sm font-black text-foreground"
              onClick={closeCameraScan}
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </AppModalOverlay>
      ) : null}
    </EnterprisePageContainer>
  );
}
