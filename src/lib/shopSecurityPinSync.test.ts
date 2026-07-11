import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockGetDeviceOnline = vi.fn(() => true);

vi.mock("./supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

vi.mock("./deviceId", () => ({
  getOrCreateDeviceId: () => "device-fingerprint-12345678",
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => mockGetDeviceOnline(),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      preferences: { backOfficePin: "argon2id:localhash" },
    }),
    setState: vi.fn(),
  },
  flushPendingPersist: vi.fn(),
}));

describe("shopSecurityPinSync", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetDeviceOnline.mockReturnValue(true);
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("hydrates newer cloud hash into local preferences", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        configured: true,
        pin_hash: "argon2id:cloudhash123456",
        version: 2,
        updated_at: "2026-07-11T12:00:00.000Z",
      },
      error: null,
    });

    const { hydrateShopSecurityPin } = await import("./shopSecurityPinSync");
    const { usePosStore } = await import("../store/usePosStore");

    const result = await hydrateShopSecurityPin("shop-1");
    expect(result).toBe("synced");
    expect(usePosStore.setState).toHaveBeenCalled();
  });

  it("migrates local hash when cloud is empty", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: { ok: true, configured: false, pin_hash: null, version: 0, updated_at: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, version: 1, updated_at: "2026-07-11T12:00:00.000Z", migrated: true },
        error: null,
      });

    const { hydrateShopSecurityPin } = await import("./shopSecurityPinSync");
    const result = await hydrateShopSecurityPin("shop-1");
    expect(result).toBe("migrated");
    expect(mockRpc).toHaveBeenCalledWith("shop_security_pin_migrate", expect.any(Object));
  });

  it("returns offline when device is offline", async () => {
    mockGetDeviceOnline.mockReturnValue(false);
    const { hydrateShopSecurityPin } = await import("./shopSecurityPinSync");
    const result = await hydrateShopSecurityPin("shop-1");
    expect(result).toBe("offline");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
