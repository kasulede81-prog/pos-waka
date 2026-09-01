import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const shopNet = vi.hoisted(() => ({
  listUserShops: vi.fn(async (): Promise<{ shop_id: string; shop_name: string; organization_id: string; role: string; is_primary: boolean }[]> => []),
  fetchProfilePrimaryShopId: vi.fn(async (): Promise<string | null> => null),
  resolvePrimaryOrganizationForUser: vi.fn(async (): Promise<{ shopId: string } | null> => null),
}));

const listUserShops = shopNet.listUserShops;
const fetchProfilePrimaryShopId = shopNet.fetchProfilePrimaryShopId;
const resolvePrimaryOrganizationForUser = shopNet.resolvePrimaryOrganizationForUser;

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
}));

vi.mock("./primaryShop", () => ({
  listUserShops: shopNet.listUserShops,
  fetchProfilePrimaryShopId: shopNet.fetchProfilePrimaryShopId,
  setUserPrimaryShop: vi.fn(async () => true),
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: shopNet.resolvePrimaryOrganizationForUser,
}));

vi.mock("../offline/shopScopeMigration", () => ({
  migrateLegacyPersistenceToShop: vi.fn(async () => ({ migrated: false, reason: "no_legacy" })),
}));

vi.mock("./bootTrace", () => ({
  bootTrace: vi.fn(),
  bootTraceAsync: vi.fn(async (_id: string, _label: string, fn: () => Promise<unknown>) => fn()),
}));

function installLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  const localStorage = {
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null),
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
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    },
    configurable: true,
  });
  return store;
}

