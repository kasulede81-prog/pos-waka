import type { Language } from "../../types";
import { tTemplate } from "../../lib/i18n";

type LockoutBannerProps = {
  lang: Language;
  locked: boolean;
  waitSeconds?: number;
  attemptsRemaining?: number;
  className?: string;
};

/** Unified lockout presentation — does not change lockout policy, only messaging. */
export function EnterpriseLockoutBanner({
  lang,
  locked,
  waitSeconds = 0,
  attemptsRemaining,
  className,
}: LockoutBannerProps) {
  if (locked && waitSeconds > 0) {
    return (
      <p
        className={className ?? "rounded-xl border border-warning-muted bg-warning-muted px-3 py-2 text-sm font-bold text-warning-foreground"}
        role="alert"
        aria-live="assertive"
      >
        {tTemplate(lang, "staffUnlockBruteForceLock", { seconds: String(waitSeconds) })}
      </p>
    );
  }

  if (typeof attemptsRemaining === "number" && attemptsRemaining > 0 && attemptsRemaining < 5) {
    return (
      <p className={className ?? "text-sm font-semibold text-muted-foreground"} role="status" aria-live="polite">
        {tTemplate(lang, "enterpriseAuthAttemptsRemaining", { count: String(attemptsRemaining) })}
      </p>
    );
  }

  return null;
}

export function formatUnlockLockoutMessage(lang: Language, waitSeconds: number): string {
  return tTemplate(lang, "staffUnlockBruteForceLock", { seconds: String(waitSeconds) });
}
