/**
 * Server-authoritative prep-batch event processor.
 *
 * The batch table is the authoritative portion state. Stock remains in the Kiosk
 * Duka ledger: create stock rides the existing pending_stock_updates path; waste
 * and cancel apply their portion-dependent stock inside the RPC using the same
 * durable adjustment ids; sale/void/return events never touch stock.
 */
import type { PrepBatch } from "../types";
import { patchProductsWithServerStock, type ServerProductStockRow } from "../lib/inventoryIntegrity";
import { reportSyncIssue } from "../lib/monitoring";
import { isServerPrepBatch, type PrepBatchSyncPayload } from "../lib/prepBatchSync";
import { supabase } from "../lib/supabase";
import { usePosStore } from "../store/usePosStore";

type ShopCtx = { shopId: string; userId: string };

type RpcResult = {
  ok?: boolean;
  error?: string;
  idempotent?: boolean;
  batch?: unknown;
  batches?: unknown[];
  stocks?: ServerProductStockRow[];
  stockDeltas?: Array<{ productId: string; delta: number }>;
};

const MISSING_RPC_CODES = new Set(["PGRST202", "42883", "42P01"]);

/**
 * Ack only when the server accepted the event (including idempotent replays).
 * `sale_not_completed` / `void_not_applied` / `return_not_applied` and transport
 * errors stay queued and are retried by the existing sync engine.
 */
export async function processPrepBatchSyncOperation(
  payload: PrepBatchSyncPayload,
  ctx: ShopCtx,
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_apply_prep_batch_event", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (MISSING_RPC_CODES.has(error.code ?? "")) {
      reportSyncIssue("prep_batch_rpc_missing", { code: error.code });
    } else {
      reportSyncIssue("prep_batch_rpc_failed", { code: error.code ?? "unknown" });
    }
    return false;
  }

  const result = data as RpcResult | null;
  if (!result?.ok) {
    reportSyncIssue("prep_batch_rpc_rejected", { error: result?.error ?? "unknown" });
    return false;
  }

  const stocks = Array.isArray(result.stocks) ? result.stocks : [];
  if (stocks.length > 0) {
    usePosStore.setState((s) => ({
      products: patchProductsWithServerStock(s.products, stocks),
    }));
  }

  const stockDeltas = Array.isArray(result.stockDeltas) ? result.stockDeltas : [];
  if (payload.kind === "waste" || payload.kind === "cancel") {
    // The server may clamp the portion-dependent stock (concurrent sale, missing stock)
    // or skip an ingredient it cannot restore. Align local movement deltas with the
    // authoritative deltas, and undo any optimistic local stock change the server did
    // not apply, so the local ledger and patched stock stay reconciled.
    const byProduct = new Map(stockDeltas.map((d) => [d.productId, d.delta]));
    const appliedProducts = new Set(byProduct.keys());
    const adjustmentIds = new Set<string>();
    if (payload.dishStockAdjustmentId) adjustmentIds.add(payload.dishStockAdjustmentId);
    if (payload.kind === "waste") adjustmentIds.add(payload.eventId);
    for (const a of payload.ingredientAdjustments ?? []) adjustmentIds.add(a.adjustmentId);

    const localMovements = usePosStore.getState().stockMovements;
    const revertByProduct = new Map<string, number>();
    for (const id of adjustmentIds) {
      const movement = localMovements.find((m) => m.id === id);
      if (!movement || appliedProducts.has(movement.productId)) continue;
      revertByProduct.set(
        movement.productId,
        (revertByProduct.get(movement.productId) ?? 0) + movement.deltaBaseUnits,
      );
    }

    usePosStore.setState((s) => ({
      stockMovements: s.stockMovements.map((m) => {
        if (!adjustmentIds.has(m.id)) return m;
        const delta = byProduct.get(m.productId);
        return { ...m, deltaBaseUnits: delta ?? 0 };
      }),
      products:
        revertByProduct.size > 0
          ? s.products.map((p) => {
              const revert = revertByProduct.get(p.id);
              if (!revert) return p;
              return { ...p, stockOnHand: Math.max(0, p.stockOnHand - revert) };
            })
          : s.products,
    }));
  }

  const batches = [
    ...(Array.isArray(result.batches) ? result.batches : []),
    ...(result.batch ? [result.batch] : []),
  ].filter(isServerPrepBatch);
  if (batches.length > 0) applyServerPrepBatches(batches);

  return true;
}

/** Apply server batch projections. The server wins unless the local batch is strictly newer. */
export function applyServerPrepBatches(batches: PrepBatch[]): void {
  if (batches.length === 0) return;
  usePosStore.setState((s) => {
    const byProduct = new Map<string, PrepBatch[]>();
    for (const batch of batches) {
      const list = byProduct.get(batch.menuProductId) ?? [];
      list.push(batch);
      byProduct.set(batch.menuProductId, list);
    }

    let changed = false;
    const products = s.products.map((product) => {
      const incoming = byProduct.get(product.id);
      if (!incoming?.length) return product;
      const current = product.menu?.prepBatches ?? [];
      let next = current;
      for (const batch of incoming) {
        const local = next.find((b) => b.id === batch.id);
        // A strictly newer local version means an unacknowledged local event; keep it.
        if (local && (local.version ?? 1) > (batch.version ?? 1)) continue;
        next = local
          ? next.map((b) => (b.id === batch.id ? batch : b))
          : [...next, batch];
      }
      if (next === current) return product;
      changed = true;
      return { ...product, menu: { ...product.menu, prepBatches: next } };
    });

    return changed ? { products } : {};
  });
}
