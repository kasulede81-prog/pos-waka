import { ScanLine, Search, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { detectBarcodeCapabilities } from "../../services/hardware/barcodeAdapter";
import { themeUi } from "../../lib/themeTokens";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Props = {
  lang: Language;
  value: string;
  onChange: (q: string) => void;
  onScan?: () => void;
};

export function SalesHistorySearchBar({ lang, value, onChange, onScan }: Props) {
  const canScan = detectBarcodeCapabilities().cameraScan;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-waka-700" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, "salesHistorySearchPh")}
        aria-label={t(lang, "salesHistorySearchPh")}
        className={clsx(themeUi.input, "h-12 pl-12 pr-12 text-base font-semibold shadow-elev")}
      />
      <button
        type="button"
        className={clsx(
          "absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground",
          enterpriseMotion.standard,
          "active:bg-muted",
        )}
        onClick={() => {
          if (value.trim()) onChange("");
          else if (canScan && onScan) onScan();
        }}
        aria-label={value.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
      >
        {value.trim() ? <X className="h-5 w-5" /> : canScan ? <ScanLine className="h-5 w-5" /> : null}
      </button>
    </div>
  );
}
