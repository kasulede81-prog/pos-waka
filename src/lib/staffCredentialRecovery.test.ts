import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccount } from "../types";

const mockSetState = vi.fn();
const mockGetState = vi.fn();
const mockLogAuditAction = vi.fn();
const mockFlushPendingPersist = vi.fn();
const mockClearSecuritySession = vi.fn();
const mockClearLegacySensitiveSession = vi.fn();
const mockClearStaffAuth = vi.fn();
const mockClearRememberedStaffDevice = vi.fn();
const mockClearOfflineStaffCache = vi.fn().mockResolvedValue(undefined);
const mockClearStaffUnlockLimiter = vi.fn();
const mockHashStaffSecretAsync = vi.fn().mockResolvedValue("argon2id:newhash");
const mockPushStaffToCloud = vi.fn().mockResolvedValue(undefined);
const mockLogStaffSecurityAudit = vi.fn();

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    setState: (...args: unknown[]) => mockSetState(...args),
    getState: () => mockGetState(),
  },
  flushPendingPersist: (...args: unknown[]) => mockFlushPendingPersist(...args),
}));

vi.mock("./enterpriseSecurity/securitySession", () => ({
  clearSecuritySession: (...args: unknown[]) => mockClearSecuritySession(...args),
  clearLegacySensitiveSession: (...args: unknown[]) => mockClearLegacySensitiveSession(...args),
}));

vi.mock("./staffOfflineAuth", () => ({
  clearStaffAuth: (...args: unknown[]) => mockClearStaffAuth(...args),
  clearRememberedStaffDevice: (...args: unknown[]) => mockClearRememberedStaffDevice(...args),
}));

vi.mock("./offlineStaffCache", () => ({
  clearOfflineStaffCache: (...args: unknown[]) => mockClearOfflineStaffCache(...args),
}));

vi.mock("./auth/staffLoginLimiter", () => ({
  clearStaffUnlockLimiter: (...args: unknown[]) => mockClearStaffUnlockLimiter(...args),
}));

vi.mock("./cloudSnapshotSync", () => ({
  uploadShopCloudSnapshot: vi.fn().mockResolvedValue(true),
}));

vi.mock("./staffSecret", () => ({
  hashStaffSecretAsync: (...args: unknown[]) => mockHashStaffSecretAsync(...args),
  normalizePin: (v: string) => v.replace(/\D/g, ""),
}));

vi.mock("./shopStaffCloud", () => ({
  pushStaffToCloud: (...args: unknown[]) => mockPushStaffToCloud(...args),
}));

