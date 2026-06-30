/**
 * Stock movement ledger — merge with archival instead of silent truncation.
 */

import type { StockMovement } from "../types";

/** Active in-memory window — older rows move to archivedStockMovements. */
export const ACTIVE_STOCK_MOVEMENT_CAP = 4000;

export type StockMovementMergeResult = {
  stockMovements: StockMovement[];
  archivedStockMovements: StockMovement[];
  archivedCount: number;
};

export function mergeStockMovementsWithArchive(
  existing: StockMovement[],
  incoming: StockMovement[],
  archived: StockMovement[] = [],
): StockMovementMergeResult {
  const byId = new Map<string, StockMovement>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);

  let active = [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const archivedById = new Map(archived.map((m) => [m.id, m]));
  let archivedCount = 0;

  if (active.length > ACTIVE_STOCK_MOVEMENT_CAP) {
    const overflow = active.slice(ACTIVE_STOCK_MOVEMENT_CAP);
    active = active.slice(0, ACTIVE_STOCK_MOVEMENT_CAP);
    for (const m of overflow) {
      if (!archivedById.has(m.id)) archivedCount += 1;
      archivedById.set(m.id, m);
    }
  }

  const archivedStockMovements = [...archivedById.values()].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );

  return { stockMovements: active, archivedStockMovements, archivedCount };
}

/** All movements for integrity verification (active + archived, deduped by id). */
export function allStockMovementsForIntegrity(
  active: StockMovement[],
  archived: StockMovement[] = [],
): StockMovement[] {
  const byId = new Map<string, StockMovement>();
  for (const m of archived) byId.set(m.id, m);
  for (const m of active) byId.set(m.id, m);
  return [...byId.values()];
}
