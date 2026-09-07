/**
 * IC-NEW-02 — Return Records presentation: honest 25-row page after filter.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReturnRecord } from "../../../types";
import {
  INVESTIGATION_RETURNS_PAGE_SIZE,
  collectInvestigationReturnsInRange,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "./investigationResultScope";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function ret(id: string, createdAt: string): ReturnRecord {
  return {
    id,
    productId: "p1",
    productName: `Item ${id}`,
    quantity: 1,
    refundAmountUgx: 1000,
    reason: "other",
    actorUserId: "staff-1",
    createdAt,
  };
}

function manyOnDay(count: number, day = "2026-09-06"): ReturnRecord[] {
  return Array.from({ length: count }, (_, i) =>
    ret(`r-${String(i).padStart(3, "0")}`, `${day}T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`),
  );
}

function present(records: ReturnRecord[], dateFrom: string, dateTo: string, visibleCount: number) {
  const matching = collectInvestigationReturnsInRange(records, dateFrom, dateTo);
  return { matching, page: paginateInvestigationResults(matching, visibleCount) };
}

describe("IC-NEW-02 return records presentation", () => {
  it("TEST 1 — 0 records → empty page, no Load More", () => {
    const { matching, page } = present([], "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(matching).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.shown).toBe(0);
    expect(page.displayed).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 2 — 24 records → all 24 visible, no Load More", () => {
    const { page } = present(manyOnDay(24), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(page.total).toBe(24);
    expect(page.shown).toBe(24);
    expect(page.displayed).toHaveLength(24);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 3 — 25 records → all 25 visible, no Load More", () => {
    const { page } = present(manyOnDay(25), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(page.total).toBe(25);
    expect(page.shown).toBe(25);
    expect(page.displayed).toHaveLength(25);
    expect(page.hasMore).toBe(false);
  });

  it("TEST 4 — 26 records → initial 25 of 26", () => {
    const { page } = present(manyOnDay(26), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(page.total).toBe(26);
    expect(page.shown).toBe(25);
    expect(page.displayed).toHaveLength(25);
    expect(page.hasMore).toBe(true);
  });

  it("TEST 5 — Load More reveals the remaining record", () => {
    const { matching, page } = present(manyOnDay(26), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    const nextVisible = nextInvestigationVisibleCount(page.shown, page.total, INVESTIGATION_RETURNS_PAGE_SIZE);
    const more = paginateInvestigationResults(matching, nextVisible);
    expect(more.shown).toBe(26);
    expect(more.displayed).toHaveLength(26);
    expect(more.hasMore).toBe(false);
    expect(more.displayed.map((r) => r.id)).toEqual(matching.map((r) => r.id));
  });

  it("TEST 6 — 50+ records → first page is 25, remaining reachable", () => {
    const { matching, page } = present(manyOnDay(50), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(page.shown).toBe(25);
    expect(page.total).toBe(50);
    expect(page.hasMore).toBe(true);
    let visible = page.shown;
    let current = page;
    while (current.hasMore) {
      visible = nextInvestigationVisibleCount(visible, matching.length, INVESTIGATION_RETURNS_PAGE_SIZE);
      current = paginateInvestigationResults(matching, visible);
    }
    expect(current.shown).toBe(50);
    expect(current.displayed).toHaveLength(50);
    expect(current.hasMore).toBe(false);
  });

  it("TEST 7 — filtered result set >25 uses matching total, not the global count", () => {
    const inRange = manyOnDay(41, "2026-09-06");
    const outside = manyOnDay(96, "2026-09-01");
    const { matching, page } = present([...inRange, ...outside], "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(matching).toHaveLength(41);
    expect(page.total).toBe(41);
    expect(page.shown).toBe(25);
    expect(page.hasMore).toBe(true);
    expect(page.total).not.toBe(137);
  });

  it("TEST 8 — date-filter matches beyond unfiltered index 25 are still found", () => {
    const newestOutside = manyOnDay(30, "2026-09-07");
    const olderInside = manyOnDay(10, "2026-09-06");
    const source = [...newestOutside, ...olderInside];
    const slicedThenFiltered = source
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 25)
      .filter((r) => r.createdAt.startsWith("2026-09-06"));
    expect(slicedThenFiltered).toHaveLength(0);

    const { matching, page } = present(source, "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    expect(matching).toHaveLength(10);
    expect(page.shown).toBe(10);
    expect(page.displayed.map((r) => r.id).sort()).toEqual(olderInside.map((r) => r.id).sort());
  });

  it("TEST 9 — loading more does not duplicate records", () => {
    const { matching, page } = present(manyOnDay(40), "2026-09-06", "2026-09-06", INVESTIGATION_RETURNS_PAGE_SIZE);
    const more = paginateInvestigationResults(
      matching,
      nextInvestigationVisibleCount(page.shown, page.total, INVESTIGATION_RETURNS_PAGE_SIZE),
    );
    expect(new Set(more.displayed.map((r) => r.id)).size).toBe(more.displayed.length);
    expect(more.displayed).toHaveLength(40);
  });

  it("TEST 10 — existing newest-first ordering is unchanged across pages", () => {
    const records = [
      ret("old", "2026-09-06T09:00:00.000Z"),
      ret("mid", "2026-09-06T10:00:00.000Z"),
      ret("new", "2026-09-06T11:00:00.000Z"),
    ];
    const { matching, page } = present(records, "2026-09-06", "2026-09-06", 2);
    expect(matching.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(page.displayed.map((r) => r.id)).toEqual(["new", "mid"]);
    const more = paginateInvestigationResults(matching, nextInvestigationVisibleCount(2, 3, 2));
    expect(more.displayed.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("filter change resets to the first page of 25", () => {
    expect(resetInvestigationVisibleCount(INVESTIGATION_RETURNS_PAGE_SIZE)).toBe(25);
  });
});

describe("IC-NEW-02 production boundary", () => {
  it("entity remainder still slices only after collect, not before date filter", () => {
    const storeSrc = src("src/features/investigation-center/EnterpriseInvestigationShell.tsx");
    expect(storeSrc).toContain("collectInvestigationReturnsInRange(allReturns, dateFrom, dateTo)");
    expect(storeSrc).not.toMatch(/\.sort\(\(a, b\) => b\.createdAt\.localeCompare\(a\.createdAt\)\)\s*\.slice\(0, 25\)/);
  });

  it("Return Records UI reuses EnterpriseListFooter Load More", () => {
    const sectionSrc = src("src/features/investigation-center/components/InvestigationRefundsSection.tsx");
    expect(sectionSrc).toContain("EnterpriseListFooter");
    expect(sectionSrc).toContain("INVESTIGATION_RETURNS_PAGE_SIZE");
    expect(sectionSrc).toContain("paginateInvestigationResults(returns, visibleCount)");
  });

  it("timeline page size and IC completeness contracts stay independent of the returns page", () => {
    const scopeSrc = src("src/features/investigation-center/lib/investigationResultScope.ts");
    const completenessSrc = src("src/features/investigation-center/lib/investigationDataCompleteness.ts");
    expect(scopeSrc).toContain("export const INVESTIGATION_PAGE_SIZE = AUDIT_FILTER_RESULT_LIMIT");
    expect(scopeSrc).toContain("export const INVESTIGATION_RETURNS_PAGE_SIZE = 25");
    expect(completenessSrc).not.toContain("returnsInRange");
    expect(completenessSrc).toContain('dataComplete: input.hydrationStage === "complete"');
  });
});
