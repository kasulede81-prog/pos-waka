import { useMemo } from "react";
import { MoreHorizontal, Printer } from "lucide-react";
import clsx from "clsx";
import type { Language, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { buildReceiptNumberForSale } from "../../lib/receiptPrint";
import { receiptPrintActionLabel } from "../../lib/printActionLabels";
import { isCompletedSale, saleStatusOf } from "../../lib/saleStatus";
import { statusTokens } from "../../lib/statusTokens";
import {
  EnterpriseDataTable,
  EnterpriseDesktopBulkBar,
  useEnterpriseTableSelection,
  type EnterpriseDataColumn,
} from "../enterprise/data-table";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  sales: Sale[];
  allSales: Sale[];
  customerNameFor: (sale: Sale) => string;
  cashierLabelFor: (sale: Sale) => string;
  onPrint: (sale: Sale) => void;
  onReceiptPdf: (sale: Sale) => void;
  onOpenActions: (sale: Sale) => void;
};

function paymentLabel(lang: Language, sale: Sale): string {
  if (sale.debtUgx > 0 && sale.cashPaidUgx > 0) return `${t(lang, "paymentMethod_cash")}+${t(lang, "paymentMethod_credit")}`;
  if (sale.debtUgx > 0) return t(lang, "paymentMethod_credit");
  return t(lang, "paymentMethod_cash");
}

function formatWhen(iso: string, lang: Language): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Africa/Kampala" }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Kampala",
  }).format(d);
  return `${day} ${time}`;
}

export function SalesHistoryDesktopTable({
  lang,
  sales,
  allSales,
  customerNameFor,
  cashierLabelFor,
  onPrint,
  onReceiptPdf,
  onOpenActions,
}: Props) {
  const selection = useEnterpriseTableSelection({ startEnabled: true });

  const columns: EnterpriseDataColumn<Sale>[] = useMemo(
    () => [
      {
        id: "receipt",
        header: t(lang, "receipts"),
        width: "minmax(100px,1fr)",
        cell: (sale) => buildReceiptNumberForSale(sale, allSales),
        className: "text-foreground",
      },
      {
        id: "cashier",
        header: "Cashier",
        width: "minmax(100px,1fr)",
        hideBelow: "lg",
        cell: (sale) => cashierLabelFor(sale),
      },
      {
        id: "customer",
        header: t(lang, "customers"),
        width: "minmax(120px,1.2fr)",
        hideBelow: "lg",
        cell: (sale) => customerNameFor(sale),
      },
      {
        id: "date",
        header: "Date",
        width: "minmax(120px,1.1fr)",
        cell: (sale) => formatWhen(sale.createdAt, lang),
      },
      {
        id: "payment",
        header: t(lang, "salesHistoryPaymentMethods"),
        width: "minmax(96px,0.9fr)",
        hideBelow: "xl",
        cell: (sale) => paymentLabel(lang, sale),
      },
      {
        id: "total",
        header: t(lang, "purchasesColTotal"),
        width: "minmax(96px,1fr)",
        align: "right",
        cell: (sale) => (
          <span className="font-bold tabular-nums text-foreground">UGX {sale.totalUgx.toLocaleString()}</span>
        ),
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(96px,0.9fr)",
        cell: (sale) => {
          const status = saleStatusOf(sale);
          if (status === "pending") return <span className={statusTokens.warning.badge}>{t(lang, "salesHistoryStatusPending")}</span>;
          if (status === "cancelled") return <span className={statusTokens.draft.badge}>{t(lang, "salesHistoryStatusCancelled")}</span>;
          return <span className={statusTokens.success.badge}>{t(lang, "salesHistoryStatusCompleted")}</span>;
        },
      },
    ],
    [lang, allSales, customerNameFor, cashierLabelFor],
  );

  const selected = useMemo(() => sales.filter((s) => selection.isSelected(s.id)), [sales, selection]);

  return (
    <div className="space-y-2">
      <EnterpriseDesktopBulkBar
        lang={lang}
        count={selection.count}
        onClear={selection.clear}
        onSelectVisible={() => selection.selectIds(sales.map((s) => s.id))}
      >
        {selected.length === 1 && isCompletedSale(selected[0]!) ? (
          <>
            <button
              type="button"
              onClick={() => onPrint(selected[0]!)}
              className={clsx(themeUi.btnSecondary, "min-h-[36px] px-3 py-1.5 text-xs")}
            >
              {receiptPrintActionLabel(lang)}
            </button>
            <button
              type="button"
              onClick={() => onReceiptPdf(selected[0]!)}
              className={clsx(themeUi.btnPrimary, "min-h-[36px] px-3 py-1.5 text-xs")}
            >
              PDF
            </button>
          </>
        ) : null}
      </EnterpriseDesktopBulkBar>

      <EnterpriseDataTable
        rows={sales}
        columns={columns}
        rowKey={(s) => s.id}
        selection={selection}
        onRowActivate={onOpenActions}
        minWidthPx={980}
        ariaLabel={t(lang, "receipts")}
        rowActions={(sale) => (
          <div className="relative flex items-center gap-0.5">
            {isCompletedSale(sale) ? (
              <button
                type="button"
                title={receiptPrintActionLabel(lang)}
                onClick={() => onPrint(sale)}
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted"
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              title={t(lang, "salesHistoryMoreActions")}
              onClick={() => onOpenActions(sale)}
              className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg hover:bg-muted"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      />
    </div>
  );
}
