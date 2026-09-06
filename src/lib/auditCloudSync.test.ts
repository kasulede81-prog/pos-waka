import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import { mergeAuditLogsFromCloudPull } from "./auditCloudSync";

const NOW_MS = Date.parse("2026-09-06T12:00:00.000Z");

const entry = (id: string, at: string): AuditLogEntry => ({
  id,
  at,
  actorUserId: "user-1",
  role: "owner",
  action: "sale_completed",
  payloadSummary: "test",
  payload: {},
});

describe("auditCloudSync merge", () => {
  it("deduplicates by client entry id", () => {
    const local = [entry("aaa", "2026-09-01T10:00:00.000Z")];
    const cloud = [entry("aaa", "2026-09-01T10:00:00.000Z"), entry("bbb", "2026-09-01T11:00:00.000Z")];
    const merged = mergeAuditLogsFromCloudPull(local, [], cloud, { policy: "3m", nowMs: NOW_MS });
    expect(merged.added).toBe(1);
    expect(merged.auditLogs.map((e) => e.id).sort()).toEqual(["aaa", "bbb"]);
    expect(merged.archivedAuditLogs).toEqual([]);
  });

  it("places old recovered rows in the archived bucket", () => {
    const archived = [entry("old", "2026-01-01T00:00:00.000Z")];
    const cloud = [entry("older", "2026-02-01T00:00:00.000Z")];
    const merged = mergeAuditLogsFromCloudPull([], archived, cloud, { policy: "3m", nowMs: NOW_MS });
    expect(merged.auditLogs).toEqual([]);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual(["old", "older"]);
  });
});
