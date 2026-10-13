/**
 * The dashboard's shop total must never present an RLS-limited count as the
 * platform total.
 *
 * `fetchInternalDashboardStats` prefers the `internal_ops_dashboard_metrics` RPC,
 * which counts `shops` inside a SECURITY DEFINER function and therefore sees
 * every shop. When that RPC fails it falls back to counting `shops` AS THE
 * CALLER — which is subject to `shops_select`. Any internal role except
 * field_agent sees everything, but a field_agent is restricted to their assigned
 * districts, so for them the fallback returns a FLOOR while looking like a total.
 *
 * The fix is not to hide the fallback (the other numbers are still useful) but to
 * mark it, so the tile reads "80+" and a caveat line explains why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), fromMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { fetchInternalDashboardStats, formatTotalShops } from "./wakaInternalAdmin";

/**
 * Any chain of `.select().gte().in()…`, awaitable, resolving one fixed shape.
 * The fallback fires thirteen such queries in a fixed order; every one of them
 * only has to resolve, so one shape is enough.
 */
function chainable(resolved: unknown) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lte", "lt", "eq", "in", "not", "order", "limit"]) {
    node[method] = () => node;
  }
  node.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolved).then(resolve);
  return node;
}

/** What RLS lets the caller see. `null` in production means "no error". */
function fallbackCounts(visibleShops: number) {
  fromMock.mockImplementation(() => chainable({ count: visibleShops, data: [], error: null }));
}

describe("dashboard shop total — partial counts are marked, never passed off as totals", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("marks the fallback counts as partial when the metrics RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "metrics unavailable" } });
    fallbackCounts(7);

    const res = await fetchInternalDashboardStats();

    expect(res.ok).toBe(true);
    expect(res.stats?.totalShops).toBe(7);
    expect(res.stats?.countsArePartial).toBe(true);
  });

  it("still reports the number it actually saw, rather than zeroing it", async () => {
    // Hiding the number would be worse: the operator loses a useful signal. It
    // is the PRESENTATION that changes, not the value.
    rpcMock.mockResolvedValue({ data: null, error: { message: "metrics unavailable" } });
    fallbackCounts(2); // e.g. a field_agent with two districts

    const res = await fetchInternalDashboardStats();

    expect(res.stats?.totalShops).toBe(2);
    expect(res.stats?.countsArePartial).toBe(true);
  });

  it("does NOT mark the counts when the metrics RPC answers", async () => {
    rpcMock.mockResolvedValue({ data: { total_shops: 80, active_today: 12 }, error: null });
    fallbackCounts(3); // would be wrong; it must not be consulted

    const res = await fetchInternalDashboardStats();

    expect(res.ok).toBe(true);
    expect(res.stats?.totalShops).toBe(80);
    expect(res.stats?.countsArePartial).toBeFalsy();
    // The RPC path never queried the tables directly.
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("formatTotalShops", () => {
  it("suffixes a floor with '+'", () => {
    expect(formatTotalShops({ totalShops: 80, countsArePartial: true })).toBe("80+");
  });

  it("leaves a true total bare", () => {
    expect(formatTotalShops({ totalShops: 80 })).toBe("80");
    expect(formatTotalShops({ totalShops: 80, countsArePartial: false })).toBe("80");
  });

  it("marks zero honestly — a floor of zero is still a floor", () => {
    expect(formatTotalShops({ totalShops: 0, countsArePartial: true })).toBe("0+");
    expect(formatTotalShops({ totalShops: 0 })).toBe("0");
  });
});
