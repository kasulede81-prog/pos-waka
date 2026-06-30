import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  shelfLabel: string;
  canAdd: boolean;
  onAddProduct: () => void;
  compact?: boolean;
};

/** Empty shelf — low-stock-style warning with restock / add-product CTA. */
export function EmptyShelfPanel({ lang, shelfLabel, canAdd, onAddProduct, compact = false }: Props) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-rose-200/90 bg-rose-50/40",
        compact ? "px-3 py-4" : "px-4 py-6",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700"
          aria-hidden
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-rose-900">{t(lang, "shelfEmptyTitle")}</p>
          <p className="mt-1 text-xs font-semibold leading-snug text-rose-800/90">
            {tTemplate(lang, "shelfEmptyDetail", { shelf: shelfLabel })}
          </p>
          {canAdd ? (
            <button
              type="button"
              onClick={onAddProduct}
              className="mt-3 min-h-[40px] w-full rounded-xl bg-waka-600 px-4 text-sm font-black text-white shadow-sm active:bg-waka-700 sm:w-auto"
            >
              {t(lang, "shelfEmptyAddProduct")}
            </button>
          ) : (
            <p className="mt-2 text-xs font-semibold text-stone-600">{t(lang, "posEmptyAskOwner")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
