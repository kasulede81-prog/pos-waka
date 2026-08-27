import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const switchSpies = vi.hoisted(() => ({
  flush: vi.fn(),
  reset: vi.fn(),
  bootstrap: vi.fn(async () => undefined),
}));

vi.mock("../store/usePosStore", () => ({
  flushPendingPersist: switchSpies.flush,
  usePosStore: { getState: () => ({ resetForSignOut: switchSpies.reset }) },
  bootstrapPosFromDisk: switchSpies.bootstrap,
}));

vi.mock("./primaryShop", () => ({
  listUserShops: vi.fn(async () => [
    { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "manager", is_primary: false },
  ]),
  setUserPrimaryShop: vi.fn(async () => true),
}));

vi.mock("../offline/shopScopeMigration", () => ({
  migrateLegacyPersistenceToShop: vi.fn(async () => ({ migrated: false, reason: "no_legacy" })),
}));

describe("MB-1 activeShopSwitch", () => {
  beforeEach(async () => {
    switchSpies.flush.mockClear();
    switchSpies.reset.mockClear();
    switchSpies.bootstrap.mockClear();
    const { resetActiveShopForTests, setActiveShopId } = await import("../offline/shopScope");
    resetActiveShopForTests();
    setActiveShopId(SHOP_A);
  });

  it("T7 — branch switch flushes and re-bootstraps without mutating business data paths", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getActiveShopId } = await import("../offline/shopScope");

    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(true);
    expect(getActiveShopId()).toBe(SHOP_B);
    expect(switchSpies.flush).toHaveBeenCalledTimes(1);
    expect(switchSpies.reset).toHaveBeenCalledTimes(1);
    expect(switchSpies.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("rejects non-member shop without flush", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValueOnce([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { switchActiveShop } = await import("./activeShopSwitch");
    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_member");
    expect(switchSpies.flush).not.toHaveBeenCalled();
  });
});
