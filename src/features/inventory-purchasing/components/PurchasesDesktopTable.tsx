import { useMemo } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { dateKeyKampala } from "../../../lib/datesUg";
import type { PurchaseListRow } from "../../../lib/purchaseReporting";
import { purchaseStatusKind, formatShortUgx } from "../lib/overviewStats";
import {
  EnterpriseDataTable,
  EnterpriseDesktopBulkBar,
  useEnterpriseTableSelection,
  type EnterpriseDataColumn,
} from "../../../components/enterprise/data-table";
import { themeUi } from "../../../lib/themeTokens";
import { InventoryPurchaseStatus } from "./InventoryRoomChrome";

type Props = {
  lang: Language;
  rows: PurchaseListRow[];
  onOpenPurchase: (id: string) => void;
  onExportSelectedCsv?: (rows: PurchaseListRow[]) => void;
};

export function PurchasesDesktopTable({ lang, rows, onOpenPurchase, onExportSelectedCsv }: Props) {
  const selection = useEnterpriseTableSelection({ startEnabled: true });

  const statusLabel = (kind: ReturnType<typeof purchaseStatusKind>) => {
    if (kind === "paid") return t(lang, "ipStatusPaid");
    if (kind === "partial") return t(lang, "ipStatusPartial");
    if (kind === "unpaid") return t(lang, "ipStatusUnpaid");
    return t(lang, "purchaseStatusVoided");
  };

  const columns: EnterpriseDataColumn<PurchaseListRow>[] = useMemo(
    () => [
      {
        id: "date",
        header: t(lang, "purchasesColDate"),
        width: "minmax(96px,0.9fr)",
        cell: (row) => dateKeyKampala(row.purchase.createdAt),
      },
      {
        id: "supplier",
        header: t(lang, "purchasesColSupplier") !== "purchasesColSupplier" ? t(lang, "purchasesColSupplier") : "Supplier",
        width: "minmax(140px,2fr)",
        cell: (row) => <span className="inventory-table-product">{row.purchase.supplierName}</span>,
        className: "text-foreground",
      },
      {
        id: "invoice",
        header: t(lang, "purchasesSearchInvoice"),
        width: "minmax(88px,1fr)",
        hideBelow: "lg",
        cell: (row) => row.purchase.invoiceNumber?.trim() || "—",
      },
      {
        id: "items",
        header: t(lang, "purchasesColProducts"),
        width: "minmax(64px,0.6fr)",
        align: "right",
        cell: (row) => String(row.productCount),
      },
      {
        id: "total",
        header: t(lang, "purchasesColTotal"),
        width: "minmax(96px,1fr)",
        align: "right",
        cell: (row) => <span className="font-bold tabular-nums text-foreground">{formatShortUgx(row.purchase.totalCostUgx)}</span>,
      },
      {
        id: "paid",
        header: t(lang, "purchasesColPaid"),
        width: "minmax(88px,0.9fr)",
        align: "right",
        hideBelow: "xl",
        cell: (row) => <span className="font-bold tabular-nums text-teal-800">{formatShortUgx(row.purchase.amountPaidUgx)}</span>,
      },
      {
        id: "balance",
        header: t(lang, "ipBalance"),
        width: "minmax(88px,0.9fr)",
        align: "right",
        hideBelow: "lg",
        cell: (row) => {
          const balance = Math.max(0, row.purchase.balanceDeltaUgx);
          return (
            <span className={clsx("font-bold tabular-nums", balance > 0 ? "text-rose-700" : "text-foreground")}>
              {formatShortUgx(balance)}
            </span>
          );
        },
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(104px,0.9fr)",
        cell: (row) => {
          const kind = purchaseStatusKind(row.purchase);
          return <InventoryPurchaseStatus kind={kind} label={statusLabel(kind)} />;
        },
      },
    ],
    [lang],
  );

  const selected = useMemo(() => rows.filter((r) => selection.isSelected(r.purchase.id)), [rows, selection]);

  return (
    <div className="inventory-room-table space-y-2">
      <EnterpriseDesktopBulkBar
        lang={lang}
        count={selection.count}
        onClear={selection.clear}
        onSelectVisible={() => selection.selectIds(rows.map((r) => r.purchase.id))}
      >
        {onExportSelectedCsv ? (
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => onExportSelectedCsv(selected)}
            className={clsx(themeUi.btnSecondary, "min-h-[36px] px-3 py-1.5 text-sm")}
          >
            CSV
          </button>
        ) : null}
      </EnterpriseDesktopBulkBar>

      <EnterpriseDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.purchase.id}
        selection={selection}
        onRowActivate={(row) => onOpenPurchase(row.purchase.id)}
        minWidthPx={920}
        ariaLabel={t(lang, "ipTabPurchases")}
        getRowClassName={(row) => {
          const kind = purchaseStatusKind(row.purchase);
          if (kind === "unpaid") return "inventory-row--out";
          if (kind === "partial") return "inventory-row--low";
          return "";
        }}
      />
    </div>
  );
}
