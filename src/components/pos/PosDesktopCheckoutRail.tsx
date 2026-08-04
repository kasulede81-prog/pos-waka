import { ShoppingCart } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  productCount: number;
  payableUgx: number;
  onExpand: () => void;
};

/** Phase 32.1 — collapsed full-desktop checkout column (keeps split mounted). */
export function PosDesktopCheckoutRail({ lang, productCount, payableUgx, onExpand }: Props) {
  return (
    <aside className="flex h-full min-h-0 flex-col items-stretch rounded-xl border border-waka-200 bg-waka-50/90 shadow-waka-sm">
      <button
        type="button"
        onClick={onExpand}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-1.5 py-3 text-center active:bg-waka-100"
        aria-label={t(lang, "checkout")}
      >
        <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm">
          <ShoppingCart className="h-5 w-5" aria-hidden />
          {productCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-waka-600 px-1 text-[9px] font-black text-white">
              {productCount}
            </span>
          ) : null}
        </span>
        <span className="text-[10px] font-black uppercase tracking-wide text-teal-900 [writing-mode:vertical-rl] rotate-180">
          {t(lang, "checkout")}
        </span>
        <span className="max-w-full break-all text-[10px] font-black tabular-nums leading-tight text-foreground">
          {payableUgx.toLocaleString()}
        </span>
      </button>
    </aside>
  );
}
