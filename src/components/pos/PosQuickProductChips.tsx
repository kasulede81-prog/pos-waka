import clsx from "clsx";
import type { Product } from "../../types";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  products: Product[];
  onTap: (product: Product) => void;
  className?: string;
};

/** Horizontal quick-product chips — name only, no images. */
export function PosQuickProductChips({ lang, products, onTap, className }: Props) {
  if (products.length === 0) return null;

  return (
    <section className={clsx("space-y-1", className)}>
      <p className="px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
        {t(lang, "posFrequentToday")}
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onTap(p)}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-sm transition-all active:scale-[0.97] active:border-waka-300 active:bg-waka-50 motion-reduce:active:scale-100"
          >
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}
