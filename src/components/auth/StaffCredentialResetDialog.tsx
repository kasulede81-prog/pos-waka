import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { EnterpriseFeedbackBanner } from "../enterprise/EnterpriseFeedbackBanner";
import { Body } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";

type StaffPinResetProps = {
  lang: Language;
  open: boolean;
  staffName: string;
  onClose: () => void;
  onConfirm: (pin: string) => void;
};

export function StaffPinResetDialog({ lang, open, staffName, onClose, onConfirm }: StaffPinResetProps) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const close = () => {
    setStep("enter");
    setDraft("");
    setError(null);
    onClose();
  };

  return (
    <ModalSheet
      open={open}
      onClose={close}
      align="center"
      zIndexClass="z-[100]"
      title={t(lang, "staffPinResetDialogTitle")}
      footer={
        <WakaButton type="button" variant="secondary" className="w-full" onClick={close}>
          {t(lang, "cancel")}
        </WakaButton>
      }
    >
      <Body className="text-muted-foreground">
        {staffName} — {step === "enter" ? t(lang, "staffPinResetPrompt") : t(lang, "settingsBackOfficePinConfirm")}
      </Body>
      {error ? (
        <EnterpriseFeedbackBanner tone="danger" role="alert" className="mt-3">
          {error}
        </EnterpriseFeedbackBanner>
      ) : null}
      <div className="mt-5">
        <EnterprisePinPad
          lang={lang}
          resetSignal={`${step}-${resetSignal}`}
          onComplete={(pin) => {
            if (step === "enter") {
              setDraft(pin);
              setStep("confirm");
              return true;
            }
            if (pin !== draft) {
              setError(t(lang, "settingsBackOfficePinMismatch"));
              setStep("enter");
              setDraft("");
              setResetSignal((n) => n + 1);
              return false;
            }
            onConfirm(pin);
            close();
            return true;
          }}
        />
      </div>
    </ModalSheet>
  );
}

/**
 * `StaffPasswordResetDialog` was DELETED here.
 *
 * It had no callers anywhere in the product (Phase 5 audited every import, barrel and test), and
 * it existed only to issue a credential the architecture no longer has: online sign-in is the
 * person's own Google account, and the offline credential is the PIN, which `StaffPinResetDialog`
 * above already manages.
 *
 * Only the UI is gone. `StaffAccount.passwordHash`, `shop_pos_staff.password_hash`, the cloud
 * sync, `resetStaffSecret`'s password branch and the offline verifier that accepts a password all
 * remain — existing staff who sign in with one on a shared terminal are unaffected. There is
 * simply no longer a way to be issued a NEW one.
 */
