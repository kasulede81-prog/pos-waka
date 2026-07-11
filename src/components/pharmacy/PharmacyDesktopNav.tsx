import clsx from "clsx";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { hasActorPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";
import {
  PHARMACY_HOME_ROUTE,
  PHARMACY_NAV_CATALOG,
  PHARMACY_NAV_ICONS,
  pharmacyNavItemActive,
} from "../../lib/pharmacyNav";
import { confirmLeavePosIfNeeded } from "../../lib/posExitGuard";
import { isPosSellPath } from "../../lib/posSellExit";

type Props = {
  lang: Language;
  visible: boolean;
};

export function PharmacyDesktopNav({ lang, visible }: Props) {
  const actor = useSessionActor();
  const location = useLocation();
  const navigate = useNavigate();

  const items = PHARMACY_NAV_CATALOG.filter((item) => {
    if (item.path === PHARMACY_HOME_ROUTE && location.pathname === PHARMACY_HOME_ROUTE) return false;
    return !item.perm || hasActorPermission(actor.role, item.perm, actor.permissions);
  });

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

  if (!visible || items.length === 0) return null;

  return (
    <nav
      className="relative z-10 shrink-0 border-b border-teal-200/70 bg-teal-50/90 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-teal-50/80 sm:px-4 lg:px-8 xl:px-10"
      aria-label={t(lang, "navGroupPharmacy")}
    >
      <div className="mx-auto flex max-w-none gap-1.5 overflow-x-auto pb-0.5">
        {items.map((item) => {
          const active = pharmacyNavItemActive(item.path, location.pathname);
          const Icon = PHARMACY_NAV_ICONS[item.path];
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => guardedNavigate(item.path)}
              className={clsx(
                "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition-waka touch-manipulation",
                active
                  ? "bg-teal-600 text-white shadow-waka-sm"
                  : "border border-teal-200/80 bg-card text-foreground hover:bg-teal-100/60",
              )}
            >
              {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden /> : null}
              {t(lang, item.labelKey)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
