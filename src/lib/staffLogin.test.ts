import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ONLINE (Google) staff sign-in path.
 *
 * Sign-in itself is not simulated — it is `useAuth.signInWithGoogle`, already covered elsewhere.
 * What is exercised here is everything the staff path decides on its own: which shops the account
 * may open, whether it may continue without asking, that a fabricated shop is refused, and that
 * the offline PIN machinery is never on this path at all.
 */

const listUserShops = vi.hoisted(() => vi.fn());
vi.mock("./primaryShop", () => ({
  listUserShops,
  setUserPrimaryShop: vi.fn(async () => true),
  fetchProfilePrimaryShopId: vi.fn(async () => null),
}));

const switchActiveShop = vi.hoisted(() => vi.fn());
vi.mock("./activeShopSwitch", () => ({
  switchActiveShop,
  clearActiveShopOnSignOut: vi.fn(),
}));

const hydrateStaffAuthWorkspace = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./staffAuthHydrate", () => ({
  hydrateStaffAuthWorkspace,
  clearPersonalStaffTerminalRuntimeState: vi.fn(),
  isNonOwnerShopMemberRole: (role: string | null | undefined) => Boolean(role) && role !== "owner",
}));

/** `user_can_access_shop` — the RLS predicate the access filter asks. Defaults to "yes". */
const canAccessShopRpc = vi.hoisted(() =>
  vi.fn<(name: string, args: unknown) => Promise<{ data: boolean | null; error: { message: string } | null }>>(
    async () => ({ data: true, error: null }),
  ),
);
vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "auth-user-1" } } }) },
    rpc: (name: string, args: unknown) => canAccessShopRpc(name, args),
  },
}));

/** The offline path, which the Google staff path must never touch. */
const listCachedShopsForStaffLogin = vi.hoisted(() => vi.fn(async () => []));
const authenticateStaffLogin = vi.hoisted(() => vi.fn(async () => undefined));
const authenticateOfflineStaff = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./staffOfflineAuth", () => ({
  listCachedShopsForStaffLogin,
  authenticateStaffLogin,
  authenticateOfflineStaff,
}));

import {
  chooseStaffShop,
  clearStaffLoginIntent,
  hasStaffLoginIntent,
  listAccessibleStaffShops,
  markStaffLoginIntent,
  selectStaffShop,
  STAFF_SHOP_SWITCH_TIMEOUT_MS,
  toStaffShopOptions,
} from "./staffLogin";

/** Server row shape returned by `list_user_shops()`. */
function row(shopId: string, shopName: string, role = "cashier", isPrimary = false) {
  return { shop_id: shopId, shop_name: shopName, organization_id: "org-1", role, is_primary: isPrimary };
}

function installSessionStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  installSessionStorage();
  listUserShops.mockReset().mockResolvedValue([]);
  canAccessShopRpc.mockReset().mockResolvedValue({ data: true, error: null });
  switchActiveShop.mockReset().mockResolvedValue({ ok: true });
  hydrateStaffAuthWorkspace.mockClear();
  listCachedShopsForStaffLogin.mockClear();
  authenticateStaffLogin.mockClear();
  authenticateOfflineStaff.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the shop list comes from the server", () => {
  it("keeps only rows the server returned", async () => {
    listUserShops.mockResolvedValue([row("shop-a", "Alpha"), row("shop-b", "Beta")]);

    const shops = await listAccessibleStaffShops();

    expect(shops.map((s) => s.shopId)).toEqual(["shop-a", "shop-b"]);
    // No local lookup contributed to the list.
    expect(listCachedShopsForStaffLogin).not.toHaveBeenCalled();
  });

  it("drops rows with no usable id instead of offering a dead end", () => {
    const shops = toStaffShopOptions([
      row("shop-a", "Alpha"),
      { shop_id: "", shop_name: "Broken", organization_id: "o", role: "cashier", is_primary: false },
      row("shop-b", "Beta"),
    ]);
    expect(shops.map((s) => s.shopId)).toEqual(["shop-a", "shop-b"]);
  });

  it("orders the primary shop first, then by name", () => {
    const shops = toStaffShopOptions([
      row("s3", "Charlie"),
      row("s1", "Alpha", "cashier", true),
      row("s2", "Bravo"),
    ]);
    expect(shops.map((s) => s.shopId)).toEqual(["s1", "s2", "s3"]);
    expect(shops[0]!.isPrimary).toBe(true);
  });

  it("treats an unreachable server as no access rather than throwing", async () => {
    listUserShops.mockRejectedValue(new Error("offline"));
    await expect(listAccessibleStaffShops()).resolves.toEqual([]);
  });

  it("hides a shop the account can no longer access (disabled or deleted staff)", async () => {
    listUserShops.mockResolvedValue([row("shop-a", "Alpha"), row("shop-b", "Beta")]);
    canAccessShopRpc.mockImplementation(async (_name, args) => {
      const shopId = (args as { p_shop: string }).p_shop;
      return { data: shopId === "shop-a", error: null };
    });

    const shops = await listAccessibleStaffShops();

    expect(shops.map((s) => s.shopId)).toEqual(["shop-a"]);
  });

  it("keeps a shop listed when the access predicate cannot be answered", async () => {
    listUserShops.mockResolvedValue([row("shop-a", "Alpha")]);
    canAccessShopRpc.mockResolvedValue({ data: null, error: { message: "offline" } });

    // Fail-open: RLS still refuses the data, so a failed check must not lock a real staff member out.
    await expect(listAccessibleStaffShops()).resolves.toHaveLength(1);
  });

  it("asks the RLS predicate about the shop, not about the caller", async () => {
    listUserShops.mockResolvedValue([row("shop-a", "Alpha")]);
    await listAccessibleStaffShops();
    expect(canAccessShopRpc).toHaveBeenCalledWith("user_can_access_shop", { p_shop: "shop-a" });
  });
});

