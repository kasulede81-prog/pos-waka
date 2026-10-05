import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * G3-B — a stale shop resolution must not be able to publish.
 *
 * THE RACE. `initializeActiveShopForAccount` mutates shared state (the active shop, the lifecycle
 * state, the cached shop, the persisted last shop, and a legacy-persistence migration) at several
 * points spread across awaits. The boot provider's generation guard runs *after* the call returns,
 * so it cannot protect any of them: by the time the stale caller is discarded, the damage is done.
 *
 * These tests control the promises directly — a resolution for one account is left pending while a
 * newer boot completes, and only then allowed to finish. They fail against an unguarded
 * implementation, which is the point: a test that passes both before and after proves nothing.
 */

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_A = "sb:user-a";
const ACCOUNT_B = "sb:user-b";

type ShopRow = { shop_id: string; shop_name: string; organization_id: string; role: string; is_primary: boolean };

const row = (shopId: string, isPrimary: boolean): ShopRow => ({
  shop_id: shopId,
  shop_name: shopId.slice(0, 4),
  organization_id: "org-1",
  role: "owner",
  is_primary: isPrimary,
});

vi.mock("./supabase", () => ({ hasSupabaseConfig: true }));
vi.mock("./primaryShop", () => ({
  listUserShops: vi.fn(async () => [] as ShopRow[]),
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

/** A promise whose settlement the test chooses. This is how the race is made deterministic. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The resolution under test may abandon this promise after a timeout; without a handler the
  // rejection would surface as an unhandled rejection unrelated to what is being asserted.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

describe("G3-B — stale shop resolution cannot publish", () => {
  beforeEach(async () => {
    // The default node environment has no storage; the persisted-last-shop assertions need one.
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => void backing.set(key, String(value)),
        removeItem: (key: string) => void backing.delete(key),
      },
    });

    const { resetActiveShopForTests } = await import("../offline/shopScope");
    const { setActiveAccountKey } = await import("../offline/accountScope");
    resetActiveShopForTests();
    setActiveAccountKey(ACCOUNT_A);
    vi.mocked((await import("./primaryShop")).listUserShops).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockReset();
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockReset();
    vi.mocked((await import("./primaryShop")).fetchProfilePrimaryShopId).mockResolvedValue(null);
    vi.mocked((await import("./fetchShopSubscription")).resolvePrimaryOrganizationForUser).mockResolvedValue(null);
  });

  /** Completes a normal boot for `accountKey`/`userId` against `shopId`. */
  async function bootFor(accountKey: string, userId: string, shopId: string) {
    const { setActiveAccountKey } = await import("../offline/accountScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([row(shopId, true)]);
    setActiveAccountKey(accountKey);
    return initializeActiveShopForAccount(userId);
  }

  it("Test A — a late resolution cannot overwrite a newer account's ready state", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    // Account A's request hangs.
    const pendingA = deferred<ShopRow[]>();
    vi.mocked((await import("./primaryShop")).listUserShops).mockReturnValueOnce(pendingA.promise);
    const staleA = initializeActiveShopForAccount("user-a");

    // Account B takes over and boots fully.
    await bootFor(ACCOUNT_B, "user-b", SHOP_B);
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);

    // A's request finally lands, carrying A's shop.
    pendingA.resolve([row(SHOP_A, true)]);
    const staleResult = await staleA;

    // The stale attempt must publish nothing at all.
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);
    expect(staleResult).toBeNull();

    // The sync-side cached shop is a mutation too: it must still point at B's shop, never A's.
    const { setCachedShopId } = await import("./shopSyncContext");
    const cachedValues = vi.mocked(setCachedShopId).mock.calls.map(([value]) => value);
    expect(cachedValues).not.toContain(SHOP_A);
    expect(cachedValues.at(-1)).toBe(SHOP_B);
  });

  it("Test B — a stale FAILURE cannot disturb a newer account's ready state", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    const pendingA = deferred<ShopRow[]>();
    vi.mocked((await import("./primaryShop")).listUserShops).mockReturnValueOnce(pendingA.promise);
    const staleA = initializeActiveShopForAccount("user-a");

    await bootFor(ACCOUNT_B, "user-b", SHOP_B);
    expect(getActiveShopState()).toBe("ready");

    // A's request fails after B is already up.
    pendingA.reject(new Error("network unavailable"));
    await staleA;

    // A failure that belongs to a superseded account must not reclassify the live one.
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);
  });

  it("Test C — a stale TIMEOUT publishes no state", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount, SHOP_NETWORK_TIMEOUT_MS } = await import("./initializeActiveShop");

    // Fake timers stay installed for the WHOLE test: switching back to real timers would discard
    // the pending request timer that this test exists to fire.
    vi.useFakeTimers();
    try {
      const pendingA = deferred<ShopRow[]>();
      vi.mocked((await import("./primaryShop")).listUserShops).mockReturnValueOnce(pendingA.promise);
      const staleA = initializeActiveShopForAccount("user-a");
      await Promise.resolve();

      // Account B boots fully while A is still hanging (B's request resolves immediately).
      vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([row(SHOP_B, true)]);
      const bootB = bootFor(ACCOUNT_B, "user-b", SHOP_B);
      await vi.advanceTimersByTimeAsync(0);
      await bootB;
      expect(getActiveShopState()).toBe("ready");

      // Now A's clock runs out.
      await vi.advanceTimersByTimeAsync(SHOP_NETWORK_TIMEOUT_MS + 1);
      await staleA;
    } finally {
      vi.useRealTimers();
    }

    // A timed-out stale attempt must not report itself as an unresolved LIVE context either —
    // `initializing` here would stall the POS even though B is perfectly ready.
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);
  });

  it("Test D — a stale attempt's retry cannot activate its shop later", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { getActiveAccountKey } = await import("../offline/accountScope");
    const { initializeActiveShopForAccount, resolveShopContextForBoot } = await import("./initializeActiveShop");

    // A never resolves for its own account, so the boot helper schedules a retry…
    vi.mocked((await import("./primaryShop")).listUserShops).mockRejectedValue(new Error("network unavailable"));
    let generation = 1;
    const waits: number[] = [];
    const outcome = await resolveShopContextForBoot(
      {
        // The REAL initializer, guarded exactly as the provider guards it.
        initialize: (userId) => initializeActiveShopForAccount(userId, { isCurrent: () => generation === 1 }),
        getState: getActiveShopState,
        getAccountKey: getActiveAccountKey,
        isCurrent: () => generation === 1,
        wait: async (ms) => {
          waits.push(ms);
          // …and while it is waiting, account B takes over (a newer generation).
          generation = 2;
          await bootFor(ACCOUNT_B, "user-b", SHOP_B);
        },
      },
      { userId: "user-a", accountKey: ACCOUNT_A },
    );

    expect(waits.length).toBe(1);
    // The superseded attempt stopped retrying, and B's context is intact.
    expect(outcome.attempts).toBe(1);
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);
  });

  it("Test E — sign-out during a pending resolution is not undone by its late arrival", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");
    const { setActiveAccountKey } = await import("../offline/accountScope");

    const pendingA = deferred<ShopRow[]>();
    vi.mocked((await import("./primaryShop")).listUserShops).mockReturnValueOnce(pendingA.promise);
    const staleA = initializeActiveShopForAccount("user-a");

    // Sign-out: the provider clears the account and records the terminal state.
    setActiveAccountKey(null);
    const { setActiveShopState, clearActiveShopId } = await import("../offline/shopScope");
    clearActiveShopId();
    setActiveShopState("signed-out");

    pendingA.resolve([row(SHOP_A, true)]);
    await staleA;

    // A signed-out session must not be resurrected by a request it left in flight.
    expect(getActiveShopState()).toBe("signed-out");
    expect(getActiveShopId()).toBeNull();
  });

  it("Test F — an older generation for the SAME account cannot overwrite the newer one", async () => {
    const { getActiveShopId, getActiveShopState } = await import("../offline/shopScope");
    const { initializeActiveShopForAccount } = await import("./initializeActiveShop");

    // Same account throughout: the account key cannot tell these two apart, so only the
    // generation token can.
    let generation = 1;
    const pendingFirst = deferred<ShopRow[]>();
    vi.mocked((await import("./primaryShop")).listUserShops).mockReturnValueOnce(pendingFirst.promise);
    const first = initializeActiveShopForAccount("user-a", { isCurrent: () => generation === 1 });

    // A newer boot for the same account completes.
    generation = 2;
    vi.mocked((await import("./primaryShop")).listUserShops).mockResolvedValue([row(SHOP_B, true)]);
    await initializeActiveShopForAccount("user-a", { isCurrent: () => generation === 2 });
    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);

    // The older generation finally lands, carrying a different shop.
    pendingFirst.resolve([row(SHOP_A, true)]);
    await first;

    expect(getActiveShopState()).toBe("ready");
    expect(getActiveShopId()).toBe(SHOP_B);
  });
});
