/**
 * Stock movement cloud pull merge helpers.
 */

import type { StockMovement } from "../types";

export function parseStockMovementRow(row: unknown): StockMovement | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const payload = (r.payload ?? r.movement) as Record<string, unknown> | undefined;
  const source = payload && typeof payload === "object" ? payload : r;
  const id = String(source.id ?? r.id ?? "");
  if (!id) return null;
  const at = String(source.at ?? r.movement_at ?? r.created_at ?? "");
  const productId = String(source.productId ?? source.product_id ?? "");
  if (!productId) return null;
  return {
    id,
    at: at || new Date().toISOString(),
    productId,
    productName: String(source.productName ?? source.product_name ?? ""),
    deltaBaseUnits: Number(source.deltaBaseUnits ?? source.delta_base_units ?? 0),
    kind: (source.kind as StockMovement["kind"]) ?? "adjust_other",
    summary: String(source.summary ?? ""),
    refId: source.refId != null ? String(source.refId) : undefined,
    supplierId:
      source.supplierId != null
        ? String(source.supplierId)
        : source.supplier_id != null
          ? String(source.supplier_id)
          : null,
  };
}

export function parseStockMovementRows(rows: unknown[]): StockMovement[] {
  const out: StockMovement[] = [];
  for (const row of rows) {
    const m = parseStockMovementRow(row);
    if (m) out.push(m);
  }
  return out;
}

export function mergeStockMovementsFromCloudPull(
  local: StockMovement[],
  cloud: StockMovement[],
): StockMovement[] {
  const byId = new Map<string, StockMovement>();
  for (const m of local) byId.set(m.id, m);
  for (const m of cloud) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
