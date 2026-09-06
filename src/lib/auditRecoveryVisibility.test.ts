/**
 * IC-P2-05 — recovered cloud audit events classified into active vs archived.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import {
  applyNormalSyncAuditPull,
  mergeAuditLogsFromCloudPull,
  parseAuditLogCloudRow,
  pullAuditLogsFromCloud,
} from "./auditCloudSync";
import { auditLogsForReporting } from "./recordArchive";
import { CLIENT_ACTOR_NAME_KEY, CLIENT_ACTOR_USER_ID_KEY } from "./investigationActorAttribution";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";
import { archiveCutoffIso } from "./dataRetention";

const NOW_MS = Date.parse("2026-09-06T12:00:00.000Z");
const SHOP_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function entry(id: string, at: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    at,
    actorUserId: extra.actorUserId ?? "staff:device-b",
    actorName: extra.actorName ?? "Device B cashier",
    role: extra.role ?? "cashier",
    action: extra.action ?? "sale_completed",
    payloadSummary: extra.payloadSummary ?? "Sale UGX 5,000",
    payload: extra.payload ?? {},
    deviceId: extra.deviceId ?? "device-b",
  };
}

function recover(localActive: AuditLogEntry[], localArchived: AuditLogEntry[], cloud: AuditLogEntry[]) {
  return mergeAuditLogsFromCloudPull(localActive, localArchived, cloud, { policy: "3m", nowMs: NOW_MS });
}

function cloudRow(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    shop_id: SHOP_A,
    actor_user_id: "11111111-2222-4333-8444-555555555555",
    role: "cashier",
    action: "sale_completed",
    payload_summary: "Sale UGX 5,000",
    payload: {
      [CLIENT_ACTOR_USER_ID_KEY]: "staff:device-b",
      [CLIENT_ACTOR_NAME_KEY]: "Device B cashier",
    },
    device_id: "device-b",
    client_entry_id: "cccccccc-3333-4333-8333-cccccccccccc",
    created_at: "2026-09-01T10:00:00.000Z",
    ...partial,
  };
}

describe("IC-P2-05 recovered audit visibility", () => {
  it("TEST 1 — recent recovered event becomes active and default Investigation sees it", () => {
    const recent = entry("recent-1", "2026-09-01T10:00:00.000Z");
    const merged = recover([], [], [recent]);
    expect(merged.auditLogs.map((e) => e.id)).toEqual(["recent-1"]);
    expect(merged.archivedAuditLogs).toEqual([]);
    const defaultView = auditLogsForReporting(merged, false);
    expect(defaultView.map((e) => e.id)).toEqual(["recent-1"]);
  });

  it("TEST 2 — old recovered event remains archived and does not unbounded-grow active", () => {
    const cutoff = archiveCutoffIso("3m", NOW_MS);
    expect(cutoff).toBeTruthy();
    const old = entry("old-1", "2026-01-01T00:00:00.000Z");
    const merged = recover([], [], [old]);
    expect(merged.auditLogs).toEqual([]);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual(["old-1"]);
    expect(auditLogsForReporting(merged, false)).toEqual([]);
    expect(auditLogsForReporting(merged, true).map((e) => e.id)).toEqual(["old-1"]);
  });

  it("TEST 3 — recovery is idempotent", () => {
    const recent = entry("recent-1", "2026-09-01T10:00:00.000Z");
    const first = recover([], [], [recent]);
    const second = recover(first.auditLogs, first.archivedAuditLogs, [recent]);
    expect(second.added).toBe(0);
    expect(second.auditLogs.filter((e) => e.id === "recent-1")).toHaveLength(1);
    expect(second.archivedAuditLogs.filter((e) => e.id === "recent-1")).toHaveLength(0);
  });

  it("TEST 4 — normal sync then recovery keeps one active event", () => {
    const recent = entry("recent-1", "2026-09-01T10:00:00.000Z");
    const synced = applyNormalSyncAuditPull([], [], [recent]);
    const afterRecovery = recover(synced.auditLogs, synced.archivedAuditLogs, [recent]);
    expect(afterRecovery.added).toBe(0);
    expect(afterRecovery.auditLogs.filter((e) => e.id === "recent-1")).toHaveLength(1);
    expect(afterRecovery.archivedAuditLogs.filter((e) => e.id === "recent-1")).toHaveLength(0);
  });

  it("TEST 5 — recovery then normal sync keeps one active event", () => {
    const recent = entry("recent-1", "2026-09-01T10:00:00.000Z");
    const recovered = recover([], [], [recent]);
    const afterSync = applyNormalSyncAuditPull(recovered.auditLogs, recovered.archivedAuditLogs, [recent]);
    expect(afterSync.added).toBe(0);
    expect(afterSync.auditLogs.filter((e) => e.id === "recent-1")).toHaveLength(1);
    expect(afterSync.archivedAuditLogs.filter((e) => e.id === "recent-1")).toHaveLength(0);
  });

  it("TEST 6 — already-archived event is not promoted or duplicated", () => {
    const archived = entry("old-1", "2026-01-01T00:00:00.000Z");
    const merged = recover([], [archived], [archived]);
    expect(merged.added).toBe(0);
    expect(merged.auditLogs.filter((e) => e.id === "old-1")).toHaveLength(0);
    expect(merged.archivedAuditLogs.filter((e) => e.id === "old-1")).toHaveLength(1);
    expect(merged.archivedAuditLogs[0]).toBe(archived);
  });

  it("TEST 7 — recovered event retains original actor", () => {
    const pulled = parseAuditLogCloudRow(cloudRow({}), SHOP_A);
    expect(pulled?.actorUserId).toBe("staff:device-b");
    expect(pulled?.actorName).toBe("Device B cashier");
    const merged = recover([], [], [pulled!]);
    expect(merged.auditLogs[0]?.actorUserId).toBe("staff:device-b");
    expect(merged.auditLogs[0]?.actorName).toBe("Device B cashier");
    expect(merged.auditLogs[0]?.actorUserId).not.toBe("11111111-2222-4333-8444-555555555555");
  });

  it("TEST 8 — recovered event retains original action timestamp", () => {
    const actionAt = "2026-09-01T10:00:00.000Z";
    const pulled = parseAuditLogCloudRow(cloudRow({ created_at: actionAt }), SHOP_A);
    expect(pulled?.at).toBe(actionAt);
    const merged = recover([], [], [pulled!]);
    expect(merged.auditLogs[0]?.at).toBe(actionAt);
  });

  it("TEST 9 — another shop's event does not enter local history", async () => {
    const foreign = parseAuditLogCloudRow(cloudRow({ shop_id: SHOP_B }), SHOP_A);
    expect(foreign).toBeNull();
    const merged = recover([], [], foreign ? [foreign] : []);
    expect(merged.auditLogs).toEqual([]);
    expect(merged.archivedAuditLogs).toEqual([]);
    const emptyShop = await pullAuditLogsFromCloud("");
    expect(emptyShop).toEqual([]);
  });

  it("TEST 10 — recovered active event survives persist/reload snapshot fields", () => {
    const recent = entry("recent-1", "2026-09-01T10:00:00.000Z");
    const merged = recover([], [], [recent]);
    const snapshot = {
      auditLogs: merged.auditLogs.map((e) => ({ ...e })),
      archivedAuditLogs: merged.archivedAuditLogs.map((e) => ({ ...e })),
    };
    const reloaded = auditLogsForReporting(snapshot, false);
    expect(reloaded.map((e) => e.id)).toEqual(["recent-1"]);
    expect(snapshot.archivedAuditLogs).toEqual([]);
  });

  it("TEST 11 — recovered event is not a new local mutation (same id, no remint)", () => {
    const remote = parseAuditLogCloudRow(cloudRow({}), SHOP_A)!;
    const merged = recover([], [], [remote]);
    expect(merged.auditLogs).toHaveLength(1);
    expect(merged.auditLogs[0]?.id).toBe(remote.id);
    expect(merged.auditLogs[0]?.id).toBe("cccccccc-3333-4333-8333-cccccccccccc");
  });

  it("TEST 12 — recovery preserves the 5000-event active cap", () => {
    const local = Array.from({ length: AUDIT_RETENTION_MAX_COUNT }, (_, i) =>
      entry(`local-${i}`, `2026-09-05T12:${String(i % 60).padStart(2, "0")}:00.000Z`),
    );
    const extra = entry("recovered-newest", "2026-09-06T11:00:00.000Z");
    const merged = recover(local, [], [extra]);
    expect(merged.auditLogs.length).toBe(AUDIT_RETENTION_MAX_COUNT);
    expect(merged.auditLogs.some((e) => e.id === "recovered-newest")).toBe(true);
    expect(merged.archivedAuditLogs.length).toBeGreaterThan(0);
    expect(merged.archivedAuditLogs.some((e) => e.id === "recovered-newest")).toBe(false);
  });
});
