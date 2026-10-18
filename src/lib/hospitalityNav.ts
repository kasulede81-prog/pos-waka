import type { LucideIcon } from "lucide-react";
import { BarChart3, Calendar, ChefHat, LayoutDashboard, LayoutGrid, Monitor } from "lucide-react";
import type { Permission } from "../types";

export type HospitalityNavItem = {
  path: string;
  labelKey: string;
  Icon: LucideIcon;
  perm: Permission;
};

/** Hospitality home/dashboard — reachable without changing the floor landing. */
export const HOSPITALITY_HOME_ROUTE = "/hospitality" as const;

/** Operational hospitality screens — one tap on mobile, permanent group on desktop. */
export const HOSPITALITY_OPERATIONAL_PATHS = [
  HOSPITALITY_HOME_ROUTE,
  "/floor",
  "/kitchen",
  "/expo",
  "/reports",
] as const;

export function isHospitalityOperationalRoute(pathname: string): boolean {
  if (pathname === HOSPITALITY_HOME_ROUTE) return true;
  if (pathname === "/floor" || pathname === "/floor/reservations") return true;
  if (pathname.startsWith("/floor/order/")) return true;
  if (pathname === "/kitchen" || pathname.startsWith("/kitchen/")) return true;
  if (pathname === "/expo" || pathname.startsWith("/expo/")) return true;
  if (pathname === "/reports" || pathname.startsWith("/reports/")) return true;
  return false;
}

export function hospitalityNavItemActive(path: string, pathname: string): boolean {
  if (path === HOSPITALITY_HOME_ROUTE) return pathname === HOSPITALITY_HOME_ROUTE;
  if (path === "/floor") {
    return (
      pathname === "/floor" ||
      pathname.startsWith("/floor/order/") ||
      (pathname.startsWith("/floor/") && pathname !== "/floor/reservations")
    );
  }
  if (path === "/floor/reservations") return pathname === "/floor/reservations";
  if (path === "/kitchen") return pathname === "/kitchen" || pathname.startsWith("/kitchen/");
  if (path === "/expo") return pathname === "/expo" || pathname.startsWith("/expo/");
  if (path === "/reports") return pathname === "/reports" || pathname.startsWith("/reports/");
  return pathname === path || pathname.startsWith(`${path}/`);
}

export const HOSPITALITY_NAV_CATALOG: HospitalityNavItem[] = [
  { path: HOSPITALITY_HOME_ROUTE, labelKey: "navHome", Icon: LayoutDashboard, perm: "hospitality.floor" },
  { path: "/floor", labelKey: "restaurantFloorNav", Icon: LayoutGrid, perm: "hospitality.floor" },
  { path: "/kitchen", labelKey: "navKitchen", Icon: ChefHat, perm: "hospitality.kitchen" },
  { path: "/expo", labelKey: "navExpo", Icon: Monitor, perm: "hospitality.kitchen" },
  { path: "/floor/reservations", labelKey: "navReservations", Icon: Calendar, perm: "hospitality.floor" },
  { path: "/reports", labelKey: "navReports", Icon: BarChart3, perm: "reports.view" },
];

/**
 * Nav items a user sees. Style-aware:
 *  - kitchen workflow off: no Expo (kitchen-to-pass screen); Kitchen becomes the Bar screen
 *    when the shop is bar-only (its only production station).
 * Permissions still decide everything else.
 */
export function visibleHospitalityNavItems(input: {
  hasPerm: (perm: Permission) => boolean;
  kitchenEnabled: boolean;
  barOnly: boolean;
}): HospitalityNavItem[] {
  return HOSPITALITY_NAV_CATALOG.filter((item) => input.hasPerm(item.perm))
    .filter((item) => input.kitchenEnabled || item.path !== "/expo")
    .map((item) =>
      item.path === "/kitchen" && input.barOnly ? { ...item, labelKey: "hospitalityStation_bar" } : item,
    );
}
