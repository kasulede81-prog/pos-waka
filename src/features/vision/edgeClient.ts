/**
 * Vision Edge Agent client — POS never speaks ONVIF/RTSP; only this client does (via agent).
 */

import type {
  VisionCameraTestResult,
  VisionDiscoveredCandidate,
  VisionEdgeAgentInfo,
  VisionNvrImportChannel,
  VisionStreamSession,
} from "./types";

export const VISION_EDGE_DEFAULT_BASE = "http://127.0.0.1:39217";

function edgeBase(): string {
  const fromEnv = (import.meta.env.VITE_VISION_EDGE_URL as string | undefined)?.trim();
  return fromEnv || VISION_EDGE_DEFAULT_BASE;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function edgeFetch<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const url = `${edgeBase().replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: timeoutSignal(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "edge_unreachable";
    return { ok: false, error: msg };
  }
}

export async function getVisionEdgeAgentInfo(): Promise<VisionEdgeAgentInfo> {
  const baseUrl = edgeBase();
  const r = await edgeFetch<{
    version?: string;
    ok?: boolean;
    mediamtx?: { available?: boolean; message?: string | null };
  }>("/v1/health");
  if (!r.ok) {
    return {
      available: false,
      version: null,
      baseUrl,
      message: "Vision Edge Agent is not running. Start it for LAN discovery, or use Manual RTSP.",
      mediamtxAvailable: false,
    };
  }
  return {
    available: true,
    version: r.data.version ?? "unknown",
    baseUrl,
    message: r.data.mediamtx?.available
      ? null
      : (r.data.mediamtx?.message ?? "MediaMTX not detected — Live View uses demo tiles until MediaMTX is running."),
    mediamtxAvailable: Boolean(r.data.mediamtx?.available),
  };
}

export async function edgeOpenStream(input: {
  cameraId: string;
  rtspUrl: string;
  username?: string;
  password?: string;
  recordingMode?: string;
  forceDemo?: boolean;
}): Promise<{ ok: true; session: VisionStreamSession } | { ok: false; error: string }> {
  const r = await edgeFetch<{ session: VisionStreamSession }>("/v1/stream/open", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, session: r.data.session };
}

export async function edgeCloseStream(sessionId: string): Promise<void> {
  await edgeFetch(`/v1/stream/${encodeURIComponent(sessionId)}/close`, { method: "POST" });
}

export async function edgeStreamHealth(
  sessionId: string,
): Promise<{ ok: true; session: VisionStreamSession } | { ok: false; error: string }> {
  const r = await edgeFetch<VisionStreamSession>(`/v1/stream/${encodeURIComponent(sessionId)}/health`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, session: r.data };
}

export async function edgeScanOnvif(timeoutMs = 5000): Promise<
  { ok: true; cameras: VisionDiscoveredCandidate[] } | { ok: false; error: string }
> {
  const r = await edgeFetch<{ cameras: VisionDiscoveredCandidate[] }>("/v1/discover/onvif", {
    method: "POST",
    body: JSON.stringify({ timeoutMs }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, cameras: Array.isArray(r.data.cameras) ? r.data.cameras : [] };
}

export async function edgeTestRtsp(input: {
  rtspUrl: string;
  username?: string;
  password?: string;
  onvifXAddr?: string | null;
}): Promise<{ ok: true; result: VisionCameraTestResult } | { ok: false; error: string }> {
  const r = await edgeFetch<VisionCameraTestResult>("/v1/test/camera", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, result: { ...r.data, viaEdgeAgent: true } };
}

export async function edgeImportNvr(input: {
  vendor: "hikvision" | "dahua" | "uniview" | "tplink_vigi" | "reolink" | "generic_onvif";
  host: string;
  port?: number;
  username: string;
  password: string;
}): Promise<{ ok: true; channels: VisionNvrImportChannel[] } | { ok: false; error: string }> {
  const r = await edgeFetch<{ channels: VisionNvrImportChannel[] }>("/v1/nvr/channels", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, channels: Array.isArray(r.data.channels) ? r.data.channels : [] };
}
