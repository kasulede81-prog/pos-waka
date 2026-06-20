import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import { mergeAuditLogsFromCloudPull } from "./auditCloudSync";

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
    const local = [entry("aaa", "2026-06-01T10:00:00.000Z")];
    const cloud = [entry("aaa", "2026-06-01T10:00:00.000Z"), entry("bbb", "2026-06-01T11:00:00.000Z")];
    const merged = mergeAuditLogsFromCloudPull(local, [], cloud);
    expect(merged.added).toBe(1);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual(["bbb"]);
  });

  it("appends new cloud rows to archived bucket", () => {
    const archived = [entry("old", "2026-05-01T00:00:00.000Z")];
    const cloud = [entry("new", "2026-06-01T00:00:00.000Z")];
    const merged = mergeAuditLogsFromCloudPull([], archived, cloud);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual(["old", "new"]);
  });
});
