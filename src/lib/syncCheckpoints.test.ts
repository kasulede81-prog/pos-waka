import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBootstrapSyncComplete,
  markBootstrapSyncComplete,
  readSyncCheckpoints,
  writeSyncCheckpoints,
} from "./syncCheckpoints";

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:test-user",
}));

describe("syncCheckpoints bootstrap rollback", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem(key: string) {
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        store[key] = value;
      },
      removeItem(key: string) {
        delete store[key];
      },
      clear() {
        for (const key of Object.keys(store)) delete store[key];
      },
    });
    localStorage.clear();
  });

  it("clearBootstrapSyncComplete rolls back bootstrap flag", () => {
    markBootstrapSyncComplete("2026-06-01T00:00:00.000Z");
    expect(readSyncCheckpoints().bootstrapComplete).toBe(true);

    clearBootstrapSyncComplete();
    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(false);
    expect(cp.lastSalesSyncAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("writeSyncCheckpoints preserves other cursors when clearing bootstrap", () => {
    writeSyncCheckpoints({ lastProductsSyncAt: "2026-05-01T00:00:00.000Z", bootstrapComplete: true });
    clearBootstrapSyncComplete();
    expect(readSyncCheckpoints().lastProductsSyncAt).toBe("2026-05-01T00:00:00.000Z");
  });
});
