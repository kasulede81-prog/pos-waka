import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import {
  buildPurchaseListRows,
  filterPurchases,
  purchaseFilterFromDateFilter,
  resolvePurchaseFilterBounds,
  searchPurchases,
} from "../../../lib/purchaseReporting";
import { downloadPurchasesCsv, downloadPurchasesPdf, printPurchasesReport } from "../../../lib/purchaseExport";
import { receiptPrintActionLabel } from "../../../lib/printActionLabels";
import { dateKeyKampala } from "../../../lib/datesUg";
import type { DateFilterValue } from "../../../lib/dateFilters";
import { SalesHistoryDateFilterChips } from "../../../components/receipts/SalesHistoryDateFilterChips";
import { purchaseStatusKind, formatShortUgx } from "../lib/overviewStats";
import type { PurchaseStatusFilter } from "../types";

type Props = {
  lang: Language;
  onOpenPurchase: (id: string) => void;
  onNewPurchase: () => void;
};

export function PurchasesTab({ lang, onOpenPurchase, onNewPurchase }: Props) {
  const purchases = usePosStore((s) => s.purchases);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const preferences = usePosStore((s) => s.preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";

  const [filter, setFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseStatusFilter>("all");
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const listFilter = useMemo(() => purchaseFilterFromDateFilter(filter), [filter]);
  const bounds = useMemo(() => resolvePurchaseFilterBounds(listFilter), [listFilter]);

  const filtered = useMemo(() => {
    let list = filterPurchases(purchases, bounds);
    list = searchPurchases(list, products, { supplier: searchQ, product: searchQ, invoiceNumber: searchQ });
    if (statusFilter !== "all") {
      list = list.filter((p) => purchaseStatusKind(p) === statusFilter);
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [purchases, bounds, products, searchQ, statusFilter]);

  const rows = useMemo(() => buildPurchaseListRows(filtered, stockMovements), [filtered, stockMovements]);
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

  const statusClass = (kind: ReturnType<typeof purchaseStatusKind>) => {
    if (kind === "paid") return "bg-emerald-100 text-emerald-800";
    if (kind === "partial") return "bg-amber-100 text-amber-900";
    if (kind === "unpaid") return "bg-rose-100 text-rose-800";
    return "bg-stone-100 text-stone-600";
  };

  const statusLabel = (kind: ReturnType<typeof purchaseStatusKind>) => {
    if (kind === "paid") return t(lang, "ipStatusPaid");
    if (kind === "partial") return t(lang, "ipStatusPartial");
    if (kind === "unpaid") return t(lang, "ipStatusUnpaid");
    return t(lang, "purchaseStatusVoided");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
        <button
          type="button"
          onClick={onNewPurchase}
          className="shrink-0 rounded-xl bg-waka-600 px-4 py-2 text-xs font-black text-white"
        >
          + {t(lang, "ipActionNewPurchase")}
        </button>
      </div>

      <input
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        placeholder={t(lang, "ipPurchasesSearchPh")}
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold shadow-sm outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200/50"
      />

      <div className="flex flex-wrap gap-1.5">
        {(["all", "paid", "partial", "unpaid", "voided"] as PurchaseStatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={clsx(
              "rounded-full px-3 py-1.5 text-[11px] font-black",
              statusFilter === s ? "bg-waka-600 text-white" : "border border-stone-200 bg-white text-stone-700",
            )}
          >
            {s === "all" ? t(lang, "ipFilterAll") : statusLabel(s as ReturnType<typeof purchaseStatusKind>)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={exportBusy || rows.length === 0} onClick={() => void printPurchasesReport(lang, shopName, rows, exportStem)} className="min-h-[40px] rounded-xl bg-stone-900 px-3 text-xs font-black text-white disabled:opacity-50">
          {receiptPrintActionLabel(lang)}
        </button>
        <button type="button" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("csv")} className="min-h-[40px] rounded-xl border border-stone-200 px-3 text-xs font-black disabled:opacity-50">
          CSV
        </button>
        <button type="button" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("pdf")} className="min-h-[40px] rounded-xl bg-waka-600 px-3 text-xs font-black text-white disabled:opacity-50">
          PDF
        </button>
        {exportHint ? <p className="self-center text-xs font-bold text-waka-800">{exportHint}</p> : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm font-semibold text-stone-500">
          {t(lang, "purchasesEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const kind = purchaseStatusKind(row.purchase);
            const balance = Math.max(0, row.purchase.balanceDeltaUgx);
            return (
              <li key={row.purchase.id}>
                <button
                  type="button"
                  onClick={() => onOpenPurchase(row.purchase.id)}
                  className="w-full rounded-2xl border border-stone-200/90 bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-stone-950">{row.purchase.supplierName}</p>
                      <p className="text-[11px] font-semibold text-stone-500">
                        {dateKeyKampala(row.purchase.createdAt)} · {row.productCount} {t(lang, "purchasesColProducts").toLowerCase()}
                      </p>
                    </div>
                    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase", statusClass(kind))}>
                      {statusLabel(kind)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <dt className="font-semibold text-stone-500">{t(lang, "purchasesColTotal")}</dt>
                      <dd className="font-black tabular-nums">{formatShortUgx(row.purchase.totalCostUgx)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-500">{t(lang, "purchasesColPaid")}</dt>
                      <dd className="font-black tabular-nums text-teal-800">{formatShortUgx(row.purchase.amountPaidUgx)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-stone-500">{t(lang, "ipBalance")}</dt>
                      <dd className={clsx("font-black tabular-nums", balance > 0 ? "text-rose-700" : "text-stone-800")}>
                        {formatShortUgx(balance)}
                      </dd>
                    </div>
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
