import { hasSupabaseConfig, supabase } from "../supabase";
import { getActiveShopId } from "../../offline/shopScope";
import { isEfrisEnabled } from "./gate";
import type { EfrisState } from "./types";
import type { SaleStatus } from "../../types";

export type EfrisEnqueueOutcome =
  | { ok: true; enqueued: false; efris_state: "NOT_REQUIRED"; reason: string }
  | { ok: true; enqueued: true; efris_state: EfrisState; created: boolean; saleId: string; shopId: string }
  | { ok: false; error: string };

export type EfrisEnqueueDeps = {
  getShopId: () => string | null;
  hasCloud: () => boolean;
  readEnabled: (shopId: string) => Promise<boolean>;
  enqueueRpc: (shopId: string, saleId: string) => Promise<{
    ok: boolean;
    enqueued?: boolean;
    created?: boolean;
    efris_state?: string;
    error?: string;
  }>;
  invokeSubmitStub: (shopId: string, saleId: string) => Promise<void>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const enabledCache = new Map<string, { enabled: boolean; at: number }>();
const ENABLED_TTL_MS = 60_000;

export function resetEfrisConfigCache(): void {
  enabledCache.clear();
}

export function setEfrisEnabledCacheForTests(shopId: string, enabled: boolean): void {
  enabledCache.set(shopId, { enabled, at: Date.now() });
}

async function defaultReadEnabled(shopId: string): Promise<boolean> {
  const cached = enabledCache.get(shopId);
  if (cached && Date.now() - cached.at < ENABLED_TTL_MS) return cached.enabled;
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;
  const { data, error } = await supabase.rpc("shop_get_efris_config", { p_shop_id: shopId });
  if (error) return false;
  const row = data as { ok?: boolean; enabled?: boolean } | null;
  if (!row || row.ok === false) return false;
  const enabled = isEfrisEnabled(row.enabled);
  enabledCache.set(shopId, { enabled, at: Date.now() });
  return enabled;
}

async function defaultEnqueueRpc(shopId: string, saleId: string) {
  if (!supabase) return { ok: false as const, error: "no_supabase" };
  const { data, error } = await supabase.rpc("shop_enqueue_efris_submission", {
    p_shop_id: shopId,
    p_sale_id: saleId,
  });
  if (error) return { ok: false as const, error: error.message ?? "rpc_failed" };
  const row = data as {
    ok?: boolean;
    enqueued?: boolean;
    created?: boolean;
    efris_state?: string;
    error?: string;
  } | null;
  if (!row || row.ok === false) return { ok: false as const, error: row?.error ?? "rpc_rejected" };
  return {
    ok: true as const,
    enqueued: row.enqueued === true,
    created: row.created === true,
    efris_state: row.efris_state,
  };
}

async function defaultInvokeSubmitStub(shopId: string, saleId: string): Promise<void> {
  const { invokeSupabaseEdgeFunction } = await import("../supabaseEdgeInvoke");
  await invokeSupabaseEdgeFunction(
    "efris-submit",
    { shop_id: shopId, sale_id: saleId },
    { timeoutMs: 15_000, deployScript: "supabase:deploy:efris" },
  );
}

export function defaultEfrisEnqueueDeps(): EfrisEnqueueDeps {
  return {
    getShopId: () => getActiveShopId(),
    hasCloud: () => hasSupabaseConfig && Boolean(supabase),
    readEnabled: defaultReadEnabled,
    enqueueRpc: defaultEnqueueRpc,
    invokeSubmitStub: defaultInvokeSubmitStub,
  };
}

/**
 * Post-complete hook. Never throws to the sale path.
 * Disabled / local-only / unknown shop → no outbox, no Edge call.
 */
export async function considerEfrisEnqueue(
  input: { saleId: string; saleStatus: SaleStatus | string | undefined },
  deps: EfrisEnqueueDeps = defaultEfrisEnqueueDeps(),
): Promise<EfrisEnqueueOutcome> {
  try {
    if (input.saleStatus !== "completed") {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "sale_not_completed" };
    }
    if (!UUID_RE.test(input.saleId)) {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "invalid_sale_id" };
    }
    if (!deps.hasCloud()) {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "no_cloud" };
    }
    const shopId = deps.getShopId();
    if (!shopId || !UUID_RE.test(shopId)) {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "no_shop" };
    }
    const enabled = await deps.readEnabled(shopId);
    if (!isEfrisEnabled(enabled)) {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "disabled" };
    }

    const rpc = await deps.enqueueRpc(shopId, input.saleId);
    if (!rpc.ok) return { ok: false, error: rpc.error ?? "enqueue_failed" };
    if (!rpc.enqueued) {
      return { ok: true, enqueued: false, efris_state: "NOT_REQUIRED", reason: "rpc_not_required" };
    }

    try {
      await deps.invokeSubmitStub(shopId, input.saleId);
    } catch {
      /* stub failure must not affect the WAKA sale */
    }

    return {
      ok: true,
      enqueued: true,
      efris_state: (rpc.efris_state as EfrisState) ?? "PENDING",
      created: rpc.created === true,
      saleId: input.saleId,
      shopId,
    };
  } catch {
    return { ok: false, error: "enqueue_exception" };
  }
}

/** Fire-and-forget from finalizeDraftSale. Sale completion does not await this. */
export function enqueueEfrisAfterCompletedSale(saleId: string, saleStatus: SaleStatus | string | undefined): void {
  void considerEfrisEnqueue({ saleId, saleStatus }).catch(() => undefined);
}
