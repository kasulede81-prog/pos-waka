import clsx from "clsx";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hasPermission } from "../../lib/permissions";
import type { UserRole } from "../../types";
import {
  HOSPITALITY_NAV_CATALOG,
  hospitalityNavItemActive,
} from "../../lib/hospitalityNav";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { confirmLeavePosIfNeeded } from "../../lib/posExitGuard";

type Props = {
  lang: Language;
  role: UserRole;
  visible: boolean;
};

export function HospitalityMobileNav({ lang, role, visible }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = usePosDesktopLayout();

  const items = HOSPITALITY_NAV_CATALOG.filter((item) => hasPermission(role, item.perm));

  const guardedNavigate = useCallback(
    (to: string) => {
      const onPos = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
      const leavingPos = onPos && to !== location.pathname && !to.startsWith("/pos");
      if (leavingPos) {
        void confirmLeavePosIfNeeded(location.pathname, to).then((ok) => {
          if (ok) navigate(to, { preventScrollReset: true });
        });
        return;
      }
      navigate(to, { preventScrollReset: true });
    },
    [location.pathname, navigate],
  );

  if (isDesktop || !visible || items.length === 0) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t border-waka-200/80 bg-white/98 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-md md:hidden"
      style={{ zIndex: "var(--waka-z-bottom-nav)" }}
      aria-label={t(lang, "navGroupHospitality")}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5 px-1 pt-1.5 pb-[max(0.375rem,var(--waka-safe-bottom))]">
        {items.map((item) => {
          const active = hospitalityNavItemActive(item.path, location.pathname);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => guardedNavigate(item.path)}
              className={clsx(
                "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-black leading-tight transition-waka touch-manipulation",
                active
                  ? "bg-waka-600 text-white shadow-waka-sm"
                  : "text-stone-600 hover:bg-waka-50 active:bg-waka-100",
              )}
            >
              <item.Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} aria-hidden />
              <span className="max-w-full truncate px-0.5">{t(lang, item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
