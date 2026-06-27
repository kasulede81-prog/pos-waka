import { useEffect, useState } from "react";
import { FileDown, FileText, MoreHorizontal, Printer, RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { Language, ReturnRecord, Sale, SaleLine } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { buildReceiptNumberForSale } from "../../lib/receiptPrint";
import { receiptPrintActionLabel } from "../../lib/printActionLabels";
import { isCompletedSale, isPendingSale, saleStatusOf } from "../../lib/saleStatus";
import { customerPaidUgxForSaleLine } from "../../lib/refundBreakdown";
import { computeSaleDiscountBreakdown } from "../../lib/discountBreakdown";
import { SaleDiscountSummary } from "../returns/SaleDiscountSummary";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { dateKeyKampala } from "../../lib/datesUg";

function formatSaleDateTime(iso: string, lang: Language): { day: string; time: string } {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  const d = new Date(iso);
  const today = dateKeyKampala(new Date());
  const saleDay = dateKeyKampala(d);
  const day =
    saleDay === today
      ? t(lang, "dateFilterPresetToday")
      : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Africa/Kampala" }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Kampala",
  }).format(d);
  return { day, time };
}

function statusBadge(
  lang: Language,
  sale: Sale,
  hasReturns: boolean,
): { label: string; className: string } {
  const status = saleStatusOf(sale);
  if (status === "pending") {
    return { label: t(lang, "salesHistoryStatusPending"), className: "bg-amber-100 text-amber-900" };
  }
  if (status === "cancelled") {
    return { label: t(lang, "salesHistoryStatusCancelled"), className: "bg-stone-200 text-stone-700" };
  }
  if (hasReturns) {
    return { label: t(lang, "salesHistoryStatusReturned"), className: "bg-sky-100 text-sky-800" };
  }
  return { label: t(lang, "salesHistoryStatusCompleted"), className: "bg-emerald-100 text-emerald-800" };
}

type SaleActionSheetProps = {
  lang: Language;
  sale: Sale;
  saleReturns: ReturnRecord[];
  cashierLabel: string;
  customerName: string;
  discountBreakdown: ReturnType<typeof computeSaleDiscountBreakdown> | null;
  allowAdjust: boolean;
  voidableLines: { line: SaleLine; lineIndex: number }[];
  open: boolean;
  onClose: () => void;
  onPrint: (sale: Sale) => void;
  onReceiptPdf: (sale: Sale) => void;
  onReturn: (sale: Sale) => void;
  onVoidLine: (sale: Sale, lineIndex: number, line: SaleLine) => void;
};

