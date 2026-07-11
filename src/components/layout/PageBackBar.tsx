import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { labelKeyForBackFallback, shouldHidePageBackBar } from "../../lib/headerBack";
import { getBackFallbackPath, historyCanGoBack } from "../../lib/navigationBack";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  fallbackTo?: string;
  label?: string;
  className?: string;
};

export function PageBackBar({ lang, fallbackTo, label, className = "" }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktopTerminal = usePosDesktopLayout();

  const handleBack = useCallback(() => {
    const fallback =
      fallbackTo ?? getBackFallbackPath(location.pathname, { desktopTerminal: isDesktopTerminal });
    if (historyCanGoBack()) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, location.pathname, fallbackTo, isDesktopTerminal]);

  const resolvedFallback =
    fallbackTo ?? getBackFallbackPath(location.pathname, { desktopTerminal: isDesktopTerminal });
  const displayLabel =
    label ?? t(lang, labelKeyForBackFallback(resolvedFallback, location.pathname));

  if (shouldHidePageBackBar(location.pathname, isDesktopTerminal)) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={clsx(themeUi.backLink, themeUi.focusRing, className)}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {displayLabel}
    </button>
  );
}
