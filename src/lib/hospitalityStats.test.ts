import { describe, expect, it } from "vitest";
import {
  activeReservationCount,
  activeWaitlistCount,
  averageOpenTableMinutes,
} from "./hospitalityStats";
import type { HospitalityFloorState } from "../types";

function floor(overrides: Partial<HospitalityFloorState> = {}): HospitalityFloorState {
  return {
    areas: [],
    tables: [],
    sessions: [],
    stations: [],
    reservations: [],
    waitlist: [],
    ...overrides,
  };
}

describe("hospitalityStats helpers", () => {
  it("counts active reservations for today excluding terminal statuses", () => {
    const state = floor({
      reservations: [
        { id: "1", reservationDate: "2026-07-10", status: "confirmed" },
        { id: "2", reservationDate: "2026-07-10", status: "cancelled" },
        { id: "3", reservationDate: "2026-07-09", status: "confirmed" },
        { id: "4", reservationDate: "2026-07-10", status: "no_show" },
      ] as HospitalityFloorState["reservations"],
    });
    expect(activeReservationCount(state, "2026-07-10")).toBe(1);
  });

  it("counts waitlist entries still waiting", () => {
    const state = floor({
      waitlist: [
        { id: "1", status: "waiting" },
        { id: "2", status: "seated" },
      ] as HospitalityFloorState["waitlist"],
    });
    expect(activeWaitlistCount(state)).toBe(1);
  });

  it("returns average open table minutes or null when none open", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const empty = floor();
    expect(averageOpenTableMinutes(empty, now)).toBeNull();

    const state = floor({
      sessions: [
        {
          id: "s1",
          tableId: "t1",
          status: "open",
          openedAt: "2026-07-10T11:30:00.000Z",
          sessionKind: "table",
        },
        {
          id: "s2",
          tableId: "t2",
          status: "open",
          openedAt: "2026-07-10T11:00:00.000Z",
          sessionKind: "table",
        },
      ] as HospitalityFloorState["sessions"],
    });
    expect(averageOpenTableMinutes(state, now)).toBe(45);
  });
});
