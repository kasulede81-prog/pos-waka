import { ScanLine, Search, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { detectBarcodeCapabilities } from "../../services/hardware/barcodeAdapter";

type Props = {
  lang: Language;
  value: string;
  onChange: (q: string) => void;
  onScan?: () => void;
};

export function StockPinnedSearch({ lang, value, onChange, onScan }: Props) {
  const canScan = detectBarcodeCapabilities().cameraScan;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, "stockSearchUnifiedPh")}
        aria-label={t(lang, "stockSearchUnifiedPh")}
        className="h-11 w-full rounded-2xl border border-stone-200 bg-white pl-9 pr-10 text-sm font-semibold text-stone-900 shadow-sm outline-none transition-shadow placeholder:text-stone-400 focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
      />
      <button
        type="button"
        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-stone-500 active:bg-stone-100"
        onClick={() => {
          if (value.trim()) onChange("");
          else if (canScan && onScan) onScan();
        }}
        aria-label={value.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
      >
        {value.trim() ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
      </button>
    </div>
  );
}
