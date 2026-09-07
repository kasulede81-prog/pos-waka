/**
 * IC-NEW-03 — Staff tab derives from the complete matching set, not the timeline page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../../types";
import { buildAuditLogSearchIndex } from "../../../lib/auditSearch";
import {
  INVESTIGATION_PAGE_SIZE,
  INVESTIGATION_RETURNS_PAGE_SIZE,
  collectInvestigationMatches,
  collectInvestigationReturnsInRange,
  collectInvestigationStaffGroups,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "./investigationResultScope";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function entry(id: string, at: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id,
    at,
    actorUserId: extra.actorUserId ?? "staff-alice",
    actorName: extra.actorName ?? "Alice",
    role: extra.role ?? "cashier",
    action: extra.action ?? "sale_completed",
    payloadSummary: extra.payloadSummary ?? `Sale ${id}`,
    payload: extra.payload ?? {},
    deviceId: extra.deviceId ?? "dev-1",
  };
}

function manyFor(
  actorUserId: string,
  actorName: string,
  count: number,
  startIso: string,
): AuditLogEntry[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) =>
    entry(`${actorUserId}-${i}`, new Date(start + i * 1000).toISOString(), {
      actorUserId,
      actorName,
    }),
  );
}

const presentationAll = {
  category: "all" as const,
  activeKpi: null,
  todayKey: "2026-09-06",
};

describe("IC-NEW-03 staff presentation from complete matching set", () => {
  it("TEST 1 — zero matching activity → no staff groups", () => {
    const groups = collectInvestigationStaffGroups([]);
    const page = paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE);
    expect(groups).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.displayed).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 2 — fewer than the timeline page size keeps every staff group", () => {
    const matching = [
      ...manyFor("staff-alice", "Alice", 30, "2026-09-06T12:00:00.000Z"),
      ...manyFor("staff-bob", "Bob", 20, "2026-09-06T11:00:00.000Z"),
    ];
    expect(matching.length).toBeLessThan(INVESTIGATION_PAGE_SIZE);
    const groups = collectInvestigationStaffGroups(matching);
    const page = paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE);
    expect(groups.map((g) => g.actorId).sort()).toEqual(["staff-alice", "staff-bob"]);
    expect(page.shown).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(50);
  });

  it("TEST 3 — exactly the timeline page size still shows every staff group", () => {
    const matching = manyFor("staff-alice", "Alice", INVESTIGATION_PAGE_SIZE, "2026-09-06T12:00:00.000Z");
    const groups = collectInvestigationStaffGroups(matching);
    const page = paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE);
    expect(matching).toHaveLength(INVESTIGATION_PAGE_SIZE);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries).toHaveLength(INVESTIGATION_PAGE_SIZE);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 4 — >200 matching events remain in Staff groups", () => {
    const matching = manyFor("staff-alice", "Alice", 250, "2026-09-06T12:00:00.000Z");
    const timelinePage = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    expect(timelinePage.displayed).toHaveLength(200);
    const groups = collectInvestigationStaffGroups(matching);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries).toHaveLength(250);
  });

  it("TEST 5 — a staff member only after timeline row 200 is still in Staff", () => {
    const alice = manyFor("staff-alice", "Alice", 200, "2026-09-06T14:00:00.000Z");
    const bob = manyFor("staff-bob", "Bob", 50, "2026-09-06T10:00:00.000Z");
    const matching = collectInvestigationMatches(
      buildAuditLogSearchIndex([...alice, ...bob]),
      { dateFrom: "2026-09-06", dateTo: "2026-09-06" },
      presentationAll,
    );
    expect(matching).toHaveLength(250);

    const timelinePage = paginateInvestigationResults(matching, INVESTIGATION_PAGE_SIZE);
    expect(timelinePage.displayed).toHaveLength(200);
    const staffFromTimelinePage = collectInvestigationStaffGroups(timelinePage.displayed);
    expect(staffFromTimelinePage.map((g) => g.actorId)).toEqual(["staff-alice"]);
    expect(staffFromTimelinePage.some((g) => g.actorId === "staff-bob")).toBe(false);

    const staffFromMatching = collectInvestigationStaffGroups(matching);
    expect(staffFromMatching.map((g) => g.actorId).sort()).toEqual(["staff-alice", "staff-bob"]);
    expect(staffFromMatching.find((g) => g.actorId === "staff-bob")?.entries).toHaveLength(50);
  });

  it("TEST 6 — Load More reveals additional staff groups", () => {
    const matching = Array.from({ length: 201 }, (_, i) =>
      entry(`solo-${i}`, new Date(Date.parse("2026-09-06T10:00:00.000Z") + i * 1000).toISOString(), {
        actorUserId: `staff-${i}`,
        actorName: `Staff ${i}`,
      }),
    );
    const groups = collectInvestigationStaffGroups(matching);
    expect(groups).toHaveLength(201);
    const first = paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE);
    expect(first.shown).toBe(200);
    expect(first.hasMore).toBe(true);
    const more = paginateInvestigationResults(
      groups,
      nextInvestigationVisibleCount(first.shown, first.total, INVESTIGATION_PAGE_SIZE),
    );
    expect(more.shown).toBe(201);
    expect(more.hasMore).toBe(false);
    expect(more.displayed).toHaveLength(201);
  });

  it("TEST 7 — loading more does not duplicate staff groups", () => {
    const matching = Array.from({ length: 210 }, (_, i) =>
      entry(`dup-${i}`, new Date(Date.parse("2026-09-06T10:00:00.000Z") + i * 1000).toISOString(), {
        actorUserId: `staff-${i}`,
        actorName: `Staff ${i}`,
      }),
    );
    const groups = collectInvestigationStaffGroups(matching);
    const more = paginateInvestigationResults(
      groups,
      nextInvestigationVisibleCount(INVESTIGATION_PAGE_SIZE, groups.length, INVESTIGATION_PAGE_SIZE),
    );
    expect(new Set(more.displayed.map((g) => g.actorId)).size).toBe(more.displayed.length);
    expect(more.displayed).toHaveLength(210);
  });

  it("TEST 8 — existing newest-first staff-group ordering is preserved", () => {
    const matching = [
      entry("old", "2026-09-06T09:00:00.000Z", { actorUserId: "staff-old", actorName: "Old" }),
      entry("mid", "2026-09-06T10:00:00.000Z", { actorUserId: "staff-mid", actorName: "Mid" }),
      entry("new", "2026-09-06T11:00:00.000Z", { actorUserId: "staff-new", actorName: "New" }),
    ];
    const groups = collectInvestigationStaffGroups(matching);
    expect(groups.map((g) => g.actorId)).toEqual(["staff-new", "staff-mid", "staff-old"]);
    const page = paginateInvestigationResults(groups, 2);
    expect(page.displayed.map((g) => g.actorId)).toEqual(["staff-new", "staff-mid"]);
    const more = paginateInvestigationResults(groups, nextInvestigationVisibleCount(2, 3, 2));
    expect(more.displayed.map((g) => g.actorId)).toEqual(["staff-new", "staff-mid", "staff-old"]);
  });

  it("TEST 9 — filters/search apply before Staff grouping and pagination", () => {
    const alice = manyFor("staff-alice", "Alice", 220, "2026-09-06T14:00:00.000Z");
    const bob = [
      entry("bob-late", "2026-09-06T09:00:00.000Z", {
        actorUserId: "staff-bob",
        actorName: "Bob",
        payloadSummary: "unique-bob-token soda refund",
      }),
    ];
    const matching = collectInvestigationMatches(
      buildAuditLogSearchIndex([...alice, ...bob]),
      { dateFrom: "2026-09-06", dateTo: "2026-09-06", searchText: "unique-bob-token" },
      presentationAll,
    );
    expect(matching.map((e) => e.id)).toEqual(["bob-late"]);
    const groups = collectInvestigationStaffGroups(matching);
    const page = paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE);
    expect(groups.map((g) => g.actorId)).toEqual(["staff-bob"]);
    expect(page.shown).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 10 — changing filters resets Staff pagination to the first page", () => {
    expect(resetInvestigationVisibleCount(INVESTIGATION_PAGE_SIZE)).toBe(INVESTIGATION_PAGE_SIZE);
    const groups = collectInvestigationStaffGroups(
      Array.from({ length: 210 }, (_, i) =>
        entry(`r-${i}`, new Date(Date.parse("2026-09-06T10:00:00.000Z") + i * 1000).toISOString(), {
          actorUserId: `staff-${i}`,
          actorName: `Staff ${i}`,
        }),
      ),
    );
    const expanded = paginateInvestigationResults(groups, 210);
    expect(expanded.shown).toBe(210);
    const reset = paginateInvestigationResults(groups, resetInvestigationVisibleCount(INVESTIGATION_PAGE_SIZE));
    expect(reset.shown).toBe(200);
    expect(reset.hasMore).toBe(true);
  });
});

describe("IC-NEW-03 production boundary", () => {
  it("TEST 11 — IC-NEW-02 Return Records collect/page helpers remain intact", () => {
    expect(INVESTIGATION_RETURNS_PAGE_SIZE).toBe(25);
    const storeSrc = src("src/features/investigation-center/EnterpriseInvestigationShell.tsx");
    expect(storeSrc).toContain("collectInvestigationReturnsInRange(allReturns, dateFrom, dateTo)");
    expect(collectInvestigationReturnsInRange([], "2026-09-06", "2026-09-06")).toEqual([]);
  });

  it("Staff reads matchingEntries, timeline still reads the presentation page", () => {
    const widgetSrc = src("src/features/investigation-center/registry/retailWidgets.tsx");
    const staffIdx = widgetSrc.indexOf("function StaffReportsWidget");
    const timelineIdx = widgetSrc.indexOf("function TimelineWidget");
    const staffEntries = widgetSrc.indexOf("entries={ctx.matchingEntries}", staffIdx);
    const timelineEntries = widgetSrc.indexOf("entries={ctx.filtered}", timelineIdx);
    expect(staffIdx).toBeGreaterThan(0);
    expect(staffEntries).toBeGreaterThan(staffIdx);
    expect(staffEntries).toBeLessThan(widgetSrc.indexOf("function RefundsReportsWidget"));
    expect(timelineEntries).toBeGreaterThan(timelineIdx);
    expect(widgetSrc.indexOf("entries={ctx.filtered}", staffIdx)).toBe(-1);
  });

  it("Staff UI paginates groups after collect, using EnterpriseListFooter", () => {
    const sectionSrc = src("src/features/investigation-center/components/InvestigationStaffSection.tsx");
    expect(sectionSrc).toContain("collectInvestigationStaffGroups(entries)");
    expect(sectionSrc).toContain("paginateInvestigationResults(staffGroups, visibleCount)");
    expect(sectionSrc).toContain("EnterpriseListFooter");
  });
});
