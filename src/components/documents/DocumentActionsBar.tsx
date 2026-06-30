import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { receiptPrintActionLabel } from "../../lib/printActionLabels";

type Props = {
  lang: Language;
  onPrint: () => void;
  onDownloadPdf: () => void;
  onSharePdf: () => void;
  compact?: boolean;
};

export function DocumentActionsBar({ lang, onPrint, onDownloadPdf, onSharePdf, compact }: Props) {
  const btn = compact
    ? "min-h-[44px] rounded-xl px-3 py-2 text-xs font-black"
    : "min-h-[48px] rounded-2xl px-4 py-3 text-sm font-black";
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
      <button type="button" className={`${btn} bg-stone-900 text-white`} onClick={onPrint}>
        {receiptPrintActionLabel(lang)}
      </button>
      <button type="button" className={`${btn} bg-waka-600 text-white`} onClick={onDownloadPdf}>
        {t(lang, "receiptDownloadPdf")}
      </button>
      <button type="button" className={`${btn} border-2 border-waka-600 bg-white text-waka-900`} onClick={onSharePdf}>
        {t(lang, "receiptSharePdf")}
      </button>
    </div>
  );
}
