import {
  AlertTriangle,
  BarChart3,
  Banknote,
  Briefcase,
  LayoutDashboard,
  Package,
  PiggyBank,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Presentation-layer mirror of the Waka POS home surface.
 * Tile ids, labels, routes and grouping match src/lib/launcherTiles.ts in the
 * Waka repo so this styling can be ported back without touching business logic.
 */

export type TileGroup = "operational" | "management";

export type HomeTile = {
  id: string;
  label: string;
  hint: string;
  to: string;
  Icon: LucideIcon;
  group: TileGroup;
  accent: string;
};

export const HOME_TILES: HomeTile[] = [
  {
    id: "inventory",
    label: "Inventory",
    hint: "1,284 items in stock",
    to: "/stock",
    Icon: Package,
    group: "operational",
    accent: "var(--chart-4)",
  },
  {
    id: "debts",
    label: "Debts",
    hint: "UGX 1.42M outstanding",
    to: "/debts",
    Icon: Users,
    group: "operational",
    accent: "var(--chart-3)",
  },
  {
    id: "cash",
    label: "Cash drawer",
    hint: "Open since 07:40",
    to: "/office/cash-drawer",
    Icon: Banknote,
    group: "operational",
    accent: "var(--chart-2)",
  },
  {
    id: "salesHistory",
    label: "Receipts",
    hint: "182 today",
    to: "/pos/receipts",
    Icon: Receipt,
    group: "operational",
    accent: "var(--waka)",
  },
  {
    id: "shop",
    label: "Back office",
    hint: "Staff, shops, devices",
    to: "/pos/shop",
    Icon: Briefcase,
    group: "operational",
    accent: "var(--chart-3)",
  },
  {
    id: "cashPosition",
    label: "Cash position",
    hint: "UGX 3.86M on hand",
    to: "/office/cash-position",
    Icon: Wallet,
    group: "management",
    accent: "var(--chart-2)",
  },
  {
    id: "commandCenter",
    label: "Command center",
    hint: "Owner overview",
    to: "/owner",
    Icon: LayoutDashboard,
    group: "management",
    accent: "var(--chart-3)",
  },
  {
    id: "reports",
    label: "Reports",
    hint: "Daily, weekly, monthly",
    to: "/reports",
    Icon: BarChart3,
    group: "management",
    accent: "var(--chart-4)",
  },
  {
    id: "profit",
    label: "Profit",
    hint: "Margin 23.4%",
    to: "/office/profit",
    Icon: TrendingUp,
    group: "management",
    accent: "var(--chart-2)",
  },
  {
    id: "investigation",
    label: "Investigation",
    hint: "Audit center",
    to: "/office/audit-center",
    Icon: Search,
    group: "management",
    accent: "var(--chart-5)",
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Terminal & printing",
    to: "/settings",
    Icon: Settings,
    group: "management",
    accent: "var(--muted-foreground)",
  },
];

export type KpiTone = "neutral" | "positive" | "warning" | "danger";

export type HomeKpi = {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: KpiTone;
  Icon: LucideIcon;
};

export const HOME_KPIS: HomeKpi[] = [
  { id: "sales", label: "Sales today", value: "UGX 4.82M", hint: "+12.4% vs yesterday", tone: "positive", Icon: TrendingUp },
  { id: "transactions", label: "Transactions", value: "182", hint: "Avg UGX 26,500", tone: "neutral", Icon: ShoppingCart },
  { id: "profit", label: "Gross profit", value: "UGX 1.13M", hint: "Margin 23.4%", tone: "positive", Icon: PiggyBank },
  { id: "cash", label: "Cash on hand", value: "UGX 3.86M", hint: "Drawer open", tone: "neutral", Icon: Banknote },
  { id: "lowStock", label: "Low stock", value: "14", hint: "Reorder soon", tone: "warning", Icon: AlertTriangle },
  { id: "debts", label: "Customer debts", value: "UGX 1.42M", hint: "9 accounts", tone: "danger", Icon: Users },
];

export type HealthStatus = "ok" | "warn" | "bad";

export const HOME_HEALTH: { id: string; label: string; status: HealthStatus }[] = [
  { id: "sync", label: "Synced 2 min ago", status: "ok" },
  { id: "offline", label: "Offline ready", status: "ok" },
  { id: "stock", label: "14 low stock", status: "warn" },
  { id: "risk", label: "2 risk alerts", status: "warn" },
  { id: "day", label: "Day open", status: "ok" },
  { id: "plan", label: "Business plan · 21 days", status: "ok" },
];

export const HOME_SPARKLINE = [38, 44, 41, 52, 49, 63, 58, 71, 66, 78, 84, 92];

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
