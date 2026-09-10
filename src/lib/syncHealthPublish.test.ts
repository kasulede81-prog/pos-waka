import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildShopSyncHealthUpsertRow,
  countPendingOutboundFromKnown,
  formatCloudSyncLastError,
  publishShopSyncHealth,
  publishShopSyncHealthAfterPushCycle,
  recordBackgroundSyncFailure,
  resolveShopSyncHealthShopId,
  shouldAdvanceLastPushOkAt,
} from "./syncMeta";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";

const upsert = vi.fn(
  async (_row: Record<string, unknown>, _opts?: { onConflict: string }) => ({ data: null, error: null }),
);

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    from: (table: string) => {
      if (table !== "sync_health") throw new Error(`unexpected table ${table}`);
      return { upsert };
    },
  },
}));

const shopState = vi.hoisted(() => ({ active: null as string | null }));

vi.mock("../offline/shopScope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../offline/shopScope")>();
  return {
    ...actual,
    getActiveShopId: () => shopState.active,
  };
});

vi.mock("../offline/localDb", () => ({
  readSyncQueue: async () => [],
}));

vi.mock("../offline/cloudSync", () => ({
  countUnsyncedSales: () => 0,
}));

function firstUpsertRow(): Record<string, unknown> {
  const call = upsert.mock.calls[0];
  if (!call) throw new Error("expected upsert to be called");
  return call[0];
}

describe("countPendingOutboundFromKnown", () => {
  it("reports non-zero durable queue length", () => {
    expect(countPendingOutboundFromKnown(3, 0)).toBe(3);
  });

  it("does not report pendingSync work as zero when the queue is empty", () => {
    expect(countPendingOutboundFromKnown(0, 2)).toBe(2);
  });

  it("does not double-count normal checkout present in both representations", () => {
    expect(countPendingOutboundFromKnown(1, 1)).toBe(1);
  });

  it("reports zero when both outbound sources are empty", () => {
    expect(countPendingOutboundFromKnown(0, 0)).toBe(0);
  });
});

describe("shouldAdvanceLastPushOkAt", () => {
  it("advances after a real successful push with outbound work", () => {
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, pushOk: 1 })).toBe(true);
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, hadOutboundWork: true })).toBe(true);
  });

  it("does not advance a genuine no-op with fail===0 and queueFailed===0", () => {
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0 })).toBe(false);
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, pushOk: 0, hadOutboundWork: false })).toBe(false);
  });

  it("does not advance on skip / no_pending", () => {
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, skipped: true, pushOk: 1 })).toBe(false);
  });

  it("does not advance on failed push", () => {
    expect(shouldAdvanceLastPushOkAt({ pushFail: 1, queueFailed: 0, pushOk: 1 })).toBe(false);
  });

  it("does not advance on partial queue failure", () => {
    expect(shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 2, hadOutboundWork: true })).toBe(false);
  });

  it("does not advance when remaining work is quarantined or blocked", () => {
    expect(
      shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, pushOk: 1, queueHealth: "quarantined" }),
    ).toBe(false);
    expect(
      shouldAdvanceLastPushOkAt({ pushFail: 0, queueFailed: 0, hadOutboundWork: true, queueHealth: "blocked" }),
    ).toBe(false);
  });
});

describe("formatCloudSyncLastError", () => {
  it("clears last_error only on verified recovery (none)", () => {
    expect(formatCloudSyncLastError({ lastIssueCode: "none", entityPullErrors: {} })).toBeNull();
  });

  it("publishes partial according to existing issue semantics", () => {
    expect(formatCloudSyncLastError({ lastIssueCode: "partial", entityPullErrors: {} })).toBe("partial");
  });

  it("preserves existing entity pull error keys", () => {
    expect(
      formatCloudSyncLastError({
        lastIssueCode: "partial",
        entityPullErrors: { sales: "sales_pull_denied" },
      }),
    ).toBe("partial:sales=sales_pull_denied");
  });

  it("publishes error for background/flush failure codes", () => {
    expect(formatCloudSyncLastError({ lastIssueCode: "error", entityPullErrors: {} })).toBe("error");
  });
});

