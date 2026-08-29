import clsx from "clsx";
import { Minus, Plus } from "lucide-react";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import { formatDraftLineQty, formatDraftLineUnitPrice } from "../../lib/draftCart";
import { lineDiscountUgx } from "../../lib/saleAdjustments";
import { PharmacyFefoBatchChip } from "../pharmacy/PharmacyFefoBatchPicker";

type Props = {
  lang: Language;
  line: SaleLine;
  product: Product | undefined;
  compact?: boolean;
  /** Ultra-compact row for mobile checkout dock (fits with numpad on screen). */
  dock?: boolean;
  /** Desktop sidebar — tighter rows so the cart list scroll area is taller. */
  sidebarCompact?: boolean;
  pharmacyMode?: boolean;
  onBatchTap?: () => void;
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
  sidebarCompact = false,
  pharmacyMode = false,
  onBatchTap,
  onIncrement,
  onDecrement,
  onQtyTap,
  onDiscount,
  onRemove,
}: Props) {
  const qtyLabel = product ? formatDraftLineQty(product, line) : String(line.quantity);
  const unitHint = product ? formatDraftLineUnitPrice(product, line) : null;

  if (dock) {
    // Phase 33.1 — enterprise dock row: spaced meta, discount cue, always-visible remove.
    const btnSize = sidebarCompact ? "h-9 w-9 min-h-[36px] min-w-[36px]" : "h-10 w-10 min-h-[40px] min-w-[40px]";
    const iconSize = sidebarCompact ? "h-4 w-4" : "h-5 w-5";
    const discount = lineDiscountUgx(line);
    return (
      <div
        className={clsx(
          "pos-ds-cart-line border-b border-border last:border-0",
          sidebarCompact ? "py-2" : "py-2.5",
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={clsx(
                "pos-ds-cart-line-name truncate font-bold leading-snug text-foreground",
                sidebarCompact ? "text-sm" : "text-[15px]",
              )}
            >
              {line.name}
            </p>
            <div
              className={clsx(
                "pos-ds-cart-line-meta mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-semibold text-muted-foreground",
                sidebarCompact ? "text-[11px]" : "text-xs",
              )}
            >
              <span>
                {t(lang, "posQtyLabel")} {qtyLabel}
              </span>
              {unitHint ? <span className="text-muted-foreground/90">{unitHint}</span> : null}
              <span className="pos-ds-cart-line-price font-black tabular-nums text-foreground">
                UGX {line.lineTotalUgx.toLocaleString()}
              </span>
            </div>
            {discount > 0 ? (
              <button
                type="button"
                onClick={onDiscount}
                className={clsx(
                  "mt-1 inline-flex max-w-full truncate rounded-md bg-warning-muted px-1.5 py-0.5 font-bold text-warning-foreground active:brightness-95",
                  sidebarCompact ? "text-[10px]" : "text-[11px]",
                )}
              >
                − UGX {discount.toLocaleString()} {t(lang, "discountBtn").toLowerCase()}
              </button>
            ) : null}
            {pharmacyMode ? <PharmacyFefoBatchChip lang={lang} line={line} onTap={onBatchTap} /> : null}
          </div>
        </div>
        <div className={clsx("flex items-center gap-1", sidebarCompact ? "mt-1.5" : "mt-2")}>
          <button
            type="button"
            onClick={onDecrement}
            aria-label={t(lang, "posQtyDecrease")}
            className={clsx("flex items-center justify-center rounded-lg border border-border bg-card text-foreground active:bg-muted", btnSize)}
          >
            <Minus className={clsx("stroke-[3]", iconSize)} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onQtyTap}
            aria-label={`${t(lang, "posQtyLabel")}: ${qtyLabel}`}
            className={clsx(
              "pos-ds-cart-line-qty flex flex-1 items-center justify-center rounded-lg border border-waka-300 bg-waka-50 font-black tabular-nums text-waka-950 active:bg-waka-100",
              sidebarCompact ? "h-9 min-w-[2.5rem] px-1 text-sm" : "h-10 min-w-[3rem] px-1.5 text-base",
            )}
          >
            {qtyLabel}
          </button>
          <button
            type="button"
            onClick={onIncrement}
            aria-label={t(lang, "posQtyIncrease")}
            className={clsx("flex items-center justify-center rounded-lg border border-waka-400 bg-waka-600 text-white active:brightness-95", btnSize)}
          >
            <Plus className={clsx("stroke-[3]", iconSize)} aria-hidden />
          </button>
          {discount <= 0 ? (
            <button
              type="button"
              onClick={onDiscount}
              aria-label={t(lang, "discountBtn")}
              className={clsx(
                "flex shrink-0 items-center justify-center rounded-lg border border-waka-200 bg-card font-black text-waka-900 active:bg-waka-50",
                sidebarCompact ? "h-9 min-w-[2.25rem] px-1.5 text-[10px]" : "h-10 min-w-[2.5rem] px-2 text-xs",
              )}
            >
              %
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRemove}
            aria-label={t(lang, "removeLine")}
            className={clsx(
              "flex shrink-0 items-center justify-center rounded-lg border border-danger/30 bg-danger-muted font-black text-danger active:brightness-95",
              btnSize,
            )}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <li className="rounded-xl border border-border bg-muted/80 p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-snug text-foreground">{line.name}</p>
            {unitHint ? <p className="truncate text-[11px] font-semibold text-muted-foreground">{unitHint}</p> : null}
            {pharmacyMode ? <PharmacyFefoBatchChip lang={lang} line={line} onTap={onBatchTap} /> : null}
            {lineDiscountUgx(line) > 0 ? (
              <p className="text-[11px] font-bold text-warning-foreground">
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
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-xl border border-border bg-card text-foreground active:bg-muted"
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
            className="min-h-[44px] shrink-0 rounded-xl border border-waka-200 bg-card px-2.5 text-xs font-black text-waka-900"
          >
            {t(lang, "discountBtn")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t(lang, "removeLine")}
            className="flex h-11 min-h-[44px] w-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-danger/30 bg-danger-muted text-sm font-black text-danger"
          >
            ✕
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-muted/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">{line.name}</p>
          {unitHint ? <p className="text-xs font-semibold text-muted-foreground">{unitHint}</p> : null}
          {pharmacyMode ? <PharmacyFefoBatchChip lang={lang} line={line} onTap={onBatchTap} /> : null}
          {lineDiscountUgx(line) > 0 ? (
            <p className="text-xs font-bold text-warning-foreground">
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
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-border bg-card text-foreground shadow-sm active:bg-muted"
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
          className="min-h-[44px] flex-1 rounded-xl border-2 border-waka-200 bg-card px-3 text-sm font-black text-waka-900"
        >
          {t(lang, "discountBtn")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-[44px] rounded-xl border-2 border-danger/30 bg-danger-muted px-4 text-sm font-black text-danger"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
