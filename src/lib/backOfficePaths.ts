const PREFIXES = ["/stock", "/suppliers", "/restock", "/reports", "/settings", "/owner", "/close-day", "/staff-access", "/office"] as const;

export function isBackOfficePath(pathname: string): boolean {
  return PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
