/**
 * NEW-06 — Integrity and staff-shift lists disclose presentation caps.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RefundIntegrityViolation } from "../../../lib/auditRefundIntegrity";
import {
  INVESTIGATION_INTEGRITY_PAGE_SIZE,
  INVESTIGATION_PAGE_SIZE,
  INVESTIGATION_SHIFTS_PAGE_SIZE,
  collectInvestigationShiftsInRange,
  collectInvestigationStaffGroups,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "./investigationResultScope";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function violation(i: number): RefundIntegrityViolation {
  return {
    code: `over_refund_sale`,
    message: `Violation ${i}`,
    saleId: `sale-${String(i).padStart(3, "0")}`,
  };
}

function violations(count: number): RefundIntegrityViolation[] {
  return Array.from({ length: count }, (_, i) => violation(i + 1));
}

function shift(id: string, startAt: string, actorUserId = "staff-1") {
  return {
    id,
    actorUserId,
    actorName: actorUserId,
    startAt,
    endAt: null as string | null,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
  };
}

function shiftsOnDay(count: number, day = "2026-09-06") {
  return Array.from({ length: count }, (_, i) =>
    shift(`sh-${String(i).padStart(3, "0")}`, `${day}T${String(8 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`),
  );
}

describe("NEW-06 integrity violation presentation", () => {
  it("0 violations → empty page, no Load More", () => {
    const page = paginateInvestigationResults(violations(0), INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(0);
    expect(page.shown).toBe(0);
    expect(page.displayed).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("5 violations → all 5 shown", () => {
    const page = paginateInvestigationResults(violations(5), INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(5);
    expect(page.shown).toBe(5);
    expect(page.displayed).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it("8 violations → all 8 shown", () => {
    const page = paginateInvestigationResults(violations(8), INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(8);
    expect(page.shown).toBe(8);
    expect(page.hasMore).toBe(false);
  });

  it("9 violations → first page 8 + 1 remaining", () => {
    const page = paginateInvestigationResults(violations(9), INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(9);
    expect(page.shown).toBe(8);
    expect(page.displayed).toHaveLength(8);
    expect(page.hasMore).toBe(true);
    expect(page.total - page.shown).toBe(1);
  });

  it("25 violations → first page 8 + 17 remaining", () => {
    const page = paginateInvestigationResults(violations(25), INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(25);
    expect(page.shown).toBe(8);
    expect(page.hasMore).toBe(true);
    expect(page.total - page.shown).toBe(17);
  });

  it("Load More reveals the next integrity records without reordering", () => {
    const matching = violations(9);
    const first = paginateInvestigationResults(matching, INVESTIGATION_INTEGRITY_PAGE_SIZE);
    const more = paginateInvestigationResults(
      matching,
      nextInvestigationVisibleCount(first.shown, first.total, INVESTIGATION_INTEGRITY_PAGE_SIZE),
    );
    expect(more.shown).toBe(9);
    expect(more.displayed).toHaveLength(9);
    expect(more.hasMore).toBe(false);
    expect(more.displayed.map((v) => v.saleId)).toEqual(matching.map((v) => v.saleId));
  });

  it("ordering stays deterministic across pages", () => {
    const matching = violations(12);
    const first = paginateInvestigationResults(matching, INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(first.displayed.map((v) => v.saleId)).toEqual(matching.slice(0, 8).map((v) => v.saleId));
    const more = paginateInvestigationResults(
      matching,
      nextInvestigationVisibleCount(first.shown, first.total, INVESTIGATION_INTEGRITY_PAGE_SIZE),
    );
    expect(more.displayed.map((v) => v.saleId)).toEqual(matching.map((v) => v.saleId));
  });

  it("filters do not inflate the integrity total", () => {
    const matching = violations(11);
    const page = paginateInvestigationResults(matching, INVESTIGATION_INTEGRITY_PAGE_SIZE);
    expect(page.total).toBe(11);
    expect(page.total).not.toBe(200);
    expect(resetInvestigationVisibleCount(INVESTIGATION_INTEGRITY_PAGE_SIZE)).toBe(8);
  });
});

describe("NEW-06 staff shift presentation", () => {
  it("0 shifts → empty page", () => {
    const matching = collectInvestigationShiftsInRange([], "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(matching).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it("5 shifts → all 5 shown", () => {
    const matching = collectInvestigationShiftsInRange(shiftsOnDay(5), "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(page.total).toBe(5);
    expect(page.shown).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it("10 shifts → all 10 shown", () => {
    const matching = collectInvestigationShiftsInRange(shiftsOnDay(10), "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(page.total).toBe(10);
    expect(page.shown).toBe(10);
    expect(page.hasMore).toBe(false);
  });

  it("11 shifts → cap is honestly disclosed", () => {
    const matching = collectInvestigationShiftsInRange(shiftsOnDay(11), "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(page.total).toBe(11);
    expect(page.shown).toBe(10);
    expect(page.hasMore).toBe(true);
    expect(page.total - page.shown).toBe(1);
  });

  it("25 shifts → total count is honest", () => {
    const matching = collectInvestigationShiftsInRange(shiftsOnDay(25), "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(page.total).toBe(25);
    expect(page.shown).toBe(10);
    expect(page.hasMore).toBe(true);
    expect(page.total - page.shown).toBe(15);
  });

  it("Load More reveals subsequent shifts in source order", () => {
    const matching = collectInvestigationShiftsInRange(shiftsOnDay(11), "2026-09-06", "2026-09-06");
    const first = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    const more = paginateInvestigationResults(
      matching,
      nextInvestigationVisibleCount(first.shown, first.total, INVESTIGATION_SHIFTS_PAGE_SIZE),
    );
    expect(more.shown).toBe(11);
    expect(more.displayed.map((s) => s.id)).toEqual(matching.map((s) => s.id));
    expect(more.hasMore).toBe(false);
  });

  it("date filter total is the matching set, not the global shift count", () => {
    const inRange = shiftsOnDay(14, "2026-09-06");
    const outside = shiftsOnDay(40, "2026-09-01");
    const matching = collectInvestigationShiftsInRange([...inRange, ...outside], "2026-09-06", "2026-09-06");
    const page = paginateInvestigationResults(matching, INVESTIGATION_SHIFTS_PAGE_SIZE);
    expect(matching).toHaveLength(14);
    expect(page.total).toBe(14);
    expect(page.shown).toBe(10);
    expect(page.total).not.toBe(54);
  });

  it("staff grouping pagination remains independent of the shift page size", () => {
    const groups = collectInvestigationStaffGroups([]);
    expect(paginateInvestigationResults(groups, INVESTIGATION_PAGE_SIZE).hasMore).toBe(false);
    expect(INVESTIGATION_SHIFTS_PAGE_SIZE).toBe(10);
    expect(INVESTIGATION_PAGE_SIZE).not.toBe(INVESTIGATION_SHIFTS_PAGE_SIZE);
  });
});

describe("NEW-06 production boundary", () => {
  it("integrity list no longer silently slices to 8", () => {
    const refunds = src("src/features/investigation-center/components/InvestigationRefundsSection.tsx");
    expect(refunds).not.toContain("violations.slice(0, 8)");
    expect(refunds).toContain("INVESTIGATION_INTEGRITY_PAGE_SIZE");
    expect(refunds).toContain("paginateInvestigationResults(integrityReport.violations, integrityVisibleCount)");
    expect(refunds).toContain("EnterpriseListFooter");
  });

  it("staff shifts collect the date range before presentation pagination", () => {
    const shell = src("src/features/investigation-center/EnterpriseInvestigationShell.tsx");
    const staff = src("src/features/investigation-center/components/InvestigationStaffSection.tsx");
    expect(shell).toContain("collectInvestigationShiftsInRange(shifts ?? [], dateFrom, dateTo)");
    expect(shell).not.toMatch(/\.slice\(0,\s*10\)/);
    expect(staff).toContain("paginateInvestigationResults(shifts, shiftVisibleCount)");
    expect(staff).toContain("INVESTIGATION_SHIFTS_PAGE_SIZE");
    expect(staff).toContain("paginateInvestigationResults(staffGroups, visibleCount)");
  });
});
