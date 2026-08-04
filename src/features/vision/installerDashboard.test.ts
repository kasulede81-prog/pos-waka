import { describe, expect, it } from "vitest";
import { buildVisionInstallerSnapshot } from "./installerDashboard";
import type { VisionCamera } from "./types";

describe("buildVisionInstallerSnapshot", () => {
  it("counts health and prefers NVR recording", () => {
    const cameras = [
      { status: "online", recordingMode: "nvr", nvrHost: "192.168.1.50" },
      { status: "offline", recordingMode: "nvr", nvrHost: "192.168.1.50" },
      { status: "degraded", recordingMode: "nvr", nvrHost: "192.168.1.50" },
    ] as VisionCamera[];
    const snap = buildVisionInstallerSnapshot(cameras, {
      available: true,
      version: "1.3.0",
      baseUrl: "http://127.0.0.1:39217",
      message: null,
      mediamtxAvailable: true,
    });
    expect(snap.connected).toBe(3);
    expect(snap.online).toBe(1);
    expect(snap.offline).toBe(1);
    expect(snap.warning).toBe(1);
    expect(snap.recorderLabel).toBe("192.168.1.50");
    expect(snap.recordingStatus).toBe("nvr_primary");
    expect(snap.networkStatus).toBe("edge_online");
  });
});
