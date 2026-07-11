import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useBackOfficeSession } from "../../context/BackOfficeSessionContext";
import { usePosStore } from "../../store/usePosStore";
import { checkBiometricCapability, promptNativeBiometric } from "../../lib/biometricAuth";
import { isBiometricAuthFeatureEnabled } from "../../lib/sensitiveActionAuth";
import { EnterpriseAuthenticationDialog } from "../auth/EnterpriseAuthenticationDialog";
import { AppModalOverlay } from "./AppModalOverlay";

type Props = { lang: Language };

export function BackOfficeUnlockModal({ lang }: Props) {
  const navigate = useNavigate();
  const preferences = usePosStore((s) => s.preferences);
  const { unlockWithPin, unlockWithBiometric, unlockedRole, unlockedLabel } = useBackOfficeSession();
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinResetSignal, setPinResetSignal] = useState(0);
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

  const runBiometric = async () => {
    if (biometricBusy) return;
    setBiometricBusy(true);
    const result = await promptNativeBiometric(t(lang, "biometricReason_access_reports"));
    setBiometricBusy(false);
    if (!result.ok) {
      return false;
    }
    if (!unlockWithBiometric()) {
      return false;
    }
    setJustUnlocked(true);
    return true;
  };

  if (justUnlocked && unlockedRole) {
    return (
      <AppModalOverlay className="z-[100] flex items-end justify-center bg-foreground/50 p-3 sm:items-center">
        <div role="dialog" aria-modal className="w-full max-w-md rounded-3xl border border-emerald-200 bg-card p-6 shadow-waka">
          <p className="text-xl font-black text-emerald-900">{t(lang, "unlockSuccessTitle")}</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
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
    <EnterpriseAuthenticationDialog
      lang={lang}
      open
      zIndexClass="z-[100]"
      title={t(lang, "unlockModalTitle")}
      subtitle={`${t(lang, "unlockModalHint")} ${t(lang, "enterpriseSecurityBackOfficeHint")}`}
      mode="pin"
      busy={biometricBusy || pinBusy}
      showBiometric={biometricEnabled && biometricAvailable}
      biometricLabel={t(lang, "unlockBiometricButton")}
      onBiometric={() => void runBiometric()}
      onPinComplete={async (pin) => {
        setPinBusy(true);
        const ok = await unlockWithPin(pin);
        setPinBusy(false);
        if (!ok) {
          setPinResetSignal((n) => n + 1);
          return false;
        }
        setJustUnlocked(true);
        return true;
      }}
      pinResetSignal={pinResetSignal}
      onCancel={() => navigate("/", { replace: true })}
      cancelLabel={t(lang, "unlockGoHome")}
    />
  );
}
