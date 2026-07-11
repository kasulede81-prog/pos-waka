import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { saveIndicatorClasses } from "../../lib/statusTokens";

export type EnterpriseSaveMode = "auto" | "explicit";

export type EnterpriseSaveIndicatorProps = {
  lang: Language;
  mode: EnterpriseSaveMode;
  /** auto: idle | saving | saved | pending. explicit: mirrors dirty state. */
  status: "idle" | "saving" | "saved" | "pending" | "dirty";
  className?: string;
};

export function EnterpriseSaveIndicator({ lang, mode, status, className }: EnterpriseSaveIndicatorProps) {
  if (status === "idle") return null;

  const label =
    mode === "auto"
      ? status === "saving"
        ? t(lang, "enterpriseSaving")
        : status === "saved"
          ? t(lang, "enterpriseSaved")
          : status === "pending"
            ? t(lang, "enterpriseChangesPending")
            : null
      : status === "dirty"
        ? t(lang, "enterpriseUnsavedChanges")
        : status === "saving"
          ? t(lang, "enterpriseSaving")
          : status === "saved"
            ? t(lang, "enterpriseSaved")
            : null;

  if (!label) return null;

  const chipStatus =
    status === "saved" ? "saved" : status === "saving" ? "saving" : status === "dirty" ? "dirty" : "pending";

  return (
    <span className={clsx(saveIndicatorClasses(chipStatus), className)} role="status" aria-live="polite">
      {status === "saving" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : status === "saved" ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : null}
      {label}
    </span>
  );
}
