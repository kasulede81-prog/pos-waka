import { describe, expect, it } from "vitest";
import { filterVisionCameras, sortWithFavorites } from "./monitorSearch";
import type { VisionCamera } from "../types";

const cam = (partial: Partial<VisionCamera> & { id: string; name: string }): VisionCamera =>
  ({
    shopScopeId: "s",
    locationLabel: "Loc",
    zoneId: "checkout",
    profileId: "cashier",
    brand: "Hikvision",
    model: null,
    serial: null,
    ip: "10.0.0.1",
    onvifPort: null,
    onvifXAddr: null,
    onvifSupported: true,
    rtspUrlMain: "rtsp://x",
    rtspUrlSub: null,
    streamPreference: "main",
    credential: null,
    status: "online",
    recordingMode: "nvr",
    nvrHost: "192.168.1.50",
    nvrChannelId: "1",
    assignedPosLabel: "POS #2",
    branchLabel: "Branch A",
    lastTestAt: null,
    lastSeenAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }) as VisionCamera;

describe("monitorSearch", () => {
  it("filters by name zone brand branch pos recorder", () => {
    const list = [
      cam({ id: "1", name: "Cashier 1", zoneId: "checkout", brand: "Hikvision" }),
      cam({ id: "2", name: "Entrance", zoneId: "entrance", brand: "Dahua", nvrHost: "10.0.0.9" }),
    ];
    expect(filterVisionCameras(list, "cashier")).toHaveLength(1);
    expect(filterVisionCameras(list, "branch a")).toHaveLength(2);
    expect(filterVisionCameras(list, "10.0.0.9")).toHaveLength(1);
    expect(filterVisionCameras(list, "pos #2")).toHaveLength(2);
  });

  it("sorts favorites first", () => {
    const list = [cam({ id: "a", name: "Zebra" }), cam({ id: "b", name: "Alpha" })];
    expect(sortWithFavorites(list, ["a"]).map((c) => c.id)).toEqual(["a", "b"]);
  });
});
