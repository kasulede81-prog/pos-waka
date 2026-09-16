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
const mockPullCloudAndMergeIntoStore = vi.fn().mockResolvedValue(true);

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
  pullCloudAndMergeIntoStore: (...args: unknown[]) => mockPullCloudAndMergeIntoStore(...args),
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

vi.mock("./staffOfflineAuth", () => ({
  clearStaffAuth: vi.fn(),
  clearRememberedStaffDevice: vi.fn(),
}));

vi.mock("./offlineStaffCache", () => ({
  clearOfflineStaffCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./auth/staffLoginLimiter", () => ({
  clearStaffUnlockLimiter: vi.fn(),
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
      preferences: {
        backOfficePin: "argon2id:hash",
        posLocked: true,
        biometricAuthEnabled: true,
        staffAccounts: [
          {
            id: "s1",
            name: "Staff",
            role: "cashier",
            active: true,
            pinHash: "argon2id:staff",
            permissions: [],
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
      },
    });
    // The global `restoreMocks: true` config wipes this module-level
    // `vi.fn().mockResolvedValue(true)` default before every test, so it
    // must be re-established here (matching the pattern already used above
    // for `mockGetState`) rather than relying on the one-time initializer.
    mockPullCloudAndMergeIntoStore.mockResolvedValue(true);
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

  it("applyShopRecoverySignalsForShop applies staff credential clear without clearing Shop Security PIN", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { clear_staff_credentials_at: "2026-07-12T10:00:00.000Z" },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as never);

    const { applyShopRecoverySignalsForShop } = await import("./shopRecoverySignals");
    const applied = await applyShopRecoverySignalsForShop("shop-1", "cloud_reconnect");
    expect(applied).toBe(true);

    const updater = mockSetState.mock.calls[0][0] as (s: {
      preferences: { backOfficePin: string | null; staffAccounts: { pinHash: string | null }[] };
    }) => unknown;
    const next = updater({
      preferences: {
        backOfficePin: "argon2id:hash",
        staffAccounts: [{ pinHash: "argon2id:staff" }],
      },
    }) as { preferences: { backOfficePin: string | null; staffAccounts: { pinHash: string | null }[] } };
    expect(next.preferences.backOfficePin).toBe("argon2id:hash");
    expect(next.preferences.staffAccounts[0].pinHash).toBeNull();
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      "admin_staff_credentials_clear_applied",
      expect.any(String),
      expect.objectContaining({ shopId: "shop-1", recoveryCompleted: true }),
    );
  });

  it("applyAdminForceFullResync forces a full cloud pull instead of replaying local cache", async () => {
    const { applyAdminForceFullResync } = await import("./shopRecoverySignals");
    const signalAt = "2026-09-13T16:00:00.000Z";

    const applied = await applyAdminForceFullResync("shop-1", signalAt, "admin_shop_reset_signal");
    expect(applied).toBe(true);
    expect(mockPullCloudAndMergeIntoStore).toHaveBeenCalledWith({
      forceFull: true,
      pullReason: "admin_shop_reset_signal",
    });
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      "admin_shop_reset_resync_applied",
      expect.any(String),
      expect.objectContaining({ shopId: "shop-1", signalAt, recoveryAppliedOnDevice: true }),
    );
  });

  it("applyAdminForceFullResync is idempotent for the same signal timestamp", async () => {
    const { applyAdminForceFullResync } = await import("./shopRecoverySignals");
    const signalAt = "2026-09-13T16:00:00.000Z";
    storage.set("waka.recovery.forceFullResyncApplied.v1::shop-1", signalAt);

    const applied = await applyAdminForceFullResync("shop-1", signalAt);
    expect(applied).toBe(false);
    expect(mockPullCloudAndMergeIntoStore).not.toHaveBeenCalled();
  });

  it("does NOT mark the reset signal applied when the authoritative full pull fails, so a later retry is still possible", async () => {
    mockPullCloudAndMergeIntoStore.mockResolvedValue(false);
    const { applyAdminForceFullResync, staleForceFullResyncCutoff } = await import("./shopRecoverySignals");
    const signalAt = "2026-09-13T16:00:00.000Z";

    const applied = await applyAdminForceFullResync("shop-1", signalAt, "admin_shop_reset_signal");
    expect(applied).toBe(false);
    expect(mockLogAuditAction).not.toHaveBeenCalled();
    expect(storage.get("waka.recovery.forceFullResyncApplied.v1::shop-1")).toBeUndefined();

    // A later retry (e.g. the next boot, or a reconnect) must still see this
    // signal as outstanding — never silently swallowed by the failed attempt.
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { force_full_resync_at: signalAt },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as never);
    await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBe(signalAt);

    // And the retry can still succeed once the pull works.
    mockPullCloudAndMergeIntoStore.mockResolvedValue(true);
    const retried = await applyAdminForceFullResync("shop-1", signalAt, "admin_shop_reset_signal");
    expect(retried).toBe(true);
    expect(storage.get("waka.recovery.forceFullResyncApplied.v1::shop-1")).toBe(signalAt);
  });

  it("applyShopRecoverySignalsForShop triggers a full resync when the RPC returns force_full_resync_at", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { force_full_resync_at: "2026-09-13T17:00:00.000Z" },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as never);

    const { applyShopRecoverySignalsForShop } = await import("./shopRecoverySignals");
    const applied = await applyShopRecoverySignalsForShop("shop-1", "cloud_reconnect");
    expect(applied).toBe(true);
    expect(mockPullCloudAndMergeIntoStore).toHaveBeenCalledWith({
      forceFull: true,
      pullReason: "cloud_reconnect",
    });
  });

  describe("staleForceFullResyncCutoff / hasUnacknowledgedForceFullResync", () => {
    it("returns the signal timestamp when this device has not applied it yet", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { staleForceFullResyncCutoff, hasUnacknowledgedForceFullResync } = await import(
        "./shopRecoverySignals"
      );
      await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBe("2026-09-13T22:01:21.853Z");
      await expect(hasUnacknowledgedForceFullResync("shop-1")).resolves.toBe(true);
    });

    it("returns null once this device has already applied that exact signal", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);
      storage.set("waka.recovery.forceFullResyncApplied.v1::shop-1", "2026-09-13T22:01:21.853Z");

      const { staleForceFullResyncCutoff, hasUnacknowledgedForceFullResync } = await import(
        "./shopRecoverySignals"
      );
      await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBeNull();
      await expect(hasUnacknowledgedForceFullResync("shop-1")).resolves.toBe(false);
    });

    it("returns null when there is no force-resync signal at all", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: {},
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { staleForceFullResyncCutoff } = await import("./shopRecoverySignals");
      await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBeNull();
    });
  });

  describe("resolveStaleResetGuardState (P1 remediation — fail-CLOSED outbox guard, financial certification audit P1#2)", () => {
    // Regression test 1: reset signal available → correct behavior (signal, with cutoff)
    it("returns {status:'signal', cutoff} when a signal is outstanding and unacknowledged", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { resolveStaleResetGuardState } = await import("./shopRecoverySignals");
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({
        status: "signal",
        cutoff: "2026-09-13T22:01:21.853Z",
      });
    });

    // Regression test 2: no reset signal → correct behavior (clear)
    it("returns {status:'clear'} when there is no force-resync signal at all", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: {},
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { resolveStaleResetGuardState } = await import("./shopRecoverySignals");
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({ status: "clear" });
    });

    it("returns {status:'clear'} once this device has already applied that exact signal", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);
      storage.set("waka.recovery.forceFullResyncApplied.v1::shop-1", "2026-09-13T22:01:21.853Z");

      const { resolveStaleResetGuardState } = await import("./shopRecoverySignals");
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({ status: "clear" });
    });

    // Regression test 3: RPC error → {status:'unknown'} (operation must NOT be pushed by the caller)
    it("FAILS CLOSED — returns {status:'unknown'} when the RPC errors, unlike staleForceFullResyncCutoff's fail-open null", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: null,
        error: { message: "network_error" },
        count: null,
        status: 500,
        statusText: "Error",
        success: false,
      } as never);

      const { resolveStaleResetGuardState, staleForceFullResyncCutoff } = await import("./shopRecoverySignals");
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({ status: "unknown" });
      // Contrast: the (unchanged) fail-open helper still treats the same
      // failure as "no confirmed signal" — proving these are deliberately
      // different call sites, not an oversight.
      await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBeNull();
    });

    // Regression test 4: RPC timeout / outright rejection → {status:'unknown'}
    it("FAILS CLOSED — returns {status:'unknown'} when Supabase rejects the RPC call outright (e.g. a timeout)", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockRejectedValue(new Error("network_down"));

      const { resolveStaleResetGuardState } = await import("./shopRecoverySignals");
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({ status: "unknown" });
    });

    // Regression test 5: recovery succeeds later → operation resumes according to the correct cutoff.
    // Simulates two consecutive flush cycles on the same device: the first
    // cycle's lookup fails (unknown — caller must hold the op), the second
    // cycle's lookup succeeds and correctly reports the real signal state.
    it("recovers on a later call once the RPC succeeds again, after a prior failed lookup", async () => {
      const { supabase } = await import("./supabase");
      const { resolveStaleResetGuardState } = await import("./shopRecoverySignals");

      vi.mocked(supabase!.rpc).mockRejectedValueOnce(new Error("network_down"));
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({ status: "unknown" });

      vi.mocked(supabase!.rpc).mockResolvedValueOnce({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);
      await expect(resolveStaleResetGuardState("shop-1")).resolves.toEqual({
        status: "signal",
        cutoff: "2026-09-13T22:01:21.853Z",
      });
    });
  });

  describe("canPublishShopCloudSnapshot (fail-CLOSED snapshot-publish gate)", () => {
    it("returns true (safe to publish) when there is no force-resync signal at all", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: {},
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { canPublishShopCloudSnapshot } = await import("./shopRecoverySignals");
      await expect(canPublishShopCloudSnapshot("shop-1")).resolves.toBe(true);
    });

    it("returns false while a signal is outstanding and unacknowledged", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { canPublishShopCloudSnapshot } = await import("./shopRecoverySignals");
      await expect(canPublishShopCloudSnapshot("shop-1")).resolves.toBe(false);
    });

    it("returns true once this device has already applied that exact signal", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T22:01:21.853Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);
      storage.set("waka.recovery.forceFullResyncApplied.v1::shop-1", "2026-09-13T22:01:21.853Z");

      const { canPublishShopCloudSnapshot } = await import("./shopRecoverySignals");
      await expect(canPublishShopCloudSnapshot("shop-1")).resolves.toBe(true);
    });

    it("FAILS CLOSED (returns false) when the RPC errors — this is the reversal of staleForceFullResyncCutoff's fail-open default", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: null,
        error: { message: "network_error" },
        count: null,
        status: 500,
        statusText: "Error",
        success: false,
      } as never);

      const { canPublishShopCloudSnapshot, staleForceFullResyncCutoff } = await import("./shopRecoverySignals");
      await expect(canPublishShopCloudSnapshot("shop-1")).resolves.toBe(false);
      // Contrast: the outbox/boot helper treats the same failure as "no
      // confirmed signal" (fail open) — proving these are deliberately
      // different, not an oversight.
      await expect(staleForceFullResyncCutoff("shop-1")).resolves.toBeNull();
    });

    it("FAILS CLOSED (returns false) when Supabase rejects the RPC call outright", async () => {
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockRejectedValue(new Error("network_down"));

      const { canPublishShopCloudSnapshot } = await import("./shopRecoverySignals");
      await expect(canPublishShopCloudSnapshot("shop-1")).resolves.toBe(false);
    });
  });

  describe("applyPendingForceFullResyncForCurrentShop (boot-time gate)", () => {
    // `resolveShopCtx` is mocked inline in the `vi.mock("../offline/cloudSync", ...)`
    // factory above. The suite's global `restoreMocks: true` restores every mock
    // (including this one) before each test, which drops its `mockResolvedValue`
    // back to a bare no-op. Every test in this block must re-establish it
    // explicitly, same as the existing tests above already do for `supabase.rpc`.
    async function mockResolvedShopCtx(): Promise<void> {
      const cloudSync = await import("../offline/cloudSync");
      vi.mocked(cloudSync.resolveShopCtx).mockResolvedValue({ shopId: "shop-1", userId: "user-1" } as never);
    }

    it("resolves the shop, applies an outstanding signal, and merges before returning", async () => {
      await mockResolvedShopCtx();
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: { force_full_resync_at: "2026-09-13T23:10:00.000Z" },
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { applyPendingForceFullResyncForCurrentShop } = await import("./shopRecoverySignals");
      await expect(applyPendingForceFullResyncForCurrentShop()).resolves.toBe(true);
      expect(mockPullCloudAndMergeIntoStore).toHaveBeenCalledWith({
        forceFull: true,
        pullReason: "app_boot_gate",
      });
    });

    it("returns false and never merges when there is no outstanding signal", async () => {
      await mockResolvedShopCtx();
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: {},
        error: null,
        count: null,
        status: 200,
        statusText: "OK",
        success: true,
      } as never);

      const { applyPendingForceFullResyncForCurrentShop } = await import("./shopRecoverySignals");
      await expect(applyPendingForceFullResyncForCurrentShop()).resolves.toBe(false);
      expect(mockPullCloudAndMergeIntoStore).not.toHaveBeenCalled();
    });

    it("fails closed (never throws, never blocks) when the RPC errors", async () => {
      await mockResolvedShopCtx();
      const { supabase } = await import("./supabase");
      vi.mocked(supabase!.rpc).mockResolvedValue({
        data: null,
        error: { message: "network down" },
        count: null,
        status: 0,
        statusText: "",
        success: false,
      } as never);

      const { applyPendingForceFullResyncForCurrentShop } = await import("./shopRecoverySignals");
      await expect(applyPendingForceFullResyncForCurrentShop()).resolves.toBe(false);
    });

    it("fails closed when the shop cannot be resolved at all", async () => {
      const cloudSync = await import("../offline/cloudSync");
      vi.mocked(cloudSync.resolveShopCtx).mockResolvedValue(null as never);

      const { applyPendingForceFullResyncForCurrentShop } = await import("./shopRecoverySignals");
      await expect(applyPendingForceFullResyncForCurrentShop()).resolves.toBe(false);
      expect(mockPullCloudAndMergeIntoStore).not.toHaveBeenCalled();
    });
  });
});
