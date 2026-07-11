import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApplyRecovery = vi.fn();
const mockHydrate = vi.fn();
const mockGetDeviceOnline = vi.fn(() => true);
const mockResolveShopCtx = vi.fn();

vi.mock("./shopRecoverySignals", () => ({
  applyShopRecoverySignalsForShop: (...args: unknown[]) => mockApplyRecovery(...args),
}));

vi.mock("./shopSecurityPinSync", () => ({
  hydrateShopSecurityPin: (...args: unknown[]) => mockHydrate(...args),
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => mockGetDeviceOnline(),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {},
}));

vi.mock("../offline/cloudSync", () => ({
  resolveShopCtx: () => mockResolveShopCtx(),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({ preferences: { backOfficePin: null } }),
  },
}));

vi.mock("./enterpriseSecurity/shopPinSecret", () => ({
  isShopSecurityPinConfigured: (hash: string | null) => Boolean(hash),
}));

describe("shopSecurityPinRecovery", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    mockGetDeviceOnline.mockReturnValue(true);
    mockResolveShopCtx.mockResolvedValue({ shopId: "shop-1", userId: "user-1" });
    mockApplyRecovery.mockResolvedValue(false);
    mockHydrate.mockResolvedValue("unchanged");

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
    vi.stubGlobal("window", { localStorage: localStorageMock, dispatchEvent: vi.fn() });
  });

  it("blocks migration after recovery is applied", async () => {
    mockApplyRecovery.mockResolvedValueOnce(true);
    mockHydrate.mockResolvedValueOnce("cleared");

    const { runShopSecurityPinRecoveryCycle, isShopSecurityPinMigrationBlocked } = await import(
      "./shopSecurityPinRecovery"
    );

    await runShopSecurityPinRecoveryCycle("shop-1", "cloud_reconnect");
    expect(isShopSecurityPinMigrationBlocked("shop-1")).toBe(true);
    expect(mockHydrate).toHaveBeenCalledWith("shop-1", { force: true });
  });

  it("hydrates on reconnect without applying recovery", async () => {
    const { runShopSecurityPinRecoveryCycle } = await import("./shopSecurityPinRecovery");
    await runShopSecurityPinRecoveryCycle("shop-1", "cloud_reconnect");
    expect(mockApplyRecovery).toHaveBeenCalledWith("shop-1", "cloud_reconnect");
    expect(mockHydrate).toHaveBeenCalledWith("shop-1", { force: false });
  });

  it("applies offline recovery without hydration", async () => {
    mockGetDeviceOnline.mockReturnValue(false);
    mockApplyRecovery.mockResolvedValueOnce(true);

    const { runShopSecurityPinRecoveryCycle } = await import("./shopSecurityPinRecovery");
    const result = await runShopSecurityPinRecoveryCycle("shop-1", "background_sync");

    expect(result.applied).toBe(true);
    expect(result.hydrated).toBe(false);
    expect(result.awaitingNewPin).toBe(true);
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("coalesces concurrent scheduleShopSecurityPinRecovery calls", async () => {
    mockApplyRecovery.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    );

    const { scheduleShopSecurityPinRecovery } = await import("./shopSecurityPinRecovery");
    const p1 = scheduleShopSecurityPinRecovery("app_launch");
    const p2 = scheduleShopSecurityPinRecovery("app_resume");
    expect(p1).toBe(p2);
    await p1;
    expect(mockApplyRecovery).toHaveBeenCalledTimes(1);
  });

  it("sets recovery notice when awaiting new pin after admin clear", async () => {
    mockApplyRecovery.mockResolvedValueOnce(true);
    mockHydrate.mockResolvedValueOnce("cleared");

    const { runShopSecurityPinRecoveryCycle, peekShopSecurityPinRecoveryNotice } = await import(
      "./shopSecurityPinRecovery"
    );

    await runShopSecurityPinRecoveryCycle("shop-1", "owner_login");
    expect(peekShopSecurityPinRecoveryNotice("shop-1")).toBeTruthy();
  });
});
