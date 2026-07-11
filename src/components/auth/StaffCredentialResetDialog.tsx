import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { EnterprisePasswordField } from "./EnterprisePasswordField";

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

  if (!open) return null;

  const close = () => {
    setStep("enter");
    setDraft("");
    setError(null);
    onClose();
  };

  return (
    <AppModalOverlay className="z-[100] flex items-end justify-center bg-foreground/50 p-3 sm:items-center">
      <div role="dialog" aria-modal className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-waka">
        <p className="text-xl font-black text-foreground">{t(lang, "staffPinResetDialogTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">
          {staffName} — {step === "enter" ? t(lang, "staffPinResetPrompt") : t(lang, "settingsBackOfficePinConfirm")}
        </p>
        {error ? (
          <p className="mt-3 rounded-xl border border-danger-muted bg-danger-muted px-3 py-2 text-sm font-bold text-danger" role="alert">
            {error}
          </p>
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
        <button
          type="button"
          onClick={close}
          className="mt-4 w-full rounded-2xl border border-border py-3 text-sm font-bold text-muted-foreground"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
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

  if (!open) return null;

  return (
    <AppModalOverlay className="z-[100] flex items-end justify-center bg-foreground/50 p-3 sm:items-center">
      <div role="dialog" aria-modal className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-waka">
        <p className="text-xl font-black text-foreground">{t(lang, "staffResetPassword")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">
          {staffName} — {t(lang, "staffPasswordResetPrompt")}
        </p>
        <form
          className="mt-5 space-y-3"
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
          <button type="submit" disabled={!password.trim()} className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white disabled:opacity-50">
            {t(lang, "save")}
          </button>
        </form>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-2xl border border-border py-3 text-sm font-bold text-muted-foreground">
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
