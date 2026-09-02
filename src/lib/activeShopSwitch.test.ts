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
    const { setActiveAccountKey } = await import("../offline/accountScope");
    resetActiveShopForTests();
    setActiveAccountKey("sb:user-1");
    setActiveShopId(SHOP_A);
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
      { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "manager", is_primary: false },
    ]);
  });

  it("T1 / T10 — authorized switch A → B", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getActiveShopId } = await import("../offline/shopScope");

    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(true);
    expect(getActiveShopId()).toBe(SHOP_B);
    expect(switchSpies.flush).toHaveBeenCalledTimes(1);
    expect(switchSpies.reset).toHaveBeenCalledTimes(1);
    expect(switchSpies.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("T2 / T10 — unauthorized shop is rejected and active shop stays A", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValueOnce([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getActiveShopId } = await import("../offline/shopScope");
    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_member");
    expect(getActiveShopId()).toBe(SHOP_A);
    expect(switchSpies.flush).not.toHaveBeenCalled();
    expect(switchSpies.reset).not.toHaveBeenCalled();
  });

  it("T3 / T4 — namespace changes to B and memory is reset before bootstrap", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getPersistenceNamespace } = await import("../offline/shopScope");
    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(true);
    expect(getPersistenceNamespace()).toBe(`sb:user-1:${SHOP_B}`);
    expect(getPersistenceNamespace()).not.toContain(SHOP_A);
    expect(switchSpies.reset).toHaveBeenCalled();
  });

  it("T5 — A → B → A restores Shop A namespace", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getActiveShopId, getPersistenceNamespace } = await import("../offline/shopScope");
    expect((await switchActiveShop(SHOP_B)).ok).toBe(true);
    expect(getActiveShopId()).toBe(SHOP_B);
    expect((await switchActiveShop(SHOP_A)).ok).toBe(true);
    expect(getActiveShopId()).toBe(SHOP_A);
    expect(getPersistenceNamespace()).toBe(`sb:user-1:${SHOP_A}`);
  });

  it("T11 — empty membership list (offline RPC) does not switch", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValueOnce([]);
    const { switchActiveShop } = await import("./activeShopSwitch");
    const { getActiveShopId } = await import("../offline/shopScope");
    const result = await switchActiveShop(SHOP_B);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_member");
    expect(getActiveShopId()).toBe(SHOP_A);
  });

  it("T12 — switch clears in-memory POS via resetForSignOut (cart/draft)", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    await switchActiveShop(SHOP_B);
    expect(switchSpies.reset).toHaveBeenCalledTimes(1);
  });

  it("T6 write path — updatePrimary persists last shop via setUserPrimaryShop", async () => {
    const { setUserPrimaryShop } = await import("./primaryShop");
    vi.mocked(setUserPrimaryShop).mockClear();
    const { switchActiveShop } = await import("./activeShopSwitch");
    await switchActiveShop(SHOP_B, { updatePrimary: true });
    expect(setUserPrimaryShop).toHaveBeenCalledWith(SHOP_B);
  });

  it("rejects invalid shop ids without touching persist", async () => {
    const { switchActiveShop } = await import("./activeShopSwitch");
    const result = await switchActiveShop("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "invalid_shop" });
    expect(switchSpies.flush).not.toHaveBeenCalled();
  });
});
