import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOP_GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
}));

vi.mock("./primaryShop", () => ({
  listUserShops: vi.fn(async () => []),
  fetchProfilePrimaryShopId: vi.fn(async () => null),
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: vi.fn(async () => null),
}));

vi.mock("../offline/shopScopeMigration", () => ({
  migrateLegacyPersistenceToShop: vi.fn(async () => ({ migrated: false, reason: "no_legacy" })),
}));

vi.mock("./shopSyncContext", () => ({
  setCachedShopId: vi.fn(),
  clearCachedShopId: vi.fn(),
}));

describe("initializeActiveShopForAccount", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests } = await import("../offline/shopScope");
    const { setActiveAccountKey } = await import("../offline/accountScope");
    resetActiveShopForTests();
    setActiveAccountKey("sb:user-1");
    vi.mocked((await import("./primaryShop")).listUserShops).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockReset();
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(null);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue(null);
  });

  it("T6 — restores the membership primary shop when none is in memory", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
      { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_B);
    expect(getActiveShopId()).toBe(SHOP_B);
  });

  it("T7 — does not keep an in-memory shop that is no longer a member", async () => {
    const { setActiveShopId } = await import("../offline/shopScope");
    setActiveShopId(SHOP_GONE);
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
  });

  it("T8 — missing persisted shop falls back to the remaining member shop", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
    ]);
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(SHOP_GONE);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
  });

  it("T7 — org shop id is not activated unless it is in membership", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: false },
      { shop_id: SHOP_B, shop_name: "B", organization_id: "o", role: "manager", is_primary: false },
    ]);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue({
      organizationId: "o",
      shopId: SHOP_GONE,
    });
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopId } = await import("../offline/shopScope");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).not.toBe(SHOP_GONE);
    expect(getActiveShopId()).not.toBe(SHOP_GONE);
  });

  it("T11 — empty membership list keeps the current in-memory shop (offline RPC)", async () => {
    const { setActiveShopId, getActiveShopId } = await import("../offline/shopScope");
    setActiveShopId(SHOP_A);
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const shopId = await initializeActiveShopForAccount("user-1");
    expect(shopId).toBe(SHOP_A);
    expect(getActiveShopId()).toBe(SHOP_A);
  });
});

/**
 * G3-A — what the resolution CONCLUDED, not just what it returned.
 *
 * `activeShopId === null` used to be the whole answer, which made a boot that had not finished
 * resolving indistinguishable from an account that genuinely has no shop. Those lead to opposite
 * decisions: the first must keep the POS in startup, the second is a legitimate place to continue
 * from (onboarding). These tests pin the distinction, and in particular pin that a failed or
 * timed-out resolution is NOT reported as ready and NOT disguised as no-shop.
 */
describe("G3-A — shop context lifecycle classification", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests, clearPersistedLastActiveShopId } = await import("../offline/shopScope");
    const { setActiveAccountKey } = await import("../offline/accountScope");
    resetActiveShopForTests();
    setActiveAccountKey("sb:user-1");
    clearPersistedLastActiveShopId("sb:user-1");
    vi.mocked((await import("./primaryShop")).listUserShops).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockReset();
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(null);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue(null);
  });

  it("starts unresolved, so nothing can assume a shop before resolution has even run", async () => {
    const { getActiveShopState } = await import("../offline/shopScope");
    // The module's own initial value — the state a consumer sees if it runs too early.
    expect(getActiveShopState()).toBe("initializing");
  });

  it("initializing → ready when a member shop is resolved", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([
      { shop_id: SHOP_A, shop_name: "A", organization_id: "o", role: "owner", is_primary: true },
    ]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopState, getActiveShopId } = await import("../offline/shopScope");

    await initializeActiveShopForAccount("user-1");

    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_A);
  });

  it("initializing → no-shop when the membership list is genuinely empty", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([]);
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopState, getActiveShopId } = await import("../offline/shopScope");

    const result = await initializeActiveShopForAccount("user-1");

    expect(result).toBeNull();
    // A real answer, and a legitimate state to continue from — NOT a failure.
    expect(getActiveShopState()).toBe("no-shop");
    expect(getActiveShopId()).toBeNull();
  });

  it("a network failure stays UNRESOLVED — neither ready nor no-shop", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockRejectedValue(new Error("network unavailable"));
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopState, getActiveShopId } = await import("../offline/shopScope");

    const result = await initializeActiveShopForAccount("user-1");

    expect(result).toBeNull();
    expect(getActiveShopState()).toBe("initializing");
    expect(getActiveShopState()).not.toBe("ready");
    // The specific confusion that let a shopless POS come up: a failed read reported as "no shop".
    expect(getActiveShopState()).not.toBe("no-shop");
    expect(getActiveShopId()).toBeNull();
  });

  it("a TIMEOUT stays unresolved too", async () => {
    vi.mocked((await import("./primaryShop")).listUserShops).mockImplementation(() => new Promise(() => {}));
    const { initializeActiveShopForAccount, SHOP_NETWORK_TIMEOUT_MS } = await import("./initializeActiveShop");
    const { getActiveShopState } = await import("../offline/shopScope");

    vi.useFakeTimers();
    const pending = initializeActiveShopForAccount("user-1");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SHOP_NETWORK_TIMEOUT_MS + 1);
    await pending;
    vi.useRealTimers();

    expect(getActiveShopState()).toBe("initializing");
  });

  it("restores the persisted last shop while offline, so legitimate offline boot stays ready", async () => {
    // The node test environment has no storage; the persisted-shop restore needs one. Only this
    // test installs it, and it is removed again in `finally`.
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => void backing.set(key, String(value)),
        removeItem: (key: string) => void backing.delete(key),
      },
    });

    try {
      const { persistLastActiveShopId, getActiveShopState } = await import("../offline/shopScope");
      persistLastActiveShopId(SHOP_A, "sb:user-1");
      vi.mocked((await import("./primaryShop")).listUserShops).mockRejectedValue(new Error("network unavailable"));

      const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
      const result = await initializeActiveShopForAccount("user-1");

      // Offline continuation is preserved exactly where a shop context IS known: this is the
      // distinction the gate depends on — unresolved must not be reachable here, and a restored
      // shop must not be mistaken for one.
      expect(result).toBe(SHOP_A);
      expect(getActiveShopState()).toBe("ready");
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("an offline-only account needs no shop — not-required, not no-shop", async () => {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    setActiveAccountKey("local:owner@example.com");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopState } = await import("../offline/shopScope");

    await initializeActiveShopForAccount("user-1");

    expect(getActiveShopState()).toBe("not-required");
  });

  it("no user at all is signed-out", async () => {
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { getActiveShopState } = await import("../offline/shopScope");

    await initializeActiveShopForAccount(null);

    expect(getActiveShopState()).toBe("signed-out");
  });
});

describe("T9 — primary shop selector uses the mutation boundary", () => {
  it("Settings selector calls switchActiveShop and displays getActiveShopId", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/settings/PrimaryShopSelector.tsx"),
      "utf8",
    );
    expect(src).toContain("switchActiveShop");
    expect(src).toContain("getActiveShopId");
    expect(src).toContain("updatePrimary: true");
    expect(src).not.toContain("setActiveShopId(");
  });
});
