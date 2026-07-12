import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { labelKeyForBackFallback, resolveHeaderBack, shouldHidePageBackBar } from "../../lib/headerBack";
import { getBackFallbackPath, historyCanGoBack } from "../../lib/navigationBack";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { themeUi } from "../../lib/themeTokens";

export type EnterpriseNavBackVariant = "inline" | "header" | "exit";

type Props = {
  lang: Language;
  variant?: EnterpriseNavBackVariant;
  fallbackTo?: string;
  label?: string;
  className?: string;
};

/**
 * Unified enterprise back / exit navigation (Phase 22.2).
 * Replaces PageBackBar, SettingsPageHeader back, HeaderBackButton styling drift.
 */
export function EnterpriseNavBack({
  lang,
  variant = "inline",
  fallbackTo,
  label,
  className,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktopTerminal = usePosDesktopLayout();

  const headerBack = resolveHeaderBack(location.pathname, isDesktopTerminal);
  const resolvedFallback =
    fallbackTo ?? getBackFallbackPath(location.pathname, { desktopTerminal: isDesktopTerminal });
  const displayLabel =
    label ??
    (variant === "header"
      ? t(lang, headerBack.labelKey)
      : t(lang, labelKeyForBackFallback(resolvedFallback, location.pathname)));

  const handleBack = useCallback(() => {
    const fallback =
      fallbackTo ?? getBackFallbackPath(location.pathname, { desktopTerminal: isDesktopTerminal });
    if (variant === "header" && !headerBack.show) return;
    if (historyCanGoBack()) navigate(-1);
    else navigate(variant === "header" ? headerBack.fallback : fallback);
  }, [navigate, location.pathname, fallbackTo, isDesktopTerminal, variant, headerBack]);

  if (variant === "inline" && shouldHidePageBackBar(location.pathname, isDesktopTerminal)) {
    return null;
  }

  if (variant === "header" && !headerBack.show) {
    return null;
  }

  const baseClass =
    variant === "header"
      ? clsx(
          "hidden touch-manipulation items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 shadow-sm md:inline-flex",
          "min-h-[44px] text-sm font-bold text-foreground",
          enterpriseMotion.standard,
          "hover:bg-muted active:bg-muted/80",
          themeUi.focusRing,
        )
      : clsx(themeUi.backLink, themeUi.focusRing, enterpriseMotion.standard);

  return (
    <button type="button" onClick={handleBack} className={clsx(baseClass, className)}>
      <ArrowLeft
        className={enterpriseIconClass(variant === "header" ? "sm" : "sm")}
        strokeWidth={ENTERPRISE_ICON_STROKE}
        aria-hidden
      />
      <span className={variant === "header" ? enterpriseTypeClass("body", "!text-sm !font-bold") : undefined}>
        {displayLabel}
      </span>
    </button>
  );
}
