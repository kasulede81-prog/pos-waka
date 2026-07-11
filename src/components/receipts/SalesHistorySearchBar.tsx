import { ScanLine, Search, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { detectBarcodeCapabilities } from "../../services/hardware/barcodeAdapter";

type Props = {
  lang: Language;
  value: string;
  onChange: (q: string) => void;
};

export function SalesHistorySearchBar({ lang, value, onChange }: Props) {
  const canScan = detectBarcodeCapabilities().cameraScan;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, "salesHistorySearchPh")}
        aria-label={t(lang, "salesHistorySearchPh")}
        className="h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-10 text-sm font-semibold text-foreground shadow-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
      />
      <button
        type="button"
        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
        onClick={() => {
          if (value.trim()) onChange("");
        }}
        aria-label={value.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
      >
        {value.trim() ? <X className="h-4 w-4" /> : canScan ? <ScanLine className="h-4 w-4" /> : null}
      </button>
    </div>
  );
}
