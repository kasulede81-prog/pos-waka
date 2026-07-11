import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Delete } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hapticPinError, hapticTap } from "../../lib/nativeFeedback";

export const ENTERPRISE_PIN_LENGTH = 4;

export type EnterprisePinPadCompleteResult = boolean | void | { ok: boolean };

export type EnterprisePinPadProps = {
  lang: Language;
  /** Called automatically when 4 digits are entered. Return false to trigger failure UX. */
  onComplete: (pin: string) => EnterprisePinPadCompleteResult | Promise<EnterprisePinPadCompleteResult>;
  disabled?: boolean;
  /** External busy state while parent verifies */
  verifying?: boolean;
  /** Force reset when this value changes */
  resetSignal?: string | number;
  size?: "desktop" | "tablet" | "mobile";
  className?: string;
  /** External lockout message (presentation only) */
  lockoutMessage?: string | null;
  /** Override default incorrect PIN message */
  errorMessage?: string | null;
  /** aria-labelledby target for screen readers */
  labelledBy?: string;
};

function isFailure(result: EnterprisePinPadCompleteResult): boolean {
  if (result === false) return true;
  if (result && typeof result === "object" && "ok" in result) return !result.ok;
  return false;
}

export function EnterprisePinPad({
  lang,
  onComplete,
  disabled = false,
  verifying = false,
  resetSignal,
  size = "tablet",
  className,
  lockoutMessage,
  errorMessage,
  labelledBy,
}: EnterprisePinPadProps) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [failed, setFailed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [internalVerifying, setInternalVerifying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  const blocked = disabled || verifying || internalVerifying || Boolean(lockoutMessage);
  const displayError = errorMessage ?? localError;

  const resetPad = useCallback(() => {
    setPin("");
    setFailed(false);
    setLocalError(null);
    setShake(false);
  }, []);

  useEffect(() => {
    resetPad();
  }, [resetSignal, resetPad]);

  const runFailure = useCallback(() => {
    void hapticPinError();
    setFailed(true);
    setShake(true);
    setLocalError(t(lang, "pinIncorrect"));
    setPin("");
    window.setTimeout(() => setShake(false), 400);
  }, [lang]);

  const submitPin = useCallback(
    async (nextPin: string) => {
      if (submittingRef.current || blocked) return;
      submittingRef.current = true;
      setInternalVerifying(true);
      setLocalError(null);
      setFailed(false);
      try {
        const result = await onComplete(nextPin);
        if (isFailure(result)) {
          runFailure();
        } else {
          setPin("");
        }
      } catch {
        runFailure();
      } finally {
        submittingRef.current = false;
        setInternalVerifying(false);
      }
    },
    [blocked, onComplete, runFailure],
  );

  const appendDigit = useCallback(
    (d: string) => {
      if (blocked) return;
      void hapticTap();
      setFailed(false);
      setLocalError(null);
      setPin((prev) => {
        if (prev.length >= ENTERPRISE_PIN_LENGTH) return prev;
        const next = prev + d;
        if (next.length === ENTERPRISE_PIN_LENGTH) {
          void submitPin(next);
        }
        return next;
      });
    },
    [blocked, submitPin],
  );

  const backspace = useCallback(() => {
    if (blocked) return;
    void hapticTap();
    setFailed(false);
    setLocalError(null);
    setPin((prev) => prev.slice(0, -1));
  }, [blocked]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (blocked) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        backspace();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [appendDigit, backspace, blocked]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const keyClass = clsx(
    "rounded-2xl border-2 font-black transition active:scale-[0.97] disabled:opacity-40 motion-reduce:active:scale-100",
    size === "desktop" && "min-h-[40px] text-lg",
    size === "tablet" && "min-h-[48px] text-xl",
    size === "mobile" && "min-h-[44px] text-xl",
    "border-border bg-card text-foreground dark:bg-foreground dark:text-background",
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={displayError ? "enterprise-pin-error" : undefined}
      className={clsx("space-y-4 outline-none", className)}
    >
      <div
        className={clsx(
          "flex items-center justify-center gap-3 motion-reduce:animate-none",
          shake && "animate-pin-shake",
        )}
        aria-hidden
      >
        {Array.from({ length: ENTERPRISE_PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              "h-3 w-3 rounded-full border-2 transition",
              failed
                ? "border-danger bg-danger-muted"
                : i < pin.length
                  ? "border-waka-600 bg-waka-600 dark:border-waka-400 dark:bg-waka-400"
                  : "border-border bg-transparent dark:border-border",
            )}
          />
        ))}
      </div>

      {(verifying || internalVerifying) && !displayError ? (
        <p className="text-center text-sm font-semibold text-muted-foreground" aria-live="polite">
          {t(lang, "biometricAuthenticating")}
        </p>
      ) : null}

      {lockoutMessage ? (
        <p className="rounded-xl border border-warning-muted bg-warning-muted px-3 py-2 text-center text-sm font-bold text-warning-foreground" aria-live="polite">
          {lockoutMessage}
        </p>
      ) : null}

      {displayError ? (
        <p
          id="enterprise-pin-error"
          className="rounded-xl border border-danger-muted bg-danger-muted px-3 py-2 text-center text-sm font-bold text-danger"
          role="alert"
          aria-live="assertive"
        >
          {displayError}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={blocked}
            className={keyClass}
            onClick={() => appendDigit(d)}
            aria-label={d}
          >
            {d}
          </button>
        ))}
        <span aria-hidden className="min-h-[44px]" />
        <button type="button" disabled={blocked} className={keyClass} onClick={() => appendDigit("0")} aria-label="0">
          0
        </button>
        <button
          type="button"
          disabled={blocked || pin.length === 0}
          className={clsx(keyClass, "border-transparent bg-transparent text-muted-foreground dark:text-muted-foreground")}
          onClick={backspace}
          aria-label={t(lang, "pinKeypadBackspace")}
        >
          <Delete className="mx-auto h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
