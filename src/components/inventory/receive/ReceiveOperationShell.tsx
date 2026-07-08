import type { FormEvent, ReactNode } from "react";
import { Package, X } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { ReceiveValidationBanner } from "./ReceiveValidationBanner";

type Props = {
  lang: Language;
  variant?: "modal" | "page";
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
  pageClassName?: string;
};

export function ReceiveOperationShell({
  lang,
  variant = "modal",
  open = true,
  title,
  subtitle,
  titleId = "receive-operation-title",
  error,
  success,
  warning,
  children,
  footer,
  statusStrip,
  onSubmit,
  onRequestClose,
  zClassName = "z-[60]",
  icon,
  pageClassName,
}: Props) {
  const banner = error ? (
    <ReceiveValidationBanner message={error} tone="error" />
  ) : success ? (
    <ReceiveValidationBanner message={success} tone="success" />
  ) : warning ? (
    <ReceiveValidationBanner message={warning} tone="warning" />
  ) : null;

  const body = (
    <>
      {variant === "modal" || title ? (
        <header className={clsx(variant === "modal" && "shrink-0 border-b border-border/60 bg-card/95 px-4 pb-4 pt-4 backdrop-blur-md sm:px-5")}>
        <div className="flex items-start gap-3">
          {variant === "modal" ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
              {icon ?? <Package className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
            </span>
          ) : null}
          <div className="min-w-0 flex-1 pt-0.5">
            {subtitle ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{subtitle}</p>
            ) : null}
            <h2 id={titleId} className={clsx("font-black tracking-tight text-foreground", variant === "modal" ? "truncate text-lg" : "text-xl")}>
              {title}
            </h2>
          </div>
          {variant === "modal" && onRequestClose ? (
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
      ) : null}

      <form
        className={clsx("flex flex-col", variant === "modal" && "min-h-0 flex-1")}
        onSubmit={onSubmit}
        noValidate
      >
        <div
          className={clsx(
            "space-y-5",
            variant === "modal" && "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5",
            variant === "page" && "pb-4",
          )}
        >
          {statusStrip}
          {banner}
          {children}
        </div>
        {footer}
      </form>
    </>
  );

  if (variant === "page") {
    if (!open) return null;
    return <div className={clsx("space-y-4", pageClassName)}>{body}</div>;
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
