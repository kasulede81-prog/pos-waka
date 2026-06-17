import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";

type Props = { lang: Language };

/** Fixed app header: return to terminal launcher (desktop / sell). */
export function HeaderExitButton({ lang, className = "" }: Props & { className?: string }) {
  const location = useLocation();

  return (
    <Link
      to={POS_HOME_ROUTE}
      state={{ from: location.pathname }}
      className={`inline-flex min-h-[38px] shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border border-red-700 bg-red-600 px-3 py-1.5 text-xs font-black text-white shadow-[0_4px_14px_rgba(220,38,38,0.35)] transition-colors hover:border-red-800 hover:bg-red-700 active:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 lg:min-h-[44px] lg:gap-2 lg:px-4 lg:py-2 lg:text-sm ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
      {t(lang, "posNavExit")}
    </Link>
  );
}

/** @deprecated Use HeaderExitButton in AppShell header. */
export function DesktopTerminalBackBar(props: Props) {
  return <HeaderExitButton {...props} />;
}
