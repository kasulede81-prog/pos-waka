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
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption } from "../enterprise/EnterpriseTypography";
import { statusTokens } from "../../lib/statusTokens";

type Props = { lang: Language };

type Action = {
  to: string;
  labelKey: string;
  icon: typeof ShoppingCart;
  tone: keyof typeof statusTokens;
};

const ACTIONS: Action[] = [
  { to: "/pos", labelKey: "cmdCenterActionNewSale", icon: ShoppingCart, tone: "info" },
  { to: "/debts", labelKey: "cmdCenterActionReceiveDebt", icon: Wallet, tone: "success" },
  { to: "/stock", labelKey: "cmdCenterActionAddProduct", icon: Package, tone: "info" },
  { to: "/stock", labelKey: "cmdCenterActionInventoryCount", icon: Search, tone: "info" },
  { to: "/office/cash-position", labelKey: "cmdCenterActionCashControl", icon: Banknote, tone: "success" },
  { to: "/reports", labelKey: "cmdCenterActionReports", icon: BarChart3, tone: "draft" },
  { to: "/office/audit-center", labelKey: "cmdCenterActionInvestigation", icon: Shield, tone: "danger" },
  { to: "/office/backup", labelKey: "cmdCenterActionBackup", icon: CloudUpload, tone: "warning" },
];

export function CommandCenterQuickActions({ lang }: Props) {
  return (
    <EnterpriseCard title={t(lang, "cmdCenterQuickActionsTitle")}>
      <ul className="grid grid-cols-4 gap-3">
        {ACTIONS.map((action) => (
          <li key={action.labelKey}>
            <Link
              to={action.to}
              className="flex flex-col items-center gap-1.5 rounded-2xl p-1 transition active:scale-95"
            >
              <span
                className={clsx(
                  "flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm",
                  statusTokens[action.tone].badge,
                  "text-foreground",
                )}
              >
                <action.icon className="h-5 w-5" aria-hidden />
              </span>
              <Caption className="text-center leading-tight">{t(lang, action.labelKey)}</Caption>
            </Link>
          </li>
        ))}
      </ul>
    </EnterpriseCard>
  );
}