vi.mock("./staffSecurityAudit", () => ({
  logStaffSecurityAudit: (...args: unknown[]) => mockLogStaffSecurityAudit(...args),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock("../offline/cloudSync", () => ({
  resolveShopCtx: vi.fn().mockResolvedValue({ shopId: "shop-1", userId: "user-1" }),
}));

describe("staffCredentialRecovery", () => {
  const storage = new Map<string, string>();
  const clearedAt = "2026-07-12T10:00:00.000Z";

  const activeStaff: StaffAccount = {
    id: "staff-1",
    name: "Jane",
    role: "cashier",
    active: true,
    pinHash: "argon2id:oldpin",
    passwordHash: "argon2id:oldpass",
    permissions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHashStaffSecretAsync.mockResolvedValue("argon2id:newhash");
    mockClearOfflineStaffCache.mockResolvedValue(undefined);
    storage.clear();
    const localStorageMock = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", {
      localStorage: localStorageMock,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    mockGetState.mockReturnValue({
      logAuditAction: mockLogAuditAction,
      preferences: {
        backOfficePin: "argon2id:shop-pin",
        staffAccounts: [activeStaff],
      },
    });
  });

  it("staffAccountNeedsCredentialSetup detects invalidated staff", async () => {
    const { staffAccountNeedsCredentialSetup } = await import("./staffCredentialRecovery");
    expect(staffAccountNeedsCredentialSetup(activeStaff)).toBe(false);
    expect(
      staffAccountNeedsCredentialSetup({
        ...activeStaff,
        pinHash: null,
        passwordHash: null,
        credentialsInvalidatedAt: clearedAt,
      }),
    ).toBe(true);
    expect(
      staffAccountNeedsCredentialSetup({
        ...activeStaff,
        pinHash: null,
        passwordHash: null,
      }),
    ).toBe(true);
    expect(staffAccountNeedsCredentialSetup({ ...activeStaff, active: false })).toBe(false);
  });

  it("stripStaffCredentialsForRecovery clears hashes and marks invalidated", async () => {
    const { stripStaffCredentialsForRecovery } = await import("./staffCredentialRecoveryOps");
    const next = stripStaffCredentialsForRecovery([activeStaff], clearedAt);
    expect(next[0].pinHash).toBeNull();
    expect(next[0].passwordHash).toBeNull();
    expect(next[0].credentialsInvalidatedAt).toBe(clearedAt);
    expect(next[0].name).toBe("Jane");
  });

  it("applyAdminStaffCredentialsClear invalidates all active staff", async () => {
    const { applyAdminStaffCredentialsClear } = await import("./shopRecoverySignals");
    const result = await applyAdminStaffCredentialsClear("shop-1", "cloud_reconnect", clearedAt);

    expect(result.applied).toBe(true);
    expect(result.affectedStaffCount).toBe(1);
    expect(mockClearStaffAuth).toHaveBeenCalled();
    expect(mockClearRememberedStaffDevice).toHaveBeenCalled();
    expect(mockClearOfflineStaffCache).toHaveBeenCalledWith("shop-1");
    expect(mockClearStaffUnlockLimiter).toHaveBeenCalled();

    const updater = mockSetState.mock.calls[0][0] as (s: {
      preferences: { backOfficePin: string | null; staffAccounts: StaffAccount[] };
    }) => unknown;
    const next = updater({
      preferences: { backOfficePin: "argon2id:shop-pin", staffAccounts: [activeStaff] },
    }) as { preferences: { backOfficePin: string | null; staffAccounts: StaffAccount[] } };
    expect(next.preferences.backOfficePin).toBe("argon2id:shop-pin");
    expect(next.preferences.staffAccounts[0].pinHash).toBeNull();
    expect(next.preferences.staffAccounts[0].credentialsInvalidatedAt).toBe(clearedAt);

    expect(mockLogAuditAction).toHaveBeenCalledWith(
      "admin_staff_credentials_clear_applied",
      expect.any(String),
      expect.objectContaining({
        shopId: "shop-1",
        affectedStaffCount: 1,
        recoveryCompleted: true,
      }),
    );
  });

  it("applyAdminStaffCredentialsClear leaves Shop Security PIN untouched", async () => {
    const pinClearAt = "2026-07-12T11:00:00.000Z";
    const { applyAdminStaffCredentialsClear } = await import("./shopRecoverySignals");
    await applyAdminStaffCredentialsClear("shop-2", "background_sync", pinClearAt);

    const updater = mockSetState.mock.calls[0][0] as (s: {
      preferences: { backOfficePin: string | null };
    }) => unknown;
    const next = updater({ preferences: { backOfficePin: "argon2id:shop-pin" } }) as {
      preferences: { backOfficePin: string | null };
    };
    expect(next.preferences.backOfficePin).toBe("argon2id:shop-pin");
  });

  it("applyAdminStaffCredentialsClear is idempotent for the same clearedAt", async () => {
    storage.set("waka.recovery.staffClearApplied.v1::shop-1", clearedAt);
    const { applyAdminStaffCredentialsClear } = await import("./shopRecoverySignals");
    const result = await applyAdminStaffCredentialsClear("shop-1", "cloud_reconnect", clearedAt);
    expect(result.applied).toBe(false);
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("applyShopRecoverySignalsForShop applies staff recovery on offline reconnect", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { clear_staff_credentials_at: clearedAt },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as never);

    const { applyShopRecoverySignalsForShop } = await import("./shopRecoverySignals");
    const applied = await applyShopRecoverySignalsForShop("shop-1", "cloud_reconnect");
    expect(applied).toBe(true);
    expect(supabase!.rpc).toHaveBeenCalledWith("shop_fetch_recovery_signal", { p_shop_id: "shop-1" });
  });

  it("completeStaffCredentialRecovery sets new PIN and clears recovery flag", async () => {
    mockGetState.mockReturnValue({
      preferences: {
        staffAccounts: [
          {
            ...activeStaff,
            pinHash: null,
            passwordHash: null,
            credentialsInvalidatedAt: clearedAt,
          },
        ],
      },
    });

    const { completeStaffCredentialRecovery } = await import("./staffCredentialRecoveryOps");
    const result = await completeStaffCredentialRecovery({
      shopId: "shop-1",
      staffId: "staff-1",
      pin: "1234",
    });

    expect(result.ok).toBe(true);
    expect(mockHashStaffSecretAsync).toHaveBeenCalledWith("1234");
    expect(mockPushStaffToCloud).toHaveBeenCalled();
    expect(mockLogStaffSecurityAudit).toHaveBeenCalledWith(
      "staff_pin_reset",
      expect.objectContaining({ source: "credential_recovery" }),
    );

    const updater = mockSetState.mock.calls.at(-1)?.[0] as (s: {
      preferences: { staffAccounts: StaffAccount[] };
    }) => unknown;
    expect(updater).toBeTypeOf("function");
    const next = updater!({
      preferences: {
        staffAccounts: [{ ...activeStaff, credentialsInvalidatedAt: clearedAt, pinHash: null, passwordHash: null }],
      },
    }) as { preferences: { staffAccounts: StaffAccount[] } };
    expect(next.preferences.staffAccounts[0].pinHash).toBe("argon2id:newhash");
    expect(next.preferences.staffAccounts[0].credentialsInvalidatedAt).toBeNull();
  });

  it("setStaffCredentialRecoveryOwnerNotice stores owner notification", async () => {
    const { setStaffCredentialRecoveryOwnerNotice, peekStaffCredentialRecoveryOwnerNotice } = await import(
      "./staffCredentialRecovery"
    );
    setStaffCredentialRecoveryOwnerNotice("shop-1", clearedAt);
    expect(peekStaffCredentialRecoveryOwnerNotice("shop-1")).toBe(clearedAt);
  });
});
