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
});
