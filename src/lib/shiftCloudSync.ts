/**
 * Cloud RPC push/pull for shop shifts.
 */

import type { ShiftRecord } from "../types";
import { supabase } from "./supabase";
import { parseShiftRows } from "./shiftRecovery";

export type ShopCtx = { shopId: string; userId: string };

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export function buildShiftPushPayload(shift: ShiftRecord): Record<string, unknown> {
  return {
    id: shift.id,
    actor_user_id: shift.actorUserId,
    start_at: shift.startAt,
    end_at: shift.endAt ?? null,
    created_at: shift.startAt,
    updated_at: shift.updatedAt ?? shift.endAt ?? shift.startAt,
    shift,
  };
}

export async function pushShiftToCloud(shift: ShiftRecord, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_push_shift", {
    p_shop_id: ctx.shopId,
    p_payload: buildShiftPushPayload(shift),
  });
  if (error) {
    if (isMissingRpcError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function pullShiftsFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ shifts: ShiftRecord[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { shifts: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_shifts", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { shifts: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[]; checkpoint_at?: string } | null;
  const rows = result?.rows ?? [];
  const shifts = parseShiftRows(rows);
  return {
    shifts,
    bytes: JSON.stringify(rows).length,
    checkpointAt: String(result?.checkpoint_at ?? since ?? new Date().toISOString()),
  };
}
