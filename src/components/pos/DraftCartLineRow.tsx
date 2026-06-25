import clsx from "clsx";
import { Minus, Plus } from "lucide-react";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import { formatDraftLineQty, formatDraftLineUnitPrice } from "../../lib/draftCart";
import { lineDiscountUgx } from "../../lib/saleAdjustments";

type Props = {
  lang: Language;
  line: SaleLine;
  product: Product | undefined;
  compact?: boolean;
  /** Ultra-compact row for mobile checkout dock (fits with numpad on screen). */
  dock?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onQtyTap: () => void;
  onDiscount: () => void;
  onRemove: () => void;
};

export function DraftCartLineRow({
  lang,
  line,
  product,
  compact = false,
  dock = false,
  onIncrement,
  onDecrement,
  onQtyTap,
  onDiscount,
  onRemove,
}: Props) {
  const qtyLabel = product ? formatDraftLineQty(product, line) : String(line.quantity);
  const unitHint = product ? formatDraftLineUnitPrice(product, line) : null;

  if (dock) {
    return (
      <li className="flex items-center gap-2 border-b border-slate-100 py-2.5 last:border-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight text-slate-900">{line.name}</p>
          <p className="truncate text-sm font-semibold text-slate-600">
            {qtyLabel}
            {unitHint ? ` · ${unitHint}` : ""}
            {" · "}
            UGX {line.lineTotalUgx.toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDecrement}
            aria-label={t(lang, "posQtyDecrease")}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 active:bg-slate-100"
          >
            <Minus className="h-5 w-5 stroke-[3]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onQtyTap}
            className="flex h-11 min-w-[3rem] items-center justify-center rounded-xl border border-waka-300 bg-waka-50 px-1.5 text-base font-black tabular-nums text-waka-950 active:bg-waka-100"
          >
            {qtyLabel}
          </button>
          <button
            type="button"
            onClick={onIncrement}
            aria-label={t(lang, "posQtyIncrease")}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-waka-400 bg-waka-600 text-white active:brightness-95"
          >
            <Plus className="h-5 w-5 stroke-[3]" aria-hidden />
          </button>
        </div>
      </li>
    );
  }

  if (compact) {
    return (
      <li className="rounded-xl border border-slate-100 bg-slate-50/80 p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-snug text-slate-900">{line.name}</p>
            {unitHint ? <p className="truncate text-[11px] font-semibold text-slate-500">{unitHint}</p> : null}
            {lineDiscountUgx(line) > 0 ? (
              <p className="text-[11px] font-bold text-amber-800">
                − UGX {lineDiscountUgx(line).toLocaleString()}
              </p>
            ) : null}
          </div>
          <p className="shrink-0 text-base font-black tabular-nums">UGX {line.lineTotalUgx.toLocaleString()}</p>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDecrement}
            aria-label={t(lang, "posQtyDecrease")}
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 active:bg-slate-100"
          >
            <Minus className="h-5 w-5 stroke-[3]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onQtyTap}
            className="flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center rounded-xl border-2 border-waka-300 bg-waka-50 px-1.5 active:bg-waka-100"
          >
            <span className="text-[9px] font-black uppercase tracking-wide text-waka-800">
              {t(lang, "posQtyLabel")}
            </span>
            <span className="truncate text-base font-black tabular-nums text-waka-950">{qtyLabel}</span>
          </button>
          <button
            type="button"
            onClick={onIncrement}
            aria-label={t(lang, "posQtyIncrease")}
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl border-2 border-waka-400 bg-waka-600 text-white active:brightness-95"
          >
            <Plus className="h-5 w-5 stroke-[3]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDiscount}
            className="min-h-[44px] shrink-0 rounded-xl border border-waka-200 bg-white px-2.5 text-xs font-black text-waka-900"
          >
            {t(lang, "discountBtn")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t(lang, "removeLine")}
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-sm font-black text-rose-800"
          >
            ✕
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900">{line.name}</p>
          {unitHint ? <p className="text-xs font-semibold text-slate-500">{unitHint}</p> : null}
          {lineDiscountUgx(line) > 0 ? (
            <p className="text-xs font-bold text-amber-800">
              − UGX {lineDiscountUgx(line).toLocaleString()} {t(lang, "discountBtn").toLowerCase()}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-lg font-black">UGX {line.lineTotalUgx.toLocaleString()}</p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onDecrement}
          aria-label={t(lang, "posQtyDecrease")}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-slate-900 shadow-sm active:bg-slate-100"
        >
          <Minus className="h-7 w-7 stroke-[3]" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onQtyTap}
          className="flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border-2 border-waka-300 bg-waka-50 px-2 active:bg-waka-100"
        >
          <span className="text-[10px] font-black uppercase tracking-wide text-waka-800">
            {t(lang, "posQtyLabel")}
          </span>
          <span className="truncate text-xl font-black tabular-nums text-waka-950">{qtyLabel}</span>
        </button>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={t(lang, "posQtyIncrease")}
          className={clsx(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 shadow-sm active:brightness-95",
            "border-waka-400 bg-waka-600 text-white",
          )}
        >
          <Plus className="h-7 w-7 stroke-[3]" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDiscount}
          className="min-h-[44px] flex-1 rounded-xl border-2 border-waka-200 bg-white px-3 text-sm font-black text-waka-900"
        >
          {t(lang, "discountBtn")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-[44px] rounded-xl border-2 border-rose-200 bg-rose-50 px-4 text-sm font-black text-rose-800"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
