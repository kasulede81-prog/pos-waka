import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { getBackFallbackPath, historyCanGoBack } from "../../lib/navigationBack";

type Props = {
  lang: Language;
  /** Override fallback when history cannot go back */
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

  const displayLabel =
    label ??
    (isDesktopTerminal && !location.pathname.startsWith("/settings/")
      ? t(lang, "posNavMainMenu")
      : t(lang, "pageBack"));

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-waka-800 active:opacity-70 lg:hidden ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {displayLabel}
    </button>
  );
}
