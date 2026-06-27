import { Link } from "react-router-dom";
import {
  Banknote,
  BarChart3,
  CloudUpload,
  Package,
  Search,
  Shield,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = { lang: Language };

type Action = {
  to: string;
  labelKey: string;
  icon: typeof ShoppingCart;
  bg: string;
};

const ACTIONS: Action[] = [
  { to: "/pos", labelKey: "cmdCenterActionNewSale", icon: ShoppingCart, bg: "bg-waka-100 text-waka-700" },
  { to: "/debts", labelKey: "cmdCenterActionReceiveDebt", icon: Wallet, bg: "bg-teal-100 text-teal-700" },
  { to: "/stock", labelKey: "cmdCenterActionAddProduct", icon: Package, bg: "bg-sky-100 text-sky-700" },
  { to: "/stock", labelKey: "cmdCenterActionInventoryCount", icon: Search, bg: "bg-indigo-100 text-indigo-700" },
  { to: "/office/cash-position", labelKey: "cmdCenterActionCashControl", icon: Banknote, bg: "bg-emerald-100 text-emerald-700" },
  { to: "/reports", labelKey: "cmdCenterActionReports", icon: BarChart3, bg: "bg-violet-100 text-violet-700" },
  { to: "/office/audit-center", labelKey: "cmdCenterActionInvestigation", icon: Shield, bg: "bg-rose-100 text-rose-700" },
  { to: "/office/backup", labelKey: "cmdCenterActionBackup", icon: CloudUpload, bg: "bg-amber-100 text-amber-800" },
];

export function CommandCenterQuickActions({ lang }: Props) {
  return (
    <section className="rounded-3xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "cmdCenterQuickActionsTitle")}</h2>
      <ul className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-4">
        {ACTIONS.map((action) => (
          <li key={action.labelKey}>
            <Link
              to={action.to}
              className="flex flex-col items-center gap-1.5 rounded-2xl p-1 transition active:scale-95"
            >
              <span className={clsx("flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm", action.bg)}>
                <action.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-center text-[10px] font-bold leading-tight text-stone-700">{t(lang, action.labelKey)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
