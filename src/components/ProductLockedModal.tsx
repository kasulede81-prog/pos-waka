import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { AppModalOverlay } from "./layout/AppModalOverlay";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

export function ProductLockedModal({ lang, open, onClose }: Props) {
  if (!open) return null;

  return (
    <AppModalOverlay
      className="z-[80] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-2xl font-black text-stone-900">{t(lang, "productLockedTitle")}</p>
        <p className="mt-2 text-base font-semibold leading-relaxed text-stone-600">{t(lang, "productLockedBody")}</p>
        <div className="mt-5 grid gap-2">
          <Link
            to="/upgrade"
            className="flex min-h-[52px] items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md active:bg-waka-700"
            onClick={onClose}
          >
            {t(lang, "productLockedUpgrade")}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-2xl border-2 border-stone-200 text-base font-bold text-stone-700"
          >
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
