import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentShopRow } from "./wakaInternalAdmin";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  fetchInternalOpsSearchShops,
  filterAdminShopListRows,
  isInternalOpsExactShopLookup,
  shouldQueryInternalOpsShopSearch,
} from "./wakaInternalAdmin";

const OLD_SHOP: RecentShopRow = {
  id: "a1870000-0000-4000-8000-000000000001",
  shop_number: "A9001",
  name: "Zebra Hidden Mart",
  district: "Gulu",
  city: "Center",
  is_active: true,
  created_at: "2020-01-01T00:00:00.000Z",
  plan_code: "starter",
  trial_days_left: null,
  owner_email: "hidden.owner@example.com",
  owner_full_name: "Nakato Hidden",
};

function rpcRow(over: Partial<RecentShopRow> = {}) {
  const row = { ...OLD_SHOP, ...over };
  return {
    id: row.id,
    shop_number: row.shop_number,
    name: row.name,
    district: row.district,
    city: row.city,
    is_active: row.is_active,
    created_at: row.created_at,
    plan_code: row.plan_code,
    trial_ends_at: null,
    subscription_status: "active",
    owner_label: row.owner_full_name,
    owner_email: row.owner_email,
    owner_full_name: row.owner_full_name,
  };
}

describe("fetchInternalOpsSearchShops", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls internal_ops_search_shops and slices has_more", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => rpcRow({ id: `shop-${i}`, name: `Shop ${i}` }));
    rpcMock.mockResolvedValue({ data: rows, error: null });

    const result = await fetchInternalOpsSearchShops({ query: "shop", limit: 25, offset: 0 });

    expect(rpcMock).toHaveBeenCalledWith("internal_ops_search_shops", {
      p_query: "shop",
      p_limit: 25,
      p_offset: 0,
    });
    expect(result.error).toBeNull();
    expect(result.hasMore).toBe(true);
    expect(result.rows).toHaveLength(25);
  });

  it("does not cap discovery to the newest 100 shops", async () => {
    rpcMock.mockResolvedValue({ data: [rpcRow()], error: null });
    const result = await fetchInternalOpsSearchShops({ query: "Zebra Hidden", limit: 8, offset: 0 });
    expect(rpcMock.mock.calls[0]?.[0]).toBe("internal_ops_search_shops");
    expect(rpcMock.mock.calls[0]?.[0]).not.toBe("internal_ops_shops_by_signup");
    expect(result.rows[0]?.id).toBe(OLD_SHOP.id);
  });

  it("surfaces search errors distinctly from empty matches", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Forbidden" } });
    const failed = await fetchInternalOpsSearchShops({ query: "ab" });
    expect(failed).toEqual({ rows: [], hasMore: false, error: "Forbidden" });

    rpcMock.mockResolvedValue({ data: [], error: null });
    const empty = await fetchInternalOpsSearchShops({ query: "zz-no-match" });
    expect(empty).toEqual({ rows: [], hasMore: false, error: null });
  });
});

describe("internal ops shop search helpers", () => {
  it("treats UUID and A-number as exact lookups", () => {
    expect(isInternalOpsExactShopLookup(OLD_SHOP.id)).toBe(true);
    expect(isInternalOpsExactShopLookup("A9001")).toBe(true);
    expect(isInternalOpsExactShopLookup("z")).toBe(false);
  });

  it("requires length 2 unless UUID/A-number, and allows empty browse", () => {
    expect(shouldQueryInternalOpsShopSearch("", { allowEmptyBrowse: true })).toBe(true);
    expect(shouldQueryInternalOpsShopSearch("")).toBe(false);
    expect(shouldQueryInternalOpsShopSearch("z")).toBe(false);
    expect(shouldQueryInternalOpsShopSearch("ab")).toBe(true);
    expect(shouldQueryInternalOpsShopSearch(OLD_SHOP.id)).toBe(true);
  });

  it("filters preview fixtures locally without requiring a server call", () => {
    const rows = filterAdminShopListRows([OLD_SHOP], {
      query: "zebra",
      district: "",
      plan: "",
      status: "all",
      applyQuery: true,
    });
    expect(rows).toHaveLength(1);
  });
});

describe("ADMIN-1 shop discovery source contracts", () => {
  const root = process.cwd();

  it("AdminShopsPage calls server search and keeps shop-console navigation", () => {
    const src = readFileSync(
      join(root, "src/components/internal-admin/v2/pages/AdminShopsPage.tsx"),
      "utf8",
    );
    expect(src).toContain("fetchInternalOpsSearchShops");
    expect(src).toContain("PREVIEW_RECENT_SHOPS");
    expect(src).toContain("internalAdminShopHref(s.id, previewMode)");
    expect(src).toContain("Shop search failed");
    expect(src).toContain("No shops match this search.");
    expect(src).toContain("Status, plan, and district filter loaded results only.");
    expect(src).toContain("isCurrentAdminShopsRequest");
    expect(src).not.toContain("fetchShopsBySignupDate");
    expect(src).not.toContain("useInternalOpsData");
    expect(src).not.toContain("window.open");
  });

  it("GlobalSearchBar calls server search and keeps shop-console navigation", () => {
    const src = readFileSync(join(root, "src/components/internal-admin/v2/ops/OpsWidgets.tsx"), "utf8");
    expect(src).toContain("fetchInternalOpsSearchShops");
    expect(src).toContain("shouldQueryInternalOpsShopSearch");
    expect(src).toContain("internalAdminShopHref(r.id, previewMode)");
    expect(src).toContain("Shop search failed");
    expect(src).toContain("previewMode");
    expect(src).not.toContain("fetchShopsBySignupDate");
    expect(src).not.toContain("window.open");
  });

  it("global search preload no longer uses newest-100 as the shop search source", () => {
    const src = readFileSync(join(root, "src/hooks/useAdminGlobalSearchData.ts"), "utf8");
    expect(src).not.toContain("fetchShopsBySignupDate");
    expect(src).toContain("PREVIEW_RECENT_SHOPS");
    expect(src).toContain("setShops([])");
  });
});