describe("buildShopSyncHealthUpsertRow", () => {
  const updatedAt = "2026-09-10T10:00:00.000Z";

  it("pull-only rows omit pending_outbound, last_push_ok_at, and last_error", () => {
    const row = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      lastPullAt: updatedAt,
      includePendingOutbound: false,
      updatedAt,
    });
    expect(row).toEqual({
      shop_id: SHOP_A,
      updated_at: updatedAt,
      last_pull_at: updatedAt,
    });
    expect(row).not.toHaveProperty("pending_outbound");
    expect(row).not.toHaveProperty("last_push_ok_at");
    expect(row).not.toHaveProperty("last_error");
  });

  it("push/flush rows still publish pending_outbound", () => {
    const row = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: countPendingOutboundFromKnown(5, 0),
      includeLastError: true,
      lastError: null,
      updatedAt,
    });
    expect(row.pending_outbound).toBe(5);
  });

  it("a late pull upsert cannot overwrite push pending state because pull omits the field", () => {
    const pushRow = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: 0,
      includeLastPushOkAt: true,
      lastPushOkAt: updatedAt,
      includeLastError: true,
      lastError: null,
      updatedAt,
    });
    const latePull = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      lastPullAt: "2026-09-10T10:00:01.000Z",
      includePendingOutbound: false,
      updatedAt: "2026-09-10T10:00:01.000Z",
    });
    expect(pushRow.pending_outbound).toBe(0);
    expect(latePull).not.toHaveProperty("pending_outbound");
    expect(latePull).not.toHaveProperty("last_push_ok_at");
    expect(latePull).not.toHaveProperty("last_error");
  });

  it("includes last_push_ok_at only when explicitly requested", () => {
    const without = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: 0,
      lastPushOkAt: updatedAt,
      updatedAt,
    });
    expect(without).not.toHaveProperty("last_push_ok_at");
    const withOk = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: 0,
      lastPushOkAt: updatedAt,
      includeLastPushOkAt: true,
      updatedAt,
    });
    expect(withOk.last_push_ok_at).toBe(updatedAt);
  });

  it("pull-only cannot erase last_error", () => {
    const row = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: 0,
      lastPullAt: updatedAt,
      lastError: null,
      updatedAt,
    });
    expect(row).not.toHaveProperty("last_error");
  });

  it("recovery sends last_error null only when includeLastError is set", () => {
    const row = buildShopSyncHealthUpsertRow({
      shopId: SHOP_A,
      pendingOutbound: 0,
      lastError: null,
      includeLastError: true,
      lastPushOkAt: updatedAt,
      includeLastPushOkAt: true,
      updatedAt,
    });
    expect(row.last_error).toBeNull();
    expect(row.last_push_ok_at).toBe(updatedAt);
  });
});

describe("shop identity", () => {
  beforeEach(() => {
    shopState.active = SHOP_A;
  });

  it("uses the explicit active shop_id", () => {
    expect(resolveShopSyncHealthShopId(SHOP_A)).toBe(SHOP_A);
  });

  it("rejects a non-uuid so a cross-shop id cannot enter the payload", () => {
    expect(resolveShopSyncHealthShopId("not-a-shop")).toBeNull();
    expect(resolveShopSyncHealthShopId(SHOP_B)).toBe(SHOP_B);
  });

  it("does not substitute another shop when the explicit id is invalid", () => {
    shopState.active = SHOP_A;
    expect(resolveShopSyncHealthShopId("nope")).toBeNull();
  });
});

