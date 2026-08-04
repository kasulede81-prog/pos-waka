import type { VisionCamera, VisionEdgeAgentInfo } from "./types";
import { resolveVisionCardHealth } from "./cameraHealth";

export type VisionRecorderHealth = "healthy" | "warning" | "offline" | "unknown";

export type VisionRecorderMeta = {
  displayName?: string | null;
  brand?: string | null;
  model?: string | null;
  firmware?: string | null;
  /** e.g. "1TB", "4TB" — informational */
  capacityLabel?: string | null;
  hddStatus?: "ok" | "low" | "full" | "unknown" | null;
};

export type VisionRecorderView = {
  id: string;
  host: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  firmware: string | null;
  capacityLabel: string;
  hddStatus: "ok" | "low" | "full" | "unknown";
  health: VisionRecorderHealth;
  recordingActive: boolean;
  cameraCount: number;
  onlineCount: number;
  offlineCount: number;
  warningCount: number;
  lastSeenAt: string | null;
  cameras: VisionCamera[];
  isStandalone: boolean;
};

export type VisionRecorderMetaMap = Record<string, VisionRecorderMeta>;

/** Group registry cameras under DVR/NVR hosts — no registry schema change. */
export function buildVisionRecorders(
  cameras: VisionCamera[],
  meta: VisionRecorderMetaMap = {},
): VisionRecorderView[] {
  const byHost = new Map<string, VisionCamera[]>();
  const standalone: VisionCamera[] = [];

  for (const cam of cameras) {
    const host = cam.nvrHost?.trim();
    if (host) {
      const list = byHost.get(host) ?? [];
      list.push(cam);
      byHost.set(host, list);
    } else {
      standalone.push(cam);
    }
  }

  const recorders: VisionRecorderView[] = [];

  for (const [host, cams] of byHost) {
    recorders.push(toRecorderView(host, cams, meta[host] ?? {}, false));
  }

  if (standalone.length > 0) {
    recorders.push(toRecorderView(null, standalone, meta["__standalone__"] ?? {}, true));
  }

  return recorders.sort((a, b) => {
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function toRecorderView(
  host: string | null,
  cams: VisionCamera[],
  overlay: VisionRecorderMeta,
  isStandalone: boolean,
): VisionRecorderView {
  let onlineCount = 0;
  let offlineCount = 0;
  let warningCount = 0;
  let lastSeenAt: string | null = null;

  for (const c of cams) {
    const h = resolveVisionCardHealth(c);
    if (h === "healthy" || c.status === "online") onlineCount += 1;
    else if (h === "offline" || c.status === "offline") offlineCount += 1;
    else warningCount += 1;
    const seen = c.lastSeenAt || c.lastTestAt;
    if (seen && (!lastSeenAt || seen > lastSeenAt)) lastSeenAt = seen;
  }

  let health: VisionRecorderHealth = "unknown";
  if (cams.length === 0) health = "unknown";
  else if (offlineCount === cams.length) health = "offline";
  else if (offlineCount > 0 || warningCount > 0) health = "warning";
  else if (onlineCount > 0) health = "healthy";

  const brand =
    overlay.brand ??
    cams.find((c) => c.brand)?.brand ??
    (isStandalone ? "IP / Direct" : "DVR");
  const model = overlay.model ?? cams.find((c) => c.model)?.model ?? null;
  const name =
    overlay.displayName?.trim() ||
    (isStandalone ? "Direct IP cameras" : `${brand} @ ${host}`);

  const recordingActive = cams.some(
    (c) => c.recordingMode === "dvr" || c.recordingMode === "nvr" || c.recordingMode === "hybrid",
  );

  return {
    id: host ?? "__standalone__",
    host,
    name,
    brand,
    model,
    firmware: overlay.firmware ?? null,
    capacityLabel: overlay.capacityLabel?.trim() || (isStandalone ? "—" : "On DVR HDD"),
    hddStatus: overlay.hddStatus ?? (isStandalone ? "unknown" : "ok"),
    health,
    recordingActive,
    cameraCount: cams.length,
    onlineCount,
    offlineCount,
    warningCount,
    lastSeenAt,
    cameras: cams,
    isStandalone,
  };
}

export function buildRecorderFocusedInstallerSnapshot(
  cameras: VisionCamera[],
  agent: VisionEdgeAgentInfo | null,
  meta: VisionRecorderMetaMap = {},
) {
  const recorders = buildVisionRecorders(cameras, meta).filter((r) => !r.isStandalone);
  const primary = recorders[0] ?? null;
  const offlineCameras = cameras.filter((c) => c.status === "offline").length;

  let networkStatus: "edge_online" | "edge_offline" | "degraded" = "edge_offline";
  if (agent?.available) {
    networkStatus = agent.mediamtxAvailable === false ? "degraded" : "edge_online";
  }

  return {
    connectedDvr: primary?.name ?? (recorders.length ? `${recorders.length} DVRs` : "—"),
    recorderHealth: primary?.health ?? (recorders.length === 0 ? ("none" as const) : "unknown"),
    storageLabel: primary?.capacityLabel ?? "—",
    cameraCount: cameras.length,
    offlineCameras,
    networkStatus,
    recording: primary?.recordingActive ?? cameras.some((c) => c.recordingMode === "dvr" || c.recordingMode === "nvr"),
    recorderCount: recorders.length,
  };
}

export function recorderHealthLabelKey(health: VisionRecorderHealth | "none"): string {
  switch (health) {
    case "healthy":
      return "visionHealthHealthy";
    case "warning":
      return "visionHealthWarning";
    case "offline":
      return "visionHealthOffline";
    case "none":
      return "visionRecNoRecorder";
    default:
      return "visionHealthUnknown";
  }
}