function SaleActionSheet({
  lang,
  sale,
  saleReturns,
  cashierLabel,
  customerName,
  discountBreakdown,
  allowAdjust,
  voidableLines,
  open,
  onClose,
  onPrint,
  onReceiptPdf,
  onReturn,
  onVoidLine,
}: SaleActionSheetProps) {
  if (!open) return null;

  const closeAnd = (fn: () => void) => {
    onClose();
    fn();
  };

  const actions = [
    {
      icon: Printer,
      label: receiptPrintActionLabel(lang),
      onClick: () => closeAnd(() => onPrint(sale)),
      primary: true,
    },
    {
      icon: FileDown,
      label: t(lang, "receiptDownloadPdf"),
      onClick: () => closeAnd(() => onReceiptPdf(sale)),
    },
    ...(allowAdjust
      ? [
          {
            icon: RotateCcw,
            label: t(lang, "returnBtn"),
            onClick: () => closeAnd(() => onReturn(sale)),
            warn: true,
          },
        ]
      : []),
  ];

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-stone-900/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div className="relative z-[55] max-h-[min(80dvh,36rem)] w-full overflow-y-auto rounded-t-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" aria-hidden />
        <p className="text-sm font-black text-stone-950">{customerName}</p>
        <p className="text-xs font-semibold text-stone-500">
          {t(lang, "receiptCashier")}: {cashierLabel}
        </p>

        <div className="mt-3 rounded-xl bg-stone-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
            {t(lang, "salesHistoryItemsSold")}
          </p>
          {discountBreakdown ? (
            <SaleDiscountSummary lang={lang} breakdown={discountBreakdown} className="mt-1.5" />
          ) : null}
          <ul className="mt-1.5 space-y-1">
            {sale.lines.map((line, lineIndex) => {
              const paid = customerPaidUgxForSaleLine(sale, line, saleReturns);
              return (
                <li key={`${sale.id}-${lineIndex}`} className="flex justify-between gap-2 text-xs">
                  <span className={clsx("font-semibold", line.voided && "text-rose-700 line-through")}>
                    {line.name}
                  </span>
                  {!line.voided ? (
                    <span className="shrink-0 font-bold tabular-nums text-stone-700">
                      UGX {(paid.showPaidBreakdown ? paid.customerPaidUgx : line.lineTotalUgx).toLocaleString()}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {isPendingSale(sale) ? (
            <p className="mt-1.5 text-[11px] font-bold text-amber-800">{t(lang, "receiptsPendingSection")}</p>
          ) : null}
        </div>

        <ul className="mt-3 space-y-1">
          {actions.map(({ icon: Icon, label, onClick, primary, warn }) => (
            <li key={label}>
              <button
                type="button"
                onClick={onClick}
                className={clsx(
                  "flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold active:opacity-90",
                  primary
                    ? "bg-waka-600 text-white"
                    : warn
                      ? "bg-amber-50 text-amber-950"
                      : "text-stone-800 active:bg-stone-50",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </button>
            </li>
          ))}
          {allowAdjust
            ? voidableLines.map(({ line, lineIndex }) => (
                <li key={`void-${lineIndex}`}>
                  <button
                    type="button"
                    onClick={() => closeAnd(() => onVoidLine(sale, lineIndex, line))}
                    className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-rose-800 active:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                    {tTemplate(lang, "salesHistoryVoidLine", { name: line.name })}
                  </button>
                </li>
              ))
            : null}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-stone-200 text-sm font-bold text-stone-600 active:bg-stone-50"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}

type Props = {
  lang: Language;
  sale: Sale;
  allSales: Sale[];
  returnRecords: ReturnRecord[];
  customerName: string;
  cashierLabel: string;
  canVoid: boolean;
  onPrint: (sale: Sale) => void;
  onReceiptPdf: (sale: Sale) => void;
  onReturn: (sale: Sale) => void;
  onVoidLine: (sale: Sale, lineIndex: number, line: SaleLine) => void;
};

export function SalesHistoryRow({
  lang,
  sale,
  allSales,
  returnRecords,
  customerName,
  cashierLabel,
  canVoid,
  onPrint,
  onReceiptPdf,
  onReturn,
  onVoidLine,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const invoice = buildReceiptNumberForSale(sale, allSales);
  const saleReturns = returnRecords.filter((r) => r.saleId === sale.id);
  const badge = statusBadge(lang, sale, saleReturns.length > 0);
  const completed = isCompletedSale(sale);
  const allowAdjust = completed && canVoid;
  const discountBreakdown = completed ? computeSaleDiscountBreakdown(sale) : null;
  const voidableLines = sale.lines.map((line, lineIndex) => ({ line, lineIndex })).filter(({ line }) => !line.voided);
  const { day, time } = formatSaleDateTime(sale.createdAt, lang);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  return (
    <>
      <article className="rounded-xl border border-stone-200/90 bg-white p-2.5 shadow-sm transition-all active:scale-[0.99] motion-reduce:active:scale-100">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-black text-stone-950">{invoice}</p>
              <p className="shrink-0 text-sm font-black tabular-nums text-stone-950">
                UGX {sale.totalUgx.toLocaleString()}
              </p>
            </div>
            <p className="truncate text-xs font-semibold text-stone-600">{customerName}</p>
            <p className="mt-0.5 text-[10px] font-medium text-stone-500">
              {day} · {time} · {cashierLabel}
            </p>
            <span className={clsx("mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase", badge.className)}>
              {badge.label}
            </span>
          </div>
          <button
            type="button"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-700 active:bg-stone-50"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t(lang, "salesHistoryMoreActions")}</span>
          </button>
        </div>
      </article>

      <SaleActionSheet
        lang={lang}
        sale={sale}
        saleReturns={saleReturns}
        cashierLabel={cashierLabel}
        customerName={customerName}
        discountBreakdown={discountBreakdown}
        allowAdjust={allowAdjust}
        voidableLines={voidableLines}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPrint={onPrint}
        onReceiptPdf={onReceiptPdf}
        onReturn={onReturn}
        onVoidLine={onVoidLine}
      />
    </>
  );
}
