import { describe, expect, it } from "vitest";
import type { DayDrawerOpen } from "../types";
import { mergeDayDrawerOpensFromCloudPull } from "./dayDrawerOpenRecovery";
import { activeDayDrawerOpenForDate } from "./dayDrawerOpen";

const DAY = "2026-06-11";

function deviceOpen(
  id: string,
  amount: number,
  deviceId: string,
  updatedAt: string,
): DayDrawerOpen {
  return {
    id,
    dateKey: DAY,
    openingFloatUgx: amount,
    countedAt: updatedAt,
    countedByUserId: "owner",
    countedByLabel: "Owner",
    note: "",
    deviceId,
    status: "open",
    supersedesId: null,
    voidReason: null,
    createdAt: updatedAt,
    updatedAt,
    pendingSync: true,
    cloudSyncedAt: null,
    lastSyncError: null,
    deletedAt: null,
  };
}

describe("multiDeviceDayDrawerOpen", () => {
  it("Scenario B — conflict resolves to single active open", async () => {
    const deviceA = deviceOpen("a", 100_000, "dev-a", "2026-06-11T06:00:00.000Z");
    const deviceB = deviceOpen("b", 80_000, "dev-b", "2026-06-11T07:00:00.000Z");

    const mergedAB = await mergeDayDrawerOpensFromCloudPull([deviceA], [deviceB]);
    const active = activeDayDrawerOpenForDate(mergedAB, DAY);
    expect(active?.id).toBe("b");
    expect(active?.openingFloatUgx).toBe(80_000);
    expect(mergedAB.filter((r) => r.status === "open")).toHaveLength(1);
  });

  it("Scenario D — restore from cloud authority preserves opening float", async () => {
    const staleLocal = deviceOpen("local", 50_000, "lost-device", "2026-06-11T05:00:00.000Z");
    const cloudAuthority = deviceOpen("cloud", 100_000, "dev-a", "2026-06-11T06:00:00.000Z");

    const merged = await mergeDayDrawerOpensFromCloudPull([staleLocal], [cloudAuthority]);
    expect(activeDayDrawerOpenForDate(merged, DAY)?.openingFloatUgx).toBe(100_000);
  });
});
