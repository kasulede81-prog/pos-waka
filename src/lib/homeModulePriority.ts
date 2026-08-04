/**
 * Phase 34.1 — Home module visual priority bands (presentation only).
 * Navigation targets and permissions stay in launcherTiles.
 */

export type HomeModuleBand = "primary" | "secondary" | "admin";

const PRIMARY = new Set(["inventory", "cash", "cashPosition", "reports", "dashboard"]);
const SECONDARY = new Set(["debts", "salesHistory", "shop", "profit"]);

export function homeModuleBand(tileId: string): HomeModuleBand {
  if (PRIMARY.has(tileId)) return "primary";
  if (SECONDARY.has(tileId)) return "secondary";
  return "admin";
}

export function sortTilesByHomePriority<T extends { id: string }>(tiles: T[]): T[] {
  const rank: Record<HomeModuleBand, number> = { primary: 0, secondary: 1, admin: 2 };
  return [...tiles].sort((a, b) => rank[homeModuleBand(a.id)] - rank[homeModuleBand(b.id)]);
}
