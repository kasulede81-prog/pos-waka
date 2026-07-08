import { useEffect, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { checkBiometricCapability } from "../../lib/biometricAuth";
import type { SecurityCredentialType } from "../../lib/enterpriseSecurity/types";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { PinInput } from "../ui/PinInput";

export type EnterpriseSecurityDialogMode = {
  /** Primary PIN credential to collect when user chooses PIN entry. */
  pinCredential: Extract<SecurityCredentialType, "shop_security_pin" | "staff_pin" | "owner_override">;
  allowBiometric?: boolean;
};

type Props = {
  lang: Language;
  open: boolean;
  mode: EnterpriseSecurityDialogMode;
  busy: boolean;
  statusMessage: string | null;
  statusKind: "success" | "error" | null;
  onAuthenticateBiometric: () => void;
  onSubmitPin: (pin: string) => void;
  onCancel: () => void;
};

function pinPromptKey(credential: EnterpriseSecurityDialogMode["pinCredential"]): Parameters<typeof t>[1] {
  if (credential === "shop_security_pin") return "enterpriseSecurityShopPinPrompt";
  if (credential === "owner_override") return "enterpriseSecurityOwnerOverridePrompt";
  return "enterpriseSecurityStaffPinPrompt";
}

function pinTitleKey(credential: EnterpriseSecurityDialogMode["pinCredential"]): Parameters<typeof t>[1] {
  if (credential === "shop_security_pin") return "enterpriseSecurityShopPinTitle";
  if (credential === "owner_override") return "enterpriseSecurityOwnerOverrideTitle";
  return "enterpriseSecurityStaffPinTitle";
}

/** Unified enterprise security dialog — same UX for all protected actions. */
export function EnterpriseSecurityDialog({
  lang,
  open,
  mode,
  busy,
  statusMessage,
  statusKind,
  onAuthenticateBiometric,
  onSubmitPin,
  onCancel,
}: Props) {
  const [pin, setPin] = useState("");
  const [pinMode, setPinMode] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    if (!open) {
      setPin("");
      setPinMode(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !mode.allowBiometric) {
      setPinMode(true);
      return;
    }
    let cancelled = false;
    void checkBiometricCapability().then((cap) => {
      if (cancelled) return;
      const ready = Capacitor.isNativePlatform() && (cap.isAvailable || cap.deviceIsSecure);
      setBiometricAvailable(ready);
      if (!ready) setPinMode(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, mode.allowBiometric]);

  if (!open) return null;

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    onSubmitPin(pin);
    setPin("");
  };

  return (
    <AppModalOverlay className="z-[110] flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="enterprise-security-title"
        className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-waka"
      >
        <p id="enterprise-security-title" className="text-xl font-black text-stone-900">
          {t(lang, pinTitleKey(mode.pinCredential))}
        </p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "enterpriseSecurityDialogSub")}</p>

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

        {pinMode || !mode.allowBiometric ? (
          <form onSubmit={submitPin} className="mt-5 space-y-3">
            <p className="text-sm font-semibold text-stone-700">{t(lang, pinPromptKey(mode.pinCredential))}</p>
            <PinInput
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t(lang, "unlockPinPlaceholder")}
              autoFocus
              className="w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-center text-2xl font-black tracking-[0.3em] text-stone-900"
            />
            <button
              type="submit"
              disabled={pin.length < 4 || busy}
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {t(lang, "enterpriseSecuritySubmit")}
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            {biometricAvailable ? (
              <button
                type="button"
                disabled={busy}
                onClick={onAuthenticateBiometric}
                className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
              >
                {busy ? t(lang, "biometricAuthenticating") : t(lang, "enterpriseSecurityBiometricButton")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setPinMode(true)}
              className={
                biometricAvailable
                  ? "w-full rounded-2xl border border-stone-200 py-3 text-sm font-bold text-stone-700"
                  : "min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm"
              }
            >
              {t(lang, pinPromptKey(mode.pinCredential))}
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
