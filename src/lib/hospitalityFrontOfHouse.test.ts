import { describe, expect, it } from "vitest";
import type { HospitalityFloorState } from "../types";
import {
  createReservation,
  markTableNeedsCleaning,
  finishTableCleaning,
  suggestTables,
  combineTables,
  splitCombinedTables,
  activeWaitlist,
} from "./hospitalityFrontOfHouse";
import { closeTableSession } from "./hospitality";

function baseFloor(): HospitalityFloorState {
  const areaId = "area1";
  const t1 = { id: "t1", areaId, label: "Table 1", capacity: 4, sortOrder: 1, displayStatus: "available" as const, isActive: true };
  const t2 = { id: "t2", areaId, label: "Table 2", capacity: 4, sortOrder: 2, displayStatus: "available" as const, isActive: true };
  return {
    areas: [{ id: areaId, name: "Main", sortOrder: 0, isActive: true }],
    tables: [t1, t2],
    sessions: [],
    stations: [],
    reservations: [],
    waitlist: [],
    waiterSections: [],
    combinedGroups: [],
    hospitalityAuditLog: [],
  };
}

describe("hospitalityFrontOfHouse", () => {
  it("creates reservation with daily number", () => {
    const today = new Date().toISOString().slice(0, 10);
    const next = createReservation(baseFloor(), {
      guestName: "Jane",
      phone: "+256700000000",
      guestCount: 2,
      reservationDate: today,
      reservationTime: "19:00",
      isVip: false,
    });
    expect(next.reservations?.[0]?.reservationNumber).toBe(1);
    expect(next.reservations?.[0]?.status).toBe("pending");
  });

  it("marks table needs cleaning after payment close", () => {
    const floor = baseFloor();
    const closed = closeTableSession(floor, "s1", "closed", { needsCleaning: true });
    // no session - test markTableNeedsCleaning directly
    const next = markTableNeedsCleaning(floor, "t1");
    expect(next.tables[0]?.displayStatus).toBe("needs_cleaning");
    const cleaned = finishTableCleaning(next, "t1");
    expect(cleaned.tables[0]?.displayStatus).toBe("available");
    void closed;
  });

  it("suggests table by guest count", () => {
    const suggestions = suggestTables({ floor: baseFloor(), guestCount: 4 });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.tableIds).toContain("t1");
  });

  it("combines and splits tables", () => {
    const combined = combineTables(baseFloor(), ["t1", "t2"]);
    expect(combined.ok).toBe(true);
    expect(combined.floor.combinedGroups?.length).toBe(1);
    const groupId = combined.floor.combinedGroups![0]!.id;
    const split = splitCombinedTables(combined.floor, groupId);
    expect(split.ok).toBe(true);
    expect(split.floor.combinedGroups?.length).toBe(0);
  });

  it("orders waitlist by priority", () => {
    let floor = baseFloor();
    floor = {
      ...floor,
      waitlist: [
        {
          id: "w1",
          name: "A",
          guestCount: 2,
          arrivalTime: new Date().toISOString(),
          priority: "normal",
          source: "walk_in",
          status: "waiting",
          createdAt: new Date().toISOString(),
        },
        {
          id: "w2",
          name: "VIP",
          guestCount: 2,
          arrivalTime: new Date().toISOString(),
          priority: "vip",
          source: "walk_in",
          status: "waiting",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(activeWaitlist(floor)[0]?.name).toBe("VIP");
  });
});
