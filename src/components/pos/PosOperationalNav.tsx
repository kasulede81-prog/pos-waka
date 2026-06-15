import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { confirmLeaveActiveSaleIfNeeded } from "../../lib/posLeaveGuard";
import { lockPosAfterSellExit } from "../../lib/posSellExit";
import { usePosStore } from "../../store/usePosStore";
import { POS_HOME_ROUTE, POS_SELL_ROUTE } from "../../lib/posNavigation";

type Props = {
  lang: Language;
  sellLabelKey: string;
};

/** Desktop in-POS nav: Exit · Sell (lg+ only). Mobile unchanged. */
export function PosOperationalNav({ lang, sellLabelKey }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const actor = useSessionActor();
  const draftLineCount = usePosStore((s) => s.draftLines.length);
  const canSell = hasPermission(actor.role, "pos.sell");
  const onSell = location.pathname === POS_SELL_ROUTE || location.pathname.startsWith(`${POS_SELL_ROUTE}/`);

  const guardedNavigate = useCallback(
    (to: string) => {
      const leavingPos =
        onSell && draftLineCount > 0 && to !== location.pathname && !to.startsWith(POS_SELL_ROUTE);
      if (leavingPos) {
        void confirmLeaveActiveSaleIfNeeded().then((ok) => {
          if (ok) {
            lockPosAfterSellExit();
            navigate(to, { preventScrollReset: true });
          }
        });
        return;
      }
      navigate(to, { preventScrollReset: true });
    },
    [draftLineCount, location.pathname, navigate, onSell],
  );

  if (!canSell) return null;

  return (
    <nav className="hidden lg:block" aria-label={t(lang, "posOperationalNavLabel")}>
      <ul className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-waka-sm">
        <li>
          <button
            type="button"
            onClick={() => guardedNavigate(POS_HOME_ROUTE)}
            className="flex min-h-[48px] min-w-[7.5rem] touch-manipulation items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-700 transition-waka hover:border-stone-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden />
            {t(lang, "posNavExit")}
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-current="page"
            onClick={() => guardedNavigate(POS_SELL_ROUTE)}
            className={clsx(
              "flex min-h-[48px] min-w-[7.5rem] touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition-waka focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2",
              onSell ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700 hover:bg-waka-50",
            )}
          >
            <ShoppingCart className="h-6 w-6 shrink-0" strokeWidth={2.5} aria-hidden />
            {t(lang, sellLabelKey)}
          </button>
        </li>
      </ul>
    </nav>
  );
}
