import { edgeImportNvr, getVisionEdgeAgentInfo } from "./edgeClient";
import type { VisionDiscoveredCandidate, VisionNvrImportChannel } from "./types";

export type VisionNvrVendor =
  | "hikvision"
  | "dahua"
  | "uniview"
  | "tplink_vigi"
  | "reolink"
  | "generic_onvif";

export const VISION_NVR_VENDORS: Array<{ id: VisionNvrVendor; label: string }> = [
  { id: "hikvision", label: "Hikvision DVR / NVR" },
  { id: "dahua", label: "Dahua DVR / NVR" },
  { id: "uniview", label: "Uniview DVR / NVR" },
  { id: "tplink_vigi", label: "TP-Link VIGI NVR" },
  { id: "reolink", label: "Reolink NVR / DVR" },
  { id: "generic_onvif", label: "Generic ONVIF recorder" },
];

function brandForVendor(vendor: VisionNvrVendor): string {
  switch (vendor) {
    case "hikvision":
      return "Hikvision";
    case "dahua":
      return "Dahua";
    case "uniview":
      return "Uniview";
    case "tplink_vigi":
      return "TP-Link VIGI";
    case "reolink":
      return "Reolink";
    default:
      return "ONVIF NVR";
  }
}

/** Deterministic RTSP channel templates — Edge Agent uses the same patterns. */
export function buildNvrChannelRtsp(vendor: VisionNvrVendor, host: string, channel: number): string {
  switch (vendor) {
    case "hikvision":
      return `rtsp://${host}:554/Streaming/Channels/${channel}01`;
    case "dahua":
      return `rtsp://${host}:554/cam/realmonitor?channel=${channel}&subtype=0`;
    case "uniview":
      return `rtsp://${host}:554/unicast/c${channel}/s0/live`;
    case "tplink_vigi":
      return `rtsp://${host}:554/stream${channel}`;
    case "reolink":
      return `rtsp://${host}:554/h264Preview_0${channel}_main`;
    default:
      return `rtsp://${host}:554/ch${channel}`;
  }
}

export function nvrChannelsToCandidates(
  channels: VisionNvrImportChannel[],
  vendor: VisionNvrVendor,
  nvrHost?: string,
): VisionDiscoveredCandidate[] {
  const brand = brandForVendor(vendor);
  return channels.map((ch) => ({
    discoveryId: `nvr:${vendor}:${ch.channelId}`,
    name: ch.name,
    ip: ch.ip ?? nvrHost ?? "0.0.0.0",
    onvifXAddr: null,
    brand: ch.brand ?? brand,
    model: ch.model,
    scopes: [],
    rtspHint: ch.rtspUrl,
    source: "nvr_import" as const,
  }));
}

/** Demo NVR channel list when Edge Agent is offline. */
export function buildDemoNvrChannels(vendor: VisionNvrVendor, host = "192.168.1.50"): VisionNvrImportChannel[] {
  const brand = brandForVendor(vendor);
  return [1, 2, 3, 4].map((n) => ({
    channelId: String(n),
    name: `${brand} Channel ${n}`,
    ip: host,
    rtspUrl: buildNvrChannelRtsp(vendor, host, n),
    brand,
    model: "NVR",
  }));
}

export async function importNvrChannels(input: {
  vendor: VisionNvrVendor;
  host: string;
  port?: number;
  username: string;
  password: string;
  allowDemoFallback?: boolean;
}): Promise<
  | { ok: true; channels: VisionNvrImportChannel[]; usedDemoFallback: boolean }
  | { ok: false; error: string }
> {
  const agent = await getVisionEdgeAgentInfo();
  if (agent.available) {
    const r = await edgeImportNvr(input);
    if (r.ok) return { ok: true, channels: r.channels, usedDemoFallback: false };
    if (input.allowDemoFallback !== false) {
      return { ok: true, channels: buildDemoNvrChannels(input.vendor, input.host.trim()), usedDemoFallback: true };
    }
    return { ok: false, error: r.error };
  }
  if (input.allowDemoFallback !== false) {
    return { ok: true, channels: buildDemoNvrChannels(input.vendor, input.host.trim()), usedDemoFallback: true };
  }
  return { ok: false, error: "Vision Edge Agent is required for live NVR import." };
}
