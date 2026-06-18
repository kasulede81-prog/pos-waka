import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./organizationDeletionState", () => ({
  isOrganizationBlocked: vi.fn(() => true),
  hasWipeMarker: vi.fn(() => false),
  ORGANIZATION_DELETED_MESSAGE: "This organization has been permanently deleted.",
}));

vi.mock("../offline/localDb", () => ({
  getLocalDb: vi.fn(),
}));

describe("offlineStaffDeletionProtection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks staff offline login for deleted organization", async () => {
    const { getLocalDb } = await import("../offline/localDb");
    vi.mocked(getLocalDb).mockResolvedValue({
      getAllKeys: async () => ["sb:shop::snapshot"],
      get: async () => ({
        preferences: {
          shopDisplayName: "Deleted Shop",
          staffAccounts: [
            {
              id: "staff-1",
              name: "Jane",
              role: "cashier",
              active: true,
              pin: "1234",
            },
          ],
        },
      }),
    } as never);

    const { authenticateOfflineStaff } = await import("./staffOfflineAuth");
    await expect(
      authenticateOfflineStaff({
        businessName: "Deleted Shop",
        role: "cashier",
        identifier: "Jane",
        pinOrPassword: "1234",
        rememberDevice: false,
      }),
    ).rejects.toThrow("This organization has been permanently deleted.");
  });

  it("excludes deleted shops from staff shop list", async () => {
    const { getLocalDb } = await import("../offline/localDb");
    vi.mocked(getLocalDb).mockResolvedValue({
      getAllKeys: async () => ["sb:shop::snapshot"],
      get: async () => ({
        preferences: {
          shopDisplayName: "Deleted Shop",
          staffAccounts: [{ id: "s1", name: "Jane", role: "cashier", active: true, pin: "1234" }],
        },
      }),
    } as never);

    const { listCachedShopsForStaffLogin } = await import("./staffOfflineAuth");
    const shops = await listCachedShopsForStaffLogin();
    expect(shops).toHaveLength(0);
  });
});
