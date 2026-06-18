import { describe, expect, it } from "vitest";
import type { DayDrawerOpen } from "../types";
import { parseDayDrawerOpenRows, mergeDayDrawerOpensFromCloudPull } from "./dayDrawerOpenRecovery";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";

const DAY = "2026-06-11";

function localRow(partial: Partial<DayDrawerOpen> & Pick<DayDrawerOpen, "id">): DayDrawerOpen {
  return {
    dateKey: DAY,
    openingFloatUgx: 100_000,
    countedAt: "2026-06-11T06:00:00.000Z",
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId: "dev-a",
    status: "open",
    supersedesId: null,
    voidReason: null,
    createdAt: "2026-06-11T06:00:00.000Z",
    updatedAt: "2026-06-11T06:00:00.000Z",
    pendingSync: true,
    cloudSyncedAt: null,
    lastSyncError: null,
    deletedAt: null,
    ...partial,
  };
}

describe("dayDrawerOpenRecovery", () => {
  it("parses cloud RPC rows", () => {
    const parsed = parseDayDrawerOpenRows([
      {
        id: "x1",
        date_key: DAY,
        opening_float_ugx: 100_000,
        status: "open",
        created_at: "2026-06-11T06:00:00.000Z",
        updated_at: "2026-06-11T06:00:00.000Z",
        created_by: "owner",
      },
    ]);
    expect(parsed[0]?.openingFloatUgx).toBe(100_000);
    expect(parsed[0]?.pendingSync).toBe(false);
  });

  it("Scenario A — device B pull matches device A open", async () => {
    const local: DayDrawerOpen[] = [];
    const cloud = parseDayDrawerOpenRows([
      {
        id: "cloud-1",
        date_key: DAY,
        opening_float_ugx: 100_000,
        status: "open",
        created_at: "2026-06-11T06:00:00.000Z",
        updated_at: "2026-06-11T06:00:00.000Z",
        created_by: "owner",
        device_id: "dev-a",
      },
    ]);
    const merged = await mergeDayDrawerOpensFromCloudPull(local, cloud);
    expect(activeDayDrawerOpenForDate(merged, DAY)?.openingFloatUgx).toBe(100_000);
  });

  it("never resurrects voided local row", async () => {
    const local = [
      localRow({
        id: "v1",
        status: "voided",
        voidReason: "mistake",
        updatedAt: "2026-06-11T06:00:00.000Z",
      }),
    ];
    const cloud = parseDayDrawerOpenRows([
      {
        id: "v1",
        date_key: DAY,
        opening_float_ugx: 100_000,
        status: "open",
        created_at: "2026-06-11T06:00:00.000Z",
        updated_at: "2026-06-11T08:00:00.000Z",
        created_by: "owner",
      },
    ]);
    const merged = await mergeDayDrawerOpensFromCloudPull(local, cloud);
    expect(merged.find((r) => r.id === "v1")?.status).toBe("voided");
  });
});
