import { Calendar, Download, Search, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
  periodLabel: string;
  compareEnabled: boolean;
  searchQuery: string;
  exportDisabled?: boolean;
  /** Performance uses its own month selector — hide the shell date-range chrome. */
  hideDateRange?: boolean;
  onSearchChange: (value: string) => void;
  onOpenDateFilter: () => void;
  onToggleCompare: () => void;
  onOpenFilters: () => void;
  onOpenExport: () => void;
};

/** Presentation-only reporting toolbar — same controls, calmer hierarchy. */
export function AnalyticsPageToolbar({
  lang,
  periodLabel,
  compareEnabled,
  searchQuery,
  exportDisabled = false,
  hideDateRange = false,
  onSearchChange,
  onOpenDateFilter,
  onToggleCompare,
  onOpenFilters,
  onOpenExport,
}: Props) {
  return (
    <div className="sticky top-0 z-20 rounded-2xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t(lang, "baSearchReports")}
            aria-label={t(lang, "baSearchReports")}
            className="min-h-[44px] w-full rounded-xl border border-border bg-muted/40 pl-10 pr-3 text-sm font-semibold outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <div className="w-full min-w-0 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] lg:w-auto lg:overflow-visible lg:pb-0">
          <div className="flex w-max min-w-full items-center gap-2 lg:w-auto lg:min-w-0">
            {hideDateRange ? null : (
              <>
                <button
                  type="button"
                  onClick={onOpenDateFilter}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-black text-foreground hover:bg-muted/60"
                >
                  <Calendar className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{periodLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleCompare}
                  aria-pressed={compareEnabled}
                  className={clsx(
                    "inline-flex min-h-[40px] items-center rounded-xl border px-3 text-xs font-black",
                    compareEnabled
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(lang, "baComparePrior")}
                </button>
                <button
                  type="button"
                  onClick={onOpenFilters}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground"
                  aria-label={t(lang, "baFilters")}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onOpenExport}
              disabled={exportDisabled}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t(lang, "baExport")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
