/**
 * R6 — swallowed sync/data failures must still hit monitoring, without becoming
 * extra user-facing toasts (WAKA-12 keeps the existing four USER_FACING codes).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ignoreReportedSyncFailure, reportSwallowedSyncFailure, reportSyncIssue } from "./monitoring";
import { applySyncHealthAfterCycle, recordBackgroundSyncFailure } from "./syncMeta";

describe("R6 — swallowed failures are observable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("1 — a swallowed sync failure is reported with the error message", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    reportSwallowedSyncFailure("background_sync_failed", new Error("pull exploded"));
    expect(warn).toHaveBeenCalled();
    const args = warn.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    expect(args).toContain("background_sync_failed");
    expect(args).toContain("pull exploded");
  });

  it("2 — expected user-facing codes still dispatch; swallowed codes do not", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    reportSwallowedSyncFailure("idb_snapshot_read_failed", new Error("idb closed"));
    expect(dispatch).not.toHaveBeenCalled();
    reportSyncIssue("sync_flush_error");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: "waka:sync-issue", detail: { code: "sync_flush_error" } });
  });

  it("3 — ignoreReportedSyncFailure reports then returns undefined (control flow unchanged)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = ignoreReportedSyncFailure("shop_recovery_schedule_failed")(new Error("timeout"));
    expect(result).toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).toContain("shop_recovery_schedule_failed");
  });

  it("4 — background sync failure records lastIssueCode error without claiming success", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const meta = recordBackgroundSyncFailure("background_sync_failed", new Error("mutex"));
    expect(meta.lastIssueCode).toBe("error");
    expect(meta.lastIssueAt).toBeTruthy();
    expect(meta.lastSuccessAt).not.toBe(meta.lastIssueAt);
    expect(JSON.stringify(warn.mock.calls)).toContain("background_sync_failed");
  });

  it("5 — WAKA-12 healthy cycle semantics are unchanged", () => {
    const attemptAt = "2026-09-08T12:00:00.000Z";
    const meta = applySyncHealthAfterCycle({
      attemptAt,
      pullPartial: false,
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 0,
      queueHealth: "healthy",
    });
    expect(meta.lastIssueCode).toBe("none");
    expect(meta.lastSuccessAt).toBe(attemptAt);
  });

  it("6 — WAKA-12 pull entity errors remain partial, not a new toast code", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    const meta = applySyncHealthAfterCycle({
      attemptAt: "2026-09-08T12:00:00.000Z",
      pullPartial: false,
      entityPullErrors: { sales: "sales_pull_denied" },
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 0,
      queueHealth: "healthy",
    });
    expect(meta.lastIssueCode).toBe("partial");
    expect(meta.entityPullErrors).toEqual({ sales: "sales_pull_denied" });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
