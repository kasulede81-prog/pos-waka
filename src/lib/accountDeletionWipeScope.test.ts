import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOP_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const idb = vi.hoisted(() => ({
  namespaces: [] as string[],
  failFor: new Set<string>(),
  throwFor: new Set<string>(),
  wiped: [] as string[],
}));

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("../offline/localDb", () => ({
  wipeIndexedDbNamespace: vi.fn(async (ns: string) => {
    idb.wiped.push(ns);
    if (idb.throwFor.has(ns)) throw new Error(`wipe failed: ${ns}`);
    if (idb.failFor.has(ns)) {
      return {
        kvKeysRemoved: 0,
        recordsRemoved: 0,
        syncQueueRemoved: 0,
        backupsRemoved: 0,
        ok: false,
        error: `idb error ${ns}`,
      };
    }
    return {
      kvKeysRemoved: 1,
      recordsRemoved: 1,
      syncQueueRemoved: 1,
      backupsRemoved: 1,
      ok: true,
    };
  }),
  listAccountKeysInIndexedDb: vi.fn(async () => [...idb.namespaces]),
  countBackupsForAccount: vi.fn(async () => 0),
  hasIndexedDbDataForAccount: vi.fn(async () => false),
}));

vi.mock("./monitoring", () => ({
  reportAuthIssue: vi.fn(),
  reportMonitoringEvent: vi.fn(),
  reportSyncIssue: vi.fn(),
  reportPwaIssue: vi.fn(),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      signOut: () => auth.signOut(),
    },
  },
}));

function installBrowserStorage(): void {
  const make = () => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    };
  };
  const localStorage = make();
  const sessionStorage = make();
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", {
    localStorage,
    sessionStorage,
  });
}

