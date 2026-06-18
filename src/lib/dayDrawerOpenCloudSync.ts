/**
 * Cloud RPC push/pull for DayDrawerOpen (authoritative opening float).
 */

import type { DayDrawerOpen } from "../types";
import { hasSupabaseConfig, supabase } from "./supabase";
import { parseDayDrawerOpenRows, mergeDayDrawerOpensFromCloudPull } from "./dayDrawerOpenRecovery";
import { usePosStore } from "../store/usePosStore";

export type ShopCtx = { shopId: string; userId: string };

export type DayDrawerOpenPushResult = {
  ok: boolean;
  error?: string;
  pullRequired?: boolean;
};

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

function buildCreatePayload(row: DayDrawerOpen): Record<string, unknown> {
  return {
    id: row.id,
    date_key: row.dateKey,
    opening_float_ugx: row.openingFloatUgx,
    created_at: row.createdAt,
    created_by: row.countedByUserId,
    counted_at: row.countedAt,
    counted_by_label: row.countedByLabel,
    note: row.note,
    device_id: row.deviceId,
    metadata: { wakaClient: true },
  };
}

export async function pushDayDrawerOpenCreateToCloud(
  row: DayDrawerOpen,
  ctx: ShopCtx,
): Promise<DayDrawerOpenPushResult> {
  if (!supabase) return { ok: false, error: "no_client" };
  const { data, error } = await supabase.rpc("shop_create_day_drawer_open", {
    p_shop_id: ctx.shopId,
    p_payload: buildCreatePayload(row),
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: true };
    return { ok: false, error: error.message };
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.ok) return { ok: true };
  if (result?.error === "dayDrawerAlreadyOpen") return { ok: false, error: result.error, pullRequired: true };
  return { ok: false, error: result?.error ?? "unknown" };
}

export async function pushDayDrawerOpenSupersedeToCloud(
  row: DayDrawerOpen,
  previousId: string,
  ctx: ShopCtx,
): Promise<DayDrawerOpenPushResult> {
  if (!supabase) return { ok: false, error: "no_client" };
  const payload = { ...buildCreatePayload(row), previous_id: previousId };
  const { data, error } = await supabase.rpc("shop_supersede_day_drawer_open", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: true };
    return { ok: false, error: error.message };
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.ok) return { ok: true };
  if (result?.error === "dayDrawerAlreadyOpen") return { ok: false, error: result.error, pullRequired: true };
  return { ok: false, error: result?.error ?? "unknown" };
}

export async function pushDayDrawerOpenVoidToCloud(
  row: DayDrawerOpen,
  ctx: ShopCtx,
): Promise<DayDrawerOpenPushResult> {
  if (!supabase) return { ok: false, error: "no_client" };
  const { data, error } = await supabase.rpc("shop_void_day_drawer_open", {
    p_shop_id: ctx.shopId,
    p_payload: {
      id: row.id,
      date_key: row.dateKey,
      void_reason: row.voidReason ?? "",
    },
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: true };
    return { ok: false, error: error.message };
  }
  const result = data as { ok?: boolean; error?: string } | null;
  if (result?.ok) return { ok: true };
  return { ok: false, error: result?.error ?? "unknown" };
}

export async function pullDayDrawerOpensFromRpc(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ dayDrawerOpens: DayDrawerOpen[]; bytes: number; checkpointAt: string }> {
  if (!supabase) {
    return { dayDrawerOpens: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const { data, error } = await supabase.rpc("shop_pull_day_drawer_opens", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { dayDrawerOpens: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
    }
    throw error;
  }
  const result = data as { ok?: boolean; rows?: unknown[] } | null;
  if (!result?.ok) {
    return { dayDrawerOpens: [], bytes: 0, checkpointAt: since ?? new Date(0).toISOString() };
  }
  const raw = result.rows ?? [];
  const dayDrawerOpens = parseDayDrawerOpenRows(raw);
  let checkpointAt = since ?? new Date(0).toISOString();
  for (const row of dayDrawerOpens) {
    if (row.updatedAt > checkpointAt) checkpointAt = row.updatedAt;
  }
  return { dayDrawerOpens, bytes: JSON.stringify(raw).length, checkpointAt };
}

export async function pullAndMergeDayDrawerOpensIntoStore(
  ctx: ShopCtx,
  since: string | null,
): Promise<{ merged: DayDrawerOpen[]; checkpointAt: string }> {
  const page = await pullDayDrawerOpensFromRpc(ctx, since);
  const local = usePosStore.getState().dayDrawerOpens;
  const merged = await mergeDayDrawerOpensFromCloudPull(local, page.dayDrawerOpens);
  usePosStore.setState({ dayDrawerOpens: merged });
  return { merged, checkpointAt: page.checkpointAt };
}

export function markDayDrawerOpenSynced(dayOpenId: string, at = new Date().toISOString()): void {
  usePosStore.setState((s) => ({
    dayDrawerOpens: s.dayDrawerOpens.map((row) =>
      row.id === dayOpenId
        ? { ...row, pendingSync: false, lastSyncError: null, cloudSyncedAt: at }
        : row,
    ),
  }));
}

export function markDayDrawerOpenSyncError(dayOpenId: string, error: string): void {
  usePosStore.setState((s) => ({
    dayDrawerOpens: s.dayDrawerOpens.map((row) =>
      row.id === dayOpenId ? { ...row, lastSyncError: error, pendingSync: true } : row,
    ),
  }));
}

export async function syncDayDrawerOpenOperation(
  payload: Record<string, unknown>,
  ctx: ShopCtx,
): Promise<boolean> {
  const dayOpenId = String(payload.dayOpenId ?? "");
  if (!dayOpenId) return true;

  const row = usePosStore.getState().dayDrawerOpens.find((r) => r.id === dayOpenId);
  if (!row) return true;

  const action =
    payload.action === "void" || payload.void === true
      ? "void"
      : payload.action === "supersede" || row.supersedesId
        ? "supersede"
        : payload.action === "create"
          ? "create"
          : row.status === "voided"
            ? "void"
            : row.supersedesId
              ? "supersede"
              : "create";

  let result: DayDrawerOpenPushResult;
  if (action === "void") {
    result = await pushDayDrawerOpenVoidToCloud(row, ctx);
  } else if (action === "supersede") {
    const previousId = String(payload.previousId ?? row.supersedesId ?? "");
    if (!previousId) return false;
    result = await pushDayDrawerOpenSupersedeToCloud(row, previousId, ctx);
  } else {
    result = await pushDayDrawerOpenCreateToCloud(row, ctx);
  }

  if (result.pullRequired) {
    await pullAndMergeDayDrawerOpensIntoStore(ctx, null);
  }

  if (result.ok) {
    markDayDrawerOpenSynced(dayOpenId);
    return true;
  }

  markDayDrawerOpenSyncError(dayOpenId, result.error ?? "sync_failed");
  return false;
}

export async function pullDayDrawerOpensForRecovery(ctx: ShopCtx): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  await pullAndMergeDayDrawerOpensIntoStore(ctx, null);
  return true;
}
