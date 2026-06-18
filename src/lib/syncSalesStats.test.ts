import { describe, expect, it } from "vitest";
import { computeSyncSalesStats } from "../offline/cloudSync";
import type { Sale } from "../types";

function sale(id: string, pendingSync: boolean, lastSyncError?: string): Sale {
  return { id, pendingSync, lastSyncError, createdAt: "2026-01-01T00:00:00.000Z" } as Sale;
}

describe("computeSyncSalesStats", () => {
  it("counts unsynced and errors in one pass", () => {
    const stats = computeSyncSalesStats([
      sale("a", true),
      sale("b", true, "network"),
      sale("c", false),
      sale("d", false, "conflict"),
    ]);
    expect(stats.unsyncedCount).toBe(2);
    expect(stats.errorCount).toBe(2);
    expect(stats.errors).toHaveLength(2);
  });

  it("returns zeros for empty sales", () => {
    const stats = computeSyncSalesStats([]);
    expect(stats.unsyncedCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });
});
