/**
 * WAKA-05 — one server clock for bootstrap / full-sync checkpoint seeding.
 *
 * Incremental cursors are compared with `.gt(updated_at|created_at, cursor)`
 * against values the server stamped. Seeding those cursors from `Date.now()`
 * after a full pull recreates the original WAKA-05 skip: a fast client writes
 * every cursor into the server's future and then never sees rows stamped in
 * the gap.
 */

import { hasSupabaseConfig, supabase } from "./supabase";

/** Accept a PostgREST timestamptz and normalise to a comparable ISO string. */
export function normalizeServerTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Postgres `now()` for the signed-in user. Null if offline, unauthenticated, or the RPC is missing. */
export async function fetchShopServerNow(): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const rpc = supabase.rpc;
  if (typeof rpc !== "function") return null;
  try {
    const { data, error } = await rpc("shop_server_now");
    if (error || data == null) return null;
    return normalizeServerTimestamp(data);
  } catch {
    return null;
  }
}
