import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const ICON_TONES = [
  "bg-waka-100 text-waka-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
] as const;

const MENU_WIDTH_PX = 288;

type MenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function formatSaleTime(iso: string, lang: Language): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

function statusBadge(lang: Language, sale: Sale): { label: string; className: string } {
  const status = saleStatusOf(sale);
  if (status === "pending") {
    return {
      label: t(lang, "salesHistoryStatusPending"),
      className: "bg-amber-100 text-amber-900",
    };
  }
  if (status === "cancelled") {
    return {
      label: t(lang, "salesHistoryStatusCancelled"),
      className: "bg-stone-200 text-stone-700",
    };
  }
  return {
    label: t(lang, "salesHistoryStatusCompleted"),
    className: "bg-emerald-100 text-emerald-800",
  };
}

function computeMenuPlacement(anchor: DOMRect): MenuPlacement {
  const width = Math.min(MENU_WIDTH_PX, window.innerWidth - 16);
  let left = anchor.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  const spaceBelow = window.innerHeight - anchor.bottom - 12;
  const spaceAbove = anchor.top - 12;
  const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(160, Math.min(openBelow ? spaceBelow : spaceAbove, window.innerHeight * 0.72));

  if (openBelow) {
    return { left, width, maxHeight, top: anchor.bottom + 6 };
  }
  return { left, width, maxHeight, bottom: window.innerHeight - anchor.top + 6 };
}

type SaleMenuPanelProps = {
  lang: Language;
  sale: Sale;
  saleReturns: ReturnRecord[];
  cashierLabel: string;
  discountBreakdown: ReturnType<typeof computeSaleDiscountBreakdown> | null;
  allowAdjust: boolean;
  voidableLines: { line: SaleLine; lineIndex: number }[];
  placement: MenuPlacement;
  onClose: () => void;
  onPrint: (sale: Sale) => void;
  onReceiptPdf: (sale: Sale) => void;
  onReturn: (sale: Sale) => void;
  onVoidLine: (sale: Sale, lineIndex: number, line: SaleLine) => void;
};

function SaleMenuPanel({
  lang,
  sale,
  saleReturns,
  cashierLabel,
  discountBreakdown,
  allowAdjust,
  voidableLines,
  placement,
  onClose,
  onPrint,
  onReceiptPdf,
  onReturn,
  onVoidLine,
}: SaleMenuPanelProps) {
  const closeAnd = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[58] bg-black/20"
        aria-label={t(lang, "cancel")}
        onClick={onClose}
      />
      <div
        className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        style={{
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
          top: placement.top,
          bottom: placement.bottom,
        }}
        role="menu"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
          <div className="border-b border-stone-100 px-3 pb-2">
            <p className="text-xs font-semibold text-slate-500">
              {t(lang, "receiptCashier")}: <span className="font-bold text-slate-800">{cashierLabel}</span>
            </p>
            {sale.debtUgx > 0 ? (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                {t(lang, "cashLabel")}: UGX {sale.cashPaidUgx.toLocaleString()}
                {" · "}
                {t(lang, "creditLabel")}: UGX {sale.debtUgx.toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="border-b border-stone-100 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
              {t(lang, "salesHistoryItemsSold")}
            </p>
            {discountBreakdown ? (
              <SaleDiscountSummary lang={lang} breakdown={discountBreakdown} className="mt-1.5" />
            ) : null}
            <ul className="mt-1.5 space-y-1">
              {sale.lines.map((line, lineIndex) => {
                const paid = customerPaidUgxForSaleLine(sale, line, saleReturns);
                return (
                  <li key={`${sale.id}-${line.productId}-${lineIndex}`} className="flex justify-between gap-2 text-xs">
                    <span
                      className={
                        line.voided ? "font-bold text-rose-700 line-through" : "font-semibold text-slate-800"
                      }
                    >
                      {line.name}
                    </span>
                    {!line.voided ? (
                      <span className="shrink-0 font-bold text-slate-700">
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

          <ul className="py-1">
            <li>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold text-slate-800 active:bg-stone-50"
                onClick={() => closeAnd(() => onPrint(sale))}
              >
                <Printer className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                {receiptPrintActionLabel(lang)}
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold text-slate-800 active:bg-stone-50"
                onClick={() => closeAnd(() => onReceiptPdf(sale))}
              >
                <FileDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                {t(lang, "receiptDownloadPdf")}
              </button>
            </li>
            {allowAdjust ? (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold text-amber-950 active:bg-amber-50"
                  onClick={() => closeAnd(() => onReturn(sale))}
                >
                  <RotateCcw className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                  {t(lang, "returnBtn")}
                </button>
              </li>
            ) : null}
            {allowAdjust
              ? voidableLines.map(({ line, lineIndex }) => (
                  <li key={`${sale.id}-${lineIndex}`}>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold text-rose-800 active:bg-rose-50"
                      onClick={() => closeAnd(() => onVoidLine(sale, lineIndex, line))}
                    >
                      <Trash2 className="h-4 w-4 shrink-0 text-rose-600" aria-hidden />
                      {tTemplate(lang, "salesHistoryVoidLine", { name: line.name })}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
      </div>
    </>
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
  toneIndex: number;
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
  toneIndex,
  onPrint,
  onReceiptPdf,
  onReturn,
  onVoidLine,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const invoice = buildReceiptNumberForSale(sale, allSales);
  const badge = statusBadge(lang, sale);
  const completed = isCompletedSale(sale);
  const allowAdjust = completed && canVoid;
  const saleReturns = returnRecords.filter((r) => r.saleId === sale.id);
  const discountBreakdown = completed ? computeSaleDiscountBreakdown(sale) : null;
  const voidableLines = sale.lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line }) => !line.voided);

  const closeMenu = () => setMenuOpen(false);

  const updatePlacement = () => {
    const anchor = menuButtonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setMenuPlacement(computeMenuPlacement(anchor));
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null);
      return;
    }
    updatePlacement();
    const onReflow = () => updatePlacement();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="border-b border-stone-100 last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <div
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            ICON_TONES[toneIndex % ICON_TONES.length],
          )}
        >
          <FileText className="h-5 w-5" aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-slate-950">{invoice}</p>
          <p className="truncate text-xs font-semibold text-slate-500">{customerName}</p>
        </div>

        <p className="hidden shrink-0 text-xs font-semibold text-slate-500 sm:block">
          {formatSaleTime(sale.createdAt, lang)}
        </p>

        <span
          className={clsx(
            "hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase sm:inline",
            badge.className,
          )}
        >
          {badge.label}
        </span>

        <p className="shrink-0 text-sm font-black text-slate-950">UGX {sale.totalUgx.toLocaleString()}</p>

        <div className="relative shrink-0">
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-stone-200 bg-white text-slate-700"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="sr-only">{t(lang, "salesHistoryMoreActions")}</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 pl-[3.75rem] sm:hidden">
        <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", badge.className)}>
          {badge.label}
        </span>
        <span className="text-xs font-semibold text-slate-500">{formatSaleTime(sale.createdAt, lang)}</span>
      </div>

      {menuOpen && menuPlacement
        ? createPortal(
            <SaleMenuPanel
              lang={lang}
              sale={sale}
              saleReturns={saleReturns}
              cashierLabel={cashierLabel}
              discountBreakdown={discountBreakdown}
              allowAdjust={allowAdjust}
              voidableLines={voidableLines}
              placement={menuPlacement}
              onClose={closeMenu}
              onPrint={onPrint}
              onReceiptPdf={onReceiptPdf}
              onReturn={onReturn}
              onVoidLine={onVoidLine}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
