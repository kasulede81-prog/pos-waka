import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Package, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { WizardProgress } from "./WizardProgress";
import { WizardValidationBanner } from "./WizardValidationBanner";
import { enterpriseTypeClass } from "../../../lib/enterpriseTypography";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  descId?: string;
  stepIndex: number;
  totalSteps: number;
  icon?: ReactNode;
  saveError?: string | null;
  savedFlash?: boolean;
  savedMessage?: string;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  zClassName?: string;
};

/**
 * Add/edit product wizard chrome — full-height form with sticky footer.
 * Portaled to document.body so hub sticky tabs cannot cover the dialog.
 */
export function ProductWizardShell({
  lang,
  open,
  onClose,
  title,
  titleId = "product-wizard-title",
  descId = "product-wizard-desc",
  stepIndex,
  totalSteps,
  icon,
  saveError,
  savedFlash,
  savedMessage,
  children,
  footer,
  onSubmit,
  zClassName = "z-[80]",
}: Props) {
  if (!open) return null;

  return createPortal(
    <AppModalOverlay
      className={clsx(
        zClassName,
        "flex items-end justify-center bg-overlay/50 backdrop-blur-[2px] sm:items-center",
      )}
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClick={onClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-border/60 bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border/60 bg-card/95 px-4 pb-4 pt-4 backdrop-blur-md sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-elev">
              {icon ?? <Package className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p id={descId} className={enterpriseTypeClass("caption")}>
                {tTemplate(lang, "simpleAddStepOf", {
                  n: String(stepIndex + 1),
                  total: String(totalSteps),
                })}
              </p>
              <h2 id={titleId} className={enterpriseTypeClass("sectionTitle", "truncate text-lg")}>
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t(lang, "cancel")}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <WizardProgress lang={lang} stepIndex={stepIndex} totalSteps={totalSteps} />
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit} noValidate>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
            {saveError ? <WizardValidationBanner message={saveError} /> : null}
            {savedFlash ? (
              <div
                className="wizard-success-enter flex flex-col items-center gap-3 rounded-2xl border border-success/25 bg-success-muted/10 px-6 py-8 text-center"
                role="status"
              >
                <span className="wizard-check-pop flex h-14 w-14 items-center justify-center rounded-full bg-success-muted/15 text-success">
                  <CheckCircle2 className="h-8 w-8" strokeWidth={2.25} aria-hidden />
                </span>
                <p className="text-lg font-bold text-success">{savedMessage ?? t(lang, "simpleAddSaved")}</p>
              </div>
            ) : (
              children
            )}
          </div>
          {!savedFlash && footer ? footer : null}
        </form>
      </div>
    </AppModalOverlay>,
    document.body,
  );
}
