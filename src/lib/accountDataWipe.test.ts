import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";

const wipeSummary = {
  kvKeysRemoved: 2,
  recordsRemoved: 1,
  syncQueueRemoved: 1,
  backupsRemoved: 1,
};

vi.mock("../offline/localDb", () => ({
  wipeIndexedDbNamespace: vi.fn(async () => ({ ...wipeSummary })),
  listAccountKeysInIndexedDb: vi.fn(async () => []),
  countBackupsForAccount: vi.fn(async () => 0),
}));

function mockBrowserStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
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
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(`s:${k}`) ?? null,
    setItem: (k: string, v: string) => {
      store.set(`s:${k}`, v);
    },
    removeItem: (k: string) => {
      store.delete(`s:${k}`);
    },
    clear: () => {
      for (const key of [...store.keys()]) {
        if (key.startsWith("s:")) store.delete(key);
      }
    },
  });
}

describe("accountDataWipe", () => {
  const accountKey = "sb:test-user";

  beforeEach(() => {
    mockBrowserStorage();
    localStorage.clear();
    sessionStorage.clear();
    setActiveAccountKey(null);
    localStorage.setItem(`waka.sync.checkpoints.v1::${accountKey}`, "{}");
    vi.clearAllMocks();
  });

  it("wipes namespace fully and is idempotent", async () => {
    const { wipeAccountNamespace } = await import("./accountDataWipe");
    const { wipeIndexedDbNamespace } = await import("../offline/localDb");

    const first = await wipeAccountNamespace(accountKey);
    expect(wipeIndexedDbNamespace).toHaveBeenCalledWith(accountKey);
    expect(first.kvKeysRemoved).toBe(2);
    expect(first.recordsRemoved).toBe(1);
    expect(first.syncQueueRemoved).toBe(1);
    expect(first.backupsRemoved).toBe(1);
    expect(first.localStorageKeysRemoved).toBeGreaterThan(0);
    expect(first.wipeMarkerWritten).toBe(true);

    const second = await wipeAccountNamespace(accountKey);
    expect(second.kvKeysRemoved).toBe(2);
  });
});