describe("publishShopSyncHealth", () => {
  beforeEach(() => {
    upsert.mockClear();
    shopState.active = SHOP_A;
  });

  afterEach(() => {
    shopState.active = null;
  });

  it("pull upsert omits pending_outbound so it cannot overwrite push pending", async () => {
    publishShopSyncHealth({
      shopId: SHOP_A,
      lastPullAt: "2026-09-10T10:00:00.000Z",
      includePendingOutbound: false,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow()).not.toHaveProperty("pending_outbound");
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
    expect(firstUpsertRow()).not.toHaveProperty("last_error");
    expect(firstUpsertRow().last_pull_at).toBe("2026-09-10T10:00:00.000Z");
  });

  it("upserts one cycle-bounded row for the active shop", async () => {
    publishShopSyncHealth({
      shopId: SHOP_A,
      pendingOutbound: 2,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      includeLastPushOkAt: true,
      lastError: null,
      includeLastError: true,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const row = firstUpsertRow();
    expect(upsert.mock.calls[0]?.[1]).toEqual({ onConflict: "shop_id" });
    expect(row.shop_id).toBe(SHOP_A);
    expect(row.pending_outbound).toBe(2);
    expect(row.last_push_ok_at).toBe("2026-09-10T10:00:00.000Z");
    expect(row.last_error).toBeNull();
  });

  it("swallows publisher failures so they cannot fail a sale/sync path", () => {
    upsert.mockRejectedValueOnce(new Error("network"));
    expect(() =>
      publishShopSyncHealth({
        shopId: SHOP_A,
        pendingOutbound: 1,
        lastError: "error",
        includeLastError: true,
      }),
    ).not.toThrow();
  });

  it("does not upsert when shop identity is missing", async () => {
    shopState.active = null;
    publishShopSyncHealth({ pendingOutbound: 1, lastError: "error", includeLastError: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("publishShopSyncHealthAfterPushCycle", () => {
  beforeEach(() => {
    upsert.mockClear();
    shopState.active = SHOP_A;
  });

  it("does not publish on skip / no_pending", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 0,
      pushFail: 0,
      queueFailed: 0,
      skipped: true,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: null,
      pushOk: 1,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(upsert).not.toHaveBeenCalled();
  });

  it("publishes pending_outbound and last_push_ok_at after a real successful push", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 0,
      pushFail: 0,
      queueFailed: 0,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: null,
      pushOk: 2,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow().pending_outbound).toBe(0);
    expect(firstUpsertRow().last_push_ok_at).toBe("2026-09-10T10:00:00.000Z");
    expect(firstUpsertRow().last_error).toBeNull();
  });

  it("does not advance last_push_ok_at on a genuine no-op", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 0,
      pushFail: 0,
      queueFailed: 0,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: null,
      pushOk: 0,
      hadOutboundWork: false,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow()).toHaveProperty("pending_outbound");
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
  });

  it("does not advance last_push_ok_at on failed push", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 1,
      pushFail: 1,
      queueFailed: 0,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: "partial",
      pushOk: 1,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
    expect(firstUpsertRow().last_error).toBe("partial");
  });

  it("does not advance last_push_ok_at when queueFailed > 0", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 1,
      pushFail: 0,
      queueFailed: 2,
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: "partial",
      hadOutboundWork: true,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
  });

  it("does not advance last_push_ok_at when remaining work is quarantined", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 1,
      pushFail: 0,
      queueFailed: 0,
      queueHealth: "quarantined",
      lastPushOkAt: "2026-09-10T10:00:00.000Z",
      lastError: null,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
    expect(firstUpsertRow().last_error).toBe("partial");
  });

  it("publishes last_error=error for background failure without last_push_ok_at", async () => {
    publishShopSyncHealthAfterPushCycle({
      shopId: SHOP_A,
      pendingOutbound: 3,
      pushFail: 0,
      queueFailed: 0,
      backgroundError: true,
    });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow().last_error).toBe("error");
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
  });
});

describe("recordBackgroundSyncFailure cloud publish", () => {
  beforeEach(() => {
    upsert.mockClear();
    shopState.active = SHOP_A;
  });

  it("publishes error without advancing last_push_ok_at", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    recordBackgroundSyncFailure("background_sync_failed", new Error("mutex"));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(firstUpsertRow().last_error).toBe("error");
    expect(firstUpsertRow()).not.toHaveProperty("last_push_ok_at");
    warn.mockRestore();
  });
});

describe("write-frequency source guards", () => {
  const root = dirname(fileURLToPath(import.meta.url));

  it("queue polling does not publish sync_health", () => {
    const src = readFileSync(join(root, "../hooks/useSyncStatus.tsx"), "utf8");
    const start = src.indexOf("const refreshQueue = useCallback");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("}, []);", start);
    const body = src.slice(start, end);
    expect(body).not.toContain("publishShopSyncHealth");
  });

  it("push-start metadata does not publish sync_health", () => {
    const src = readFileSync(join(root, "posPushScheduler.ts"), "utf8");
    const start = src.indexOf("function recordPosPushAttempt");
    const end = src.indexOf("function recordPosPushSuccess", start);
    const body = src.slice(start, end);
    expect(body).not.toContain("publishShopSyncHealth");
  });

  it("pull path omits pending_outbound, last_push_ok_at, and last_error", () => {
    const src = readFileSync(join(root, "../offline/cloudSync.ts"), "utf8");
    const start = src.indexOf("publishShopSyncHealth({");
    expect(start).toBeGreaterThanOrEqual(0);
    const snippet = src.slice(start, start + 280);
    expect(snippet).toContain("lastPullAt");
    expect(snippet).toContain("includePendingOutbound: false");
    expect(snippet).not.toContain("pendingOutbound:");
    expect(snippet).not.toContain("last_push_ok_at");
    expect(snippet).not.toContain("includeLastError");
    expect(snippet).not.toContain("includeLastPushOkAt");
  });
});
