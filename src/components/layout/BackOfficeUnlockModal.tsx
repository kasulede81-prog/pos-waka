import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { usePosStore } from "../../store/usePosStore";
import { checkBiometricCapability, promptNativeBiometric } from "../../lib/biometricAuth";
import { isBiometricAuthFeatureEnabled } from "../../lib/sensitiveActionAuth";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { AppModalOverlay } from "./AppModalOverlay";
import { PinInput } from "../ui/PinInput";
import { EnterprisePinKeypad } from "../auth/EnterprisePinKeypad";

type Props = { lang: Language };

export function BackOfficeUnlockModal({ lang }: Props) {
  const navigate = useNavigate();
  const isDesktop = usePosDesktopLayout();
  const useOnScreenKeypad = Capacitor.isNativePlatform() || !isDesktop;
  const preferences = usePosStore((s) => s.preferences);
  const { unlockWithPin, unlockWithBiometric, unlockedRole, unlockedLabel } = useBackOfficeSession();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const biometricEnabled = isBiometricAuthFeatureEnabled(preferences);

  useEffect(() => {
    if (!biometricEnabled) return;
    let cancelled = false;
    void checkBiometricCapability().then((cap) => {
      if (cancelled) return;
      setBiometricAvailable(Capacitor.isNativePlatform() && (cap.isAvailable || cap.deviceIsSecure));
    });
    return () => {
      cancelled = true;
    };
  }, [biometricEnabled]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setErr(false);
    void unlockWithPin(pin).then((ok) => {
      if (!ok) {
        setErr(true);
        setPin("");
        return;
      }
      setPin("");
      setJustUnlocked(true);
    });
  };

  const runBiometric = async () => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    setErr(false);
    const result = await promptNativeBiometric(t(lang, "biometricReason_access_reports"));
    setBiometricBusy(false);
    if (!result.ok) {
      if (!result.cancelled) setErr(true);
      return;
    }
    if (!unlockWithBiometric()) {
      setErr(true);
      return;
    }
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
        <p className="mt-1 text-xs font-semibold text-stone-500">{t(lang, "enterpriseSecurityBackOfficeHint")}</p>
        {biometricEnabled && biometricAvailable ? (
          <button
            type="button"
            disabled={biometricBusy}
            onClick={() => void runBiometric()}
            className="mt-4 min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
          >
            {biometricBusy ? t(lang, "biometricAuthenticating") : t(lang, "unlockBiometricButton")}
          </button>
        ) : null}
        <form onSubmit={submit} className="mt-5 space-y-3">
          {useOnScreenKeypad ? (
            <EnterprisePinKeypad
              lang={lang}
              value={pin}
              maxLength={6}
              size="mobile"
              onChange={setPin}
              onSubmit={() => submit()}
            />
          ) : (
            <PinInput
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t(lang, "unlockPinPlaceholder")}
              className="w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-center text-2xl font-black tracking-[0.3em] text-stone-900"
            />
          )}
          {err ? <p className="text-sm font-bold text-rose-600">{t(lang, "enterpriseSecurityWrongPin")}</p> : null}
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
