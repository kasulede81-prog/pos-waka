import type { FormEvent, ReactNode } from "react";
import { Scale } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { ModalSheet } from "../../layout/ModalSheet";
import { AdjustmentValidationBanner } from "./AdjustmentValidationBanner";
import { enterpriseTypeClass } from "../../../lib/enterpriseTypography";

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

/** Phase 31.1 — ModalSheet dialog policy for stock adjustments. */
export function StockAdjustmentShell({
  lang: _lang,
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
  void _lang;
  const banner = error ? (
    <AdjustmentValidationBanner message={error} tone="error" />
  ) : success ? (
    <AdjustmentValidationBanner message={success} tone="success" />
  ) : warning ? (
    <AdjustmentValidationBanner message={warning} tone="warning" />
  ) : null;

  const formBody = (
    <form className="space-y-5" onSubmit={onSubmit} noValidate>
      {statusStrip}
      {banner}
      {children}
    </form>
  );

  if (variant === "embedded") {
    if (!open) return null;
    return (
      <div className="space-y-4">
        <header>
          {subtitle ? <p className={enterpriseTypeClass("caption")}>{subtitle}</p> : null}
          <h2 id={titleId} className={enterpriseTypeClass("sectionTitle")}>
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
        {icon ?? <Scale className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {subtitle ? <p className={enterpriseTypeClass("caption")}>{subtitle}</p> : null}
        <h2 id={titleId} className={clsx(enterpriseTypeClass("sectionTitle"), "truncate")}>
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
    </ModalSheet>
  );
}
