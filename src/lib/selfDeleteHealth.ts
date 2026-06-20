/**
 * Owner self-delete deployment health + readiness probes.
 */

import type { User } from "@supabase/supabase-js";
import { hasRecentOwnerDeleteReauth, sessionHasRecentSignIn } from "./ownerDeleteReauth";
import { supabase } from "./supabase";
import { invokeSupabaseEdgeFunction } from "./supabaseEdgeInvoke";

export type SelfDeleteHealthStatus = "ok" | "fail" | "unknown" | "skipped";

export type SelfDeleteHealthSnapshot = {
  routeAccessOk: boolean;
  rpcStatus: SelfDeleteHealthStatus;
  rpcDetail: string | null;
  edgeStatus: SelfDeleteHealthStatus;
  edgeDetail: string | null;
  reauthRecent: boolean;
  deviceCleanupReady: boolean;
  orphanAuth: boolean;
  checkedAt: string;
};

function isRpcMissingMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("schema cache") ||
    m.includes("function public.owner_self_delete") ||
    m.includes("owner_self_delete_health_probe")
  );
}

export async function probeOwnerSelfDeleteRpc(): Promise<{ ok: boolean; detail: string | null }> {
  if (!supabase) return { ok: false, detail: "Supabase is not configured." };

  const { data, error } = await supabase.rpc("owner_self_delete_health_probe");
  if (error) {
    if (isRpcMissingMessage(error.message ?? "")) {
      return {
        ok: false,
        detail: "Migration 111 not deployed (owner_self_delete_health_probe missing). Run supabase db push.",
      };
    }
    return { ok: false, detail: error.message ?? "RPC probe failed." };
  }

  const j = (data ?? {}) as { ok?: boolean };
  return j.ok ? { ok: true, detail: null } : { ok: false, detail: "RPC probe returned unexpected payload." };
}

export async function probeOwnerSelfDeleteEdge(): Promise<{ ok: boolean; detail: string | null }> {
  const r = await invokeSupabaseEdgeFunction<{ probe?: boolean; edge?: string }>(
    "owner-permanently-delete-account",
    { probe: true },
    { timeoutMs: 20_000, deployScript: "supabase:deploy:admin" },
  );

  if (!r.ok) {
    if (r.errorCode === "function_not_deployed") {
      return {
        ok: false,
        detail: 'Edge function not deployed. Run: npm run supabase:deploy:admin',
      };
    }
    if (r.errorCode === "timeout") {
      return { ok: false, detail: "Network timeout reaching owner-permanently-delete-account." };
    }
    return { ok: false, detail: r.message };
  }

  if (r.data.probe === true) return { ok: true, detail: null };
  return { ok: false, detail: "Edge probe returned unexpected payload." };
}

export async function probeOwnerOrphanAuth(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("owner_self_delete_orphan_auth_status");
  if (error) return false;
  return Boolean((data as { orphan_auth?: boolean } | null)?.orphan_auth);
}

export async function buildSelfDeleteHealthSnapshot(input: {
  isOwner: boolean;
  user: User | null;
}): Promise<SelfDeleteHealthSnapshot> {
  const routeAccessOk = input.isOwner;
  const reauthRecent =
    hasRecentOwnerDeleteReauth() || sessionHasRecentSignIn(input.user ?? null);

  if (!input.isOwner || !supabase) {
    return {
      routeAccessOk,
      rpcStatus: "skipped",
      rpcDetail: null,
      edgeStatus: "skipped",
      edgeDetail: null,
      reauthRecent,
      deviceCleanupReady: false,
      orphanAuth: false,
      checkedAt: new Date().toISOString(),
    };
  }

  const [rpc, edge, orphanAuth] = await Promise.all([
    probeOwnerSelfDeleteRpc(),
    probeOwnerSelfDeleteEdge(),
    probeOwnerOrphanAuth(),
  ]);

  return {
    routeAccessOk,
    rpcStatus: rpc.ok ? "ok" : "fail",
    rpcDetail: rpc.detail,
    edgeStatus: edge.ok ? "ok" : "fail",
    edgeDetail: edge.detail,
    reauthRecent,
    deviceCleanupReady: rpc.ok,
    orphanAuth,
    checkedAt: new Date().toISOString(),
  };
}
