import { describe, expect, it } from "vitest";
import { buildRecorderFocusedInstallerSnapshot, buildVisionRecorders } from "./recorders";
import type { VisionCamera } from "./types";

const cam = (partial: Partial<VisionCamera> & { id: string }): VisionCamera =>
  ({
    shopScopeId: "s",
    name: "Cam",
    locationLabel: "Loc",
    zoneId: "checkout",
    profileId: "cashier",
    brand: "Hikvision",
    model: null,
    serial: null,
    ip: "10.0.0.1",
    onvifPort: null,
    onvifXAddr: null,
    onvifSupported: null,
    rtspUrlMain: "rtsp://x",
    rtspUrlSub: null,
    streamPreference: "main",
    credential: null,
    status: "online",
    recordingMode: "dvr",
    nvrHost: "192.168.1.50",
    nvrChannelId: "1",
    assignedPosLabel: null,
    branchLabel: "Main Shop",
    lastTestAt: null,
    lastSeenAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }) as VisionCamera;

describe("vision recorders (V1.4)", () => {
  it("groups cameras under DVR host", () => {
    const list = [
      cam({ id: "1", nvrChannelId: "1", name: "Entrance" }),
      cam({ id: "2", nvrChannelId: "2", name: "Cashier", status: "offline" }),
      cam({ id: "3", nvrHost: null, name: "IP Cam", recordingMode: "none" }),
    ];
    const recs = buildVisionRecorders(list, {
      "192.168.1.50": { displayName: "Main Shop DVR", capacityLabel: "1TB HDD" },
    });
    expect(recs).toHaveLength(2);
    expect(recs[0]?.name).toBe("Main Shop DVR");
    expect(recs[0]?.cameraCount).toBe(2);
    expect(recs[0]?.capacityLabel).toBe("1TB HDD");
    expect(recs[1]?.isStandalone).toBe(true);
  });

  it("builds recorder-focused installer snapshot", () => {
    const snap = buildRecorderFocusedInstallerSnapshot(
      [cam({ id: "1" }), cam({ id: "2", status: "offline" })],
      { available: true, version: "1.3.0", baseUrl: "http://127.0.0.1:39217", message: null },
      { "192.168.1.50": { displayName: "Main Shop DVR", capacityLabel: "1TB HDD" } },
    );
    expect(snap.connectedDvr).toBe("Main Shop DVR");
    expect(snap.cameraCount).toBe(2);
    expect(snap.offlineCameras).toBe(1);
    expect(snap.recording).toBe(true);
  });
});
