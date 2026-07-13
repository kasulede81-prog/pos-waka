import type { SyncOperation, SyncOperationKind } from "../types";

/** P0 operational → P1 catalog/people → P2 settings/analytics. */
export function syncKindPriority(kind: SyncOperationKind): 0 | 1 | 2 {
  switch (kind) {
    case "pending_sales":
    case "sale":
    case "pending_returns":
    case "pending_stock_updates":
    case "stock_move":
    case "pending_cash_drawer_adjustments":
    case "pending_day_drawer_opens":
    case "pending_shifts":
    case "pending_day_closes":
    case "pending_expenses":
    case "pending_cash_expenses":
      return 0;
    case "customer":
    case "pending_purchases":
    case "purchase":
    case "supplier":
    case "pending_staff":
    case "pending_inventory_counts":
    case "pending_hospitality":
      return 1;
    default:
      return 2;
  }
}

export function sortSyncQueueByPriority(queue: SyncOperation[]): SyncOperation[] {
  return [...queue].sort((a, b) => {
    const pa = syncKindPriority(a.kind);
    const pb = syncKindPriority(b.kind);
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function coalesceKeyForOp(kind: SyncOperationKind, payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  if (kind === "product" || kind === "customer" || kind === "supplier") {
    const id = String(p.id ?? "");
    return id ? `${kind}:${id}` : null;
  }
  if (kind === "pending_sales" || kind === "sale") {
    const saleId = String(p.saleId ?? p.id ?? "");
    return saleId ? `sale:${saleId}` : null;
  }
  if (kind === "pending_staff") {
    const staffPayload = payload as { staff?: { id?: string } } | null;
    const staffId = String(staffPayload?.staff?.id ?? "");
    return staffId ? `pending_staff:${staffId}` : null;
  }
  return null;
}
