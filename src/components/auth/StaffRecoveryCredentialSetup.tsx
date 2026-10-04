import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { completeStaffCredentialRecovery } from "../../lib/staffCredentialRecoveryOps";

type Props = {
  lang: Language;
  open: boolean;
  shopId: string;
  staffId: string;
  staffName: string;
  onClose: () => void;
  onComplete: (pin: string) => void;
};

export function StaffRecoveryCredentialSetup({
  lang,
  open,
  shopId,
  staffId,
  staffName,
  onClose,
  onComplete,
}: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinResetSignal, setPinResetSignal] = useState(0);

  if (!open) return null;

  const submit = async () => {
    if (pin.length < 4) {
      setError(t(lang, "staffRecoveryPinInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await completeStaffCredentialRecovery({
        shopId,
        staffId,
        pin,
      });
      if (!result.ok) {
        setError(t(lang, result.errorKey as never));
        setPinResetSignal((n) => n + 1);
        return;
      }
      onComplete(pin);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[80]"
      clearNav={false}
      title={t(lang, "staffCredentialRecoverySetupTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => void submit()}
            className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "staffCredentialRecoverySetupFinish")}
          </button>
        </div>
      }
    >
      <p className="text-sm font-semibold text-muted-foreground">{t(lang, "staffCredentialRecoveryStaffBody")}</p>
      <p className="mt-2 text-base font-black text-foreground">{staffName}</p>

      <p className="mt-4 text-sm font-bold text-foreground">{t(lang, "staffCredentialRecoverySetupPin")}</p>
      <EnterprisePinPad
        lang={lang}
        resetSignal={pinResetSignal}
        disabled={busy}
        onComplete={async (enteredPin) => {
          if (enteredPin.length < 4 || enteredPin.length > 6) {
            setError(t(lang, "staffRecoveryPinInvalid"));
            setPinResetSignal((n) => n + 1);
            return false;
          }
          setPin(enteredPin);
          setError(null);
          return true;
        }}
      />

      {/* NO PASSWORD FIELD. The dialog already requires a PIN before it can be submitted, and the
          PIN is the only credential this architecture issues for offline selling. The optional
          "New password" that used to sit here was a leftover of the four-credential model, and it
          was never load-bearing: `completeStaffCredentialRecovery` accepts a PIN alone.

          The backend keeps its `password?` parameter and `staffOfflineAuth` still verifies an
          existing `passwordHash`, so legacy staff who sign in with a password on a shared terminal
          are unaffected — they simply have no way to be issued a NEW one. */}
      <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
        {t(lang, "staffCredentialRecoveryPinNotLogin")}
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger-muted px-3 py-2 text-sm font-bold text-danger-foreground">
          {error}
        </p>
      ) : null}
    </ModalSheet>
  );
}
