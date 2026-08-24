import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccount } from "../types";
import { setActiveAccountKey } from "../offline/accountScope";
import { filterActiveSellersForPicker } from "./staffSellerPicker";
import { resolveSessionActor } from "./sessionActor";
import { usePosStore } from "../store/usePosStore";

const ACCOUNT = "sb:owner-phase11g1";
const SHOP_A = "shop-a-uuid";
const STAFF_JOHN = "33333333-3333-4333-8333-333333333333";
const STAFF_MARY = "55555555-5555-4555-8555-555555555555";
const OWNER_UUID = "11111111-1111-4111-8111-111111111111";

const memoryStaffCache = new Map<string, { shopId: string; payload: unknown }>();
const memoryKv = new Map<string, unknown>();

function staff(partial: Partial<StaffAccount> & Pick<StaffAccount, "id" | "name" | "role" | "active">): StaffAccount {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

vi.mock("../offline/localDb", () => ({
  getLocalDb: async () => ({
    get: async (store: string, key: string) => {
      if (store === "staffCache") return memoryStaffCache.get(key);
      if (store === "kv") return memoryKv.get(key);
      return undefined;
    },
    put: async (store: string, value: unknown, key: string) => {
      if (store === "staffCache") {
        memoryStaffCache.set(key, value as { shopId: string; payload: unknown });
      }
      if (store === "kv") memoryKv.set(key, value);
    },
    getAllKeys: async (store: string) => {
      if (store === "staffCache") return [...memoryStaffCache.keys()];
      if (store === "kv") return [...memoryKv.keys()];
      return [];
    },
    delete: async () => undefined,
    transaction: () => ({ store: { delete: async () => undefined }, done: Promise.resolve() }),
  }),
  appendSyncOperation: async () => undefined,
  writeSnapshot: async () => undefined,
  readSnapshotWithFallback: async () => null,
}));

vi.mock("./deviceId", () => ({
  getOrCreateDeviceId: () => "phase11g1-device",
}));

vi.mock("./organizationDeletionState", () => ({
  isOrganizationBlocked: () => false,
  hasWipeMarker: () => false,
  ORGANIZATION_DELETED_MESSAGE: "deleted",
}));

describe("STAFF-V2 Phase 11g.1 seller cache hydration", () => {
  beforeEach(() => {
    memoryStaffCache.clear();
    memoryKv.clear();
    setActiveAccountKey(null);
    vi.resetModules();
  });

  it("H1 — encrypted cache read returns sellers for shopId+accountKey", async () => {
    const { writeOfflineStaffCache } = await import("./offlineStaffCache");
    const { listActiveSellersForStaffLogin } = await import("./staffOfflineAuth");

    await writeOfflineStaffCache(
      {
        shopId: SHOP_A,
        businessName: "Denis&Sons",
        version: 1,
        downloadedAt: new Date().toISOString(),
        staff: [staff({ id: STAFF_JOHN, name: "John", role: "cashier", active: true })],
      },
      ACCOUNT,
    );

    const sellers = await listActiveSellersForStaffLogin({
      accountKey: ACCOUNT,
      businessName: "Denis&Sons",
      shopId: SHOP_A,
    });
    expect(sellers.map((s) => s.name)).toEqual(["John"]);
  });

  it("H2 — decrypts with provided accountKey when getActiveAccountKey is null", async () => {
    const { writeOfflineStaffCache, readOfflineStaffCache } = await import("./offlineStaffCache");

    setActiveAccountKey(ACCOUNT);
    await writeOfflineStaffCache(
      {
        shopId: SHOP_A,
        businessName: "Denis&Sons",
        version: 1,
        downloadedAt: new Date().toISOString(),
        staff: [staff({ id: STAFF_JOHN, name: "John", role: "cashier", active: true })],
      },
      ACCOUNT,
    );

    setActiveAccountKey(null);
    const record = await readOfflineStaffCache(SHOP_A, ACCOUNT);
    expect(record?.staff.map((s) => s.name)).toEqual(["John"]);

    const missing = await readOfflineStaffCache(SHOP_A, null);
    expect(missing).toBeNull();
  });

  it("H3 — inactive cache falls through to active snapshot sellers", async () => {
    const { writeOfflineStaffCache } = await import("./offlineStaffCache");
    const { listActiveSellersForStaffLogin } = await import("./staffOfflineAuth");

    await writeOfflineStaffCache(
      {
        shopId: SHOP_A,
        businessName: "Denis&Sons",
        version: 1,
        downloadedAt: new Date().toISOString(),
        staff: [staff({ id: STAFF_JOHN, name: "John", role: "cashier", active: false })],
      },
      ACCOUNT,
    );

    memoryKv.set(`${ACCOUNT}::snapshot`, {
      preferences: {
        shopDisplayName: "Denis&Sons",
        staffAccounts: [staff({ id: STAFF_MARY, name: "Mary", role: "cashier", active: true })],
      },
    });

    const sellers = await listActiveSellersForStaffLogin({
      accountKey: ACCOUNT,
      businessName: "Denis&Sons",
      shopId: SHOP_A,
    });
    expect(sellers.map((s) => s.name)).toEqual(["Mary"]);
    expect(sellers.find((s) => s.name === "John")).toBeUndefined();
  });

  it("H4 — shop listing omits shops with only suspended staff", async () => {
    const { listCachedShopsForStaffLogin } = await import("./staffOfflineAuth");

    memoryKv.set(`${ACCOUNT}::snapshot`, {
      preferences: {
        shopDisplayName: "Denis&Sons",
        staffAccounts: [
          staff({
            id: STAFF_JOHN,
            name: "John",
            role: "cashier",
            active: true,
            lockedUntil: new Date(Date.now() + 60_000).toISOString(),
          }),
        ],
      },
    });

    expect(filterActiveSellersForPicker(
      (memoryKv.get(`${ACCOUNT}::snapshot`) as { preferences: { staffAccounts: StaffAccount[] } })
        .preferences.staffAccounts,
    )).toEqual([]);

    const shops = await listCachedShopsForStaffLogin();
    expect(shops.find((s) => s.businessName === "Denis&Sons")).toBeUndefined();
  });

  it("H5 — Phase 11g seller select keeps owner authUserId (SessionActor)", () => {
    usePosStore.setState((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        activeStaffId: STAFF_JOHN,
        staffAccounts: [
          staff({
            id: STAFF_JOHN,
            name: "John",
            role: "cashier",
            active: true,
            linkedAuthUserId: "22222222-2222-4222-8222-222222222222",
          }),
        ],
      },
    }));

    expect(usePosStore.getState().preferences.activeStaffId).toBe(STAFF_JOHN);

    const actor = resolveSessionActor({
      mode: "supabase",
      user: { id: OWNER_UUID, email: "owner@waka.invalid" } as never,
      email: "owner@waka.invalid",
      shopMemberRole: "owner",
      preferences: usePosStore.getState().preferences,
    });
    expect(actor.authUserId).toBe(OWNER_UUID);
    expect(actor.authRole).toBe("owner");
    expect(actor.userId).toBe(`staff:${STAFF_JOHN}`);
  });
});
