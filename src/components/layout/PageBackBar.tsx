import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
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

  const handleBack = useCallback(() => {
    const fallback = fallbackTo ?? getBackFallbackPath(location.pathname);
    if (historyCanGoBack()) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, location.pathname, fallbackTo]);

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold text-waka-800 active:opacity-70 ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {label ?? t(lang, "pageBack")}
    </button>
  );
}
