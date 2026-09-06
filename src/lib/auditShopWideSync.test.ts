/**
 * IC-P1-01 — shop-wide audit log sync into ACTIVE investigation history.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import {
  applyNormalSyncAuditPull,
  auditIncrementalSince,
  mergeAuditLogsFromCloudPull,
  parseAuditLogCloudRow,
  pullAuditLogsFromCloudIncremental,
} from "./auditCloudSync";
import { CLIENT_ACTOR_NAME_KEY, CLIENT_ACTOR_USER_ID_KEY } from "./investigationActorAttribution";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";

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
      totalUgx: 5000,
    },
    device_id: "device-b",
    client_entry_id: "cccccccc-3333-4333-8333-cccccccccccc",
    created_at: "2026-09-06T10:00:00.000Z",
    ...partial,
  };
}

describe("IC-P1-01 shop-wide audit sync", () => {
  it("TEST 1 — remote event becomes active, not archived-only", () => {
    const remote = entry("event-x", "2026-09-06T10:00:00.000Z");
    const merged = applyNormalSyncAuditPull([], [], [remote]);
    expect(merged.added).toBe(1);
    expect(merged.auditLogs.map((e) => e.id)).toEqual(["event-x"]);
    expect(merged.archivedAuditLogs).toEqual([]);
  });

  it("TEST 2 — repeated pull is idempotent", () => {
    const remote = entry("event-x", "2026-09-06T10:00:00.000Z");
    const first = applyNormalSyncAuditPull([], [], [remote]);
    const second = applyNormalSyncAuditPull(first.auditLogs, first.archivedAuditLogs, [remote]);
    expect(second.added).toBe(0);
    expect(second.auditLogs.filter((e) => e.id === "event-x")).toHaveLength(1);
    const third = applyNormalSyncAuditPull(second.auditLogs, second.archivedAuditLogs, [remote, remote]);
    expect(third.auditLogs.filter((e) => e.id === "event-x")).toHaveLength(1);
  });

  it("TEST 3 — Device B event is visible on Device A after normal sync merge", () => {
    const deviceALocal = entry("device-a-sale", "2026-09-06T09:00:00.000Z", {
      actorUserId: "staff:device-a",
      actorName: "Device A cashier",
      deviceId: "device-a",
    });
    const deviceBCloud = parseAuditLogCloudRow(cloudRow({}), SHOP_A);
    expect(deviceBCloud).not.toBeNull();
    const deviceAAfterSync = applyNormalSyncAuditPull([deviceALocal], [], [deviceBCloud!]);
    expect(deviceAAfterSync.auditLogs.map((e) => e.id).sort()).toEqual(
      ["cccccccc-3333-4333-8333-cccccccccccc", "device-a-sale"].sort(),
    );
    expect(deviceAAfterSync.archivedAuditLogs).toHaveLength(0);
  });

  it("TEST 4 — original actor is preserved (not the pulling device user)", () => {
    const pulled = parseAuditLogCloudRow(cloudRow({}), SHOP_A);
    expect(pulled?.actorUserId).toBe("staff:device-b");
    expect(pulled?.actorName).toBe("Device B cashier");
    expect(pulled?.actorUserId).not.toBe("11111111-2222-4333-8444-555555555555");
    const merged = applyNormalSyncAuditPull([], [], [pulled!]);
    expect(merged.auditLogs[0]?.actorUserId).toBe("staff:device-b");
    expect(merged.auditLogs[0]?.actorName).toBe("Device B cashier");
  });

  it("TEST 5 — action timestamp is created_at from the cloud row, not sync time", () => {
    const actionAt = "2026-09-06T10:00:00.000Z";
    const pulled = parseAuditLogCloudRow(cloudRow({ created_at: actionAt }), SHOP_A);
    expect(pulled?.at).toBe(actionAt);
    expect(pulled?.at).not.toBe("2026-09-06T18:00:00.000Z");
    expect(parseAuditLogCloudRow(cloudRow({ created_at: "" }), SHOP_A)).toBeNull();
  });

  it("TEST 6 — locally created event remains in active history without a cloud pull", () => {
    const local = entry("local-offline", "2026-09-06T11:00:00.000Z", {
      actorUserId: "staff:device-a",
      actorName: "Device A cashier",
      deviceId: "device-a",
    });
    const merged = applyNormalSyncAuditPull([local], [], []);
    expect(merged.auditLogs).toEqual([local]);
    expect(merged.added).toBe(0);
  });

  it("TEST 7 — pulled event keeps its client_entry_id and is not minted as a new local event", () => {
    const remote = parseAuditLogCloudRow(cloudRow({}), SHOP_A)!;
    const merged = applyNormalSyncAuditPull([], [], [remote]);
    expect(merged.auditLogs).toHaveLength(1);
    expect(merged.auditLogs[0]?.id).toBe("cccccccc-3333-4333-8333-cccccccccccc");
    expect(merged.auditLogs[0]?.id).toBe(remote.id);
  });

  it("TEST 8 — another shop's row never enters local auditLogs", async () => {
    const foreign = parseAuditLogCloudRow(cloudRow({ shop_id: SHOP_B }), SHOP_A);
    expect(foreign).toBeNull();
    const merged = applyNormalSyncAuditPull([], [], foreign ? [foreign] : []);
    expect(merged.auditLogs).toEqual([]);
    const emptyShop = await pullAuditLogsFromCloudIncremental("", "2026-09-06T00:00:00.000Z");
    expect(emptyShop.entries).toEqual([]);
  });

  it("TEST 9 — existing local event is not duplicated or rewritten", () => {
    const local = entry("event-x", "2026-09-06T10:00:00.000Z", {
      actorName: "Original local actor",
      payloadSummary: "local copy",
    });
    const cloudCopy = entry("event-x", "2026-09-06T10:00:00.000Z", {
      actorName: "Cloud rewrite attempt",
      payloadSummary: "cloud copy",
    });
    const merged = applyNormalSyncAuditPull([local], [], [cloudCopy]);
    expect(merged.added).toBe(0);
    expect(merged.auditLogs).toHaveLength(1);
    expect(merged.auditLogs[0]).toBe(local);
    expect(merged.auditLogs[0]?.actorName).toBe("Original local actor");
    expect(merged.auditLogs[0]?.payloadSummary).toBe("local copy");
  });

  it("TEST 10 — recovery and normal sync share identity (no duplicate)", () => {
    const remote = entry("event-x", "2026-09-06T10:00:00.000Z");
    const viaRecovery = mergeAuditLogsFromCloudPull([], [], [remote], {
      policy: "3m",
      nowMs: Date.parse("2026-09-06T12:00:00.000Z"),
    });
    expect(viaRecovery.auditLogs.map((e) => e.id)).toEqual(["event-x"]);
    expect(viaRecovery.archivedAuditLogs).toEqual([]);
    const viaNormalAfterRecovery = applyNormalSyncAuditPull(
      viaRecovery.auditLogs,
      viaRecovery.archivedAuditLogs,
      [remote],
    );
    expect(viaNormalAfterRecovery.added).toBe(0);
    expect(viaNormalAfterRecovery.auditLogs.filter((e) => e.id === "event-x")).toHaveLength(1);
    expect(viaNormalAfterRecovery.archivedAuditLogs.filter((e) => e.id === "event-x")).toHaveLength(0);

    const viaNormalFirst = applyNormalSyncAuditPull([], [], [remote]);
    const viaRecoveryAfterNormal = mergeAuditLogsFromCloudPull(
      viaNormalFirst.auditLogs,
      viaNormalFirst.archivedAuditLogs,
      [remote],
      { policy: "3m", nowMs: Date.parse("2026-09-06T12:00:00.000Z") },
    );
    expect(viaRecoveryAfterNormal.added).toBe(0);
    expect(viaRecoveryAfterNormal.auditLogs.filter((e) => e.id === "event-x")).toHaveLength(1);
    expect(viaRecoveryAfterNormal.archivedAuditLogs.filter((e) => e.id === "event-x")).toHaveLength(0);
  });

  it("preserves the existing 5000-event active cap", () => {
    const local = Array.from({ length: AUDIT_RETENTION_MAX_COUNT }, (_, i) =>
      entry(`local-${i}`, `2026-09-06T12:${String(i % 60).padStart(2, "0")}:00.000Z`),
    );
    const remote = entry("too-old-or-newest", "2026-09-07T00:00:00.000Z");
    const merged = applyNormalSyncAuditPull(local, [], [remote]);
    expect(merged.auditLogs.length).toBe(AUDIT_RETENTION_MAX_COUNT);
    expect(merged.auditLogs.some((e) => e.id === "too-old-or-newest")).toBe(true);
    expect(merged.archivedAuditLogs.length).toBeGreaterThan(0);
    expect(merged.auditLogs.length + merged.archivedAuditLogs.length).toBe(AUDIT_RETENTION_MAX_COUNT + 1);
  });

  it("incremental since uses a lookback instead of a full-table scan", () => {
    const since = "2026-09-06T12:00:00.000Z";
    const cursor = auditIncrementalSince(since);
    expect(Date.parse(cursor)).toBeLessThan(Date.parse(since));
    expect(Date.parse(since) - Date.parse(cursor)).toBe(48 * 60 * 60 * 1000);
    expect(auditIncrementalSince(null)).toBe(new Date(0).toISOString());
  });
});
