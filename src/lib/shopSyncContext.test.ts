import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedShopId,
  consumeOrResolveShopCtx,
  inventoryMovementNamespace,
  resetShopCtxTickForTests,
  setCachedShopId,
  shopCtxTickResolveCount,
} from "./shopSyncContext";

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:user-abc",
}));

describe("shopSyncContext", () => {
  beforeEach(() => {
    resetShopCtxTickForTests();
    clearCachedShopId();
  });

  it("prefers cached shop id for movement namespace", () => {
    setCachedShopId("11111111-1111-4111-8111-111111111111");
    expect(inventoryMovementNamespace()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to account key when shop id is not cached", () => {
    expect(inventoryMovementNamespace()).toBe("sb:user-abc");
  });

  it("reuses shop context for later entity pulls in the same tick", async () => {
    const resolve = vi.fn().mockResolvedValue({ shopId: "shop-1", userId: "user-1" });
    const first = await consumeOrResolveShopCtx(resolve);
    const second = await consumeOrResolveShopCtx(resolve);
    const third = await consumeOrResolveShopCtx(resolve);
    expect(first).toEqual({ shopId: "shop-1", userId: "user-1" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(shopCtxTickResolveCount()).toBe(1);
  });
});
