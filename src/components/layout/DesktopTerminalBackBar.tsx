import { useCallback, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { POS_HOME_ROUTE } from "../../lib/posNavigation";
import { confirmLeavePosIfNeeded } from "../../lib/posExitGuard";

type Props = { lang: Language };

/** Fixed app header: return to terminal launcher (desktop / sell). */
export function HeaderExitButton({
  lang,
  className = "",
  variant = "default",
}: Props & { className?: string; variant?: "default" | "sellOrange" }) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleClick = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      void confirmLeavePosIfNeeded(location.pathname, POS_HOME_ROUTE).then((ok) => {
        if (ok) navigate(POS_HOME_ROUTE, { state: { from: location.pathname } });
      });
    },
    [location.pathname, navigate],
  );

  return (
    <a
      href={POS_HOME_ROUTE}
      onClick={handleClick}
      className={`inline-flex min-h-[38px] shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 lg:min-h-[44px] lg:gap-2 lg:px-4 lg:py-2 lg:text-sm ${
        variant === "sellOrange"
          ? "border-waka-600 bg-waka-600 shadow-[0_4px_14px_rgba(249,115,22,0.35)] hover:border-waka-700 hover:bg-waka-700 active:bg-waka-800 focus-visible:ring-waka-500"
          : "border-red-700 bg-red-600 shadow-[0_4px_14px_rgba(220,38,38,0.35)] hover:border-red-800 hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500"
      } ${className}`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
      {t(lang, "posNavExit")}
    </a>
  );
}

/** @deprecated Use HeaderExitButton in AppShell header. */
export function DesktopTerminalBackBar(props: Props) {
  return <HeaderExitButton {...props} />;
}
