import { Plus } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  onClick: () => void;
  disabled?: boolean;
};

export function StockFab({ lang, onClick, disabled }: Props) {
  return (
    <div className="pointer-events-none fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.75rem)] right-4 z-[45]">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={t(lang, "stockAddProductBtn")}
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-waka-600 text-white shadow-[0_8px_24px_rgba(249,115,22,0.45)] transition-all active:scale-95 active:bg-waka-700 disabled:opacity-50 motion-reduce:active:scale-100"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}
