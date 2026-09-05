import { useMemo } from "react";
import { MoreHorizontal, Printer } from "lucide-react";
import clsx from "clsx";
import type { Language, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { buildReceiptNumberForSale } from "../../lib/receiptPrint";
import { receiptPrintActionLabel } from "../../lib/printActionLabels";
import { isCompletedSale, isPreCompletionVoidedSale, isVoidedSale, saleStatusOf, voidedSaleHistoryNumber } from "../../lib/saleStatus";
import { salesHistoryPaymentMethodLabel } from "../../lib/salesHistoryTender";
import { resolveSaleLineQuantity } from "../../lib/saleQuantityLabel";
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
  return salesHistoryPaymentMethodLabel(lang, sale);
}

/** Compact WHAT summary from already-loaded sale.lines — no extra fetch. */
function saleItemsSummary(sale: Sale): string {
  const parts: string[] = [];
  for (const line of sale.lines) {
    if (line.voided) continue;
    const qty = resolveSaleLineQuantity(line);
    parts.push(`${line.name} ×${qty}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
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
        width: "minmax(112px,1fr)",
        cell: (sale) =>
          isPreCompletionVoidedSale(sale) ? voidedSaleHistoryNumber(sale) : buildReceiptNumberForSale(sale, allSales),
        className: "text-base font-bold text-foreground",
      },
      {
        id: "items",
        header: t(lang, "salesHistoryItemsSold"),
        width: "minmax(168px,1.6fr)",
        hideBelow: "xl",
        cell: (sale) => {
          const summary = saleItemsSummary(sale);
          return (
            <span className="block truncate font-semibold text-foreground" title={summary}>
              {summary}
            </span>
          );
        },
      },
      {
        id: "customer",
        header: t(lang, "customers"),
        width: "minmax(128px,1.2fr)",
        cell: (sale) => <span className="font-semibold text-foreground">{customerNameFor(sale)}</span>,
      },
      {
        id: "cashier",
        header: "Cashier",
        width: "minmax(108px,1fr)",
        cell: (sale) => <span className="font-medium text-muted-foreground">{cashierLabelFor(sale)}</span>,
      },
      {
        id: "date",
        header: "Date",
        width: "minmax(128px,1.1fr)",
        cell: (sale) => <span className="font-medium text-muted-foreground">{formatWhen(sale.createdAt, lang)}</span>,
      },
      {
        id: "payment",
        header: t(lang, "salesHistoryPaymentMethods"),
        width: "minmax(108px,0.9fr)",
        cell: (sale) => (
          <span className={clsx(statusTokens.business.badge, "max-w-full truncate")}>{paymentLabel(lang, sale)}</span>
        ),
      },
      {
        id: "total",
        header: t(lang, "purchasesColTotal"),
        width: "minmax(108px,1fr)",
        align: "right",
        cell: (sale) => (
          <span className="text-base font-bold tabular-nums text-foreground">UGX {sale.totalUgx.toLocaleString()}</span>
        ),
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(96px,0.9fr)",
        cell: (sale) => {
          const status = saleStatusOf(sale);
          if (status === "pending") return <span className={statusTokens.warning.badge}>{t(lang, "salesHistoryStatusPending")}</span>;
          if (isVoidedSale(sale) || isPreCompletionVoidedSale(sale)) {
            return <span className={statusTokens.danger.badge}>{t(lang, "salesHistoryStatusVoided")}</span>;
          }
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
        minWidthPx={1100}
        estimateRowHeight={56}
        className="sales-history-table"
        ariaLabel={t(lang, "receipts")}
        rowActions={(sale) => (
          <div className="relative flex items-center gap-1">
            {isCompletedSale(sale) ? (
              <button
                type="button"
                title={receiptPrintActionLabel(lang)}
                onClick={() => onPrint(sale)}
                className={clsx(
                  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl text-waka-800 hover:bg-waka-50",
                  themeUi.focusRing,
                )}
              >
                <Printer className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              title={t(lang, "salesHistoryMoreActions")}
              onClick={() => onOpenActions(sale)}
              className={clsx(
                "inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted",
                themeUi.focusRing,
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}
      />
    </div>
  );
}
