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
import { PurchasesDesktopTable } from "./PurchasesDesktopTable";
import { useWakaLayoutBand } from "../../../hooks/useWakaLayoutBand";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { statusTokens } from "../../../lib/statusTokens";

type Props = {
  lang: Language;
  onOpenPurchase: (id: string) => void;
  onNewPurchase: () => void;
};

export function PurchasesTab({ lang, onOpenPurchase, onNewPurchase }: Props) {
  const desktopTable = useWakaLayoutBand() === "desktop";
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
    if (kind === "paid") return statusTokens.success.badge;
    if (kind === "partial") return statusTokens.warning.badge;
    if (kind === "unpaid") return statusTokens.danger.badge;
    return statusTokens.draft.badge;
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
        <WakaButton type="button" variant="primary" className="shrink-0 !min-h-[40px] !px-4 !text-xs" onClick={onNewPurchase}>
          + {t(lang, "ipActionNewPurchase")}
        </WakaButton>
      </div>

      <input
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        placeholder={t(lang, "ipPurchasesSearchPh")}
        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold shadow-sm outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200/50"
      />

      <div className="flex flex-wrap gap-1.5">
        {(["all", "paid", "partial", "unpaid", "voided"] as PurchaseStatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={clsx(
              "rounded-full px-3 py-1.5 text-[11px] font-bold",
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground",
            )}
          >
            {s === "all" ? t(lang, "ipFilterAll") : statusLabel(s as ReturnType<typeof purchaseStatusKind>)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <WakaButton type="button" variant="secondary" className="!min-h-[40px] !text-xs" disabled={exportBusy || rows.length === 0} onClick={() => void printPurchasesReport(lang, shopName, rows, exportStem)}>
          {receiptPrintActionLabel(lang)}
        </WakaButton>
        <WakaButton type="button" variant="secondary" className="!min-h-[40px] !text-xs" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("csv")}>
          CSV
        </WakaButton>
        <WakaButton type="button" variant="primary" className="!min-h-[40px] !text-xs" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("pdf")}>
          PDF
        </WakaButton>
        {exportHint ? <p className="self-center text-xs font-bold text-primary">{exportHint}</p> : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-muted px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
          {t(lang, "purchasesEmpty")}
        </p>
      ) : desktopTable ? (
        <PurchasesDesktopTable
          lang={lang}
          rows={rows}
          onOpenPurchase={onOpenPurchase}
          onExportSelectedCsv={(selected) => {
            void downloadPurchasesCsv(selected, `${exportStem}_selected`);
          }}
        />
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
                  className="w-full rounded-2xl border border-border/90 bg-card p-3 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-foreground">{row.purchase.supplierName}</p>
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        {dateKeyKampala(row.purchase.createdAt)} · {row.productCount} {t(lang, "purchasesColProducts").toLowerCase()}
                      </p>
                    </div>
                    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase", statusClass(kind))}>
                      {statusLabel(kind)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                    <div>
                      <dt className="font-semibold text-muted-foreground">{t(lang, "purchasesColTotal")}</dt>
                      <dd className="font-black tabular-nums">{formatShortUgx(row.purchase.totalCostUgx)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-muted-foreground">{t(lang, "purchasesColPaid")}</dt>
                      <dd className="font-black tabular-nums text-teal-800">{formatShortUgx(row.purchase.amountPaidUgx)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-muted-foreground">{t(lang, "ipBalance")}</dt>
                      <dd className={clsx("font-black tabular-nums", balance > 0 ? "text-rose-700" : "text-foreground")}>
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
