import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { EnterprisePasswordField } from "./EnterprisePasswordField";
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

type StaffPasswordResetProps = {
  lang: Language;
  open: boolean;
  staffName: string;
  onClose: () => void;
  onConfirm: (password: string) => void;
};

export function StaffPasswordResetDialog({ lang, open, staffName, onClose, onConfirm }: StaffPasswordResetProps) {
  const [password, setPassword] = useState("");

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      align="center"
      zIndexClass="z-[100]"
      title={t(lang, "staffResetPassword")}
      footer={
        <div className="space-y-2">
          <WakaButton
            type="submit"
            form="staff-password-reset-form"
            className="w-full"
            disabled={!password.trim()}
          >
            {t(lang, "save")}
          </WakaButton>
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        </div>
      }
    >
      <Body className="text-muted-foreground">
        {staffName} — {t(lang, "staffPasswordResetPrompt")}
      </Body>
      <form
        id="staff-password-reset-form"
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!password.trim()) return;
          onConfirm(password);
          setPassword("");
          onClose();
        }}
      >
        <EnterprisePasswordField
          lang={lang}
          label={t(lang, "password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={1}
        />
      </form>
    </ModalSheet>
  );
}
