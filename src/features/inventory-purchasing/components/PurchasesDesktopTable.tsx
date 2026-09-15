import { useMemo } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { dateKeyKampala } from "../../../lib/datesUg";
import type { PurchaseListRow } from "../../../lib/purchaseReporting";
import { purchaseStatusKind, formatShortUgx } from "../lib/overviewStats";
import { statusTokens } from "../../../lib/statusTokens";
import {
  EnterpriseDataTable,
  EnterpriseDesktopBulkBar,
  useEnterpriseTableSelection,
  type EnterpriseDataColumn,
} from "../../../components/enterprise/data-table";
import { themeUi } from "../../../lib/themeTokens";

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

  const statusBadge = (kind: ReturnType<typeof purchaseStatusKind>) => {
    if (kind === "paid") return statusTokens.success.badge;
    if (kind === "partial") return statusTokens.warning.badge;
    if (kind === "unpaid") return statusTokens.danger.badge;
    return statusTokens.draft.badge;
  };

  const columns: EnterpriseDataColumn<PurchaseListRow>[] = useMemo(
    () => [
      {
        id: "date",
        header: "Date",
        width: "minmax(96px,0.9fr)",
        cell: (row) => dateKeyKampala(row.purchase.createdAt),
      },
      {
        id: "supplier",
        header: t(lang, "purchasesColSupplier") !== "purchasesColSupplier" ? t(lang, "purchasesColSupplier") : "Supplier",
        width: "minmax(140px,2fr)",
        cell: (row) => row.purchase.supplierName,
        className: "text-foreground",
      },
      {
        id: "invoice",
        header: "Invoice",
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
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(88px,0.8fr)",
        cell: (row) => {
          const kind = purchaseStatusKind(row.purchase);
          return <span className={statusBadge(kind)}>{statusLabel(kind)}</span>;
        },
      },
    ],
    [lang],
  );

  const selected = useMemo(() => rows.filter((r) => selection.isSelected(r.purchase.id)), [rows, selection]);

  return (
    <div className="space-y-2">
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
            className={clsx(themeUi.btnSecondary, "min-h-[36px] px-3 py-1.5 text-xs")}
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
      />
    </div>
  );
}
