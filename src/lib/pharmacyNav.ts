import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  LayoutGrid,
  Package,
  Pill,
  RotateCcw,
  Settings,
  Shield,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import type { Permission } from "../types";

export const PHARMACY_HOME_ROUTE = "/pharmacy" as const;
export const PHARMACY_DISPENSE_ROUTE = "/pharmacy/prescriptions" as const;
export const PHARMACY_PRESCRIPTIONS_ROUTE = "/pharmacy/prescriptions" as const;

export type PharmacyNavItem = {
  path: string;
  labelKey: string;
  Icon?: LucideIcon;
  perm?: Permission;
};

/** Operational pharmacy screens — dedicated workspace navigation. */
export const PHARMACY_OPERATIONAL_PATHS = [
  PHARMACY_HOME_ROUTE,
  PHARMACY_DISPENSE_ROUTE,
  "/pharmacy/patients",
  "/pharmacy/inventory",
  "/pharmacy/purchases",
  "/pharmacy/reports",
  "/pharmacy/compliance/register",
  "/pharmacy/compliance/reports",
  "/pharmacy/returns",
  "/pharmacy/settings",
] as const;

export function isPharmacyOperationalRoute(pathname: string): boolean {
  if (pathname === PHARMACY_HOME_ROUTE) return true;
  if (pathname === "/pharmacy/expiry" || pathname.startsWith("/pharmacy/expiry/")) return true;
  if (pathname === "/pharmacy/reports/inventory" || pathname.startsWith("/pharmacy/reports/inventory/")) return true;
  if (pathname === PHARMACY_PRESCRIPTIONS_ROUTE || pathname.startsWith(`${PHARMACY_PRESCRIPTIONS_ROUTE}/`)) return true;
  if (pathname === "/pharmacy/dispense") return true;
  if (pathname === "/pharmacy/reports/patients" || pathname.startsWith("/pharmacy/reports/patients/")) return true;
  if (pathname === "/pharmacy/compliance/register" || pathname.startsWith("/pharmacy/compliance/register/")) return true;
  if (pathname === "/pharmacy/compliance/reports" || pathname.startsWith("/pharmacy/compliance/reports/")) return true;
  if (pathname.startsWith("/pharmacy/patients/")) return true;
  if (pathname === "/pharmacy/inventory" || pathname.startsWith("/pharmacy/inventory/")) return true;
  if (pathname === "/pharmacy/purchases" || pathname.startsWith("/pharmacy/purchases/")) return true;
  if (pathname === "/pharmacy/reports" || pathname.startsWith("/pharmacy/reports/")) return true;
  if (pathname === "/pharmacy/returns" || pathname.startsWith("/pharmacy/returns/")) return true;
  if (pathname === "/pharmacy/settings" || pathname.startsWith("/pharmacy/settings/")) return true;
  return false;
}

export function pharmacyNavItemActive(path: string, pathname: string): boolean {
  if (path === PHARMACY_HOME_ROUTE) return pathname === PHARMACY_HOME_ROUTE;
  if (path === "/pharmacy/inventory") {
    return (
      pathname === "/pharmacy/inventory" ||
      pathname.startsWith("/pharmacy/inventory/") ||
      pathname === "/pharmacy/purchases" ||
      pathname.startsWith("/pharmacy/purchases/")
    );
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Desktop + tablet pharmacy navigation (full catalog). */
export const PHARMACY_NAV_CATALOG: PharmacyNavItem[] = [
  { path: PHARMACY_HOME_ROUTE, labelKey: "pharmacyNav_dashboard" },
  { path: PHARMACY_PRESCRIPTIONS_ROUTE, labelKey: "pharmacyNav_prescriptions", perm: "pos.sell" },
  { path: "/pharmacy/patients", labelKey: "pharmacyTerm_patients", perm: "customers.view" },
  { path: "/pharmacy/inventory", labelKey: "pharmacyTerm_medicines", perm: "stock.view" },
  { path: "/pharmacy/purchases", labelKey: "pharmacyNav_purchases", perm: "purchases.view" },
  { path: "/pharmacy/reports", labelKey: "pharmacyNav_reports", perm: "reports.view" },
  { path: "/pharmacy/compliance/register", labelKey: "pharmacyNav_compliance", perm: "reports.view" },
  { path: "/pharmacy/returns", labelKey: "pharmacyNav_returns", perm: "receipts.view" },
  { path: "/pharmacy/settings", labelKey: "pharmacyNav_settings", perm: "settings.view" },
];

/** Mobile bottom navigation (subset). */
export const PHARMACY_MOBILE_NAV_CATALOG: PharmacyNavItem[] = [
  { path: PHARMACY_HOME_ROUTE, labelKey: "pharmacyNav_dashboard", Icon: LayoutGrid },
  { path: PHARMACY_DISPENSE_ROUTE, labelKey: "navDispense", Icon: ShoppingCart, perm: "pos.sell" },
  { path: "/pharmacy/patients", labelKey: "pharmacyTerm_patients", Icon: Users, perm: "customers.view" },
  { path: "/pharmacy/inventory", labelKey: "pharmacyNav_inventory", Icon: Package, perm: "stock.view" },
  { path: "/pharmacy/reports", labelKey: "pharmacyNav_reports", Icon: BarChart3, perm: "reports.view" },
];

/** Icon map for desktop nav (catalog entries without Icon get defaults). */
export const PHARMACY_NAV_ICONS: Record<string, LucideIcon> = {
  [PHARMACY_HOME_ROUTE]: LayoutGrid,
  [PHARMACY_PRESCRIPTIONS_ROUTE]: Pill,
  "/pharmacy/patients": Users,
  "/pharmacy/inventory": Package,
  "/pharmacy/purchases": Truck,
  "/pharmacy/reports": BarChart3,
  "/pharmacy/compliance/register": Shield,
  "/pharmacy/returns": RotateCcw,
  "/pharmacy/settings": Settings,
};
