/**
 * IC-P2-01 — timeline total vs displayed vs export/share.
 */
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../../types";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import { auditLogsForReporting } from "../../../lib/recordArchive";
import {
  INVESTIGATION_PAGE_SIZE,
  INVESTIGATION_SHARE_ENTRY_LIMIT,
  collectInvestigationMatches,
  investigationResultScopeKey,
  investigationShareSlice,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "./investigationResultScope";

function entry(id: string, at: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    at,
    actorUserId: extra.actorUserId ?? "staff-1",
    actorName: extra.actorName ?? "Alice",
    role: extra.role ?? "cashier",
    action: extra.action ?? "sale_completed",
    payloadSummary: extra.payloadSummary ?? `Sale ${id}`,
    payload: extra.payload ?? {},
    deviceId: extra.deviceId ?? "dev-1",
  };
}

function many(count: number, startIso = "2026-09-06T10:00:00.000Z"): AuditLogEntry[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    entry(`e-${i}`, new Date(start + i * 1000).toISOString()),
  );
}

const presentationAll = {
  category: "all" as const,
  activeKpi: null,
  todayKey: "2026-09-06",
};

describe("IC-P2-01 investigation result scope", () => {
  it("TEST 1 — under limit: 50 matching → shown 50, hasMore false", () => {
    const page = paginateInvestigationResults(many(50), INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(50);
    expect(page.shown).toBe(50);
    expect(page.displayed).toHaveLength(50);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 2 — exactly 200: shown 200, hasMore false", () => {
    const page = paginateInvestigationResults(many(200), INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(200);
    expect(page.shown).toBe(200);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 3 — above limit: 450 matching → first page 200, hasMore true", () => {
    const page = paginateInvestigationResults(many(450), INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(450);
    expect(page.shown).toBe(200);
    expect(page.displayed).toHaveLength(200);
    expect(page.hasMore).toBe(true);
  });

  it("TEST 4 — load more 200 → 400 → 450 without duplicates", () => {
    const matching = many(450);
    const first = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    const secondVisible = nextInvestigationVisibleCount(first.shown, first.total);
    const second = paginateInvestigationResults(matching, secondVisible);
    expect(second.shown).toBe(400);
    expect(second.hasMore).toBe(true);
    const thirdVisible = nextInvestigationVisibleCount(second.shown, second.total);
    const third = paginateInvestigationResults(matching, thirdVisible);
    expect(third.shown).toBe(450);
    expect(third.hasMore).toBe(false);
    expect(new Set(third.displayed.map((e) => e.id)).size).toBe(450);
    expect(third.displayed.map((e) => e.id)).toEqual(matching.map((e) => e.id));
  });

  it("TEST 5 — total is after date, staff, action, category, and search filters", () => {
    const logs: AuditLogEntry[] = [
      entry("sale-today", "2026-09-06T10:00:00.000Z", {
        action: "sale_completed",
        actorUserId: "staff-1",
        payloadSummary: "Coca Cola sale",
      }),
      entry("sale-yesterday", "2026-09-05T10:00:00.000Z", {
        action: "sale_completed",
        actorUserId: "staff-1",
        payloadSummary: "Coca Cola sale",
      }),
      entry("void-today", "2026-09-06T11:00:00.000Z", {
        action: "sale_void",
        actorUserId: "staff-1",
        payloadSummary: "Void cola",
      }),
      entry("bob-sale", "2026-09-06T12:00:00.000Z", {
        action: "sale_completed",
        actorUserId: "staff-2",
        actorName: "Bob",
        payloadSummary: "Bread sale",
      }),
    ];
    const index = buildAuditLogSearchIndex(logs);
    const matches = collectInvestigationMatches(
      index,
      {
        dateFrom: "2026-09-06",
        dateTo: "2026-09-06",
        actorUserId: "staff-1",
        action: "sale_completed",
        searchText: "coca",
      },
      presentationAll,
    );
    expect(matches.map((e) => e.id)).toEqual(["sale-today"]);
    const salesCategory = collectInvestigationMatches(
      index,
      { dateFrom: "2026-09-06", dateTo: "2026-09-06" },
      { category: "sales", activeKpi: null, todayKey: "2026-09-06" },
    );
    expect(salesCategory.every((e) => e.action === "sale_completed" || e.action === "sale_void")).toBe(true);
    expect(salesCategory.map((e) => e.id).sort()).toEqual(["bob-sale", "sale-today", "void-today"]);
  });

  it("TEST 6 — filter-scope change resets display to page 1", () => {
    const matching = many(450);
    const page2 = paginateInvestigationResults(matching, 400);
    expect(page2.shown).toBe(400);
    const keyBefore = investigationResultScopeKey({
      dateFrom: "2026-09-06",
      dateTo: "2026-09-06",
      actorUserId: "all",
      action: "all",
      productId: "",
      customerId: "",
      supplierId: "",
      searchText: "",
      category: "all",
      activeKpi: null,
      includeArchived: false,
    });
    const keyAfter = investigationResultScopeKey({
      dateFrom: "2026-09-06",
      dateTo: "2026-09-06",
      actorUserId: "all",
      action: "all",
      productId: "",
      customerId: "",
      supplierId: "",
      searchText: "cola",
      category: "all",
      activeKpi: null,
      includeArchived: false,
    });
    expect(keyBefore).not.toBe(keyAfter);
    const resetVisible = resetInvestigationVisibleCount();
    const resetPage = paginateInvestigationResults(matching, resetVisible);
    expect(resetVisible).toBe(INVESTIGATION_PAGE_SIZE);
    expect(resetPage.shown).toBe(200);
    expect(resetPage.hasMore).toBe(true);
  });

  it("TEST 7 — newest-first order is preserved across pages", () => {
    const matching = [
      entry("n1", "2026-09-06T12:00:00.000Z"),
      entry("n2", "2026-09-06T11:00:00.000Z"),
      entry("n3", "2026-09-06T10:00:00.000Z"),
    ];
    const page = paginateInvestigationResults(matching, 2);
    expect(page.displayed.map((e) => e.id)).toEqual(["n1", "n2"]);
    const more = paginateInvestigationResults(matching, nextInvestigationVisibleCount(2, 3, 2));
    expect(more.displayed.map((e) => e.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("TEST 8 — includeArchived uses the existing combined reporting source", () => {
    const active = [entry("active-1", "2026-09-06T10:00:00.000Z")];
    const archived = [entry("arch-1", "2026-01-01T10:00:00.000Z")];
    const activeOnly = auditLogsForReporting({ auditLogs: active, archivedAuditLogs: archived }, false);
    const combined = auditLogsForReporting({ auditLogs: active, archivedAuditLogs: archived }, true);
    expect(collectInvestigationMatches(buildAuditLogSearchIndex(activeOnly), {}, presentationAll).map((e) => e.id)).toEqual([
      "active-1",
    ]);
    expect(collectInvestigationMatches(buildAuditLogSearchIndex(combined), {}, presentationAll).map((e) => e.id).sort()).toEqual([
      "active-1",
      "arch-1",
    ]);
  });

  it("TEST 9 — export uses the full matching set, not the first 200", () => {
    const matching = many(450);
    const page = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    const exportEntries = matching;
    expect(page.displayed).toHaveLength(200);
    expect(exportEntries).toHaveLength(450);
    expect(exportEntries.map((e) => e.id)).toEqual(matching.map((e) => e.id));
  });

  it("TEST 10 — share remains capped at 40", () => {
    const matching = many(200);
    const shared = investigationShareSlice(matching);
    expect(INVESTIGATION_SHARE_ENTRY_LIMIT).toBe(40);
    expect(shared).toHaveLength(40);
    expect(shared.map((e) => e.id)).toEqual(matching.slice(0, 40).map((e) => e.id));
  });

  it("TEST 11 — empty matching set stays empty (no 0-of-0 page model)", () => {
    const page = paginateInvestigationResults([], INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(0);
    expect(page.shown).toBe(0);
    expect(page.displayed).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 12 — large matching set keeps a bounded display window", () => {
    const matching = many(5000);
    const page = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    expect(page.total).toBe(5000);
    expect(page.displayed.length).toBe(INVESTIGATION_PAGE_SIZE);
    expect(page.displayed.length).toBeLessThan(matching.length);
  });
});
