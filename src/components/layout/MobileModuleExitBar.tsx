import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { resolveModuleExit } from "../../lib/moduleExit";
import { historyCanGoBack } from "../../lib/navigationBack";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";

type Props = { lang: Language };

export function MobileModuleExitBar({ lang }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = usePosDesktopLayout();
  const exit = resolveModuleExit(location.pathname);

  const handleClick = useCallback(() => {
    if (!exit) return;
    if (exit.preferHistoryBack && historyCanGoBack()) {
      navigate(-1);
      return;
    }
    navigate(exit.fallbackTo, { preventScrollReset: true });
  }, [exit, navigate]);

  if (isDesktop || !exit) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 border-t border-rose-300/60 bg-rose-50/95 px-3 pt-2 pb-[max(0.625rem,var(--waka-safe-bottom))] shadow-[0_-6px_28px_rgba(220,38,38,0.18)] backdrop-blur lg:hidden"
      style={{ zIndex: "var(--waka-z-bottom-nav)" }}
    >
      <button
        type="button"
        onClick={handleClick}
        className="mx-auto flex min-h-[52px] w-full max-w-lg touch-manipulation items-center justify-center gap-2.5 rounded-2xl bg-red-600 px-5 py-3 text-base font-black text-white shadow-[0_6px_20px_rgba(220,38,38,0.45)] transition-waka hover:bg-red-700 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-5 w-5 shrink-0" strokeWidth={2.75} aria-hidden />
        {t(lang, exit.labelKey)}
      </button>
    </div>
  );
}
