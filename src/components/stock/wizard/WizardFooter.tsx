import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_BTN_FOOTER_BASE } from "./wizardTokens";

export type WizardFooterProps = {
  lang: Language;
  isLastStep: boolean;
  canGoBack: boolean;
  canProceed: boolean;
  disabled?: boolean;
  onBack: () => void;
  onPrimary: () => void;
  onAddAnother?: () => void;
  isEdit?: boolean;
  primaryLabelKey?: string;
  nextLabelKey?: string;
  showAddAnother?: boolean;
  primaryType?: "submit" | "button";
};

export function WizardFooter({
  lang,
  isLastStep,
  canGoBack,
  canProceed,
  disabled,
  onBack,
  onPrimary,
  onAddAnother,
  isEdit,
  primaryLabelKey,
  nextLabelKey,
  showAddAnother,
  primaryType = "submit",
}: WizardFooterProps) {
  if (isLastStep) {
    return (
      <footer className="shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5">
        <div className="space-y-2.5">
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onBack}
              disabled={!canGoBack}
              className={clsx(
                WIZARD_BTN_FOOTER_BASE,
                "min-w-[52px] shrink-0 border border-border bg-card px-4 text-foreground shadow-sm hover:bg-muted",
              )}
              aria-label={t(lang, "simpleAddBack")}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type={primaryType}
              disabled={disabled || !canProceed}
              onClick={primaryType === "button" ? onPrimary : undefined}
              className={clsx(
                WIZARD_BTN_FOOTER_BASE,
                "flex-1 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
              )}
            >
              {t(lang, primaryLabelKey ?? (isEdit ? "simpleAddSaveChanges" : "simpleAddSave"))}
            </button>
          </div>
          {showAddAnother && !isEdit && onAddAnother ? (
            <button
              type="button"
              disabled={disabled || !canProceed}
              onClick={onAddAnother}
              className={clsx(
                WIZARD_BTN_FOOTER_BASE,
                "w-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10",
              )}
            >
              {t(lang, "simpleAddAddAnother")}
            </button>
          ) : null}
        </div>
      </footer>
    );
  }

  return (
    <footer className="shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5">
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className={clsx(
            WIZARD_BTN_FOOTER_BASE,
            "min-w-[52px] shrink-0 border border-border bg-card px-4 text-foreground shadow-sm hover:bg-muted",
          )}
          aria-label={t(lang, "simpleAddBack")}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type={primaryType}
          disabled={!canProceed}
          onClick={primaryType === "button" ? onPrimary : undefined}
          className={clsx(
            WIZARD_BTN_FOOTER_BASE,
            "flex-1 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
          )}
        >
          {t(lang, nextLabelKey ?? "simpleAddNext")}
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </footer>
  );
}
