import { useMemo, useState } from "react";
import { Package, Receipt, ShoppingCart, Wallet } from "lucide-react";
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
import { InventoryDateFilterChips } from "./InventoryDateFilterChips";
import { purchaseStatusKind, formatShortUgx } from "../lib/overviewStats";
import type { PurchaseStatusFilter } from "../types";
import { PurchasesDesktopTable } from "./PurchasesDesktopTable";
import { InventoryPurchaseStatus, InventoryRoomEmpty, InventoryRoomHeader, InventoryRoomMetric } from "./InventoryRoomChrome";
import { useWakaLayoutBand } from "../../../hooks/useWakaLayoutBand";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import clsx from "clsx";

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

  const summary = useMemo(() => {
    let total = 0;
    let paid = 0;
    let balance = 0;
    let open = 0;
    for (const row of rows) {
      const kind = purchaseStatusKind(row.purchase);
      if (kind === "voided") continue;
      total += row.purchase.totalCostUgx;
      paid += row.purchase.amountPaidUgx;
      balance += Math.max(0, row.purchase.balanceDeltaUgx);
      if (kind === "unpaid" || kind === "partial") open += 1;
    }
    return { count: rows.length, total, paid, balance, open };
  }, [rows]);

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

  const statusLabel = (kind: ReturnType<typeof purchaseStatusKind>) => {
    if (kind === "paid") return t(lang, "ipStatusPaid");
    if (kind === "partial") return t(lang, "ipStatusPartial");
    if (kind === "unpaid") return t(lang, "ipStatusUnpaid");
    return t(lang, "purchaseStatusVoided");
  };

  return (
    <div className="inventory-room inventory-room--purchases space-y-3">
      <InventoryRoomHeader
        icon={Receipt}
        title={t(lang, "ipTabPurchases")}
        subtitle={t(lang, "ipPurchasesSub")}
        action={
          <WakaButton
            type="button"
            variant="primary"
            className="inventory-hub-cta shrink-0"
            iconLeft={<ShoppingCart className="h-4 w-4" aria-hidden />}
            onClick={onNewPurchase}
          >
            {t(lang, "ipActionNewPurchase")}
          </WakaButton>
        }
      />

      <div className="inventory-room-summary inventory-enter inventory-enter--1">
        <InventoryRoomMetric icon={Receipt} label={t(lang, "ipTabPurchases")} value={String(summary.count)} />
        <InventoryRoomMetric icon={Package} label={t(lang, "purchasesColTotal")} value={formatShortUgx(summary.total)} />
        <InventoryRoomMetric icon={Wallet} label={t(lang, "purchasesColPaid")} value={formatShortUgx(summary.paid)} tone="ok" />
        <InventoryRoomMetric
          icon={Wallet}
          label={t(lang, "ipBalance")}
          value={formatShortUgx(summary.balance)}
          tone={summary.open > 0 ? "warning" : "default"}
        />
      </div>

      <div className="inventory-enter inventory-enter--2 space-y-2.5">
        <InventoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder={t(lang, "ipPurchasesSearchPh")}
          className="inventory-room-search"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["all", "paid", "partial", "unpaid", "voided"] as PurchaseStatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={clsx("inventory-room-chip", statusFilter === s ? "inventory-room-chip--on" : "inventory-room-chip--off")}
            >
              {s === "all" ? t(lang, "ipFilterAll") : statusLabel(s as ReturnType<typeof purchaseStatusKind>)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <WakaButton type="button" variant="secondary" className="!min-h-[40px]" disabled={exportBusy || rows.length === 0} onClick={() => void printPurchasesReport(lang, shopName, rows, exportStem)}>
            {receiptPrintActionLabel(lang)}
          </WakaButton>
          <WakaButton type="button" variant="secondary" className="!min-h-[40px]" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("csv")}>
            CSV
          </WakaButton>
          <WakaButton type="button" variant="secondary" className="!min-h-[40px]" disabled={exportBusy || rows.length === 0} onClick={() => void runExport("pdf")}>
            PDF
          </WakaButton>
          {exportHint ? <p className="self-center text-sm font-bold text-primary">{exportHint}</p> : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <InventoryRoomEmpty
          icon={ShoppingCart}
          title={t(lang, "purchasesEmpty")}
          actionLabel={t(lang, "ipActionNewPurchase")}
          onAction={onNewPurchase}
        />
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
        <ul>
          {rows.map((row) => {
            const kind = purchaseStatusKind(row.purchase);
            const balance = Math.max(0, row.purchase.balanceDeltaUgx);
            return (
              <li key={row.purchase.id}>
                <button type="button" onClick={() => onOpenPurchase(row.purchase.id)} className="inventory-room-row">
                  <span className="inventory-ops-icon">
                    <Receipt className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="inventory-room-row__name truncate">{row.purchase.supplierName}</p>
                    <p className="inventory-room-row__meta truncate">
                      {dateKeyKampala(row.purchase.createdAt)}
                      {row.purchase.invoiceNumber?.trim() ? ` · ${row.purchase.invoiceNumber.trim()}` : ""}
                      {" · "}
                      {row.productCount} {t(lang, "purchasesColProducts").toLowerCase()}
                    </p>
                    <InventoryPurchaseStatus kind={kind} label={statusLabel(kind)} />
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="inventory-room-row__amount tabular-nums">{formatShortUgx(row.purchase.totalCostUgx)}</span>
                    <span className={clsx("text-sm font-bold tabular-nums", balance > 0 ? "text-rose-700" : "text-muted-foreground")}>
                      {formatShortUgx(balance)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
