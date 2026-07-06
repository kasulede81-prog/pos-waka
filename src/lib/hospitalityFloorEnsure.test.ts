import { describe, expect, it } from "vitest";
import { ensureHospitalityFloor, defaultHospitalityFloor, syncTableDisplayStatuses } from "./hospitality";

describe("ensureHospitalityFloor", () => {
  it("is idempotent after normalization", () => {
    const floor = defaultHospitalityFloor();
    const once = ensureHospitalityFloor(floor);
    const twice = ensureHospitalityFloor(once);
    expect(twice).toBe(once);
  });

  it("syncTableDisplayStatuses returns same reference when unchanged", () => {
    const floor = ensureHospitalityFloor(defaultHospitalityFloor());
    const again = syncTableDisplayStatuses(floor);
    expect(again).toBe(floor);
  });

  it("fills missing optional arrays once then stabilizes", () => {
    const base = defaultHospitalityFloor();
    const { reservations: _r, waitlist: _w, ...partial } = base;
    const missing = { ...partial } as typeof base;
    const once = ensureHospitalityFloor(missing);
    expect(once.reservations).toEqual([]);
    const twice = ensureHospitalityFloor(once);
    expect(twice).toBe(once);
  });

  it("repairs missing areas from tables without new random layout each call", () => {
    const base = defaultHospitalityFloor();
    const { areas: _areas, ...withoutAreas } = base;
    const once = ensureHospitalityFloor(withoutAreas as typeof base);
    const twice = ensureHospitalityFloor(once);
    expect(once.areas.length).toBeGreaterThan(0);
    expect(once.tables).toEqual(base.tables);
    expect(twice).toBe(once);
  });

  it("handles null areas without throwing and stabilizes", () => {
    const base = defaultHospitalityFloor();
    const corrupt = { ...base, areas: null as unknown as typeof base.areas };
    const once = ensureHospitalityFloor(corrupt);
    const twice = ensureHospitalityFloor(once);
    expect(once.areas?.length).toBeGreaterThan(0);
    expect(twice).toBe(once);
  });

  it("preserves sessions when layout is empty then stabilizes", () => {
    const session = defaultHospitalityFloor().sessions[0] ?? {
      id: "sess-1",
      sessionKind: "table" as const,
      tableId: "tbl-1",
      tabLabel: null,
      saleId: "sale-1",
      guestCount: 2,
      status: "open" as const,
      openedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingSync: false,
    };
    const empty = {
      areas: [],
      tables: [],
      sessions: [session],
      stations: [],
    } as ReturnType<typeof defaultHospitalityFloor>;
    const once = ensureHospitalityFloor(empty);
    const twice = ensureHospitalityFloor(once);
    expect(once.sessions).toHaveLength(1);
    expect(once.areas.length).toBeGreaterThan(0);
    expect(twice).toBe(once);
  });
});
