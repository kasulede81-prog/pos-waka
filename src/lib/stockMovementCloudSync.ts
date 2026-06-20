/**
 * Cloud RPC push/pull for shop stock movements (local StockMovement ledger).
 */

import type { StockMovement } from "../types";
import { supabase } from "./supabase";
import { parseStockMovementRows } from "./stockMovementRecovery";

export type ShopCtx = { shopId: string; userId: string };

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export function buildStockMovementPushPayload(movement: StockMovement): Record<string, unknown> {
  return {
    id: movement.id,
    movement_at: movement.at,
    at: movement.at,
    created_at: movement.at,
    updated_at: movement.at,
    movement,
  };
}

export async function pushStockMovementToCloud(movement: StockMovement, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_push_stock_movement", {
    p_shop_id: ctx.shopId,
    p_payload: buildStockMovementPushPayload(movement),
  });
  if (error) {
    if (isMissingRpcError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function pullStockMovementsFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ movements: StockMovement[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { movements: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_stock_movements", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { movements: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[]; checkpoint_at?: string } | null;
  const rows = result?.rows ?? [];
  const movements = parseStockMovementRows(rows);
  return {
    movements,
    bytes: JSON.stringify(rows).length,
    checkpointAt: String(result?.checkpoint_at ?? since ?? new Date().toISOString()),
  };
}

/** Pull all stock movements using paginated RPC cursor until exhausted. */
export async function pullStockMovementsFull(
  ctx: ShopCtx,
): Promise<{ movements: StockMovement[]; bytes: number; checkpointAt: string }> {
  const all: StockMovement[] = [];
  let bytes = 0;
  let since: string | null = null;
  let checkpointAt = new Date(0).toISOString();
  const seen = new Set<string>();

  for (let page = 0; page < 500; page++) {
    const batch = await pullStockMovementsFromRpc(ctx, since);
    bytes += batch.bytes;
    checkpointAt = batch.checkpointAt;
    if (batch.movements.length === 0) break;

    let advanced = false;
    for (const m of batch.movements) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      all.push(m);
      advanced = true;
    }

    if (!advanced || batch.checkpointAt <= (since ?? "")) break;
    since = batch.checkpointAt;

    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }

  return { movements: all, bytes, checkpointAt };
}

export async function pullStockMovementsIncremental(
  ctx: ShopCtx,
  since: string,
): Promise<{ movements: StockMovement[]; bytes: number; checkpointAt: string }> {
  const all: StockMovement[] = [];
  let bytes = 0;
  let cursor = since;
  let checkpointAt = since;

  for (let page = 0; page < 40; page++) {
    const batch = await pullStockMovementsFromRpc(ctx, cursor);
    bytes += batch.bytes;
    if (batch.movements.length === 0) break;
    checkpointAt = batch.checkpointAt;
    all.push(...batch.movements);
    if (batch.checkpointAt <= cursor) break;
    cursor = batch.checkpointAt;
    const { yieldUiTick } = await import("./uiYield");
    await yieldUiTick();
  }

  return { movements: all, bytes, checkpointAt };
}
