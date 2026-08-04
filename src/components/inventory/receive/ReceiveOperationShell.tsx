import type { FormEvent, ReactNode } from "react";
import { Package } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ModalSheet } from "../../layout/ModalSheet";
import { ReceiveValidationBanner } from "./ReceiveValidationBanner";
import { enterpriseTypeClass } from "../../../lib/enterpriseTypography";

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

/**
 * Shared receive chrome — Phase 31.1 uses ModalSheet (dialog policy), not AppModalOverlay.
 * Used by purchase multi-line receive and SKU restock.
 */
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

  const formBody = (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      {statusStrip}
      {banner}
      {children}
    </form>
  );

  if (variant === "page") {
    if (!open) return null;
    return (
      <div className={clsx("space-y-4", pageClassName)}>
        <header>
          {subtitle ? <p className={enterpriseTypeClass("caption")}>{subtitle}</p> : null}
          <h2 id={titleId} className={enterpriseTypeClass("pageTitle")}>
            {title}
          </h2>
        </header>
        {formBody}
        {footer}
      </div>
    );
  }

  const titleNode = (
    <div className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-elev">
        {icon ?? <Package className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {subtitle ? <p className={enterpriseTypeClass("caption")}>{subtitle}</p> : null}
        <h2 id={titleId} className={enterpriseTypeClass("sectionTitle")}>
          {title}
        </h2>
      </div>
    </div>
  );

  return (
    <ModalSheet
      open={open}
      onClose={onRequestClose ?? (() => undefined)}
      title={titleNode}
      footer={footer}
      zIndexClass={zClassName}
      maxHeightClass="max-h-[min(94dvh,900px)]"
      panelClassName="sm:max-w-lg"
      aria-labelledby={titleId}
    >
      {formBody}
      <span className="sr-only">{t(lang, "cancel")}</span>
    </ModalSheet>
  );
}
