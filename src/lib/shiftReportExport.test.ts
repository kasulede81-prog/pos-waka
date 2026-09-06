import { describe, expect, it } from "vitest";
import type { ShiftRecord } from "../types";
import { t } from "./i18n";
import {
  buildShiftSummaryCsv,
  buildShiftSummaryRows,
  shiftIdsFromSummaryRows,
  shiftSummaryDocumentLabels,
  shiftSummaryExportFilenames,
} from "./shiftReportExport";

function shift(partial: Partial<ShiftRecord> & Pick<ShiftRecord, "id" | "startAt">): ShiftRecord {
  return {
    actorUserId: "staff:cashier-1",
    actorName: "Cashier A",
    role: "cashier",
    endAt: null,
    salesTotalUgx: 10_000,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 10_000,
    debtPaymentsTotalUgx: 0,
    ...partial,
  };
}

const juneClosed = shift({
  id: "june",
  startAt: "2026-06-11T08:00:00.000Z",
  endAt: "2026-06-11T18:00:00.000Z",
  salesTotalUgx: 80_000,
});
const julyClosed = shift({
  id: "july",
  startAt: "2026-07-04T08:00:00.000Z",
  endAt: "2026-07-04T17:00:00.000Z",
  salesTotalUgx: 50_000,
});
const augustClosed = shift({
  id: "august",
  startAt: "2026-08-20T08:00:00.000Z",
  endAt: "2026-08-20T16:00:00.000Z",
  salesTotalUgx: 40_000,
});
const openToday = shift({
  id: "open-today",
  startAt: "2026-09-06T07:00:00.000Z",
  endAt: null,
  salesTotalUgx: 25_000,
});
const archivedJune = shift({
  id: "archived-june",
  startAt: "2026-06-01T08:00:00.000Z",
  endAt: "2026-06-01T18:00:00.000Z",
  salesTotalUgx: 9_000,
});

describe("P3-NEW-08 shift summary export labels", () => {
  it("TEST 1 — CSV filename communicates retained scope, not a calendar day", () => {
    const { csv } = shiftSummaryExportFilenames();
    expect(csv).toBe("waka-shift-summary-retained-shifts.csv");
    expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(csv).not.toContain("today");
  });

  it("TEST 2 — PDF filename communicates retained scope, not a calendar day", () => {
    const { pdf } = shiftSummaryExportFilenames();
    expect(pdf).toBe("waka-shift-summary-retained-shifts.pdf");
    expect(pdf).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(pdf).not.toContain("today");
  });

  it("TEST 3 — export rows are retained open + closed shifts and exclude archived", () => {
    const retained = [juneClosed, julyClosed, augustClosed, openToday];
    const archived = [archivedJune];
    const rows = buildShiftSummaryRows(retained, Date.parse("2026-09-06T12:00:00.000Z"));
    const ids = shiftIdsFromSummaryRows(rows);
    expect(ids).toEqual(["open-today", "august", "july", "june"]);
    expect(ids).toContain("open-today");
    expect(ids).toContain("june");
    expect(ids).not.toContain("archived-june");
    expect(archived.some((sh) => ids.includes(sh.id))).toBe(false);
  });

  it("TEST 4 — CSV and PDF use the same retained shift row set", () => {
    const retained = [juneClosed, openToday, julyClosed];
    const rows = buildShiftSummaryRows(retained, Date.parse("2026-09-06T12:00:00.000Z"));
    const ids = shiftIdsFromSummaryRows(rows);
    const csv = buildShiftSummaryCsv("en", rows);
    for (const id of ids) {
      const row = rows.find((r) => r.shift.id === id)!;
      expect(csv).toContain(row.shift.startAt);
      expect(csv).toContain(String(row.shift.salesTotalUgx));
    }
    expect(ids).toEqual(["open-today", "july", "june"]);
    const labels = shiftSummaryDocumentLabels("en");
    expect(labels.title).toBe(t("en", "shiftReportTitle"));
    expect(labels.scopeHint).toBe(t("en", "shiftReportScopeHint"));
  });

  it("TEST 5 — no date filter is introduced; historical retained dates remain", () => {
    const rows = buildShiftSummaryRows(
      [juneClosed, julyClosed, augustClosed, openToday],
      Date.parse("2026-09-06T12:00:00.000Z"),
    );
    const starts = rows.map((r) => r.shift.startAt);
    expect(starts.some((at) => at.startsWith("2026-06"))).toBe(true);
    expect(starts.some((at) => at.startsWith("2026-07"))).toBe(true);
    expect(starts.some((at) => at.startsWith("2026-08"))).toBe(true);
    expect(starts.some((at) => at.startsWith("2026-09"))).toBe(true);
  });

  it("TEST 6 — labels do not treat a generated date as the report period", () => {
    const names = shiftSummaryExportFilenames();
    const labels = shiftSummaryDocumentLabels("en");
    expect(names.csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(names.pdf).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(labels.title.toLowerCase()).toContain("retained");
    expect(labels.title.toLowerCase()).not.toContain("today");
    expect(labels.scopeHint.toLowerCase()).toContain("retained");
    expect(labels.scopeHint.toLowerCase()).not.toMatch(/all-time|all historical|all shifts ever/);
  });
});
