import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  clampInternalOpsPage,
  fetchInternalOpsShopCashExpenses,
  fetchInternalOpsShopSaleReturns,
  fetchInternalOpsShopSaleVoids,
  sliceInternalOpsHasMore,
} from "./wakaInternalAdmin";

describe("internal ops shop ledger fetchers", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls internal_ops_shop_sale_returns and slices has_more", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({
      id: `ret-${i}`,
      shop_id: "shop-a",
      sale_id: `sale-${i}`,
      product_id: "p1",
      product_name: "Soda",
      quantity: 1,
      refund_amount_ugx: 1000,
      reason: "damaged",
      stock_applied_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    }));
    rpcMock.mockResolvedValue({ data: rows, error: null });

    const result = await fetchInternalOpsShopSaleReturns({ shopId: "shop-a", limit: 25, offset: 0 });

    expect(rpcMock).toHaveBeenCalledWith("internal_ops_shop_sale_returns", {
      p_shop_id: "shop-a",
      p_limit: 25,
      p_offset: 0,
    });
    expect(result.error).toBeNull();
    expect(result.hasMore).toBe(true);
    expect(result.rows).toHaveLength(25);
  });

  it("calls voids and expenses RPCs", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchInternalOpsShopSaleVoids({ shopId: "shop-a", limit: 10, offset: 10 });
    await fetchInternalOpsShopCashExpenses({ shopId: "shop-a" });
    expect(rpcMock).toHaveBeenNthCalledWith(1, "internal_ops_shop_sale_voids", {
      p_shop_id: "shop-a",
      p_limit: 10,
      p_offset: 10,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "internal_ops_shop_cash_expenses", {
      p_shop_id: "shop-a",
      p_limit: 25,
      p_offset: 0,
    });
  });

  it("surfaces RPC errors distinctly from empty matches", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Forbidden" } });
    const failed = await fetchInternalOpsShopSaleReturns({ shopId: "shop-a" });
    expect(failed).toEqual({ rows: [], hasMore: false, error: "Forbidden" });

    rpcMock.mockResolvedValue({ data: [], error: null });
    const empty = await fetchInternalOpsShopSaleReturns({ shopId: "shop-empty" });
    expect(empty).toEqual({ rows: [], hasMore: false, error: null });
  });

  it("clamps page size and offset on the client before the RPC", () => {
    expect(clampInternalOpsPage({ limit: 999, offset: -4 })).toEqual({ pageSize: 50, offset: 0 });
    expect(clampInternalOpsPage({ limit: 0, offset: 900 })).toEqual({ pageSize: 1, offset: 500 });
    expect(sliceInternalOpsHasMore([1, 2, 3, 4, 5, 6], 5)).toEqual({ rows: [1, 2, 3, 4, 5], hasMore: true });
  });
});

describe("ADMIN-2 phase 1 source contracts", () => {
  const root = process.cwd();

  it("Business tab adds the three collapsible ledgers and lazy-loads them", () => {
    const src = readFileSync(
      join(root, "src/components/internal-admin/v2/shop-console/tabs/ShopConsoleBusinessTab.tsx"),
      "utf8",
    );
    expect(src).toContain('title="Returns"');
    expect(src).toContain('title="Sale voids / refunds"');
    expect(src).toContain('title="Cash expenses"');
    expect(src).toContain("ensureOpsLedgers");
    expect(src).toContain("AdminCollapsible");
    expect(src).toContain("AdminShopOpsLedgerPanel");
    expect(src).toContain("No returns in cloud for this shop.");
    expect(src).toContain("No sale voids in cloud for this shop.");
    expect(src).toContain("No cash expenses in cloud for this shop.");
    expect(src).not.toContain('.from("sale_returns")');
    expect(src).not.toContain('.from("expenses")');
    const panel = readFileSync(
      join(root, "src/components/internal-admin/v2/shop-console/AdminShopOpsLedgerPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("Load more");
    expect(panel).toContain("EmptyState");
  });

  it("preview mode uses local fixtures and live mode calls the RPCs", () => {
    const src = readFileSync(
      join(root, "src/components/internal-admin/v2/shop-console/useShopConsoleState.ts"),
      "utf8",
    );
    expect(src).toContain("PREVIEW_SHOP_SALE_RETURNS");
    expect(src).toContain("PREVIEW_SHOP_SALE_VOIDS");
    expect(src).toContain("PREVIEW_SHOP_CASH_EXPENSES");
    expect(src).toContain("fetchInternalOpsShopSaleReturns");
    expect(src).toContain("fetchInternalOpsShopSaleVoids");
    expect(src).toContain("fetchInternalOpsShopCashExpenses");
    expect(src).toContain("if (effectivePreviewMode)");
    expect(src).toContain("applyOpsLedgerLoadMore");
    expect(src).toContain("isCurrentOpsLedgerRequest");
    expect(src).not.toContain('.from("sale_returns")');
    expect(src).not.toContain('.from("expenses")');
  });

  it("Overview does not fetch operational ledgers", () => {
    const src = readFileSync(
      join(root, "src/components/internal-admin/v2/shop-console/tabs/ShopConsoleOverviewTab.tsx"),
      "utf8",
    );
    expect(src).not.toContain("ensureOpsLedgers");
    expect(src).not.toContain("fetchInternalOpsShopSaleReturns");
    expect(src).not.toContain("fetchInternalOpsShopCashExpenses");
  });

  it("does not add a 12th shop console tab", () => {
    const src = readFileSync(join(root, "src/lib/shopConsoleState.ts"), "utf8");
    expect(src).toContain('"business"');
    expect(src).not.toContain('"operations"');
    expect(src).not.toContain('"returns"');
  });

  it("admin live path does not PostgREST-read sale_returns or expenses for these datasets", () => {
    const admin = readFileSync(join(root, "src/lib/wakaInternalAdmin.ts"), "utf8");
    expect(admin).toContain("internal_ops_shop_sale_returns");
    expect(admin).toContain("internal_ops_shop_sale_voids");
    expect(admin).toContain("internal_ops_shop_cash_expenses");
    expect(admin).not.toContain('.from("sale_returns")');
    expect(admin).not.toContain(".from('sale_returns')");
    expect(admin).not.toContain('.from("expenses")');
    expect(admin).not.toContain(".from('expenses')");
    expect(admin).not.toContain('.from("sale_voids")');
  });
});
