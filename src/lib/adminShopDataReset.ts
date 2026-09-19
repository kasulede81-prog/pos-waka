import { supabase } from "./supabase";

/**
 * Internal WAKA admin: reset a shop's business/test data.
 * Server-side authorization, dependency-safe deletion, and audit logging all
 * live in the single Postgres RPC `admin_reset_shop_business_data` — this file
 * is a thin client wrapper, not a second implementation of the reset logic.
 */

/**
 * Every table the server-side reset plan deletes (public.shop_reset_business_plan(), migration
 * 20260920100000). Order = deletion order. A unit test keeps this list identical to the SQL plan.
 */
export const SHOP_RESET_COUNT_KEYS = [
  "loyalty_redemptions",
  "loyalty_transactions",
  "loyalty_accounts",
  "financial_correction_requests",
  "sale_line_item_corrections",
  "kitchen_ticket_items",
  "kitchen_tickets",
  "table_session_events",
  "waitlist_entries",
  "table_reservations",
  "table_sessions",
  "sale_line_items",
  "sale_payments",
  "receipts",
  "sale_voids",
  "sale_returns",
  "customer_debt_payments",
  "sales",
  "inventory_movements",
  "shop_stock_movements",
  "shop_cash_drawer_adjustments",
  "shop_inventory_count_sessions",
  "shop_supplier_payments",
  "shop_purchases",
  "expenses",
  "shop_suppliers",
  "print_jobs",
  "barcode_labels",
  "products",
  "customers",
  "ai_generation_usage_log",
  "shop_day_closes",
  "shop_day_drawer_opens",
  "shop_shifts",
  "shop_activity",
  "shop_cloud_snapshots",
  "audit_logs",
] as const;

export type ShopResetCountKey = (typeof SHOP_RESET_COUNT_KEYS)[number];
export type ShopResetCounts = Record<ShopResetCountKey, number>;

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
  | { ok: false; message: string; errorCode?: string; failedTable?: string };

function missingFunctionMessage(error: { message?: string; code?: string }): string | null {
  const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
  return missingFn ? "Missing RPC: admin_reset_shop_business_data. Apply migration 191 and retry." : null;
}

const EMPTY_COUNTS = Object.fromEntries(SHOP_RESET_COUNT_KEYS.map((k) => [k, 0])) as ShopResetCounts;

function normalizeCounts(raw: unknown): ShopResetCounts {
  const j = (raw ?? {}) as Record<string, unknown>;
  const counts = { ...EMPTY_COUNTS };
  for (const key of SHOP_RESET_COUNT_KEYS) {
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
    failed_table?: string | null;
    shop_name?: string;
    shop_number?: string | null;
    deleted?: unknown;
    verification?: unknown;
  };
  if (j.ok !== true) {
    const base = j.detail ?? j.error ?? "Shop reset failed.";
    const failedTable = j.failed_table ?? undefined;
    return {
      ok: false,
      message: failedTable && !base.includes(failedTable) ? `${base} (failed at: ${failedTable})` : base,
      errorCode: j.error,
      ...(failedTable ? { failedTable } : {}),
    };
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
