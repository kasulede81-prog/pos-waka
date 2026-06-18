import { describe, expect, it } from "vitest";
import type { DayDrawerOpen } from "../types";
import {
  compareDayDrawerOpenWinner,
  resolveDayDrawerOpenConflicts,
} from "./dayDrawerOpenConflictResolution";

const DAY = "2026-06-11";

function row(partial: Partial<DayDrawerOpen> & Pick<DayDrawerOpen, "id">): DayDrawerOpen {
  return {
    dateKey: DAY,
    openingFloatUgx: 100_000,
    countedAt: "2026-06-11T06:00:00.000Z",
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "d1",
    status: "open",
    supersedesId: null,
    voidReason: null,
    createdAt: "2026-06-11T06:00:00.000Z",
    updatedAt: "2026-06-11T06:00:00.000Z",
    pendingSync: false,
    cloudSyncedAt: null,
    lastSyncError: null,
    deletedAt: null,
    ...partial,
  };
}

describe("dayDrawerOpenConflictResolution", () => {
  it("Scenario B — newer updated_at wins between two active opens", () => {
    const a = row({ id: "a", openingFloatUgx: 100_000, updatedAt: "2026-06-11T06:00:00.000Z", deviceId: "dev-a" });
    const b = row({
      id: "b",
      openingFloatUgx: 80_000,
      updatedAt: "2026-06-11T07:00:00.000Z",
      createdAt: "2026-06-11T07:00:00.000Z",
      deviceId: "dev-b",
    });
    expect(compareDayDrawerOpenWinner(a, b).id).toBe("b");
    const resolved = resolveDayDrawerOpenConflicts([a, b]);
    const active = resolved.filter((r) => r.status === "open");
    expect(active).toHaveLength(1);
    expect(active[0]?.openingFloatUgx).toBe(80_000);
  });

  it("voided never beats non-voided", () => {
    const open = row({ id: "open", status: "open", updatedAt: "2026-06-11T05:00:00.000Z" });
    const voided = row({
      id: "void",
      status: "voided",
      updatedAt: "2026-06-11T08:00:00.000Z",
    });
    expect(compareDayDrawerOpenWinner(open, voided).id).toBe("open");
  });

  it("lexicographical id tie-break", () => {
    const a = row({ id: "aaa", updatedAt: "2026-06-11T06:00:00.000Z", createdAt: "2026-06-11T06:00:00.000Z" });
    const b = row({ id: "bbb", updatedAt: "2026-06-11T06:00:00.000Z", createdAt: "2026-06-11T06:00:00.000Z" });
    expect(compareDayDrawerOpenWinner(a, b).id).toBe("bbb");
  });
});
