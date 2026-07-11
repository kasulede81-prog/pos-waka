import { Search, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  value: string;
  onChange: (q: string) => void;
};

export function ProfitSearchBar({ lang, value, onChange }: Props) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, "profitSearchPh")}
        aria-label={t(lang, "profitSearchPh")}
        className="h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-10 text-sm font-semibold text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
      />
      {value.trim() ? (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
          onClick={() => onChange("")}
          aria-label={t(lang, "posClearSearch")}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
