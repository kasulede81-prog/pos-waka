import type { VisionCamera, VisionEdgeAgentInfo } from "../types";
import { resolveVisionCardHealth } from "../cameraHealth";
import { buildVisionInstallerSnapshot } from "../installerDashboard";

export type VisionMonitorDashboard = {
  total: number;
  online: number;
  warning: number;
  offline: number;
  recording: number;
  lastEventLabel: string;
  activeRecorder: string;
  networkStatus: "edge_online" | "edge_offline" | "degraded";
};

/** Operator dashboard KPIs — Last Event reserved for V1.4 (uses lastSeen for now). */
export function buildVisionMonitorDashboard(
  cameras: VisionCamera[],
  agent: VisionEdgeAgentInfo | null,
): VisionMonitorDashboard {
  const installer = buildVisionInstallerSnapshot(cameras, agent);
  let warning = 0;
  let offline = 0;
  let online = 0;
  for (const c of cameras) {
    const h = resolveVisionCardHealth(c);
    if (h === "healthy") online += 1;
    else if (h === "warning") warning += 1;
    else if (h === "offline") offline += 1;
    else if (c.status === "online") online += 1;
    else if (c.status === "offline") offline += 1;
    else warning += 1;
  }

  const recording = cameras.filter(
    (c) => c.recordingMode === "nvr" || c.recordingMode === "dvr" || c.recordingMode === "hybrid",
  ).length;

  const lastSeen = cameras
    .map((c) => c.lastSeenAt || c.lastTestAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    total: cameras.length,
    online,
    warning,
    offline,
    recording,
    lastEventLabel: lastSeen ? new Date(lastSeen).toLocaleString() : "—",
    activeRecorder: installer.recorderLabel,
    networkStatus: installer.networkStatus,
  };
}
