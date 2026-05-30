import type { Sale } from "../types";

/** Operational memory window — sales older than this move to archivedSales automatically. */
export const ACTIVE_SALES_MEMORY_DAYS = 30;

/** Initial sales loaded into RAM at bootstrap; additional pages load on demand. */
export const INITIAL_SALES_LOAD_COUNT = 100;

/** Sales loaded per background page after bootstrap. */
export const SALES_PAGE_LOAD_SIZE = 200;

export function activeSalesCutoffIso(nowMs = Date.now(), days = ACTIVE_SALES_MEMORY_DAYS): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isOlderThanActiveWindow(createdAt: string, nowMs = Date.now(), days = ACTIVE_SALES_MEMORY_DAYS): boolean {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < new Date(activeSalesCutoffIso(nowMs, days)).getTime();
}

/** Move synced sales older than the active window into archive (never deletes). */
export function archiveSalesBeyondActiveWindow(
  sales: Sale[],
  archivedSales: Sale[],
  nowMs = Date.now(),
): { sales: Sale[]; archivedSales: Sale[]; moved: number } {
  const keep: Sale[] = [];
  const moved: Sale[] = [];
  for (const s of sales) {
    if (s.pendingSync || !isOlderThanActiveWindow(s.createdAt, nowMs)) {
      keep.push(s);
    } else {
      moved.push(s);
    }
  }
  if (moved.length === 0) return { sales, archivedSales, moved: 0 };
  return {
    sales: keep,
    archivedSales: [...moved, ...archivedSales],
    moved: moved.length,
  };
}
