import { describe, expect, it } from "vitest";
import { resolveVisionCardHealth } from "./cameraHealth";
import type { VisionCamera, VisionCameraTestResult } from "./types";

const base = {
  id: "c1",
  shopScopeId: "s1",
  name: "Cam",
  locationLabel: "Front",
  zoneId: "entrance" as const,
  profileId: "entrance" as const,
  brand: null,
  model: null,
  serial: null,
  ip: "1.1.1.1",
  onvifPort: null,
  onvifXAddr: null,
  onvifSupported: true,
  rtspUrlMain: "rtsp://x",
  rtspUrlSub: null,
  streamPreference: "main" as const,
  credential: null,
  recordingMode: "nvr" as const,
  nvrHost: null,
  nvrChannelId: null,
  assignedPosLabel: null,
  lastTestAt: null,
  lastSeenAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("resolveVisionCardHealth", () => {
  it("maps online status to healthy", () => {
    expect(resolveVisionCardHealth({ ...base, status: "online" } as VisionCamera)).toBe("healthy");
  });

  it("prefers last test result", () => {
    const test: VisionCameraTestResult = {
      cameraId: "c1",
      testedAt: "2026-01-01T00:00:00.000Z",
      online: false,
      resolution: null,
      fps: null,
      latencyMs: null,
      signal: "unknown",
      recordingDetected: null,
      onvifSupported: null,
      rtspWorking: false,
      snapshotWorking: null,
      message: null,
      viaEdgeAgent: true,
    };
    expect(resolveVisionCardHealth({ ...base, status: "online" } as VisionCamera, test)).toBe("offline");
  });
});
