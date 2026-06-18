import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSyncQueueForRestore, getLastRestoreQueueSafety } from "./restoreSyncSafety";

vi.mock("../offline/localDb", () => ({
  archiveAndClearSyncQueue: vi.fn(),
  countArchivedRestoreQueueOps: vi.fn(),
}));

import { archiveAndClearSyncQueue, countArchivedRestoreQueueOps } from "../offline/localDb";

describe("restoreQueueSafety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records cleared and archived counts after restore", async () => {
    vi.mocked(archiveAndClearSyncQueue).mockResolvedValue({ clearedCount: 4, archivedCount: 4 });
    vi.mocked(countArchivedRestoreQueueOps).mockResolvedValue(12);

    const result = await clearSyncQueueForRestore();
    expect(result.clearedCount).toBe(4);
    expect(result.archivedCount).toBe(4);
    expect(result.totalArchivedOps).toBe(12);
    expect(getLastRestoreQueueSafety()?.clearedCount).toBe(4);
  });

  it("handles empty queue on restore", async () => {
    vi.mocked(archiveAndClearSyncQueue).mockResolvedValue({ clearedCount: 0, archivedCount: 0 });
    vi.mocked(countArchivedRestoreQueueOps).mockResolvedValue(0);

    const result = await clearSyncQueueForRestore();
    expect(result.clearedCount).toBe(0);
    expect(getLastRestoreQueueSafety()?.archivedCount).toBe(0);
  });
});
