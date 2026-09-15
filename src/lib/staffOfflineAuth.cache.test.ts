import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashStaffSecret } from "./staffSecret";

vi.mock("./organizationDeletionState", () => ({
  isOrganizationBlocked: vi.fn(() => false),
  hasWipeMarker: vi.fn(() => false),
  ORGANIZATION_DELETED_MESSAGE: "This organization has been permanently deleted.",
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: vi.fn(() => false),
}));

const staffCacheRecords: Array<{
  shopId: string;
  businessName?: string;
  version: number;
  downloadedAt: string;
  staff: Array<{
    id: string;
    name: string;
    role: string;
    active: boolean;
    pinHash?: string;
    lockedUntil?: string;
  }>;
}> = [];

vi.mock("./offlineStaffCache", async () => {
  const actual = await vi.importActual<typeof import("./offlineStaffCache")>("./offlineStaffCache");
  return {
    ...actual,
    listStaffCacheRecordsForAccount: vi.fn(async (accountKey: string) =>
      staffCacheRecords.filter(() => accountKey === "sb:shop"),
    ),
    listCachedStaffForLogin: vi.fn(async (shopId: string, accountKey?: string | null) => {
      const record = staffCacheRecords.find((r) => r.shopId === shopId && accountKey === "sb:shop");
      return record?.staff.filter((s) => s.active) ?? [];
    }),
    readOfflineStaffCache: vi.fn(async (shopId: string, accountKey?: string | null) => {
      if (accountKey !== "sb:shop") return null;
      const record = staffCacheRecords.find((r) => r.shopId === shopId);
      return record ?? null;
    }),
    writeOfflineStaffCache: vi.fn(async () => undefined),
  };
});

vi.mock("./deviceAuthority", () => ({
  fetchDeviceAuthorityContext: vi.fn(async () => ({
    isApproved: true,
    isOperational: true,
    approvalStatus: "approved",
  })),
}));

vi.mock("./staffLoginSecurity", () => ({
  assertStaffLoginDeviceApproved: vi.fn(async () => ({ ok: true })),
  recordStaffLoginAttemptLocal: vi.fn(async () => ({ ok: true, success: true })),
  flushPendingStaffSecurityEvents: vi.fn(async () => undefined),
}));

vi.mock("./staffSecurityAudit", () => ({
  logStaffSecurityAudit: vi.fn(),
}));

vi.mock("../offline/localDb", () => ({
  getLocalDb: vi.fn(async () => ({
    getAllKeys: async () => ["sb:shop::snapshot"],
    get: async (_store: string, key: string) => {
      if (key === "sb:shop::snapshot") {
        return {
          preferences: {
            shopDisplayName: "Corner Shop",
            staffAccounts: [],
          },
        };
      }
      return undefined;
    },
  })),
}));

describe("staffOfflineAuth cache login", () => {
  beforeEach(() => {
    staffCacheRecords.length = 0;
    vi.clearAllMocks();
  });

  it("throws StaffCacheMissingError when offline with empty cache", async () => {
    const { authenticateOfflineStaff, StaffCacheMissingError } = await import("./staffOfflineAuth");
    await expect(
      authenticateOfflineStaff({
        businessName: "Corner Shop",
        role: "cashier",
        identifier: "Jane",
        pinOrPassword: "1234",
        rememberDevice: false,
      }),
    ).rejects.toBeInstanceOf(StaffCacheMissingError);
  });

  it("authenticates from encrypted cache offline", async () => {
    const pinHash = hashStaffSecret("1234");
    staffCacheRecords.push({
      shopId: "shop-uuid-1",
      businessName: "Corner Shop",
      version: 1,
      downloadedAt: new Date().toISOString(),
      staff: [
        {
          id: "staff-1",
          name: "Jane",
          role: "cashier",
          active: true,
          pinHash,
        },
      ],
    });

    const { authenticateOfflineStaff } = await import("./staffOfflineAuth");
    const result = await authenticateOfflineStaff({
      businessName: "Corner Shop",
      role: "cashier",
      identifier: "Jane",
      pinOrPassword: "1234",
      rememberDevice: false,
    });
    expect(result.staffId).toBe("staff-1");
    expect(result.accountKey).toBe("sb:shop");
  });

  it("rejects suspended staff from cache", async () => {
    staffCacheRecords.push({
      shopId: "shop-uuid-1",
      businessName: "Corner Shop",
      version: 1,
      downloadedAt: new Date().toISOString(),
      staff: [
        {
          id: "staff-1",
          name: "Jane",
          role: "cashier",
          active: false,
          pinHash: hashStaffSecret("1234"),
        },
      ],
    });

    const { authenticateOfflineStaff } = await import("./staffOfflineAuth");
    await expect(
      authenticateOfflineStaff({
        businessName: "Corner Shop",
        role: "cashier",
        identifier: "Jane",
        pinOrPassword: "1234",
        rememberDevice: false,
      }),
    ).rejects.toThrow("Invalid staff credentials.");
  });
});
