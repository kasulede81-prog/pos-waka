import { useMemo, useState } from "react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Navigate } from "react-router-dom";
import { CalendarDays, ChevronDown, FileDown, Printer } from "lucide-react";
import type { Language, ReturnRecord, Sale, SaleLine } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";
import { saleMatchesFilter } from "../lib/dateFilters";
import { DateFilterBar } from "../components/shared/DateFilterBar";
import { DateFilterViewingLabel } from "../components/shared/DateFilterViewingLabel";
import { DateFilterArchiveNotice } from "../components/shared/DateFilterArchiveNotice";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { formatDateFilterChipDay } from "../lib/dateFilterLabels";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { logReceiptPdfExportAudit, logReceiptReprintAudit } from "../lib/auditReceiptLog";
import { downloadSaleReceiptPdf, printSaleReceipt } from "../lib/receiptDocuments";
import { receiptPrintActionLabel } from "../lib/printActionLabels";
import { buildSaleReceiptContext } from "../lib/receiptContextHelpers";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { ReturnReceiptActionsModal, buildReturnReceiptContext } from "../components/documents/ReturnReceiptActionsModal";
import { countSalesWithSyncErrors } from "../offline/cloudSync";
import { VoidLineModal } from "../components/pos/VoidLineModal";
import { ReturnProductModal } from "../components/pos/ReturnProductModal";
import type { VoidReason } from "../types";
import { getCompletedRevenue } from "../lib/financialMetrics";
import { isCompletedSale } from "../lib/saleStatus";
import {
  groupCompletedSalesByKampalaDay,
  groupPendingSalesByKampalaDay,
  partitionReceiptsSales,
} from "../lib/receiptsGrouping";
import { computeSaleDiscountBreakdown } from "../lib/discountBreakdown";
import { customerPaidUgxForSaleLine } from "../lib/refundBreakdown";
import { SaleDiscountSummary } from "../components/returns/SaleDiscountSummary";
function formatReceiptsDayHeading(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateKey;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-UG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

type SaleArticleProps = {
  lang: Language;
  sale: Sale;
  returnRecords: ReturnRecord[];
  canVoid: boolean;
  soldByLabel: (sale: Sale) => string;
  onPrint: (sale: Sale) => void;
  onReceiptPdf: (sale: Sale) => void;
  onVoidLine: (sale: Sale, lineIndex: number, line: SaleLine) => void;
  onReturn: (sale: Sale) => void;
  pendingBadge?: boolean;
};

function SaleArticle({
  lang,
  sale,
  returnRecords,
  canVoid,
  soldByLabel,
  onPrint,
  onReceiptPdf,
  onVoidLine,
  onReturn,
  pendingBadge,
}: SaleArticleProps) {
  const completed = isCompletedSale(sale);
  const allowAdjust = completed && canVoid;
  const discountBreakdown = useMemo(
    () => (completed ? computeSaleDiscountBreakdown(sale) : null),
    [completed, sale],
  );
  const saleReturns = useMemo(
    () => returnRecords.filter((r) => r.saleId === sale.id),
    [returnRecords, sale.id],
  );

  return (
    <article
      className={`rounded-2xl border p-3 ${pendingBadge ? "border-amber-200 bg-amber-50/40" : "border-stone-100 bg-white"}`}
    >
      <div className="flex justify-between gap-2">
        <p className="font-mono text-xs font-bold text-slate-500">#{sale.id.slice(0, 8)}</p>
        <p className="text-xs font-medium text-slate-500">{new Date(sale.createdAt).toLocaleString()}</p>
      </div>
      {pendingBadge ? (
        <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-amber-800">{t(lang, "receiptsPendingSection")}</p>
      ) : null}
      <p className="mt-1 text-xs font-semibold text-slate-500">
        {t(lang, "receiptCashier")}: {soldByLabel(sale)}
      </p>
      <p className="mt-1 text-lg font-black text-slate-950">UGX {sale.totalUgx.toLocaleString()}</p>
      {discountBreakdown ? (
        <SaleDiscountSummary lang={lang} breakdown={discountBreakdown} className="mt-2" />
      ) : null}
      <p className="text-xs font-medium text-slate-500">
        {t(lang, "cashLabel")}: UGX {sale.cashPaidUgx.toLocaleString()}
        {sale.debtUgx > 0 ? (
          <>
            {" · "}
            {t(lang, "creditLabel")}: UGX {sale.debtUgx.toLocaleString()}
          </>
        ) : null}
      </p>
      <ul className="mt-2 space-y-2 text-sm text-slate-700">
        {sale.lines.map((line, lineIndex) => {
          const paid = customerPaidUgxForSaleLine(sale, line, saleReturns);
          return (
          <li key={`${sale.id}-${line.productId}-${lineIndex}`} className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 flex-1">
              {line.voided ? (
                <span className="font-bold text-rose-700 line-through">{line.name}</span>
              ) : paid.showPaidBreakdown ? (
                <span className="font-bold text-slate-900">{line.name}</span>
              ) : (
                line.name
              )}{" "}
              {!line.voided && !paid.showPaidBreakdown ? (
                <span className="text-xs text-slate-500">
                  ({line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")})
                </span>
              ) : null}
              {!line.voided && paid.showPaidBreakdown ? (
                <span className="mt-0.5 block text-xs font-semibold text-slate-600">
                  {t(lang, "refundBreakdownListPrice")}: UGX {paid.listPriceUgx.toLocaleString()}
                  {" · "}
                  {t(lang, "refundBreakdownCustomerPaid")}: UGX {paid.customerPaidUgx.toLocaleString()}
                </span>
              ) : null}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {!paid.showPaidBreakdown ? (
                <span className={line.voided ? "line-through text-slate-400" : "font-bold"}>
                  UGX {(line.voided ? line.lineTotalUgx : paid.customerPaidUgx).toLocaleString()}
                </span>
              ) : null}
              {!line.voided && allowAdjust ? (
                <button
                  type="button"
                  onClick={() => onVoidLine(sale, lineIndex, line)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase text-rose-800"
                >
                  {t(lang, "voidBtn")}
                </button>
              ) : null}
            </div>
          </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onPrint(sale)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-800"
        >
          <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {receiptPrintActionLabel(lang)}
        </button>
        <button
          type="button"
          onClick={() => onReceiptPdf(sale)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-waka-200 bg-waka-50 px-3 text-xs font-black text-waka-800"
        >
          <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t(lang, "receiptDownloadPdf")}
        </button>
        {allowAdjust ? (
          <button
            type="button"
            onClick={() => onReturn(sale)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-950"
          >
            {t(lang, "returnBtn")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function ReceiptsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
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
  const { authMode, snapshot } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const term = hospitalityMode ? ht : pharmacyMode ? pt : null;
  const canVoid = hasPermission(actor.role, "sale_void");
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

  const rangeRevenueUgx = useMemo(
    () => getCompletedRevenue(partitioned.completed, allReturns, products),
    [partitioned.completed, allReturns, products],
  );

  const completedByDay = useMemo(
    () => groupCompletedSalesByKampalaDay(partitioned.completed, allReturns, products),
    [partitioned.completed, allReturns, products],
  );

  const pendingByDay = useMemo(() => groupPendingSalesByKampalaDay(partitioned.pending), [partitioned.pending]);

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

  const onDownloadDay = async (daySales: Sale[], dateKey: string) => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    await saveSalesListPdf({
      sales: daySales,
      title: tTemplate(lang, "receiptsPdfDayTitle", { date: formatReceiptsDayHeading(dateKey) }),
      subtitle: shopLabel,
      fileStem: `waka-past-sales-${dateKey}`,
    });
  };

  const hasAnyInRange = filteredInRange.length > 0;

  return (
    <div className="space-y-3 pb-8 md:pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{term ? term("receipts") : t(lang, "receipts")}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">{term ? term("receiptsHint") : t(lang, "receiptsHint")}</p>
        </div>
        {partitioned.completed.length > 0 ? (
          <button
            type="button"
            onClick={onDownloadAll}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-waka-200 bg-white px-3 text-xs font-black text-waka-800 shadow-sm transition-waka active:bg-waka-50"
          >
            <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(lang, "receiptsDownloadPdf")}
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
          <DateFilterBar lang={lang} value={filter} onChange={setFilter} />
          <DateFilterViewingLabel lang={lang} value={filter} />
          {filter.kind === "day" ? (
            <p className="text-xs font-bold text-waka-800">
              {tTemplate(lang, "dateFilterSelectedDayChip", {
                label: formatDateFilterChipDay(filter.dateKey, lang),
              })}
            </p>
          ) : null}
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

      {hasAnyInRange ? (
        <p className="rounded-xl border border-waka-100 bg-waka-50/80 px-3 py-2 text-sm font-bold text-waka-950">
          {t(lang, "receiptsRangeRevenue")}: UGX {rangeRevenueUgx.toLocaleString()}
        </p>
      ) : null}

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

      {completedByDay.length > 0 ? (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-black uppercase tracking-wide text-stone-600">{t(lang, "receiptsCompletedSection")}</h3>
          {completedByDay.map((group) => (
            <details
              key={group.dateKey}
              open
              className="group overflow-hidden rounded-[1.35rem] border border-stone-200/90 bg-white shadow-waka-sm open:ring-1 open:ring-waka-100"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-black text-stone-950">{formatReceiptsDayHeading(group.dateKey)}</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-500">
                    {tTemplate(lang, "receiptsDayGroupMeta", {
                      count: group.sales.length,
                      amount: group.dayRevenueUgx.toLocaleString(),
                    })}
                  </p>
                </div>
              </summary>
              <div className="space-y-2 border-t border-stone-100 bg-stone-50/50 px-3 py-3 sm:px-4">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onDownloadDay(group.sales, group.dateKey)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-black text-waka-700 ring-1 ring-stone-200"
                  >
                    <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t(lang, "receiptsDownloadDayPdf")}
                  </button>
                </div>
                {group.sales.map((sale) => (
                  <SaleArticle
                    key={sale.id}
                    lang={lang}
                    sale={sale}
                    returnRecords={allReturns}
                    canVoid={canVoid}
                    soldByLabel={soldByLabel}
                    onPrint={printSale}
                    onReceiptPdf={receiptPdfSale}
                    onVoidLine={(s, lineIndex, line) => setVoidTarget({ sale: s, lineIndex, line })}
                    onReturn={setReturnSale}
                  />
                ))}
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {pendingByDay.length > 0 ? (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-black uppercase tracking-wide text-amber-800">{t(lang, "receiptsPendingSection")}</h3>
          {pendingByDay.map((group) => (
            <details
              key={`pending-${group.dateKey}`}
              className="group overflow-hidden rounded-[1.35rem] border border-amber-200/90 bg-amber-50/30 shadow-waka-sm"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 shrink-0 text-amber-600 transition-transform group-open:rotate-180" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-black text-stone-950">{formatReceiptsDayHeading(group.dateKey)}</p>
                  <p className="mt-0.5 text-sm font-medium text-amber-900">
                    {tTemplate(lang, "receiptsDayGroupMeta", {
                      count: group.sales.length,
                      amount: group.sales.reduce((a, s) => a + s.totalUgx, 0).toLocaleString(),
                    })}
                  </p>
                </div>
              </summary>
              <div className="space-y-2 border-t border-amber-100 px-3 py-3 sm:px-4">
                {group.sales.map((sale) => (
                  <SaleArticle
                    key={sale.id}
                    lang={lang}
                    sale={sale}
                    returnRecords={allReturns}
                    canVoid={false}
                    soldByLabel={soldByLabel}
                    onPrint={printSale}
                    onReceiptPdf={receiptPdfSale}
                    onVoidLine={() => undefined}
                    onReturn={() => undefined}
                    pendingBadge
                  />
                ))}
              </div>
            </details>
          ))}
        </section>
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
          {showCancelled
            ? partitioned.cancelled.map((sale) => (
                <SaleArticle
                  key={sale.id}
                  lang={lang}
                  sale={sale}
                  returnRecords={allReturns}
                  canVoid={false}
                  soldByLabel={soldByLabel}
                  onPrint={printSale}
                  onReceiptPdf={receiptPdfSale}
                  onVoidLine={() => undefined}
                  onReturn={() => undefined}
                />
              ))
            : null}
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

