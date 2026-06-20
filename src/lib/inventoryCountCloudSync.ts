/**
 * Cloud RPC push/pull for inventory count sessions.
 */

import type { InventoryCountSession } from "../types";
import { supabase } from "./supabase";
import { parseInventoryCountSessionRows } from "./inventoryCountRecovery";

export type ShopCtx = { shopId: string; userId: string };

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export function buildInventoryCountPushPayload(session: InventoryCountSession): Record<string, unknown> {
  return {
    id: session.id,
    session_number: session.sessionNumber,
    status: session.status,
    created_at: session.startedAt ?? session.updatedAt,
    updated_at: session.updatedAt,
    session: session,
  };
}

export async function pushInventoryCountSessionToCloud(
  session: InventoryCountSession,
  ctx: ShopCtx,
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_push_inventory_count_session", {
    p_shop_id: ctx.shopId,
    p_payload: buildInventoryCountPushPayload(session),
  });
  if (error) {
    if (isMissingRpcError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function pullInventoryCountSessionsFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ sessions: InventoryCountSession[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { sessions: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_inventory_count_sessions", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { sessions: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[]; checkpoint_at?: string } | null;
  const rows = result?.rows ?? [];
  const sessions = parseInventoryCountSessionRows(rows);
  const bytes = JSON.stringify(rows).length;
  return {
    sessions,
    bytes,
    checkpointAt: String(result?.checkpoint_at ?? since ?? new Date().toISOString()),
  };
}
