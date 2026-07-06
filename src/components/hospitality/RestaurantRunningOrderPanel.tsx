import clsx from "clsx";
import { UtensilsCrossed } from "lucide-react";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { formatDraftLineQty } from "../../lib/draftCart";
import { NumericKeypad } from "./NumericKeypad";

export type RunningOrderTotals = {
  lineSubtotalUgx: number;
  cartDiscountUgx: number;
  payableUgx: number;
};

type KitchenSummary = { queued: number; preparing: number; ready: number };

type Props = {
  lang: Language;
  lines: SaleLine[];
  productById: Map<string, Product>;
  totals: RunningOrderTotals;
  serviceChargeUgx?: number;
  guestCount: number;
  kitchenSummary?: KitchenSummary;
  keypadValue: string;
  onKeypadChange: (v: string) => void;
  onLineTap: (line: SaleLine) => void;
  onRemove: (line: SaleLine) => void;
  compact?: boolean;
  className?: string;
};

export function RestaurantRunningOrderPanel({
  lang,
  lines,
  productById,
  totals,
  serviceChargeUgx = 0,
  guestCount,
  kitchenSummary,
  keypadValue,
  onKeypadChange,
  onLineTap,
  compact,
  className,
}: Props) {
  const grandWithService = totals.payableUgx + serviceChargeUgx;

  return (
    <aside
      className={clsx(
        "flex min-h-0 flex-col border-l border-stone-300 bg-stone-100",
        className,
      )}
    >
      <div className="shrink-0 border-b border-stone-300 bg-white px-3 py-2">
        <p className="text-xs font-black uppercase text-stone-600">{t(lang, "restaurantRunningOrder")}</p>
        <p className="text-[10px] font-semibold text-stone-500">
          {guestCount} {t(lang, "tableOrderGuests")}
        </p>
        {kitchenSummary && (kitchenSummary.queued > 0 || kitchenSummary.preparing > 0) ? (
          <p className="mt-1 text-[10px] font-bold text-amber-800">
            {kitchenSummary.queued + kitchenSummary.preparing} {t(lang, "kitchenStatusQueued")}
          </p>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-[2rem_1fr_auto] gap-x-2 border-b border-stone-200 bg-stone-50 px-2 py-1 text-[9px] font-black uppercase text-stone-500">
        <span>Q</span>
        <span>{t(lang, "restaurantBillItems")}</span>
        <span className="text-right">{t(lang, "total")}</span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs font-semibold text-stone-400">{t(lang, "restaurantOrderEmpty")}</li>
        ) : (
          lines.map((line) => {
            const product = productById.get(line.productId);
            const qtyLabel = product ? formatDraftLineQty(product, line) : String(line.quantity);
            return (
              <li key={line.id ?? line.productId}>
                <button
                  type="button"
                  onClick={() => onLineTap(line)}
                  className="grid w-full grid-cols-[2rem_1fr_auto] items-center gap-x-2 border-b border-stone-200 px-2 py-2 text-left hover:bg-white"
                >
                  <span className="text-sm font-black tabular-nums text-stone-800">{qtyLabel}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-stone-200 text-stone-500">
                      <UtensilsCrossed className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-stone-900">{line.name}</p>
                      {line.notes ? (
                        <p className="truncate text-[10px] font-bold text-rose-600">{line.notes}</p>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-xs font-black tabular-nums">{formatUgx(line.lineTotalUgx)}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="shrink-0 space-y-0.5 border-t border-stone-300 bg-white px-3 py-2 text-xs">
        <div className="flex justify-between font-semibold text-stone-600">
          <span>{t(lang, "subtotal")}</span>
          <span>{formatUgx(totals.lineSubtotalUgx - totals.cartDiscountUgx)}</span>
        </div>
        {serviceChargeUgx > 0 ? (
          <div className="flex justify-between font-semibold text-stone-600">
            <span>{t(lang, "restaurantBillServiceCharge")}</span>
            <span>{formatUgx(serviceChargeUgx)}</span>
          </div>
        ) : null}
        <div className="flex justify-between rounded bg-pink-100 px-2 py-2 text-base font-black text-pink-950">
          <span>{t(lang, "total")}</span>
          <span className="tabular-nums">{formatUgx(grandWithService)}</span>
        </div>
      </div>

      {!compact ? (
        <div className="shrink-0 border-t border-stone-300 p-2">
          <NumericKeypad value={keypadValue} onChange={onKeypadChange} />
        </div>
      ) : null}
    </aside>
  );
}
