import clsx from "clsx";
import {
  Boxes,
  BriefcaseBusiness,
  CircleGauge,
  Coins,
  LayoutDashboard,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { categoryLabelKey } from "../lib/analyticsPageView";
import type { AnalyticsCategory } from "../types";

type Props = {
  lang: Language;
  active: AnalyticsCategory;
  canProfit: boolean;
  onChange: (category: AnalyticsCategory) => void;
};

type Group = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: AnalyticsCategory[];
};

/**
 * Presentation-only report navigation.
 * Same categories and ids as before — grouped so the workspace reads as a
 * report directory instead of one long chip row.
 */
const GROUPS: Group[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, items: ["overview"] },
  { id: "sales", label: "Sales", icon: ShoppingCart, items: ["sales", "products"] },
  { id: "financial", label: "Financial", icon: Coins, items: ["profit", "expenses", "cash_flow", "taxes"] },
  { id: "inventory", label: "Inventory", icon: Boxes, items: ["inventory"] },
  { id: "customers", label: "Customers", icon: Users, items: ["customers", "debts"] },
  { id: "operations", label: "Staff & purchasing", icon: BriefcaseBusiness, items: ["employees", "purchases"] },
  { id: "insights", label: "Insights", icon: CircleGauge, items: ["performance", "forecast"] },
];

export function AnalyticsCategoryChips({ lang, active, canProfit, onChange }: Props) {
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((c) => c !== "profit" || canProfit),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="reports-category-nav" aria-label="Report categories">
      {groups.map((group) => {
        const Icon = group.icon;
        return (
          <div key={group.id} className="reports-category-group">
            <p className="reports-category-group-label">
              <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              {group.label}
            </p>
            <div className="reports-category-chips">
              {group.items.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(id)}
                  aria-current={active === id ? "page" : undefined}
                  className={clsx(
                    "reports-category-chip",
                    active === id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(lang, categoryLabelKey(id))}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
