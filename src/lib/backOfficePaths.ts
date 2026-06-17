import type { Permission } from "../types";

const PREFIXES = [
  "/stock",
  "/suppliers",
  "/restock",
  "/reports",
  "/settings",
  "/owner",
  "/close-day",
  "/staff-access",
  "/office",
  "/customers",
  "/debts",
  "/cash-expenses",
] as const;

/** Debt / customer credit workflows reachable without full Back Office access. */
const DEBT_PREFIXES = ["/customers", "/debts"] as const;

/** Stock workflows reachable without full Back Office access (stock keeper role). */
const STOCK_KEEPER_PREFIXES = ["/stock", "/suppliers", "/restock"] as const;

/** Routes that belong to Settings (main-menu launcher), not the shop/back-office hub. */
export function isSettingsLauncherPath(pathname: string): boolean {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/staff-access" ||
    pathname === "/office/hardware"
  );
}

export function isBackOfficePath(pathname: string): boolean {
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isDebtPath(pathname: string): boolean {
  return DEBT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Permission required for debt/customer credit paths, or null if not a debt path. */
export function debtPathPermission(pathname: string): Permission | null {
  if (isDebtPath(pathname)) return "customers.view";
  return null;
}

export function isStockKeeperPath(pathname: string): boolean {
  if (pathname === "/inventory") return true;
  return STOCK_KEEPER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Permission required for the current stock-keeper path, or null if not a stock path. */
export function stockKeeperPathPermission(pathname: string): Permission | null {
  if (pathname === "/inventory" || pathname === "/stock" || pathname.startsWith("/stock/")) {
    return "stock.view";
  }
  if (pathname === "/suppliers" || pathname.startsWith("/suppliers/")) {
    return "suppliers.view";
  }
  if (pathname === "/restock" || pathname.startsWith("/restock/")) {
    return "purchases.record";
  }
  return null;
}
