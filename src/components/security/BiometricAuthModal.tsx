import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { PinInput } from "../ui/PinInput";

type Props = {
  lang: Language;
  busy: boolean;
  showPinOnly: boolean;
  statusMessage: string | null;
  statusKind: "success" | "error" | null;
  onAuthenticateBiometric: () => void;
  onUseOwnerPin: () => void;
  onSubmitOwnerPin: (pin: string) => void;
  onCancel: () => void;
};

export function BiometricAuthModal({
  lang,
  busy,
  showPinOnly,
  statusMessage,
  statusKind,
  onAuthenticateBiometric,
  onUseOwnerPin,
  onSubmitOwnerPin,
  onCancel,
}: Props) {
  const [pin, setPin] = useState("");
  const [pinMode, setPinMode] = useState(showPinOnly);
  const autoPromptStartedRef = useRef(false);

  useEffect(() => {
    setPinMode(showPinOnly);
    autoPromptStartedRef.current = false;
  }, [showPinOnly]);

  useEffect(() => {
    if (!pinMode && !busy && !autoPromptStartedRef.current) {
      autoPromptStartedRef.current = true;
      onAuthenticateBiometric();
    }
  }, [pinMode, busy, onAuthenticateBiometric]);

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    onSubmitOwnerPin(pin);
    setPin("");
  };

  return (
    <AppModalOverlay className="z-[110] flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="biometric-auth-title"
        className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-waka"
      >
        <p id="biometric-auth-title" className="text-xl font-black text-stone-900">
          {t(lang, "biometricModalTitle")}
        </p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "biometricModalSub")}</p>

        {statusMessage ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${
              statusKind === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border border-rose-200 bg-rose-50 text-rose-950"
            }`}
          >
            {statusMessage}
          </p>
        ) : null}

        {pinMode ? (
          <form onSubmit={submitPin} className="mt-5 space-y-3">
            <p className="text-sm font-semibold text-stone-700">{t(lang, "biometricOwnerPinPrompt")}</p>
            <PinInput
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t(lang, "unlockPinPlaceholder")}
              className="w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-center text-2xl font-black tracking-[0.3em] text-stone-900"
            />
            <button
              type="submit"
              disabled={pin.length < 4 || busy}
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {t(lang, "biometricOwnerPinSubmit")}
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={onAuthenticateBiometric}
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {busy ? t(lang, "biometricAuthenticating") : t(lang, "biometricAuthenticateButton")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPinMode(true);
                onUseOwnerPin();
              }}
              className="w-full rounded-2xl border border-stone-200 py-3 text-sm font-bold text-stone-700"
            >
              {t(lang, "biometricUseOwnerPin")}
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="mt-3 w-full rounded-2xl border border-stone-200 py-3 text-sm font-bold text-stone-500"
        >
          {t(lang, "biometricCancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
