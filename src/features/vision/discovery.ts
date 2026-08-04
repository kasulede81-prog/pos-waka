import { edgeScanOnvif, getVisionEdgeAgentInfo } from "./edgeClient";
import type { VisionDiscoveredCandidate, VisionEdgeAgentInfo } from "./types";

/** Demo candidates when Edge Agent is unavailable — UI/flow certification only. */
export function buildDemoDiscoveryCandidates(): VisionDiscoveredCandidate[] {
  return [
    {
      discoveryId: "demo-hik-1",
      name: "DS-2CD2143",
      ip: "192.168.1.64",
      onvifXAddr: "http://192.168.1.64/onvif/device_service",
      brand: "Hikvision",
      model: "DS-2CD2143",
      scopes: ["onvif://www.onvif.org/Profile/Streaming"],
      rtspHint: "rtsp://192.168.1.64:554/Streaming/Channels/101",
      source: "demo",
    },
    {
      discoveryId: "demo-dahua-1",
      name: "IPC-HFW1431S",
      ip: "192.168.1.108",
      onvifXAddr: "http://192.168.1.108/onvif/device_service",
      brand: "Dahua",
      model: "IPC-HFW1431S",
      scopes: ["onvif://www.onvif.org/Profile/Streaming"],
      rtspHint: "rtsp://192.168.1.108:554/cam/realmonitor?channel=1&subtype=0",
      source: "demo",
    },
    {
      discoveryId: "demo-axis-1",
      name: "Axis M3046",
      ip: "192.168.1.90",
      onvifXAddr: "http://192.168.1.90/onvif/device_service",
      brand: "Axis",
      model: "M3046-V",
      scopes: ["onvif://www.onvif.org/Profile/T"],
      rtspHint: "rtsp://192.168.1.90:554/axis-media/media.amp",
      source: "demo",
    },
    {
      discoveryId: "demo-reolink-1",
      name: "Reolink RLC-520A",
      ip: "192.168.1.120",
      onvifXAddr: null,
      brand: "Reolink",
      model: "RLC-520A",
      scopes: [],
      rtspHint: "rtsp://192.168.1.120:554/h264Preview_01_main",
      source: "demo",
    },
    {
      discoveryId: "demo-vigi-1",
      name: "VIGI C440",
      ip: "192.168.1.77",
      onvifXAddr: "http://192.168.1.77:2020/onvif/device_service",
      brand: "TP-Link VIGI",
      model: "C440",
      scopes: ["onvif://www.onvif.org/Profile/Streaming"],
      rtspHint: "rtsp://192.168.1.77:554/stream1",
      source: "demo",
    },
    {
      discoveryId: "demo-generic-1",
      name: "ONVIF Camera",
      ip: "192.168.1.200",
      onvifXAddr: "http://192.168.1.200:80/onvif/device_service",
      brand: "Generic ONVIF",
      model: null,
      scopes: ["onvif://www.onvif.org/Profile/S"],
      rtspHint: "rtsp://192.168.1.200:554/stream1",
      source: "demo",
    },
  ];
}

export type VisionScanResult = {
  agent: VisionEdgeAgentInfo;
  cameras: VisionDiscoveredCandidate[];
  usedDemoFallback: boolean;
};

/**
 * Scan LAN via Edge Agent. If agent missing, returns demo candidates for UI flow
 * (clearly marked) so technicians can still practice the add wizard offline.
 */
export async function scanVisionNetwork(opts?: {
  allowDemoFallback?: boolean;
}): Promise<VisionScanResult> {
  const allowDemo = opts?.allowDemoFallback !== false;
  const agent = await getVisionEdgeAgentInfo();
  if (agent.available) {
    const scan = await edgeScanOnvif();
    if (scan.ok) {
      return { agent, cameras: scan.cameras, usedDemoFallback: false };
    }
    if (allowDemo) {
      return {
        agent: { ...agent, available: false, message: scan.error },
        cameras: buildDemoDiscoveryCandidates(),
        usedDemoFallback: true,
      };
    }
    return { agent: { ...agent, message: scan.error }, cameras: [], usedDemoFallback: false };
  }
  if (allowDemo) {
    return { agent, cameras: buildDemoDiscoveryCandidates(), usedDemoFallback: true };
  }
  return { agent, cameras: [], usedDemoFallback: false };
}
