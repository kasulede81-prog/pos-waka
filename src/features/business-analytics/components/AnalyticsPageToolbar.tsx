import { Calendar, Download, Search, SlidersHorizontal } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
  periodLabel: string;
  compareEnabled: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenDateFilter: () => void;
  onToggleCompare: () => void;
  onOpenFilters: () => void;
  onOpenExport: () => void;
};

export function AnalyticsPageToolbar({
  lang,
  periodLabel,
  compareEnabled,
  searchQuery,
  onSearchChange,
  onOpenDateFilter,
  onToggleCompare,
  onOpenFilters,
  onOpenExport,
}: Props) {
  return (
    <div className="sticky top-0 z-20 space-y-2 rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t(lang, "baSearchReports")}
          className="min-h-[44px] w-full rounded-2xl border-2 border-stone-200 bg-stone-50/50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-waka-500"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenDateFilter}
          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-800 sm:flex-none"
        >
          <Calendar className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{periodLabel}</span>
        </button>
        <button
          type="button"
          onClick={onToggleCompare}
          className={`inline-flex min-h-[40px] items-center rounded-xl border px-3 text-xs font-black ${
            compareEnabled ? "border-waka-300 bg-waka-50 text-waka-800" : "border-stone-200 bg-white text-stone-700"
          }`}
        >
          {t(lang, "baComparePrior")}
        </button>
        <button
          type="button"
          onClick={onOpenFilters}
          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700"
          aria-label={t(lang, "baFilters")}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-waka-600 px-4 text-xs font-black text-white shadow-sm"
        >
          <Download className="h-4 w-4" aria-hidden />
          {t(lang, "baExport")}
        </button>
      </div>
    </div>
  );
}