describe("ANDROID-STARTUP-P0 corrections", () => {
  beforeEach(async () => {
    installLocalStorage();
    listUserShops.mockReset();
    fetchProfilePrimaryShopId.mockReset();
    resolvePrimaryOrganizationForUser.mockReset();
    listUserShops.mockResolvedValue([]);
    fetchProfilePrimaryShopId.mockResolvedValue(null);
    resolvePrimaryOrganizationForUser.mockResolvedValue(null);
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { resetActiveShopForTests } = await import("../offline/shopScope");
    setActiveAccountKey(null);
    resetActiveShopForTests();
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { resetActiveShopForTests } = await import("../offline/shopScope");
    setActiveAccountKey(null);
    resetActiveShopForTests();
  });

  it("T1 — device check does not prevent POS provider mount while loading", async () => {
    const { deviceGateMountsProtectedOutlet } = await import("./deviceActivationGatePolicy");
    expect(
      deviceGateMountsProtectedOutlet({
        loading: true,
        activated: false,
        path: "/",
        isShopOwner: false,
        blockKind: null,
      }),
    ).toBe(true);
  });

  it("T2 — first paint is checking, not false unauthorized/network failed", async () => {
    const { initialDeviceActivationFlags, isDeviceActivationBlockingUse } = await import("./deviceActivationGatePolicy");
    const flags = initialDeviceActivationFlags("supabase", USER_A);
    expect(flags).toEqual({ loading: true, activated: false });
    expect(isDeviceActivationBlockingUse(flags)).toBe(false);
    expect(initialDeviceActivationFlags("local", USER_A)).toEqual({ loading: false, activated: true });
    expect(initialDeviceActivationFlags("supabase", null)).toEqual({ loading: false, activated: true });
  });

  it("T3 — persisted shop for this namespace restores when network is unavailable", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { persistLastActiveShopId, getActiveShopId, getPersistenceNamespace } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    setActiveAccountKey(`sb:${USER_A}`);
    persistLastActiveShopId(SHOP_A);
    listUserShops.mockRejectedValue(new Error("network unavailable"));

    const started = Date.now();
    const result = await initializeActiveShopForAccount(USER_A);
    const elapsed = Date.now() - started;

    expect(result).toBe(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
    expect(getPersistenceNamespace()).toBe(`sb:${USER_A}:${SHOP_A}`);
    expect(elapsed).toBeLessThan(500);
  });

  it("T4 — hanging listUserShops does not block startup indefinitely", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { getActiveShopId } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount, SHOP_NETWORK_TIMEOUT_MS } = await import("./initializeActiveShop");

    setActiveAccountKey(`sb:${USER_A}`);
    listUserShops.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const p = initializeActiveShopForAccount(USER_A);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SHOP_NETWORK_TIMEOUT_MS + 1);
    const result = await p;
    expect(result).toBeNull();
    expect(getActiveShopId()).toBeNull();
    vi.useRealTimers();
  });

  it("T5 — no safe local shop + network fail does not fabricate a shop", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { getActiveShopId, readPersistedLastActiveShopId } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    setActiveAccountKey(`sb:${USER_A}`);
    listUserShops.mockResolvedValue([]);
    const result = await initializeActiveShopForAccount(USER_A);
    expect(result).toBeNull();
    expect(getActiveShopId()).toBeNull();
    expect(readPersistedLastActiveShopId()).toBeNull();
  });

  it("T6 — User A/Shop A cannot cross-restore User B/Shop B", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const {
      persistLastActiveShopId,
      lastActiveShopStorageKey,
      readPersistedLastActiveShopId,
      getActiveShopId,
      getPersistenceNamespace,
    } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    const keyA = lastActiveShopStorageKey(`sb:${USER_A}`);
    const keyB = lastActiveShopStorageKey(`sb:${USER_B}`);
    expect(keyA).toBe(`waka.lastActiveShopId.v1::sb:${USER_A}`);
    expect(keyB).toBe(`waka.lastActiveShopId.v1::sb:${USER_B}`);
    expect(keyA).not.toBe(keyB);
    expect(globalThis.localStorage.getItem("waka.lastActiveShopId.v1")).toBeNull();

    persistLastActiveShopId(SHOP_A, `sb:${USER_A}`);
    persistLastActiveShopId(SHOP_B, `sb:${USER_B}`);

    setActiveAccountKey(`sb:${USER_B}`);
    listUserShops.mockRejectedValue(new Error("network unavailable"));
    const result = await initializeActiveShopForAccount(USER_B);
    expect(result).toBe(SHOP_B);
    expect(getActiveShopId()).toBe(SHOP_B);
    expect(getPersistenceNamespace()).toBe(`sb:${USER_B}:${SHOP_B}`);
    expect(readPersistedLastActiveShopId(`sb:${USER_A}`)).toBe(SHOP_A);
    expect(readPersistedLastActiveShopId(`sb:${USER_B}`)).toBe(SHOP_B);
  });

  it("T7 — logout clears in-memory shop so the next user cannot inherit it", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { setActiveShopId, getActiveShopId, persistLastActiveShopId, readPersistedLastActiveShopId } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    setActiveAccountKey(`sb:${USER_A}`);
    setActiveShopId(SHOP_A);
    persistLastActiveShopId(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
    expect(readPersistedLastActiveShopId(`sb:${USER_A}`)).toBe(SHOP_A);

    setActiveShopId(null);
    setActiveAccountKey(null);
    expect(getActiveShopId()).toBeNull();

    setActiveAccountKey(`sb:${USER_B}`);
    listUserShops.mockResolvedValue([]);
    const result = await initializeActiveShopForAccount(USER_B);
    expect(result).toBeNull();
    expect(getActiveShopId()).toBeNull();
    expect(readPersistedLastActiveShopId(`sb:${USER_A}`)).toBe(SHOP_A);
    expect(readPersistedLastActiveShopId(`sb:${USER_B}`)).toBeNull();
  });

  it("T8 — cloud sync is not awaited before POS-ready", async () => {
    const { POS_BOOT_GATES } = await import("./posBootGates");
    expect(POS_BOOT_GATES.awaitCloudRecovery).toBe(false);
    expect(POS_BOOT_GATES.awaitQueueFlush).toBe(false);
    expect(POS_BOOT_GATES.awaitReports).toBe(false);
    expect(POS_BOOT_GATES.awaitCriticalDiskHydrate).toBe(true);
  });

  it("T9 — unauthorized device remains blocked after the check resolves", async () => {
    const { deviceGateMountsProtectedOutlet, isDeviceActivationBlockingUse } = await import("./deviceActivationGatePolicy");
    expect(isDeviceActivationBlockingUse({ loading: false, activated: false })).toBe(true);
    expect(
      deviceGateMountsProtectedOutlet({
        loading: false,
        activated: false,
        path: "/",
        isShopOwner: false,
        blockKind: "pending",
      }),
    ).toBe(false);
    expect(
      deviceGateMountsProtectedOutlet({
        loading: false,
        activated: false,
        path: "/",
        isShopOwner: false,
        blockKind: "revoked",
      }),
    ).toBe(false);
    expect(
      deviceGateMountsProtectedOutlet({
        loading: false,
        activated: false,
        path: "/device-pending",
        isShopOwner: false,
        blockKind: "pending",
      }),
    ).toBe(true);
  });
});
