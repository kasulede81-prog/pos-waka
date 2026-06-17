import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Package, Receipt, Truck } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";
import { HistoryListCard } from "../components/shared/HistoryListCard";
import { formatHistoryPickerDate } from "../components/shared/HistoryDatePickerStrip";
import {
  buildPurchaseListRows,
  filterPurchases,
  filterSupplierPayments,
  purchaseFilterFromDateFilter,
  resolvePurchaseFilterBounds,
  searchPurchases,
  sumSupplierPaymentsUgx,
  type PurchaseListFilter,
} from "../lib/purchaseReporting";
import { isPurchaseVoided, supplierPaymentCreatedByLabel } from "../lib/purchaseCorrections";
import { downloadPurchasesCsv, downloadPurchasesPdf, printPurchasesReport } from "../lib/purchaseExport";
import { receiptPrintActionLabel } from "../lib/printActionLabels";
import { dateKeyKampala } from "../lib/datesUg";
import type { DateFilterValue } from "../lib/dateFilters";

export function PurchasesPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "purchases.view");
  const purchases = usePosStore((s) => s.purchases);
  const products = usePosStore((s) => s.products);
  const suppliers = usePosStore((s) => s.suppliers);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const preferences = usePosStore((s) => s.preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";

  const [presetFilter, setPresetFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });
  const [useRange, setUseRange] = useState(false);
  const [fromKey, setFromKey] = useState(dateKeyKampala(new Date()));
  const [toKey, setToKey] = useState(dateKeyKampala(new Date()));
  const [searchSupplier, setSearchSupplier] = useState("");
  const [searchProduct, setSearchProduct] = useState("");
  const [searchInvoice, setSearchInvoice] = useState("");
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const listFilter: PurchaseListFilter = useMemo(() => {
    if (useRange) return { kind: "range", fromKey, toKey };
    return purchaseFilterFromDateFilter(presetFilter);
  }, [useRange, fromKey, toKey, presetFilter]);

  const bounds = useMemo(() => resolvePurchaseFilterBounds(listFilter), [listFilter]);

  const filteredPurchases = useMemo(() => {
    const scoped = filterPurchases(purchases, bounds);
    return searchPurchases(scoped, products, {
      supplier: searchSupplier,
      product: searchProduct,
      invoiceNumber: searchInvoice,
    });
  }, [purchases, bounds, products, searchSupplier, searchProduct, searchInvoice]);

  const rows = useMemo(
    () => buildPurchaseListRows(filteredPurchases, stockMovements),
    [filteredPurchases, stockMovements],
  );

  const paymentsInPeriod = useMemo(
    () => filterSupplierPayments(supplierPayments, bounds),
    [supplierPayments, bounds],
  );

  const supplierNameById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const exportStem = `${bounds.fromKey}_${bounds.toKey}`;

  const runExport = async (kind: "csv" | "pdf") => {
    setExportBusy(true);
    try {
      const ok =
        kind === "csv"
          ? await downloadPurchasesCsv(rows, exportStem)
          : await downloadPurchasesPdf(lang, shopName, rows, exportStem);
      setExportHint(ok ? t(lang, "purchasesExportOk") : t(lang, "purchasesExportFail"));
      window.setTimeout(() => setExportHint(null), 3500);
    } finally {
      setExportBusy(false);
    }
  };

  const runPrint = async () => {
    setExportBusy(true);
    try {
      const ok = await printPurchasesReport(lang, shopName, rows, exportStem);
      setExportHint(ok ? t(lang, "purchasesExportOk") : t(lang, "purchasesExportFail"));
      window.setTimeout(() => setExportHint(null), 3500);
    } finally {
      setExportBusy(false);
    }
  };

  const purchaseTotals = useMemo(
    () => ({
      cost: rows.reduce((sum, row) => sum + row.purchase.totalCostUgx, 0),
      paid: rows.reduce((sum, row) => sum + row.purchase.amountPaidUgx, 0),
      payments: sumSupplierPaymentsUgx(paymentsInPeriod),
    }),
    [rows, paymentsInPeriod],
  );

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5 pb-16">
      <PageHeader
        lang={lang}
        title={t(lang, "purchasesTitle")}
        subtitle={t(lang, "purchasesSub")}
        backFallback="/office"
        backLabel={t(lang, "officeBackToHub")}
      />

      <HistoryHeroCard
        lang={lang}
        filter={presetFilter}
        onFilterChange={setPresetFilter}
        dateLabelOverride={
          useRange ? `${formatHistoryPickerDate(fromKey, lang)} – ${formatHistoryPickerDate(toKey, lang)}` : undefined
        }
        datePickerFooter={
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
              <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
              {t(lang, "purchasesFilterRange")}
            </label>
            {useRange ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-bold text-stone-600">
                  {t(lang, "purchasesFilterFrom")}
                  <input
                    type="date"
                    value={fromKey}
                    onChange={(e) => setFromKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-semibold"
                  />
                </label>
                <label className="block text-xs font-bold text-stone-600">
                  {t(lang, "purchasesFilterTo")}
                  <input
                    type="date"
                    value={toKey}
                    onChange={(e) => setToKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-semibold"
                  />
                </label>
              </div>
            ) : null}
          </div>
        }
        metrics={[
          {
            label: t(lang, "purchasesColTotal"),
            icon: Package,
            value: `UGX ${purchaseTotals.cost.toLocaleString()}`,
          },
          {
            label: t(lang, "purchasesColPaid"),
            icon: Receipt,
            value: `UGX ${purchaseTotals.paid.toLocaleString()}`,
          },
          {
            label: t(lang, "supplierPaymentHistory"),
            icon: Truck,
            value: `UGX ${purchaseTotals.payments.toLocaleString()}`,
          },
        ]}
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={searchSupplier}
          onChange={(e) => setSearchSupplier(e.target.value)}
          placeholder={t(lang, "purchasesSearchSupplier")}
          className="rounded-2xl border-2 border-stone-200 px-4 py-3 text-sm font-semibold"
        />
        <input
          value={searchProduct}
          onChange={(e) => setSearchProduct(e.target.value)}
          placeholder={t(lang, "purchasesSearchProduct")}
          className="rounded-2xl border-2 border-stone-200 px-4 py-3 text-sm font-semibold"
        />
        <input
          value={searchInvoice}
          onChange={(e) => setSearchInvoice(e.target.value)}
          placeholder={t(lang, "purchasesSearchInvoice")}
          className="rounded-2xl border-2 border-stone-200 px-4 py-3 text-sm font-semibold"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={exportBusy || rows.length === 0}
          onClick={() => void runPrint()}
          className="min-h-[44px] rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
        >
          {receiptPrintActionLabel(lang)}
        </button>
        <button
          type="button"
          disabled={exportBusy || rows.length === 0}
          onClick={() => void runExport("csv")}
          className="min-h-[44px] rounded-2xl border-2 border-stone-300 bg-white px-4 py-2 text-sm font-black disabled:opacity-50"
        >
          {t(lang, "purchasesExportCsv")}
        </button>
        <button
          type="button"
          disabled={exportBusy || rows.length === 0}
          onClick={() => void runExport("pdf")}
          className="min-h-[44px] rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
        >
          {t(lang, "purchasesExportPdf")}
        </button>
        {exportHint ? <p className="self-center text-sm font-bold text-waka-800">{exportHint}</p> : null}
      </div>

      {rows.length === 0 ? (
        <HistoryListCard
          isEmpty
          empty={<p className="text-sm font-medium text-stone-600">{t(lang, "purchasesEmpty")}</p>}
        />
      ) : (
        <HistoryListCard>
          <ul>
          {rows.map((row) => (
            <li key={row.purchase.id} className="border-b border-stone-100 last:border-b-0">
              <Link
                to={`/office/purchases/${row.purchase.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 active:bg-stone-50 sm:px-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase text-stone-500">{row.dayKey}</p>
                  <p className="mt-0.5 truncate text-sm font-black text-stone-950">
                    {row.purchase.supplierName}
                    {isPurchaseVoided(row.purchase) ? (
                      <span className="ml-2 rounded-lg bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">
                        {t(lang, "purchaseStatusVoided")}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-stone-500">
                    {row.productCount} {t(lang, "purchasesColProducts").toLowerCase()} · {row.quantityReceived}{" "}
                    {t(lang, "purchasesColQty").toLowerCase()}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-waka-800">UGX {row.purchase.totalCostUgx.toLocaleString()}</p>
                  <p className="text-[11px] font-semibold text-stone-500">
                    {t(lang, "purchasesColPaid")}: UGX {row.purchase.amountPaidUgx.toLocaleString()}
                  </p>
                </div>
              </Link>
            </li>
          ))}
          </ul>
        </HistoryListCard>
      )}

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "supplierPaymentHistory")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">
          {t(lang, "purchasesColTotal")}: UGX {sumSupplierPaymentsUgx(paymentsInPeriod).toLocaleString()}
        </p>
        {paymentsInPeriod.length === 0 ? (
          <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, "supplierPaymentEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {paymentsInPeriod.map((pay) => (
              <li
                key={pay.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-stone-50 px-4 py-3"
              >
                <div>
                  <p className="font-bold text-stone-900">{supplierNameById.get(pay.supplierId) ?? "—"}</p>
                  <p className="text-xs font-semibold text-stone-500">{dateKeyKampala(pay.createdAt)}</p>
                  <p className="text-xs font-semibold text-stone-600">
                    {t(lang, "supplierPaymentCreatedBy")}:{" "}
                    {supplierPaymentCreatedByLabel(
                      pay,
                      auditLogs.find(
                        (e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id,
                      ) ?? null,
                    )}
                  </p>
                  {pay.paymentMethod ? (
                    <p className="text-xs text-stone-500">
                      {t(lang, "supplierPaymentMethod")}: {pay.paymentMethod}
                    </p>
                  ) : null}
                  {pay.reference ? (
                    <p className="text-xs text-stone-500">
                      {t(lang, "supplierPaymentReference")}: {pay.reference}
                    </p>
                  ) : null}
                </div>
                <p className="text-lg font-black text-teal-800">UGX {pay.amountUgx.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