describe("SETTINGS-P0-DELETION-WIPE-SCOPE", () => {
  const userA = "sb:userA";
  const userB = "sb:userB";
  const user1 = "sb:user1";
  const user10 = "sb:user10";

  beforeEach(() => {
    installBrowserStorage();
    setActiveAccountKey(null);
    idb.namespaces = [];
    idb.failFor.clear();
    idb.throwFor.clear();
    idb.wiped = [];
    auth.signOut.mockClear();
    vi.clearAllMocks();
  });

  it("T1 — wipe removes sb:user account namespace", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    const { wipeIndexedDbNamespace } = await import("../offline/localDb");
    idb.namespaces = [userA];
    localStorage.setItem(`waka.sync.checkpoints.v1::${userA}`, "{}");

    const summary = await wipeAccountNamespace(userA);

    expect(wipeIndexedDbNamespace).toHaveBeenCalledWith(userA);
    expect(idb.wiped).toContain(userA);
    expect(summary.namespacesWiped).toContain(userA);
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${userA}`)).toBeNull();
    expect(summary.complete).toBe(true);
  });

  it("T2 — MB-1 wipe removes sb:user:shopA and sb:user:shopB", async () => {
    const { wipeAccountNamespace, listPersistenceNamespacesForAccount } = await import("./accountDataWipe");
    const nsA = `${userA}:${SHOP_A}`;
    const nsB = `${userA}:${SHOP_B}`;
    idb.namespaces = [userA, nsA, nsB];
    localStorage.setItem(`waka.sync.checkpoints.v1::${nsA}`, "a");
    localStorage.setItem(`waka.sync.health.v1::${nsB}`, "b");

    const discovered = await listPersistenceNamespacesForAccount(userA);
    expect(discovered).toEqual(expect.arrayContaining([userA, nsA, nsB]));

    const summary = await wipeAccountNamespace(userA);
    expect(idb.wiped).toEqual(expect.arrayContaining([userA, nsA, nsB]));
    expect(summary.namespacesWiped).toEqual(expect.arrayContaining([userA, nsA, nsB]));
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${nsA}`)).toBeNull();
    expect(localStorage.getItem(`waka.sync.health.v1::${nsB}`)).toBeNull();
  });

  it("T3 — wipe userA does not remove userB", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    const nsA = `${userA}:${SHOP_A}`;
    const nsB = `${userB}:${SHOP_B}`;
    idb.namespaces = [userA, nsA, userB, nsB];
    localStorage.setItem(`waka.sync.checkpoints.v1::${userB}`, "keep-b");
    localStorage.setItem(`waka.sync.checkpoints.v1::${nsB}`, "keep-b-shop");
    localStorage.setItem(`waka.lastActiveShopId.v1::${userB}`, SHOP_B);

    await wipeAccountNamespace(userA);

    expect(idb.wiped).toContain(userA);
    expect(idb.wiped).toContain(nsA);
    expect(idb.wiped).not.toContain(userB);
    expect(idb.wiped).not.toContain(nsB);
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${userB}`)).toBe("keep-b");
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${nsB}`)).toBe("keep-b-shop");
    expect(localStorage.getItem(`waka.lastActiveShopId.v1::${userB}`)).toBe(SHOP_B);
  });

  it("T4 — delete user1 does not delete user10 (prefix isolation)", async () => {
    const { wipeAccountNamespace, persistenceNamespaceBelongsToAccount } = await import("./accountDataWipe");
    expect(persistenceNamespaceBelongsToAccount(user10, user1)).toBe(false);
    expect(persistenceNamespaceBelongsToAccount(`${user10}:${SHOP_A}`, user1)).toBe(false);
    expect(persistenceNamespaceBelongsToAccount(`${user1}:${SHOP_A}`, user1)).toBe(true);

    idb.namespaces = [user1, `${user1}:${SHOP_A}`, user10, `${user10}:${SHOP_C}`];
    localStorage.setItem(`waka.sync.checkpoints.v1::${user10}`, "keep-10");
    localStorage.setItem(`waka.sync.checkpoints.v1::${user10}:${SHOP_C}`, "keep-10-shop");
    localStorage.setItem(`waka.lastActiveShopId.v1::${user10}`, SHOP_C);

    await wipeAccountNamespace(user1);

    expect(idb.wiped).toContain(user1);
    expect(idb.wiped).toContain(`${user1}:${SHOP_A}`);
    expect(idb.wiped).not.toContain(user10);
    expect(idb.wiped).not.toContain(`${user10}:${SHOP_C}`);
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${user10}`)).toBe("keep-10");
    expect(localStorage.getItem(`waka.sync.checkpoints.v1::${user10}:${SHOP_C}`)).toBe("keep-10-shop");
    expect(localStorage.getItem(`waka.lastActiveShopId.v1::${user10}`)).toBe(SHOP_C);
  });

  it("T5 — last active shop key removed for this account only", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    const { persistLastActiveShopId, lastActiveShopStorageKey } = await import("../offline/shopScope");
    persistLastActiveShopId(SHOP_A, userA);
    persistLastActiveShopId(SHOP_B, userB);
    const keyA = lastActiveShopStorageKey(userA);
    const keyB = lastActiveShopStorageKey(userB);
    expect(keyA).toBe(`waka.lastActiveShopId.v1::${userA}`);
    expect(localStorage.getItem(keyA!)).toBe(SHOP_A);
    expect(localStorage.getItem(keyB!)).toBe(SHOP_B);

    idb.namespaces = [userA, `${userA}:${SHOP_A}`];
    await wipeAccountNamespace(userA);

    expect(localStorage.getItem(keyA!)).toBeNull();
    expect(localStorage.getItem(keyB!)).toBe(SHOP_B);
  });

  it("T6 — theme, language, and device identity are preserved", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    localStorage.setItem("waka-app-theme", "dark");
    localStorage.setItem("waka.ui.language", "lg");
    localStorage.setItem("waka-pos-device-id", "device-stable-id");
    idb.namespaces = [userA, `${userA}:${SHOP_A}`];

    await wipeAccountNamespace(userA);

    expect(localStorage.getItem("waka-app-theme")).toBe("dark");
    expect(localStorage.getItem("waka.ui.language")).toBe("lg");
    expect(localStorage.getItem("waka-pos-device-id")).toBe("device-stable-id");
  });

  it("T7 — local wipe partial failure does not claim complete and does not block cloud deletion", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    const { reportAuthIssue } = await import("./monitoring");
    const nsA = `${userA}:${SHOP_A}`;
    const nsB = `${userA}:${SHOP_B}`;
    idb.namespaces = [userA, nsA, nsB];
    idb.failFor.add(nsA);

    const summary = await wipeAccountNamespace(userA);
    expect(idb.wiped).toEqual(expect.arrayContaining([userA, nsA, nsB]));
    expect(summary.namespacesWiped).toEqual(expect.arrayContaining([userA, nsB]));
    expect(summary.namespacesWiped).not.toContain(nsA);
    expect(summary.failedNamespaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ namespace: nsA })]),
    );
    expect(summary.complete).toBe(false);
    expect(summary.wipeMarkerWritten).toBe(true);
    expect(reportAuthIssue).toHaveBeenCalledWith(
      "account_namespace_wipe_incomplete",
      expect.objectContaining({ failedCount: 1 }),
    );

    setActiveAccountKey(userA);
    idb.throwFor.add(userA);
    const { finalizeOwnerAccountDeletionLocally } = await import("./ownerAccountDeletion");
    await finalizeOwnerAccountDeletionLocally("userA");
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("T8 — existing logout path does not wipe account namespaces", async () => {
    const logoutSrc = readFileSync(resolve(process.cwd(), "src/lib/auth/enterpriseLogout.ts"), "utf8");
    expect(logoutSrc).not.toContain("wipeAccountNamespace");
    expect(logoutSrc).not.toContain("wipeIndexedDbNamespace");
    expect(logoutSrc).toContain("performEnterpriseLogout");
    expect(logoutSrc).toContain('signOut({ scope: "local" })');
  });
});
