import type { FormEvent, ReactNode } from "react";
import { Scale, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { AdjustmentValidationBanner } from "./AdjustmentValidationBanner";

type Props = {
  lang: Language;
  variant?: "modal" | "embedded";
  open?: boolean;
  title: string;
  subtitle?: string;
  titleId?: string;
  error?: string | null;
  success?: string | null;
  warning?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  statusStrip?: ReactNode;
  onSubmit?: (e: FormEvent) => void;
  onRequestClose?: () => void;
  zClassName?: string;
  icon?: ReactNode;
};

export function StockAdjustmentShell({
  lang,
  variant = "modal",
  open = true,
  title,
  subtitle,
  titleId = "stock-adjustment-title",
  error,
  success,
  warning,
  children,
  footer,
  statusStrip,
  onSubmit,
  onRequestClose,
  zClassName = "z-[65]",
  icon,
}: Props) {
  const banner = error ? (
    <AdjustmentValidationBanner message={error} tone="error" />
  ) : success ? (
    <AdjustmentValidationBanner message={success} tone="success" />
  ) : warning ? (
    <AdjustmentValidationBanner message={warning} tone="warning" />
  ) : null;

  const body = (
    <>
      <header className="shrink-0 border-b border-border/60 bg-card/95 px-4 pb-4 pt-4 backdrop-blur-md sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
            {icon ?? <Scale className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            {subtitle ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{subtitle}</p>
            ) : null}
            <h2 id={titleId} className="truncate text-lg font-black tracking-tight text-foreground">
              {title}
            </h2>
          </div>
          {onRequestClose ? (
            <button
              type="button"
              onClick={onRequestClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t(lang, "cancel")}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit} noValidate>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
          {statusStrip}
          {banner}
          {children}
        </div>
        {footer}
      </form>
    </>
  );

  if (variant === "embedded") {
    if (!open) return null;
    return <div className="space-y-4">{body}</div>;
  }

  if (!open) return null;

  return (
    <AppModalOverlay
      className={clsx(zClassName, "flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center")}
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
      onClick={onRequestClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-border/60 bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </AppModalOverlay>
  );
}
