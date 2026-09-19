import { describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHOP_RESET_COUNT_KEYS,
  adminPreviewShopReset,
  adminResetShopBusinessData,
  isShopResetVerified,
  type ShopResetCounts,
} from "./adminShopDataReset";

const SHOP_ID = "shop-1";

const ZERO_COUNTS: Record<string, number> = {
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

describe("adminPreviewShopReset", () => {
  it("calls the RPC in preview phase and normalizes counts (read-only, no p_confirmation)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        phase: "preview",
        shop_id: SHOP_ID,
        shop_name: "Test Shop",
        shop_number: "A044",
        counts: { ...ZERO_COUNTS, products: 500, sales: 142 },
      },
      error: null,
    });

    const result = await adminPreviewShopReset(SHOP_ID);

    expect(rpcMock).toHaveBeenCalledWith("admin_reset_shop_business_data", {
      p_shop_id: SHOP_ID,
      p_phase: "preview",
    });
    expect(rpcMock.mock.calls[0]?.[1]).not.toHaveProperty("p_confirmation");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shopName).toBe("Test Shop");
      expect(result.counts.products).toBe(500);
      expect(result.counts.sales).toBe(142);
      expect(result.counts.sale_line_items).toBe(0);
    }
  });

  it("surfaces a forbidden response as a failure, not a thrown error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, error: "forbidden", detail: "WAKA internal admin only." },
      error: null,
    });

    const result = await adminPreviewShopReset(SHOP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("forbidden");
      expect(result.message).toBe("WAKA internal admin only.");
    }
  });

  it("surfaces a transport-level RPC error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "network down" } });
    const result = await adminPreviewShopReset(SHOP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("network down");
  });

  it("reports a missing-function error with an actionable message", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Could not find the function public.admin_reset_shop_business_data", code: "PGRST202" },
    });
    const result = await adminPreviewShopReset(SHOP_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Missing RPC");
  });
});

describe("adminResetShopBusinessData", () => {
  it("calls the RPC in execute phase with the trimmed confirmation phrase", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        phase: "execute",
        shop_name: "Test Shop",
        shop_number: "A044",
        deleted: { ...ZERO_COUNTS, products: 500 },
        verification: ZERO_COUNTS,
      },
      error: null,
    });

    const result = await adminResetShopBusinessData(SHOP_ID, "  RESET SHOP  ");

    expect(rpcMock).toHaveBeenCalledWith("admin_reset_shop_business_data", {
      p_shop_id: SHOP_ID,
      p_phase: "execute",
      p_confirmation: "RESET SHOP",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted.products).toBe(500);
      expect(isShopResetVerified(result.verification)).toBe(true);
    }
  });

  it("surfaces confirmation_required without deleting anything", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, error: "confirmation_required", detail: "Type RESET SHOP to confirm." },
      error: null,
    });
    const result = await adminResetShopBusinessData(SHOP_ID, "not the phrase");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("confirmation_required");
  });

  it("surfaces a server-side reset_failed result (atomic rollback) as a clear failure", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, error: "reset_failed", detail: "deadlock detected" },
      error: null,
    });
    const result = await adminResetShopBusinessData(SHOP_ID, "RESET SHOP");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("reset_failed");
      expect(result.message).toContain("deadlock");
    }
  });
});

describe("isShopResetVerified", () => {
  it("is true only when every count is zero", () => {
    expect(isShopResetVerified(ZERO_COUNTS as ShopResetCounts)).toBe(true);
    expect(isShopResetVerified({ ...ZERO_COUNTS, products: 1 } as ShopResetCounts)).toBe(false);
  });
});

describe("reset coverage stays in lockstep with the server-side plan", () => {
  it("SHOP_RESET_COUNT_KEYS equals the tables of shop_reset_business_plan() in deletion order", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260920100000_shop_reset_fk_ordered_plan.sql"),
      "utf8",
    );
    const planBlock = sql.slice(
      sql.indexOf("create or replace function public.shop_reset_business_plan"),
      sql.indexOf("create or replace function public.shop_reset_table_classification"),
    );
    const planTables = [...planBlock.matchAll(/^\s+\((\d+),\s+'(\w+)',/gm)].map((m) => m[2]);
    expect(planTables.length).toBeGreaterThan(30);
    expect([...SHOP_RESET_COUNT_KEYS]).toEqual(planTables);
  });

  it("previously unverified tables now fail client verification (stock ledger, table sessions, loyalty redemptions)", () => {
    const zero = Object.fromEntries(SHOP_RESET_COUNT_KEYS.map((k) => [k, 0])) as ShopResetCounts;
    expect(isShopResetVerified(zero)).toBe(true);
    for (const k of ["shop_stock_movements", "table_sessions", "loyalty_redemptions", "expenses"] as const) {
      expect(isShopResetVerified({ ...zero, [k]: 1 })).toBe(false);
    }
  });

  it("normalizes the new keys from the server response", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: true, phase: "preview", shop_name: "S", counts: { table_sessions: 1, shop_stock_movements: 100 } },
      error: null,
    });
    const r = await adminPreviewShopReset(SHOP_ID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.counts.table_sessions).toBe(1);
      expect(r.counts.shop_stock_movements).toBe(100);
      expect(r.counts.loyalty_redemptions).toBe(0);
    }
  });

  it("surfaces the failing table of an atomic rollback", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ok: false, error: "reset_failed", detail: "verification_failed_rows_remaining=3", failed_table: "shop_stock_movements" },
      error: null,
    });
    const r = await adminResetShopBusinessData(SHOP_ID, "RESET SHOP");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedTable).toBe("shop_stock_movements");
      expect(r.message).toContain("shop_stock_movements");
    }
  });
});
