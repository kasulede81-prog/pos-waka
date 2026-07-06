import clsx from "clsx";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hasPermission } from "../../lib/permissions";
import type { UserRole } from "../../types";
import {
  PHARMACY_MOBILE_NAV_CATALOG,
  pharmacyNavItemActive,
} from "../../lib/pharmacyNav";
import { LayoutGrid } from "lucide-react";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { confirmLeavePosIfNeeded } from "../../lib/posExitGuard";
import { isPosSellPath } from "../../lib/posSellExit";

type Props = {
  lang: Language;
  role: UserRole;
  visible: boolean;
};

export function PharmacyMobileNav({ lang, role, visible }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = usePosDesktopLayout();

  const items = PHARMACY_MOBILE_NAV_CATALOG.filter(
    (item) => !item.perm || hasPermission(role, item.perm),
  );

  const guardedNavigate = useCallback(
    (to: string) => {
      const onSell = isPosSellPath(location.pathname);
      const leavingSell = onSell && to !== location.pathname && !isPosSellPath(to);
      if (leavingSell) {
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
      className="fixed bottom-0 left-0 right-0 border-t border-teal-200/80 bg-white/98 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] backdrop-blur-md lg:hidden"
      style={{ zIndex: "var(--waka-z-bottom-nav)" }}
      aria-label={t(lang, "navGroupPharmacy")}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5 px-1 pt-1.5 pb-[max(0.375rem,var(--waka-safe-bottom))]">
        {items.map((item) => {
          const active = pharmacyNavItemActive(item.path, location.pathname);
          const Icon = item.Icon ?? LayoutGrid;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => guardedNavigate(item.path)}
              className={clsx(
                "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-black leading-tight transition-waka touch-manipulation",
                active
                  ? "bg-teal-600 text-white shadow-waka-sm"
                  : "text-stone-600 hover:bg-teal-50 active:bg-teal-100",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} aria-hidden />
              <span className="max-w-full truncate px-0.5">{t(lang, item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
