import type { VisionCamera, VisionCameraTestResult } from "./types";

export type VisionCardHealth = "healthy" | "warning" | "offline" | "unknown";

/** Map registry status + last test into installer-friendly health. */
export function resolveVisionCardHealth(
  camera: VisionCamera,
  lastTest?: VisionCameraTestResult | null,
): VisionCardHealth {
  if (lastTest) {
    if (!lastTest.online) return "offline";
    if (lastTest.signal === "poor" || (lastTest.latencyMs != null && lastTest.latencyMs > 400)) {
      return "warning";
    }
    return "healthy";
  }
  switch (camera.status) {
    case "online":
      return "healthy";
    case "degraded":
      return "warning";
    case "offline":
      return "offline";
    default:
      return "unknown";
  }
}

export function visionCardHealthLabelKey(health: VisionCardHealth): string {
  switch (health) {
    case "healthy":
      return "visionHealthHealthy";
    case "warning":
      return "visionHealthWarning";
    case "offline":
      return "visionHealthOffline";
    default:
      return "visionHealthUnknown";
  }
}
