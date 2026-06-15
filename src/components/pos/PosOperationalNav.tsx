import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Home, ShoppingCart, Receipt, Briefcase, type LucideIcon } from "lucide-react";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { confirmLeaveActiveSaleIfNeeded } from "../../lib/posLeaveGuard";
import { usePosStore } from "../../store/usePosStore";
import {
  POS_HOME_ROUTE,
  POS_RECEIPTS_ROUTE,
  POS_SELL_ROUTE,
  POS_SHOP_ROUTE,
} from "../../lib/posNavigation";

type NavItem = {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  perm?: Permission;
};

type Props = {
  lang: Language;
  sellLabelKey: string;
};

function navActive(path: string, pathname: string): boolean {
  if (path === POS_SHOP_ROUTE) {
    return pathname === POS_SHOP_ROUTE || pathname.startsWith(`${POS_SHOP_ROUTE}/`);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Desktop in-POS nav: Home · Sell · Sales History · Shop (lg+ only). */
export function PosOperationalNav({ lang, sellLabelKey }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const actor = useSessionActor();
  const draftLineCount = usePosStore((s) => s.draftLines.length);

  const items: NavItem[] = [
    { path: POS_HOME_ROUTE, labelKey: "posNavMainMenu", Icon: Home },
    { path: POS_SELL_ROUTE, labelKey: sellLabelKey, Icon: ShoppingCart, perm: "pos.sell" as Permission },
    { path: POS_RECEIPTS_ROUTE, labelKey: "receipts", Icon: Receipt, perm: "receipts.view" as Permission },
    { path: POS_SHOP_ROUTE, labelKey: "officeHubNav", Icon: Briefcase, perm: "back_office.access" as Permission },
  ].filter((item) => !item.perm || hasPermission(actor.role, item.perm));

  const guardedNavigate = useCallback(
    (to: string) => {
      const onPos = location.pathname === POS_SELL_ROUTE || location.pathname.startsWith(`${POS_SELL_ROUTE}/`);
      const leavingPos = onPos && draftLineCount > 0 && to !== location.pathname && !to.startsWith(POS_SELL_ROUTE);
      if (leavingPos) {
        void confirmLeaveActiveSaleIfNeeded().then((ok) => {
          if (ok) navigate(to, { preventScrollReset: true });
        });
        return;
      }
      navigate(to, { preventScrollReset: true });
    },
    [draftLineCount, location.pathname, navigate],
  );

  if (items.length === 0) return null;

  return (
    <nav
      className="hidden lg:block"
      aria-label={t(lang, "posOperationalNavLabel")}
    >
      <ul className="flex flex-wrap gap-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-waka-sm">
        {items.map(({ path, labelKey, Icon }) => {
          const active = navActive(path, location.pathname);
          const isSell = path === POS_SELL_ROUTE;
          return (
            <li key={path}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => guardedNavigate(path)}
                className={clsx(
                  "flex min-h-[48px] min-w-[7.5rem] touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-waka focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
                  active
                    ? "bg-waka-600 text-white shadow-waka-sm"
                    : "text-stone-700 hover:bg-waka-50",
                  isSell && !active && "font-black",
                )}
              >
                <Icon
                  className={isSell ? "h-6 w-6 shrink-0" : "h-5 w-5 shrink-0"}
                  strokeWidth={isSell ? 2.5 : 2.25}
                  aria-hidden
                />
                {t(lang, labelKey)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
