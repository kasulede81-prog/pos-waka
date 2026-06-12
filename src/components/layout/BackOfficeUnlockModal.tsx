import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { AppModalOverlay } from "./AppModalOverlay";
import { PinInput } from "../ui/PinInput";

type Props = { lang: Language };

export function BackOfficeUnlockModal({ lang }: Props) {
  const navigate = useNavigate();
  const { unlockWithPin, unlockedRole, unlockedLabel } = useBackOfficeSession();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(false);
    const ok = unlockWithPin(pin);
    if (!ok) {
      setErr(true);
      setPin("");
      return;
    }
    setPin("");
    setJustUnlocked(true);
  };

  if (justUnlocked && unlockedRole) {
    return (
      <AppModalOverlay className="z-[100] flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
        <div role="dialog" aria-modal className="w-full max-w-md rounded-3xl border border-emerald-200 bg-white p-6 shadow-waka">
          <p className="text-xl font-black text-emerald-900">{t(lang, "unlockSuccessTitle")}</p>
          <p className="mt-2 text-sm font-semibold text-stone-700">
            {tTemplate(lang, "unlockSuccessRole", {
              role: t(lang, `roleLabel_${unlockedRole}` as Parameters<typeof t>[1]),
              name: unlockedLabel ?? "",
            })}
          </p>
        </div>
      </AppModalOverlay>
    );
  }

  return (
    <AppModalOverlay className="z-[100] flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal
        className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-waka"
      >
        <p className="text-xl font-black text-stone-900">{t(lang, "unlockModalTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "unlockModalHint")}</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <PinInput
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={t(lang, "unlockPinPlaceholder")}
            className="w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-center text-2xl font-black tracking-[0.3em] text-stone-900"
          />
          {err ? <p className="text-sm font-bold text-rose-600">{t(lang, "unlockWrongPin")}</p> : null}
          <button
            type="submit"
            className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm"
          >
            {t(lang, "unlockSubmit")}
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-stone-200 py-3 text-sm font-bold text-stone-700"
            onClick={() => navigate("/", { replace: true })}
          >
            {t(lang, "unlockGoHome")}
          </button>
        </form>
      </div>
    </AppModalOverlay>
  );
}
