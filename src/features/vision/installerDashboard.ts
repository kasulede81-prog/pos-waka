import type { VisionCamera, VisionEdgeAgentInfo, VisionRecordingMode } from "./types";

export type VisionInstallerSnapshot = {
  connected: number;
  online: number;
  offline: number;
  warning: number;
  recorderLabel: string;
  storageType: VisionRecordingMode | "mixed" | "none";
  recordingStatus: "nvr_primary" | "mixed" | "none" | "unknown";
  networkStatus: "edge_online" | "edge_offline" | "degraded";
  nvrHostCount: number;
};

function dominantRecording(cameras: VisionCamera[]): VisionRecordingMode | "mixed" | "none" {
  if (cameras.length === 0) return "none";
  const counts = new Map<VisionRecordingMode, number>();
  for (const c of cameras) {
    counts.set(c.recordingMode, (counts.get(c.recordingMode) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return "none";
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return "mixed";
  return ranked[0][0];
}

/** Lightweight installer KPIs from registry + Edge Agent (no streaming). */
export function buildVisionInstallerSnapshot(
  cameras: VisionCamera[],
  agent: VisionEdgeAgentInfo | null,
): VisionInstallerSnapshot {
  const online = cameras.filter((c) => c.status === "online").length;
  const offline = cameras.filter((c) => c.status === "offline").length;
  const warning = cameras.filter((c) => c.status === "degraded").length;
  const nvrHosts = new Set(cameras.map((c) => c.nvrHost).filter(Boolean) as string[]);
  const storageType = dominantRecording(cameras);
  const recordingStatus =
    storageType === "nvr" || storageType === "dvr"
      ? "nvr_primary"
      : storageType === "none"
        ? "none"
        : storageType === "mixed"
          ? "mixed"
          : "unknown";

  let networkStatus: VisionInstallerSnapshot["networkStatus"] = "edge_offline";
  if (agent?.available) {
    networkStatus = agent.mediamtxAvailable === false ? "degraded" : "edge_online";
  }

  const recorderLabel =
    nvrHosts.size === 1
      ? ([...nvrHosts][0] as string)
      : nvrHosts.size > 1
        ? `${nvrHosts.size} recorders`
        : cameras.some((c) => c.recordingMode === "nvr" || c.recordingMode === "dvr")
          ? "DVR / NVR (local)"
          : "—";

  return {
    connected: cameras.length,
    online,
    offline,
    warning,
    recorderLabel,
    storageType,
    recordingStatus,
    networkStatus,
    nvrHostCount: nvrHosts.size,
  };
}
