import { ArrowLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatShelfDisplayLabel, formatShelfProductCountLabel } from "../../lib/posShelfDisplayLabel";
import { shelfIconFor } from "../../lib/productCategories";

type Props = {
  lang: Language;
  shelfLabel: string;
  productCount: number;
  onBack: () => void;
  className?: string;
};

/**
 * Phase 32.3 — shared Retail + Pharmacy drill-down chrome.
 * Orientation: ← Shelves | Shelf name | N products
 */
export function PosShelfDrillDownHeader({ lang, shelfLabel, productCount, onBack, className }: Props) {
  const displayLabel = formatShelfDisplayLabel(shelfLabel);
  const icon = shelfIconFor(shelfLabel);
  const countLabel = formatShelfProductCountLabel(lang, productCount);

  return (
    <div
      className={clsx(
        "sticky top-0 z-10 flex items-center gap-3 rounded-[1.35rem] border border-waka-200 bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur",
        className,
      )}
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-3.5 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
        aria-label={t(lang, "posSellCategoryHeading")}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
        {t(lang, "posSellCategoryHeading")}
      </button>
      <div className="min-w-0 flex-1 text-right">
        <p className="truncate text-sm font-black text-foreground">
          {icon ? (
            <span className="mr-1" aria-hidden>
              {icon}
            </span>
          ) : null}
          {displayLabel}
        </p>
        <p className="truncate text-[11px] font-bold text-muted-foreground">{countLabel}</p>
      </div>
    </div>
  );
}
