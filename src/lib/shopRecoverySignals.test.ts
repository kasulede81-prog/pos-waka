import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetState = vi.fn();
const mockGetState = vi.fn();
const mockLogAuditAction = vi.fn();
const mockFlushPendingPersist = vi.fn();
const mockClearSecuritySession = vi.fn();
const mockClearLegacySensitiveSession = vi.fn();
const mockApplyShopSecurityPinRecoveryClear = vi.fn();
const mockBlockMigration = vi.fn();
const mockSetRecoveryNotice = vi.fn();

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

vi.mock("../offline/cloudSync", () => ({
  resolveShopCtx: vi.fn().mockResolvedValue({ shopId: "shop-1", userId: "user-1" }),
}));

vi.mock("./cloudSnapshotSync", () => ({
  uploadShopCloudSnapshot: vi.fn().mockResolvedValue(true),
}));

vi.mock("./shopSecurityPinSync", () => ({
  applyShopSecurityPinRecoveryClear: (...args: unknown[]) => mockApplyShopSecurityPinRecoveryClear(...args),
}));

vi.mock("./shopSecurityPinRecovery", () => ({
  blockShopSecurityPinMigration: (...args: unknown[]) => mockBlockMigration(...args),
  setShopSecurityPinRecoveryNotice: (...args: unknown[]) => mockSetRecoveryNotice(...args),
  scheduleShopSecurityPinRecovery: vi.fn().mockResolvedValue({ applied: false, hydrated: false, awaitingNewPin: false }),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getSession: vi.fn() },
    rpc: vi.fn(),
  },
}));

describe("shopRecoverySignals", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.stubGlobal("window", { localStorage: localStorageMock });
    mockGetState.mockReturnValue({
      logAuditAction: mockLogAuditAction,
      preferences: { backOfficePin: "argon2id:hash", posLocked: true, biometricAuthEnabled: true },
    });
  });

  it("applyAdminBackOfficePinClear clears shop security PIN only and verification cache", async () => {
    const { applyAdminBackOfficePinClear } = await import("./shopRecoverySignals");
    const clearedAt = "2026-07-08T12:00:00.000Z";

    const applied = await applyAdminBackOfficePinClear("shop-1", clearedAt, "background_sync");
    expect(applied).toBe(true);

    expect(mockClearSecuritySession).toHaveBeenCalled();
    expect(mockClearLegacySensitiveSession).toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledOnce();
    const updater = mockSetState.mock.calls[0][0] as (s: {
      preferences: { backOfficePin: string | null; posLocked: boolean; biometricAuthEnabled: boolean };
    }) => unknown;
    const next = updater({
      preferences: { backOfficePin: "argon2id:hash", posLocked: true, biometricAuthEnabled: true },
    }) as { preferences: { backOfficePin: string | null; posLocked: boolean; biometricAuthEnabled: boolean } };
    expect(next.preferences.backOfficePin).toBeNull();
    expect(next.preferences.posLocked).toBe(true);
    expect(next.preferences.biometricAuthEnabled).toBe(true);
    expect(mockApplyShopSecurityPinRecoveryClear).toHaveBeenCalledWith("shop-1");
    expect(mockBlockMigration).toHaveBeenCalledWith("shop-1", "admin_clear");
    expect(mockSetRecoveryNotice).toHaveBeenCalledWith("shop-1", clearedAt);
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      "admin_pin_clear_applied",
      expect.any(String),
      expect.objectContaining({
        shopId: "shop-1",
        recoveryCompleted: true,
        recoveryAppliedOnDevice: true,
      }),
    );
    expect(mockFlushPendingPersist).toHaveBeenCalled();
  });

  it("applyAdminBackOfficePinClear is idempotent for the same clearedAt", async () => {
    const { applyAdminBackOfficePinClear } = await import("./shopRecoverySignals");
    const clearedAt = "2026-07-08T12:00:00.000Z";
    storage.set("waka.recovery.pinClearApplied.v1::shop-1", clearedAt);

    const applied = await applyAdminBackOfficePinClear("shop-1", clearedAt);
    expect(applied).toBe(false);
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("applyShopRecoverySignalsForCurrentShop applies when RPC returns clear signal", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { clear_back_office_pin_at: "2026-07-08T13:00:00.000Z" },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as never);

    const { applyShopRecoverySignalsForCurrentShop } = await import("./shopRecoverySignals");
    const applied = await applyShopRecoverySignalsForCurrentShop("cloud_reconnect");
    expect(applied).toBe(true);
    expect(supabase!.rpc).toHaveBeenCalledWith("shop_fetch_recovery_signal", { p_shop_id: "shop-1" });
  });
});
