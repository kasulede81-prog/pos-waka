import { describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
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
