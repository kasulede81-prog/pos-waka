import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ArrowRight, ShoppingCart } from "lucide-react";

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
  unitCount: _unitCount,
  payableUgx,
  onOpen,
  variant,
}: Props) {
  if (variant === "mobile") {
    return (
      <div className="fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom))] left-0 right-0 z-[48] border-t border-stone-200/90 bg-white/98 px-3 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
              <ShoppingCart className="h-5 w-5" aria-hidden />
              {productCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-waka-600 px-1 text-[9px] font-black text-white">
                  {productCount}
                </span>
              ) : null}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-stone-600">
                {productCount} {t(lang, "posCartProductsShort").toLowerCase()}
              </p>
              <p className="truncate text-lg font-black leading-tight text-teal-900">
                UGX {payableUgx.toLocaleString()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-black text-white shadow-md transition-all active:scale-[0.98] active:bg-teal-800 motion-reduce:active:scale-100"
          >
            {t(lang, "checkout")}
            <ArrowRight className="h-4 w-4" aria-hidden />
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
        className="pointer-events-auto flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-2xl border border-teal-300 bg-white px-4 py-2.5 text-sm font-black text-teal-900 shadow-lg active:bg-teal-50"
      >
        <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-teal-700 px-2 text-xs font-black text-white">
          {productCount}
        </span>
        <span className="hidden sm:inline">UGX {payableUgx.toLocaleString()}</span>
        <span className="sm:hidden">{t(lang, "posReviewPay")}</span>
      </button>
    </div>
  );
}
