import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { isOwnerPasswordValid, passwordStrength, type PasswordStrength } from "../../lib/passwordValidation";

export type EnterprisePasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  lang: Language;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  showStrength?: boolean;
  showVisibilityToggle?: boolean;
  loading?: boolean;
  wrapperClassName?: string;
};

function strengthLabel(lang: Language, strength: PasswordStrength): string {
  if (strength === "strong") return t(lang, "enterprisePasswordStrengthStrong");
  if (strength === "fair") return t(lang, "enterprisePasswordStrengthFair");
  return t(lang, "enterprisePasswordStrengthWeak");
}

export const EnterprisePasswordField = forwardRef<HTMLInputElement, EnterprisePasswordFieldProps>(
  function EnterprisePasswordField(
    {
      lang,
      label,
      hint,
      error,
      showStrength = false,
      showVisibilityToggle = true,
      loading = false,
      className,
      wrapperClassName,
      value = "",
      onChange,
      minLength = 8,
      disabled,
      id,
      ...rest
    },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const [capsLock, setCapsLock] = useState(false);
    const inputId = id ?? "enterprise-password-field";
    const str = String(value);
    const strength = passwordStrength(str);

    useEffect(() => {
      if (!showStrength && !showVisibilityToggle) return;
    }, [showStrength, showVisibilityToggle]);

    return (
      <div className={wrapperClassName}>
        {label ? (
          <label htmlFor={inputId} className="block text-sm font-bold text-foreground dark:text-muted-foreground">
            {label}
          </label>
        ) : null}

        <div className={clsx("relative", label ? "mt-1.5" : undefined)}>
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            value={value}
            onChange={onChange}
            disabled={disabled || loading}
            minLength={minLength}
            aria-invalid={Boolean(error)}
            aria-describedby={
              [error ? `${inputId}-error` : null, capsLock ? `${inputId}-caps` : null, hint ? `${inputId}-hint` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
            onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
            className={clsx(
              "w-full min-h-[48px] rounded-xl border border-border bg-card py-3 pl-4 pr-12 text-base text-foreground outline-none ring-waka-200 placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 disabled:opacity-60 dark:bg-foreground dark:text-background",
              error && "border-danger focus:border-danger focus:ring-danger/30",
              className,
            )}
            {...rest}
          />

          {showVisibilityToggle ? (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled || loading}
              onClick={() => setVisible((v) => !v)}
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label={visible ? t(lang, "enterprisePasswordHide") : t(lang, "enterprisePasswordShow")}
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : null}
        </div>

        {capsLock ? (
          <p id={`${inputId}-caps`} className="mt-1.5 text-xs font-semibold text-warning-foreground" role="status">
            {t(lang, "enterprisePasswordCapsLock")}
          </p>
        ) : null}

        {hint ? (
          <p id={`${inputId}-hint`} className="mt-1.5 text-xs font-medium text-muted-foreground">
            {hint}
          </p>
        ) : null}

        {showStrength && str ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={clsx(
                  "h-full rounded-full transition-all",
                  strength === "strong" && "w-full bg-success",
                  strength === "fair" && "w-2/3 bg-warning",
                  strength === "weak" && "w-1/3 bg-danger",
                )}
              />
            </div>
            <span className="text-xs font-bold text-muted-foreground">{strengthLabel(lang, strength)}</span>
          </div>
        ) : null}

        {error ? (
          <p id={`${inputId}-error`} className="mt-2 text-sm font-bold text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-1.5 text-xs font-semibold text-muted-foreground" aria-live="polite">
            {t(lang, "loadingAuth")}
          </p>
        ) : null}
      </div>
    );
  },
);

export { isOwnerPasswordValid, passwordStrength };
