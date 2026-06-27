import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import type { ProfitProductView } from "../../lib/profitPageView";
import { formatShortUgx, productInitials } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  open: boolean;
  product: ProfitProductView | null;
  productRecord: Product | undefined;
  lastSoldAt: string | null;
  onClose: () => void;
};

function formatLastSold(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

export function ProfitProductDetailSheet({ lang, open, product, productRecord, lastSoldAt, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !product) return null;

  const loss = product.profitUgx < 0;

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-stone-900/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div className="relative z-[55] max-h-[min(85dvh,40rem)] w-full overflow-y-auto rounded-t-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" aria-hidden />
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-sm font-black text-stone-700">
            {productInitials(product.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-black text-stone-950">{product.name}</p>
            <p className="text-xs font-semibold text-stone-500">{product.shelfLabel}</p>
          </div>
        </div>

        <dl className="mt-4 space-y-2 rounded-xl bg-stone-50 p-3">
          {[
            { label: t(lang, "profitStatRevenue"), value: formatShortUgx(product.salesUgx) },
            { label: t(lang, "profitStatCost"), value: formatShortUgx(product.costUgx) },
            {
              label: t(lang, "profitStatNetProfit"),
              value: formatShortUgx(product.profitUgx),
              valueClass: loss ? "text-rose-700" : "text-teal-800",
            },
            {
              label: t(lang, "profitStatMargin"),
              value: `${product.marginPct.toFixed(1)}%`,
              valueClass: loss ? "text-rose-700" : "text-teal-800",
            },
            { label: t(lang, "profitPageQtySold"), value: product.qty.toLocaleString() },
            { label: t(lang, "profitStatBestShelf"), value: product.shelfLabel },
            { label: t(lang, "profitDetailLastSold"), value: formatLastSold(lastSoldAt, lang) },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-sm">
              <dt className="font-semibold text-stone-500">{row.label}</dt>
              <dd className={`font-black tabular-nums ${row.valueClass ?? "text-stone-950"}`}>{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to="/stock?tab=products"
            onClick={onClose}
            className="flex min-h-[44px] items-center justify-center rounded-xl border border-stone-200 text-sm font-bold text-stone-800 active:bg-stone-50"
          >
            {t(lang, "profitDetailViewProduct")}
          </Link>
          <Link
            to="/receipts"
            onClick={onClose}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-waka-600 text-sm font-bold text-white active:bg-waka-700"
          >
            {t(lang, "profitDetailViewSales")}
          </Link>
          {productRecord ? (
            <Link
              to="/stock?tab=products"
              onClick={onClose}
              className="col-span-2 flex min-h-[44px] items-center justify-center rounded-xl border border-waka-200 text-sm font-bold text-waka-800 active:bg-waka-50"
            >
              {t(lang, "profitDetailEditProduct")}
            </Link>
          ) : null}
        </div>

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
