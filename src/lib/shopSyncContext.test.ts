import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedShopId, inventoryMovementNamespace, setCachedShopId } from "./shopSyncContext";

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:user-abc",
}));

describe("shopSyncContext", () => {
  beforeEach(() => {
    clearCachedShopId();
  });

  it("prefers cached shop id for movement namespace", () => {
    setCachedShopId("11111111-1111-4111-8111-111111111111");
    expect(inventoryMovementNamespace()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to account key when shop id is not cached", () => {
    expect(inventoryMovementNamespace()).toBe("sb:user-abc");
  });
});
