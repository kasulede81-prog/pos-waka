import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { checkBiometricCapability } from "../../lib/biometricAuth";
import type { SecurityCredentialType } from "../../lib/enterpriseSecurity/types";
import { EnterpriseAuthenticationDialog } from "../auth/EnterpriseAuthenticationDialog";

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
  const [pinMode, setPinMode] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinResetSignal, setPinResetSignal] = useState(0);

  useEffect(() => {
    if (!open) {
      setPinMode(false);
      setPinResetSignal((n) => n + 1);
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

  const showPin = pinMode || !mode.allowBiometric || !biometricAvailable;

  return (
    <EnterpriseAuthenticationDialog
      lang={lang}
      open={open}
      title={t(lang, pinTitleKey(mode.pinCredential))}
      subtitle={t(lang, "enterpriseSecurityDialogSub")}
      mode={showPin ? "pin" : "biometric"}
      busy={busy}
      statusMessage={statusMessage}
      statusKind={statusKind}
      showBiometric={showPin && mode.allowBiometric === true && biometricAvailable}
      onBiometric={onAuthenticateBiometric}
      onUsePin={() => setPinMode(true)}
      onPinComplete={(pin) => {
        onSubmitPin(pin);
        setPinResetSignal((n) => n + 1);
      }}
      pinResetSignal={pinResetSignal}
      onCancel={onCancel}
    />
  );
}
