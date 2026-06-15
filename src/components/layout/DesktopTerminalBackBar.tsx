import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";

type Props = { lang: Language };

/** Desktop terminal: return to launcher (lg+ only). */
export function DesktopTerminalBackBar({ lang }: Props) {
  const location = useLocation();

  return (
    <div className="mb-4 hidden border-b border-stone-200/80 pb-3 lg:block">
      <Link
        to={POS_HOME_ROUTE}
        state={{ from: location.pathname }}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-800 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        {t(lang, "posNavMainMenu")}
      </Link>
    </div>
  );
}
