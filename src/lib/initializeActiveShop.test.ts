import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOP_GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
}));

vi.mock("./primaryShop", () => ({
  listUserShops: vi.fn(async () => []),
  fetchProfilePrimaryShopId: vi.fn(async () => null),
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: vi.fn(async () => null),
}));

vi.mock("../offline/shopScopeMigration", () => ({
  migrateLegacyPersistenceToShop: vi.fn(async () => ({ migrated: false, reason: "no_legacy" })),
}));

vi.mock("./shopSyncContext", () => ({
  setCachedShopId: vi.fn(),
  clearCachedShopId: vi.fn(),
}));

describe("initializeActiveShopForAccount", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests } = await import("../offline/shopScope");
    const { setActiveAccountKey } = await import("../offline/accountScope");
    resetActiveShopForTests();
    setActiveAccountKey("sb:user-1");
    vi.mocked((await import("./primaryShop")).listUserShops).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockReset();
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(null);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue(null);
  });

  it("T6 — restores the membership primary shop when none is in memory", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
      { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_B);
    expect(getActiveShopId()).toBe(SHOP_B);
  });

  it("T7 — does not keep an in-memory shop that is no longer a member", async () => {
    const { setActiveShopId } = await import("../offline/shopScope");
    setActiveShopId(SHOP_GONE);
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
  });

  it("T8 — missing persisted shop falls back to the remaining member shop", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
    ]);
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(SHOP_GONE);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
  });

  it("T7 — org shop id is not activated unless it is in membership", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
      { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "manager", is_primary: false },
    ]);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue({
      organizationId: "o",
      shopId: SHOP_GONE,
    });
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).not.toBe(SHOP_GONE);
    expect(getActiveShopId()).not.toBe(SHOP_GONE);
  });

  it("T11 — empty membership list keeps the current in-memory shop (offline RPC)", async () => {
    const { setActiveShopId, getActiveShopId } = await import("../offline/shopScope");
    setActiveShopId(SHOP_A);
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
  });
});

describe("T9 — primary shop selector uses the mutation boundary", () => {
  it("Settings selector calls switchActiveShop and displays getActiveShopId", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/settings/PrimaryShopSelector.tsx"),
      "utf8",
    );
    expect(src).toContain("switchActiveShop");
    expect(src).toContain("getActiveShopId");
    expect(src).toContain("updatePrimary: true");
    expect(src).not.toContain("setActiveShopId(");
  });
});
