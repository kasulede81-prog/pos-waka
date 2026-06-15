import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { resolveHeaderBack } from "../../lib/headerBack";
import { historyCanGoBack } from "../../lib/navigationBack";

type Props = { lang: Language };

/** Fixed app header: back one level (folder / hub). Desktop lg+ only. */
export function HeaderBackButton({ lang }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = usePosDesktopLayout();
  const back = resolveHeaderBack(location.pathname, isDesktop);

  const handleBack = useCallback(() => {
    if (historyCanGoBack()) {
      navigate(-1);
    } else {
      navigate(back.fallback);
    }
  }, [navigate, back.fallback]);

  if (!back.show) return null;

  return (
    <button
      type="button"
      onClick={handleBack}
      className="hidden min-h-[38px] shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border border-waka-200 bg-waka-50 px-3 py-1.5 text-xs font-bold text-waka-900 shadow-sm transition-colors hover:border-waka-300 hover:bg-waka-100 active:bg-waka-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 lg:inline-flex lg:min-h-[44px] lg:gap-2 lg:px-4 lg:py-2 lg:text-sm"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {t(lang, back.labelKey)}
    </button>
  );
}
