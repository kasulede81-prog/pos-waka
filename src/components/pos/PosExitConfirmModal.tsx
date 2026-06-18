import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  open: boolean;
  onLock: () => void;
  onContinue: () => void;
  onCancel: () => void;
};

export function PosExitConfirmModal({ lang, open, onLock, onContinue, onCancel }: Props) {
  if (!open) return null;

  return (
    <AppModalOverlay className="z-[70] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-stone-900">{t(lang, "posExitTitle")}</h2>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "posExitBody")}</p>
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={onLock}
            className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white"
          >
            {t(lang, "posExitLockBtn")}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="min-h-[48px] rounded-2xl border-2 border-stone-200 font-bold text-stone-800"
          >
            {t(lang, "posExitContinueBtn")}
          </button>
          <button type="button" onClick={onCancel} className="min-h-[44px] text-sm font-bold text-stone-500">
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
