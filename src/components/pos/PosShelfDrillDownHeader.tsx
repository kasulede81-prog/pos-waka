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
  /** M1.4 — tighter phone chrome (≥44px targets, less vertical padding). */
  compact?: boolean;
};

/**
 * Phase 32.3 — shared Retail + Pharmacy drill-down chrome.
 * Orientation: ← Shelves | Shelf name | N products
 */
export function PosShelfDrillDownHeader({
  lang,
  shelfLabel,
  productCount,
  onBack,
  className,
  compact = false,
}: Props) {
  const displayLabel = formatShelfDisplayLabel(shelfLabel);
  const icon = shelfIconFor(shelfLabel);
  const countLabel = formatShelfProductCountLabel(lang, productCount);

  return (
    <div
      className={clsx(
        "sticky top-0 z-10 flex items-center gap-2 border border-waka-200 bg-card/95 backdrop-blur",
        compact
          ? "rounded-xl px-2 py-1.5 shadow-none"
          : "gap-3 rounded-[1.35rem] px-2.5 py-2 shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={onBack}
        className={clsx(
          "inline-flex shrink-0 items-center gap-1.5 font-black text-white shadow-sm active:bg-waka-700",
          compact
            ? "min-h-[44px] rounded-xl bg-waka-600 px-3 py-1.5 text-xs"
            : "min-h-[48px] rounded-2xl bg-waka-600 px-3.5 py-2 text-sm",
        )}
        aria-label={t(lang, "posSellCategoryHeading")}
      >
        <ArrowLeft className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
        {t(lang, "posSellCategoryHeading")}
      </button>
      <div className="min-w-0 flex-1 text-right">
        <p className={clsx("truncate font-black text-foreground", compact ? "text-xs" : "text-sm")}>
          {icon ? (
            <span className="mr-1" aria-hidden>
              {icon}
            </span>
          ) : null}
          {displayLabel}
        </p>
        <p className={clsx("truncate font-bold text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>
          {countLabel}
        </p>
      </div>
    </div>
  );
}
