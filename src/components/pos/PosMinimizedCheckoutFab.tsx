import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  productCount: number;
  unitCount: number | string;
  payableUgx: number;
  onOpen: () => void;
  /** Mobile: above bottom nav. Compact desktop: bottom-right FAB. */
  variant: "mobile" | "compact";
};

export function PosMinimizedCheckoutFab({
  lang,
  productCount,
  unitCount,
  payableUgx,
  onOpen,
  variant,
}: Props) {
  if (variant === "mobile") {
    return (
      <div className="fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom))] left-0 right-0 z-[48] border-t border-waka-200 bg-white px-3 py-2 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-stone-600">
              {productCount} {t(lang, "posCartProductsShort").toLowerCase()} · {unitCount}{" "}
              {t(lang, "posCartUnitsShort").toLowerCase()}
            </p>
            <p className="truncate text-lg font-black leading-tight text-waka-700">
              UGX {payableUgx.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="min-h-[44px] shrink-0 rounded-xl bg-waka-600 px-3.5 py-2.5 text-sm font-black text-white shadow-md active:bg-waka-700"
          >
            {t(lang, "posReviewPay")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[48]">
      <button
        type="button"
        onClick={onOpen}
        className="pointer-events-auto flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-2xl border border-waka-300 bg-white px-4 py-2.5 text-sm font-black text-waka-900 shadow-lg active:bg-waka-50"
      >
        <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-waka-600 px-2 text-xs font-black text-white">
          {productCount}
        </span>
        <span className="hidden sm:inline">UGX {payableUgx.toLocaleString()}</span>
        <span className="sm:hidden">{t(lang, "posReviewPay")}</span>
      </button>
    </div>
  );
}
