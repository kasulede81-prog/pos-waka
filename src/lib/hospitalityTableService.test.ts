import { describe, expect, it } from "vitest";
import type { DiningTable, HospitalityFloorState, TableSession } from "../types";
import { computeHospitalityReports } from "./hospitalityReports";

const RANGE = { fromKey: "2026-06-02", toKey: "2026-06-03" };
const NOW = new Date("2026-06-04T18:00:00.000Z");

function table(id: string, label: string, sortOrder: number): DiningTable {
  return {
    id,
    areaId: "area-1",
    label,
    capacity: 4,
    sortOrder,
    displayStatus: "available",
    isActive: true,
  };
}

function session(partial: Partial<TableSession> & Pick<TableSession, "id" | "tableId" | "status" | "openedAt">): TableSession {
  return {
    sessionKind: "table",
    saleId: `sale-${partial.id}`,
    guestCount: 2,
    ...partial,
  };
}

const floor: HospitalityFloorState = {
  areas: [],
  tables: [
    table("t1", "Table 1", 1),
    table("t2", "Table 2", 2),
    table("t3", "Table 3", 3),
    table("t4", "Table 4", 4),
    table("t5", "Table 5", 5),
  ],
  stations: [],
  sessions: [
    session({
      id: "closed-90",
      tableId: "t1",
      status: "closed",
      openedAt: "2026-06-02T10:00:00.000Z",
      closedAt: "2026-06-02T11:30:00.000Z",
    }),
    session({
      id: "closed-45",
      tableId: "t2",
      status: "closed",
      openedAt: "2026-06-03T12:00:00.000Z",
      closedAt: "2026-06-03T12:45:00.000Z",
    }),
    session({
      id: "missing-end",
      tableId: "t1",
      status: "closed",
      openedAt: "2026-06-02T10:00:00.000Z",
    }),
    session({
      id: "invalid-interval",
      tableId: "t2",
      status: "closed",
      openedAt: "2026-06-02T12:00:00.000Z",
      closedAt: "2026-06-02T11:00:00.000Z",
    }),
    session({
      id: "outside-range",
      tableId: "t3",
      status: "closed",
      openedAt: "2026-05-01T10:00:00.000Z",
      closedAt: "2026-05-01T11:00:00.000Z",
    }),
    session({
      id: "open-table",
      tableId: "t4",
      status: "open",
      openedAt: "2026-06-04T17:00:00.000Z",
      guestCount: 4,
    }),
    session({
      id: "payment-pending",
      tableId: "t5",
      status: "payment_pending",
      openedAt: "2026-06-04T17:30:00.000Z",
      guestCount: 3,
    }),
    session({
      id: "cancelled",
      tableId: "t1",
      status: "cancelled",
      openedAt: "2026-06-02T13:00:00.000Z",
      closedAt: "2026-06-02T13:30:00.000Z",
    }),
    session({
      id: "merged",
      tableId: "t2",
      status: "merged",
      openedAt: "2026-06-02T14:00:00.000Z",
      closedAt: "2026-06-02T14:30:00.000Z",
    }),
  ],
};

const report = computeHospitalityReports([], [], RANGE, { floor, now: NOW });
const service = report.tableService;

describe("hospitality table service report", () => {
  it("counts completed turnover only when both start and end timestamps exist in range", () => {
    expect(service.completedCount).toBe(2);
    expect(service.completedDurationMinutes).toBe(135);
    expect(service.averageCompletedDurationMinutes).toBe(67.5);
    expect(service.completedByTable).toEqual([
      {
        tableLabel: "Table 1",
        completedCount: 1,
        totalDurationMinutes: 90,
        averageDurationMinutes: 90,
      },
      {
        tableLabel: "Table 2",
        completedCount: 1,
        totalDurationMinutes: 45,
        averageDurationMinutes: 45,
      },
    ]);
    expect(service.missingEndEvidenceCount).toBe(1);
    expect(service.invalidIntervalCount).toBe(1);
    expect(service.outsideRangeCount).toBe(1);
  });

  it("reports open-table elapsed time separately from completed turnover", () => {
    expect(service.openCount).toBe(2);
    expect(service.openTables).toEqual([
      {
        sessionId: "open-table",
        tableLabel: "Table 4",
        status: "open",
        openedAt: "2026-06-04T17:00:00.000Z",
        elapsedMinutes: 60,
        guestCount: 4,
      },
      {
        sessionId: "payment-pending",
        tableLabel: "Table 5",
        status: "payment_pending",
        openedAt: "2026-06-04T17:30:00.000Z",
        elapsedMinutes: 30,
        guestCount: 3,
      },
    ]);
    expect(service.completedCount).toBe(2);
  });

  it("does not count cancelled or merged sessions as completed turnover", () => {
    expect(service.completedByTable.map((row) => row.tableLabel)).toEqual(["Table 1", "Table 2"]);
    expect(service.completedCount).toBe(2);
  });
});
