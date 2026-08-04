import { describe, expect, it } from "vitest";
import { groupCameras, groupIdForCamera } from "./cameraGroups";
import type { VisionCamera } from "../types";

describe("cameraGroups", () => {
  it("maps zones to retail and warehouse groups", () => {
    expect(
      groupIdForCamera({ zoneId: "entrance" } as VisionCamera),
    ).toBe("retail_entrance");
    expect(
      groupIdForCamera({ zoneId: "warehouse" } as VisionCamera),
    ).toBe("warehouse_storage");
    expect(groupIdForCamera({ zoneId: "safe" } as VisionCamera)).toBe("safe");
  });

  it("omits empty groups", () => {
    const rows = groupCameras([
      { zoneId: "kitchen", id: "1", name: "K1" } as VisionCamera,
      { zoneId: "kitchen", id: "2", name: "K2" } as VisionCamera,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.group.id).toBe("kitchen");
    expect(rows[0]?.cameras).toHaveLength(2);
  });
});
