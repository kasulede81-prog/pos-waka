import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./organizationDeletionState", async () => {
  class OrganizationDeletedError extends Error {
    errorKey = "organizationDeleted";
  }
  return {
    refreshOrganizationDeletionState: vi.fn(async () => true),
    assertOrganizationOperationsAllowed: vi.fn(async () => {
      throw new OrganizationDeletedError();
    }),
    isOrganizationBlocked: vi.fn(() => true),
    OrganizationDeletedError,
  };
});

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })),
    },
  },
}));

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:u1",
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({ _hydrated: true, products: [{ id: "p1" }], sales: [], customers: [] }),
    subscribe: () => () => {},
  },
}));

describe("staleResurrectionProtection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("postAuthCloudHydrate exits early when organization is blocked", async () => {
    const cloudSync = await import("../offline/cloudSync");
    const pushSpy = vi.spyOn(cloudSync, "syncShopWithCloud").mockResolvedValue({
      pulled: false,
      push: { ok: 0, fail: 0 },
      queueFailed: 0,
    });

    const { hydrateAccountFromCloud } = await import("./postAuthCloudHydrate");
    await hydrateAccountFromCloud({ forcePull: true });

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("syncShopWithCloud does not push when organization is deleted", async () => {
    const { syncShopWithCloud } = await import("../offline/cloudSync");
    const result = await syncShopWithCloud({ pull: false });
    expect(result.push.ok).toBe(0);
    expect(result.push.fail).toBe(0);
  });

  it("pushShopPendingToCloud is blocked for deleted org", async () => {
    const { pushShopPendingToCloud } = await import("../offline/cloudSync");
    const result = await pushShopPendingToCloud();
    expect(result).toEqual({ push: { ok: 0, fail: 0 }, queueFailed: 0 });
  });
});
