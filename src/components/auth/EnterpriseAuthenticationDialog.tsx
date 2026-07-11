import type { ReactNode } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { EnterprisePinPad } from "./EnterprisePinPad";

export type EnterpriseAuthenticationMode = "pin" | "password" | "biometric";

export type EnterpriseAuthenticationDialogProps = {
  lang: Language;
  open: boolean;
  title: string;
  subtitle?: string;
  mode: EnterpriseAuthenticationMode;
  busy?: boolean;
  statusMessage?: string | null;
  statusKind?: "success" | "error" | null;
  lockoutMessage?: string | null;
  /** PIN mode */
  onPinComplete?: (pin: string) => boolean | void | Promise<boolean | void>;
  pinResetSignal?: string | number;
  /** Biometric mode */
  biometricLabel?: string;
  onBiometric?: () => void;
  onUsePin?: () => void;
  showBiometric?: boolean;
  showPinFallback?: boolean;
  /** Password mode — render children (EnterprisePasswordField forms) */
  passwordContent?: ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
  zIndexClass?: string;
};

/** Unified authentication dialog shell — PIN, password, and biometric prompts. */
export function EnterpriseAuthenticationDialog({
  lang,
  open,
  title,
  subtitle,
  mode,
  busy = false,
  statusMessage,
  statusKind,
  lockoutMessage,
  onPinComplete,
  pinResetSignal,
  biometricLabel,
  onBiometric,
  onUsePin,
  showBiometric = false,
  showPinFallback = false,
  passwordContent,
  onCancel,
  cancelLabel,
  zIndexClass = "z-[110]",
}: EnterpriseAuthenticationDialogProps) {
  if (!open) return null;

  const titleId = "enterprise-auth-dialog-title";

  return (
    <AppModalOverlay className={clsx(zIndexClass, "flex items-end justify-center bg-foreground/50 p-3 sm:items-center")}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-waka"
      >
        <p id={titleId} className="text-xl font-black text-foreground">
          {title}
        </p>
        {subtitle ? <p className="mt-2 text-sm font-medium text-muted-foreground">{subtitle}</p> : null}

        {statusMessage ? (
          <p
            className={clsx(
              "mt-3 rounded-xl px-3 py-2 text-sm font-bold",
              statusKind === "success"
                ? "border border-success-muted bg-success-muted text-success"
                : "border border-danger-muted bg-danger-muted text-danger",
            )}
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}

        {mode === "pin" && onPinComplete ? (
          <div className="mt-5">
            {showBiometric && onBiometric ? (
              <button
                type="button"
                disabled={busy}
                onClick={onBiometric}
                className="mb-4 min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
              >
                {busy ? t(lang, "biometricAuthenticating") : (biometricLabel ?? t(lang, "enterpriseSecurityBiometricButton"))}
              </button>
            ) : null}
            {showPinFallback && onUsePin ? (
              <button
                type="button"
                disabled={busy}
                onClick={onUsePin}
                className="mb-4 w-full rounded-2xl border border-border py-3 text-sm font-bold text-muted-foreground"
              >
                {t(lang, "enterpriseSecurityUsePinInstead")}
              </button>
            ) : null}
            <EnterprisePinPad
              lang={lang}
              onComplete={onPinComplete}
              disabled={busy}
              verifying={busy}
              lockoutMessage={lockoutMessage}
              resetSignal={pinResetSignal}
              labelledBy={titleId}
            />
          </div>
        ) : null}

        {mode === "biometric" && onBiometric ? (
          <div className="mt-5 space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={onBiometric}
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {busy ? t(lang, "biometricAuthenticating") : (biometricLabel ?? t(lang, "enterpriseSecurityBiometricButton"))}
            </button>
            {onUsePin ? (
              <button
                type="button"
                disabled={busy}
                onClick={onUsePin}
                className="w-full rounded-2xl border border-border py-3 text-sm font-bold text-muted-foreground"
              >
                {t(lang, "enterpriseSecurityUsePinInstead")}
              </button>
            ) : null}
          </div>
        ) : null}

        {mode === "password" && passwordContent ? <div className="mt-5 space-y-3">{passwordContent}</div> : null}

        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="mt-4 w-full rounded-2xl border border-border py-3 text-sm font-bold text-muted-foreground"
        >
          {cancelLabel ?? t(lang, "biometricCancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
