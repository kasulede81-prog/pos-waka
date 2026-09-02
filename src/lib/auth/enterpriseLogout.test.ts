import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async (_opts?: { scope?: string }) => ({ error: null }));

vi.mock("../supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      signOut: (opts?: { scope?: string }) => signOut(opts),
    },
  },
}));

vi.mock("../../store/usePosStore", () => ({
  flushPendingPersist: vi.fn(),
  usePosStore: {
    getState: () => ({
      preferences: { activeStaffId: null },
      switchStaffAccount: vi.fn(),
      resetForSignOut: vi.fn(),
    }),
  },
}));

vi.mock("../../offline/cloudSync", () => ({
  cancelBackgroundCloudSync: vi.fn(),
}));

vi.mock("../queryClient", () => ({
  queryClient: {
    clear: vi.fn(),
    getQueryCache: () => ({ clear: vi.fn() }),
    getMutationCache: () => ({ clear: vi.fn() }),
  },
}));

vi.mock("../pilotEventLog", () => ({
  appendPilotEvent: vi.fn(),
}));

vi.mock("../deviceOnline", () => ({
  getDeviceOnline: () => false,
}));

function installBrowserMocks(): void {
  const makeStorage = () => {
    const store: Record<string, string> = {};
    return {
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    };
  };
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: {
      ...globalThis,
      localStorage,
      sessionStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { replace: vi.fn() },
    },
    configurable: true,
  });
}

import { clearPersistedSupabaseAuthTokens, performEnterpriseLogout } from "./enterpriseLogout";

describe("enterpriseLogout", () => {
  beforeEach(() => {
    installBrowserMocks();
    signOut.mockClear();
    signOut.mockImplementation(async () => ({ error: null }));
  });

  it("clears persisted Supabase auth tokens", () => {
    localStorage.setItem("sb-abc-auth-token", JSON.stringify({ access_token: "x", user: { id: "1" } }));
    localStorage.setItem("unrelated-key", "keep");
    expect(clearPersistedSupabaseAuthTokens()).toBe(1);
    expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep");
  });

  it("signs out with local scope and clears tokens without requiring network", async () => {
    localStorage.setItem("sb-abc-auth-token", JSON.stringify({ access_token: "x", user: { id: "1" } }));
    await performEnterpriseLogout({ hardNavigate: false });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem("sb-abc-auth-token")).toBeNull();
  });

  it("clears the settings security session so it cannot survive into another login", async () => {
    const { setActiveAccountKey } = await import("../../offline/accountScope");
    const { grantSensitiveActionSession, isSensitiveActionSessionActive } = await import("../sensitiveActionAuth");
    setActiveAccountKey("sb:logout-user");
    grantSensitiveActionSession();
    expect(isSensitiveActionSessionActive()).toBe(true);
    await performEnterpriseLogout({ hardNavigate: false });
    expect(isSensitiveActionSessionActive()).toBe(false);
  });

  it("clears account-scoped device authority so the next login cannot reuse it", async () => {
    const { setActiveAccountKey } = await import("../../offline/accountScope");
    const { seedDeviceAuthorityCacheForTests, isDeviceAuthorizedForManagementSync } = await import("../deviceAuthority");
    setActiveAccountKey("sb:logout-user");
    seedDeviceAuthorityCacheForTests({
      shopId: "shop-logout",
      deviceFingerprint: "fp",
      deviceId: "d",
      formFactor: "tablet",
      approvalStatus: "approved",
      isDeviceAuthorized: true,
      isApproved: true,
      isOperational: true,
      status: "active",
      lastSyncAt: null,
      lastLoginAt: null,
      lastSeenAt: null,
      currentStaffClientId: null,
      appVersion: null,
      label: null,
      platform: null,
      pendingUploads: 0,
      pendingDownloads: 0,
      cloudStatus: null,
      recoveryStatus: null,
    });
    expect(isDeviceAuthorizedForManagementSync()).toBe(true);
    await performEnterpriseLogout({ hardNavigate: false });
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });

  it("coalesces concurrent logout calls", async () => {
    const slow = new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 30);
    });
    signOut.mockImplementationOnce(async () => {
      await slow;
      return { error: null };
    });

    const a = performEnterpriseLogout({ hardNavigate: false });
    const b = performEnterpriseLogout({ hardNavigate: false });
    expect(a).toBe(b);
    await a;
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
