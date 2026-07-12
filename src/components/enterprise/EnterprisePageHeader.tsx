import type { ReactNode } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { EnterpriseNavBack } from "./EnterpriseNavBack";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backFallback?: string;
  backLabel?: string;
  showBack?: boolean;
  /** Settings hub style — page title without sm: bump on mobile */
  compact?: boolean;
  children?: ReactNode;
  className?: string;
};

/**
 * Unified page header — typography + back navigation (Phase 22.2).
 */
export function EnterprisePageHeader({
  lang,
  title,
  subtitle,
  backFallback,
  backLabel,
  showBack = true,
  compact = false,
  children,
  className,
}: Props) {
  return (
    <header className={clsx(compact ? "space-y-2" : "space-y-3", className)}>
      {showBack ? (
        <EnterpriseNavBack lang={lang} variant="inline" fallbackTo={backFallback} label={backLabel} />
      ) : null}
      <div>
        <h1 className={enterpriseTypeClass(compact ? "pageTitle" : "pageTitle")}>{title}</h1>
        {subtitle ? (
          <p className={clsx(enterpriseTypeClass("body", "mt-1 !font-medium text-muted-foreground"))}>{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}
