/**
 * Cloud RPC push/pull for day closes.
 */

import type { DayCloseSummary } from "../types";
import { supabase } from "./supabase";
import { parseDayCloseRows } from "./dayCloseRecovery";

export type ShopCtx = { shopId: string; userId: string };

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export function buildDayClosePushPayload(close: DayCloseSummary): Record<string, unknown> {
  return {
    id: close.id,
    date_key: close.dateKey,
    superseded_at: close.supersededAt ?? null,
    created_at: close.createdAt,
    updated_at: close.updatedAt ?? close.createdAt,
    close,
  };
}

export async function pushDayCloseToCloud(close: DayCloseSummary, ctx: ShopCtx): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_push_day_close", {
    p_shop_id: ctx.shopId,
    p_payload: buildDayClosePushPayload(close),
  });
  if (error) {
    if (isMissingRpcError(error)) return true;
    return false;
  }
  const result = data as { ok?: boolean } | null;
  return result?.ok === true;
}

export async function pullDayClosesFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ dayCloses: DayCloseSummary[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { dayCloses: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_day_closes", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { dayCloses: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[]; checkpoint_at?: string } | null;
  const rows = result?.rows ?? [];
  const dayCloses = parseDayCloseRows(rows);
  return {
    dayCloses,
    bytes: JSON.stringify(rows).length,
    checkpointAt: String(result?.checkpoint_at ?? since ?? new Date().toISOString()),
  };
}
