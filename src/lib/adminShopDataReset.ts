import { supabase } from "./supabase";

/**
 * Internal WAKA admin: reset a shop's business/test data.
 * Server-side authorization, dependency-safe deletion, and audit logging all
 * live in the single Postgres RPC `admin_reset_shop_business_data` — this file
 * is a thin client wrapper, not a second implementation of the reset logic.
 */

export type ShopResetCounts = {
  products: number;
  inventory_movements: number;
  sales: number;
  sale_line_items: number;
  sale_payments: number;
  sale_voids: number;
  sale_returns: number;
  receipts: number;
  customers: number;
  customer_debt_payments: number;
  audit_logs: number;
  ai_generation_usage_log: number;
  shop_day_closes: number;
  shop_day_drawer_opens: number;
  shop_shifts: number;
  shop_purchases: number;
  shop_supplier_payments: number;
  shop_cash_drawer_adjustments: number;
  shop_inventory_count_sessions: number;
  shop_cloud_snapshots: number;
};

export type AdminShopResetPreviewResult =
  | { ok: true; shopName: string; shopNumber: string | null; counts: ShopResetCounts }
  | { ok: false; message: string; errorCode?: string };

export type AdminShopResetExecuteResult =
  | {
      ok: true;
      shopName: string;
      shopNumber: string | null;
      deleted: ShopResetCounts;
      verification: ShopResetCounts;
    }
  | { ok: false; message: string; errorCode?: string };

function missingFunctionMessage(error: { message?: string; code?: string }): string | null {
  const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
  return missingFn ? "Missing RPC: admin_reset_shop_business_data. Apply migration 191 and retry." : null;
}

const EMPTY_COUNTS: ShopResetCounts = {
  products: 0,
  inventory_movements: 0,
  sales: 0,
  sale_line_items: 0,
  sale_payments: 0,
  sale_voids: 0,
  sale_returns: 0,
  receipts: 0,
  customers: 0,
  customer_debt_payments: 0,
  audit_logs: 0,
  ai_generation_usage_log: 0,
  shop_day_closes: 0,
  shop_day_drawer_opens: 0,
  shop_shifts: 0,
  shop_purchases: 0,
  shop_supplier_payments: 0,
  shop_cash_drawer_adjustments: 0,
  shop_inventory_count_sessions: 0,
  shop_cloud_snapshots: 0,
};

function normalizeCounts(raw: unknown): ShopResetCounts {
  const j = (raw ?? {}) as Record<string, unknown>;
  const counts = { ...EMPTY_COUNTS };
  for (const key of Object.keys(counts) as (keyof ShopResetCounts)[]) {
    const v = j[key];
    counts[key] = typeof v === "number" ? v : Number(v ?? 0) || 0;
  }
  return counts;
}

/** Read-only: returns exact per-entity counts that WOULD be deleted. Never mutates data. */
export async function adminPreviewShopReset(shopId: string): Promise<AdminShopResetPreviewResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_reset_shop_business_data", {
    p_shop_id: shopId,
    p_phase: "preview",
  });
  if (error) {
    return { ok: false, message: missingFunctionMessage(error) ?? error.message };
  }
  const j = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    shop_name?: string;
    shop_number?: string | null;
    counts?: unknown;
  };
  if (j.ok !== true) {
    return { ok: false, message: j.detail ?? j.error ?? "Could not preview shop reset.", errorCode: j.error };
  }
  return {
    ok: true,
    shopName: j.shop_name ?? "—",
    shopNumber: j.shop_number ?? null,
    counts: normalizeCounts(j.counts),
  };
}

/**
 * Destructive: deletes the shop's business/test data. Requires the exact
 * confirmation phrase "RESET SHOP" (server-validated — this is a UX
 * convenience, not the actual authorization boundary).
 */
export async function adminResetShopBusinessData(
  shopId: string,
  confirmation: string,
): Promise<AdminShopResetExecuteResult> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_reset_shop_business_data", {
    p_shop_id: shopId,
    p_phase: "execute",
    p_confirmation: confirmation.trim(),
  });
  if (error) {
    return { ok: false, message: missingFunctionMessage(error) ?? error.message };
  }
  const j = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    shop_name?: string;
    shop_number?: string | null;
    deleted?: unknown;
    verification?: unknown;
  };
  if (j.ok !== true) {
    return { ok: false, message: j.detail ?? j.error ?? "Shop reset failed.", errorCode: j.error };
  }
  return {
    ok: true,
    shopName: j.shop_name ?? "—",
    shopNumber: j.shop_number ?? null,
    deleted: normalizeCounts(j.deleted),
    verification: normalizeCounts(j.verification),
  };
}

/** True only when every entity in the post-reset verification is zero. */
export function isShopResetVerified(verification: ShopResetCounts): boolean {
  return Object.values(verification).every((n) => n === 0);
}
