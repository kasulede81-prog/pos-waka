/**
 * IC-P2-03 — 5000 active cap archives overflow instead of deleting it.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../types";
import { applyAuditActiveCap } from "./auditActiveCap";
import { applyNormalSyncAuditPull, mergeAuditLogsFromCloudPull } from "./auditCloudSync";
import { AUDIT_RETENTION_MAX_COUNT } from "./auditHealth";
import { auditLogsForReporting } from "./recordArchive";
import {
  collectInvestigationMatches,
  INVESTIGATION_PAGE_SIZE,
  paginateInvestigationResults,
} from "../features/investigation-center/lib/investigationResultScope";
import { buildAuditLogSearchIndex } from "./auditSearch";

function entry(
  id: string,
  at: string,
  extra: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id,
    at,
    actorUserId: extra.actorUserId ?? "staff-1",
    actorName: extra.actorName ?? "Amina",
    role: extra.role ?? "cashier",
    action: extra.action ?? "sale_completed",
    payloadSummary: extra.payloadSummary ?? id,
    payload: extra.payload ?? {},
    deviceId: extra.deviceId ?? "dev-1",
  };
}

function many(count: number, startMs = Date.parse("2026-09-01T00:00:00.000Z")): AuditLogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry(`e-${i}`, new Date(startMs + i * 1000).toISOString()),
  );
}

function assertNoDuplicateIds(rows: AuditLogEntry[]) {
  const ids = rows.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
}

function assertDisjointBuckets(active: AuditLogEntry[], archived: AuditLogEntry[]) {
  const archivedIds = new Set(archived.map((e) => e.id));
  for (const e of active) expect(archivedIds.has(e.id)).toBe(false);
}

describe("IC-P2-03 audit active cap overflow archive", () => {
  it("TEST 1 — 4999 stays all-active", () => {
    const rows = many(4999);
    const merged = applyAuditActiveCap(rows, []);
    expect(merged.auditLogs).toHaveLength(4999);
    expect(merged.archivedAuditLogs).toHaveLength(0);
  });

  it("TEST 2 — 5000 stays all-active", () => {
    const rows = many(AUDIT_RETENTION_MAX_COUNT);
    const merged = applyAuditActiveCap(rows, []);
    expect(merged.auditLogs).toHaveLength(AUDIT_RETENTION_MAX_COUNT);
    expect(merged.archivedAuditLogs).toHaveLength(0);
  });

  it("TEST 3 — 5001 archives the oldest", () => {
    const rows = many(5001);
    const oldest = rows[0]!;
    const newest = rows[5000]!;
    const merged = applyAuditActiveCap(rows, []);
    expect(merged.auditLogs).toHaveLength(5000);
    expect(merged.auditLogs[0]?.id).toBe(newest.id);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual([oldest.id]);
    expect(merged.auditLogs.some((e) => e.id === oldest.id)).toBe(false);
    assertNoDuplicateIds([...merged.auditLogs, ...merged.archivedAuditLogs]);
    assertDisjointBuckets(merged.auditLogs, merged.archivedAuditLogs);
  });

  it("TEST 4 — 20,000 recent events: active 5000, archive 15000", () => {
    const merged = applyAuditActiveCap(many(20_000), []);
    expect(merged.auditLogs).toHaveLength(5000);
    expect(merged.archivedAuditLogs).toHaveLength(15_000);
    expect(merged.auditLogs.length + merged.archivedAuditLogs.length).toBe(20_000);
    assertNoDuplicateIds([...merged.auditLogs, ...merged.archivedAuditLogs]);
  });

  it("TEST 5 — forever retention still archives overflow", () => {
    const rows = many(5001);
    const oldest = rows[0]!;
    const recovered = mergeAuditLogsFromCloudPull([], [], rows, {
      policy: "forever",
      nowMs: Date.parse("2026-09-06T12:00:00.000Z"),
    });
    expect(recovered.auditLogs).toHaveLength(5000);
    expect(recovered.archivedAuditLogs.some((e) => e.id === oldest.id)).toBe(true);
    expect(recovered.auditLogs.some((e) => e.id === oldest.id)).toBe(false);
  });

  it("TEST 6 — existing archive is preserved without duplicates", () => {
    const prior = [entry("arch-old", "2026-01-01T00:00:00.000Z")];
    const rows = many(5001);
    const merged = applyAuditActiveCap(rows, prior);
    expect(merged.archivedAuditLogs.some((e) => e.id === "arch-old")).toBe(true);
    expect(merged.archivedAuditLogs).toHaveLength(2);
    assertNoDuplicateIds(merged.archivedAuditLogs);
  });

  it("TEST 7 — same audit id stays one record", () => {
    const first = entry("same", "2026-09-06T10:00:00.000Z", { payloadSummary: "first" });
    const again = entry("same", "2026-09-06T10:00:00.000Z", { payloadSummary: "second" });
    const merged = applyAuditActiveCap([first, again], [first]);
    const all = [...merged.auditLogs, ...merged.archivedAuditLogs].filter((e) => e.id === "same");
    expect(all).toHaveLength(1);
  });

  it("TEST 8 — normal cloud pull overflow archives", () => {
    const local = many(5000);
    const remote = entry("pulled-newest", "2026-09-07T00:00:00.000Z");
    const merged = applyNormalSyncAuditPull(local, [], [remote]);
    expect(merged.auditLogs).toHaveLength(5000);
    expect(merged.auditLogs.some((e) => e.id === "pulled-newest")).toBe(true);
    expect(merged.archivedAuditLogs).toHaveLength(1);
    expect(merged.archivedAuditLogs[0]?.id).toBe("e-0");
  });

  it("TEST 9 — recovery of >5000 recent events archives overflow", () => {
    const cloud = many(5001);
    const merged = mergeAuditLogsFromCloudPull([], [], cloud, {
      policy: "3m",
      nowMs: Date.parse("2026-09-06T12:00:00.000Z"),
    });
    expect(merged.auditLogs).toHaveLength(5000);
    expect(merged.archivedAuditLogs).toHaveLength(1);
    expect(merged.archivedAuditLogs[0]?.id).toBe("e-0");
  });

  it("TEST 11 — appendDeviceAuditEntry archives overflow", async () => {
    const { usePosStore } = await import("../store/usePosStore");
    const { appendDeviceAuditEntry } = await import("./deviceAudit");
    const seeded = many(5000);
    const oldest = seeded[0]!;
    usePosStore.setState({
      auditLogs: seeded,
      archivedAuditLogs: [],
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
    });
    appendDeviceAuditEntry("device_viewed", "Viewed connected devices", { source: "ic-p2-03" });
    const next = usePosStore.getState();
    expect(next.auditLogs).toHaveLength(5000);
    expect(next.archivedAuditLogs.some((e) => e.id === oldest.id)).toBe(true);
    expect(next.auditLogs.some((e) => e.id === oldest.id)).toBe(false);
    expect(next.auditLogs.some((e) => e.action === "device_viewed")).toBe(true);
  });

  it("TEST 10 — recovery still date-archives old events directly", () => {
    const old = entry("old-direct", "2026-01-01T00:00:00.000Z");
    const merged = mergeAuditLogsFromCloudPull([], [], [old], {
      policy: "3m",
      nowMs: Date.parse("2026-09-06T12:00:00.000Z"),
    });
    expect(merged.auditLogs).toEqual([]);
    expect(merged.archivedAuditLogs.map((e) => e.id)).toEqual(["old-direct"]);
  });

  it("TEST 12 — persist/reload snapshot keeps capacity-archived events", () => {
    const rows = many(5001);
    const oldest = rows[0]!;
    const persisted = applyAuditActiveCap(rows, []);
    const reloaded = {
      auditLogs: persisted.auditLogs.map((e) => ({ ...e })),
      archivedAuditLogs: persisted.archivedAuditLogs.map((e) => ({ ...e })),
    };
    expect(reloaded.auditLogs).toHaveLength(5000);
    expect(reloaded.archivedAuditLogs.some((e) => e.id === oldest.id)).toBe(true);
    expect(auditLogsForReporting(reloaded, true).some((e) => e.id === oldest.id)).toBe(true);
  });

  it("TEST 13 — Investigation Center includeArchived shows capacity overflow", () => {
    const rows = many(5001);
    const oldest = rows[0]!;
    const merged = applyAuditActiveCap(rows, []);
    const hidden = auditLogsForReporting(merged, false);
    const shown = auditLogsForReporting(merged, true);
    expect(hidden.some((e) => e.id === oldest.id)).toBe(false);
    expect(hidden).toHaveLength(5000);
    expect(shown.some((e) => e.id === oldest.id)).toBe(true);
  });

  it("TEST 14 — overflow sale_return remains in archived investigation data", () => {
    const rows = many(5000);
    const refund = entry("refund-1", "2026-08-31T00:00:00.000Z", {
      action: "sale_return",
      payloadSummary: "Return soda UGX 2,000",
    });
    const merged = applyAuditActiveCap([...rows, refund], []);
    expect(merged.auditLogs.some((e) => e.id === "refund-1")).toBe(false);
    expect(merged.archivedAuditLogs.some((e) => e.id === "refund-1" && e.action === "sale_return")).toBe(true);
    expect(auditLogsForReporting(merged, true).some((e) => e.id === "refund-1")).toBe(true);
  });

  it("TEST 15 — overflow security event survives archive", () => {
    const rows = many(5000);
    const security = entry("sec-1", "2026-08-31T00:00:00.000Z", {
      action: "back_office_unlock_failed",
      payloadSummary: "Unlock failed",
    });
    const merged = applyAuditActiveCap([...rows, security], []);
    expect(merged.archivedAuditLogs.some((e) => e.id === "sec-1" && e.action === "back_office_unlock_failed")).toBe(
      true,
    );
  });

  it("Invariant 12 — IC-P2-01 paging is unchanged (filter all, then slice)", () => {
    const matching = many(450);
    const page = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(450);
    expect(page.shown).toBe(200);
    expect(page.hasMore).toBe(true);
    const collected = collectInvestigationMatches(buildAuditLogSearchIndex(matching), {}, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    });
    expect(collected.length).toBe(450);
  });
});
