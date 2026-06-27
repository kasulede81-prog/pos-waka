import { Download, Search, SlidersHorizontal } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
  searchText: string;
  onSearchChange: (value: string) => void;
  onOpenFilters: () => void;
  onOpenExport: () => void;
  resultCount: number;
};

export function InvestigationSearchBar({
  lang,
  searchText,
  onSearchChange,
  onOpenFilters,
  onOpenExport,
  resultCount,
}: Props) {
  return (
    <div className="sticky top-0 z-20 -mx-1 space-y-2 rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input
            type="search"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t(lang, "icSearchPlaceholder")}
            className="min-h-[44px] w-full rounded-2xl border-2 border-stone-200 bg-stone-50/50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-waka-500"
          />
        </div>
        <button
          type="button"
          onClick={onOpenFilters}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl border-2 border-stone-200 bg-white text-stone-700 active:bg-stone-50"
          aria-label={t(lang, "icFiltersTitle")}
        >
          <SlidersHorizontal className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl border-2 border-waka-200 bg-waka-50 text-waka-800 active:bg-waka-100"
          aria-label={t(lang, "icExportTitle")}
        >
          <Download className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <p className="px-1 text-[11px] font-semibold text-stone-500">
        {t(lang, "auditResultCount")}: {resultCount.toLocaleString()}
      </p>
    </div>
  );
}
