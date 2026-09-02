/**
 * HOME REMIX V6 — presentation zones only.
 * Does not change stored money, formula version, or shop identity.
 */

export type HomeWorldZone = "work" | "live" | "ops" | "admin";
export type HomeWorldInk = "dark" | "light";

export type HomeWorldSurface = {
  id: string;
  zone: HomeWorldZone;
  ink: HomeWorldInk;
};

const SURFACES: Record<string, HomeWorldSurface> = {
  cash: { id: "cash", zone: "work", ink: "light" },
  inventory: { id: "inventory", zone: "work", ink: "dark" },
  cashPosition: { id: "cashPosition", zone: "live", ink: "light" },
  reports: { id: "reports", zone: "live", ink: "light" },
  profit: { id: "profit", zone: "live", ink: "light" },
  salesHistory: { id: "salesHistory", zone: "ops", ink: "dark" },
  debts: { id: "debts", zone: "ops", ink: "light" },
  shop: { id: "shop", zone: "ops", ink: "dark" },
  commandCenter: { id: "commandCenter", zone: "ops", ink: "light" },
  dashboard: { id: "dashboard", zone: "ops", ink: "light" },
  investigation: { id: "investigation", zone: "admin", ink: "dark" },
  settings: { id: "settings", zone: "admin", ink: "light" },
  agent: { id: "agent", zone: "ops", ink: "dark" },
};

export function resolveHomeWorldSurface(tileId: string): HomeWorldSurface {
  return SURFACES[tileId] ?? { id: "fallback", zone: "ops", ink: "dark" };
}

export function homeWorldHasStage(tileId: string): boolean {
  return tileId in SURFACES || tileId === "sell";
}
