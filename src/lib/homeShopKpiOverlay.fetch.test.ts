import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, onlineMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  onlineMock: vi.fn(() => true),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => onlineMock(),
}));

import { fetchShopHomeKpiOverlay } from "./homeShopKpiOverlay";

const TODAY = "2026-08-20";
const MONTH = "2026-08";

describe("fetchShopHomeKpiOverlay", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    onlineMock.mockReturnValue(true);
  });

  it("returns shop today + month totals on RPC success", async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "shop_get_daily_sales_summary") {
        return {
          data: {
            ok: true,
            transaction_count: 3,
            total_revenue_ugx: 13_000,
            expected_cash_in_drawer_ugx: 9_000,
          },
          error: null,
        };
      }
      return {
        data: {
          ok: true,
          total_revenue_ugx: 685_000,
          estimated_profit_ugx: 218_401,
          previous_month_revenue_ugx: 400_000,
          revenue_growth_pct: 71.25,
        },
        error: null,
      };
    });

    const result = await fetchShopHomeKpiOverlay(TODAY, MONTH);
    expect(result).toEqual({
      status: "ok",
      overlay: {
        todayKey: TODAY,
        monthKey: MONTH,
        todayTransactionCount: 3,
        todayRevenueUgx: 13_000,
        todayExpectedCashUgx: 9_000,
        monthRevenueUgx: 685_000,
        monthProfitUgx: 218_401,
        previousMonthRevenueUgx: 400_000,
        revenueGrowthPct: 71.25,
      },
    });
  });

  it("returns error instead of a silent null when both RPCs fail", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(fetchShopHomeKpiOverlay(TODAY, MONTH)).resolves.toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network"));
    await expect(fetchShopHomeKpiOverlay(TODAY, MONTH)).resolves.toEqual({ status: "error" });
  });

  it("skips when the device is offline", async () => {
    onlineMock.mockReturnValue(false);
    await expect(fetchShopHomeKpiOverlay(TODAY, MONTH)).resolves.toEqual({ status: "skipped" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
