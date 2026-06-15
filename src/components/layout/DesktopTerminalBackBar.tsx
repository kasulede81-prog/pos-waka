import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";

type Props = { lang: Language };

/** Fixed app header: return to terminal launcher. */
export function HeaderExitButton({ lang }: Props) {
  const location = useLocation();

  return (
    <Link
      to={POS_HOME_ROUTE}
      state={{ from: location.pathname }}
      className="inline-flex min-h-[38px] shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 active:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 lg:min-h-[44px] lg:gap-2 lg:px-4 lg:py-2 lg:text-sm"
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {t(lang, "posNavExit")}
    </Link>
  );
}

/** @deprecated Use HeaderExitButton in AppShell header. */
export function DesktopTerminalBackBar(props: Props) {
  return <HeaderExitButton {...props} />;
}