describe("chooseStaffShop — one shop continues, several ask, none is an error", () => {
  it("one shop continues automatically (no picker)", () => {
    const choice = chooseStaffShop(toStaffShopOptions([row("shop-a", "Alpha")]));
    expect(choice.kind).toBe("single");
  });

  it("two shops require a choice (picker)", () => {
    const choice = chooseStaffShop(toStaffShopOptions([row("shop-a", "Alpha"), row("shop-b", "Beta")]));
    expect(choice.kind).toBe("multiple");
    if (choice.kind === "multiple") expect(choice.shops).toHaveLength(2);
  });

  it("no shop is 'none' — never a silent pick and never a new shop", () => {
    expect(chooseStaffShop([])).toEqual({ kind: "none" });
  });
});

describe("selectStaffShop — the server stays authoritative", () => {
  it("attaches the chosen shop through the existing branch switch, and persists it", async () => {
    const result = await selectStaffShop("shop-b");

    expect(result).toEqual({ ok: true });
    expect(switchActiveShop).toHaveBeenCalledTimes(1);
    expect(switchActiveShop).toHaveBeenCalledWith("shop-b", { updatePrimary: true });
  });

  it("refuses a shop the account is not a member of", async () => {
    // `switchActiveShop` re-checks membership against list_user_shops() and reports not_member.
    switchActiveShop.mockResolvedValue({ ok: false, error: "not_member" });

    const result = await selectStaffShop("shop-someone-else");

    expect(result).toEqual({ ok: false, error: "not_member" });
  });

  it("refuses a blank id without calling into the switch at all", async () => {
    await expect(selectStaffShop("")).resolves.toEqual({ ok: false, error: "invalid_shop" });
    await expect(selectStaffShop("   ")).resolves.toEqual({ ok: false, error: "invalid_shop" });
    expect(switchActiveShop).not.toHaveBeenCalled();
  });

  it("reports an unexpected switch failure instead of continuing", async () => {
    switchActiveShop.mockRejectedValue(new Error("boom"));
    await expect(selectStaffShop("shop-a")).resolves.toEqual({ ok: false, error: "unavailable" });
  });

  it("treats 'already on this shop' as success", async () => {
    switchActiveShop.mockResolvedValue({ ok: false, error: "same_shop" });
    await expect(selectStaffShop("shop-a")).resolves.toEqual({ ok: true });
  });
});

/**
 * The shop switch awaits an RPC, IndexedDB, a persistence migration, a second RPC and the POS
 * bootstrap. None of them rejects when a device merely stops making progress — they simply never
 * settle. Unbounded, that pinned the caller's spinner forever and left the picker a dead screen.
 */
describe("selectStaffShop is bounded — a hung switch can never lock the UI", () => {
  it("resolves to 'timeout' when the switch never settles, instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      switchActiveShop.mockImplementation(() => new Promise(() => undefined)); // never settles

      const pending = selectStaffShop("shop-a");
      await vi.advanceTimersByTimeAsync(STAFF_SHOP_SWITCH_TIMEOUT_MS + 50);

      await expect(pending).resolves.toEqual({ ok: false, error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reports success on a timeout — a hung switch must not read as ok", async () => {
    vi.useFakeTimers();
    try {
      switchActiveShop.mockImplementation(() => new Promise(() => undefined));
      const pending = selectStaffShop("shop-a");
      await vi.advanceTimersByTimeAsync(STAFF_SHOP_SWITCH_TIMEOUT_MS + 50);
      const result = await pending;
      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still returns the server's refusal promptly — the bound does not mask a real answer", async () => {
    switchActiveShop.mockResolvedValue({ ok: false, error: "not_member" });
    await expect(selectStaffShop("shop-someone-else")).resolves.toEqual({
      ok: false,
      error: "not_member",
    });
  });

  it("exposes the bound it enforces", () => {
    expect(STAFF_SHOP_SWITCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(STAFF_SHOP_SWITCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("no offline credential is used by the Google staff path", () => {
  it("never reads the local shop cache nor authenticates a PIN", async () => {
    listUserShops.mockResolvedValue([row("shop-a", "Alpha"), row("shop-b", "Beta")]);

    await listAccessibleStaffShops();
    await selectStaffShop("shop-a");

    expect(listCachedShopsForStaffLogin).not.toHaveBeenCalled();
    expect(authenticateStaffLogin).not.toHaveBeenCalled();
    expect(authenticateOfflineStaff).not.toHaveBeenCalled();
  });
});

describe("staff sign-in intent marker", () => {
  it("round-trips and clears", () => {
    expect(hasStaffLoginIntent()).toBe(false);
    markStaffLoginIntent();
    expect(hasStaffLoginIntent()).toBe(true);
    clearStaffLoginIntent();
    expect(hasStaffLoginIntent()).toBe(false);
  });

  it("survives a storage failure without throwing", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => markStaffLoginIntent()).not.toThrow();
    expect(hasStaffLoginIntent()).toBe(false);
    expect(() => clearStaffLoginIntent()).not.toThrow();
  });
});
