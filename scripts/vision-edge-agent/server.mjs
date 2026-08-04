#!/usr/bin/env node
/**
 * WAKA Vision Edge Agent (V1.1 discovery + V1.2 streaming + V1.3 NVR vendors)
 * LAN ONVIF WS-Discovery + camera test + NVR helpers + MediaMTX stream sessions.
 * Bind: 127.0.0.1 only. POS talks here — never ONVIF/RTSP from the browser.
 *
 * Usage:
 *   npm run vision:edge
 *   npm run vision:mediamtx   # optional, for real RTSP→WebRTC/HLS
 */

import dgram from "node:dgram";
import http from "node:http";
import { Buffer } from "node:buffer";
import {
  closeStreamSession,
  getMediaMtxStatus,
  getStreamSession,
  listSessions,
  openStreamSession,
  refreshStreamHealth,
} from "./streamManager.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.VISION_EDGE_PORT || 39217);
const VERSION = "1.3.0";
const MULTICAST = "239.255.255.250";
const WS_PORT = 3702;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function buildProbe() {
  const uuid = crypto.randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${uuid}</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
}

function parseProbeMatch(xml) {
  const xaddrs = [...xml.matchAll(/<[^>]*XAddrs[^>]*>([^<]+)</gi)].map((m) => m[1].trim());
  const scopesRaw = [...xml.matchAll(/<[^>]*Scopes[^>]*>([^<]+)</gi)].map((m) => m[1].trim());
  const scopes = scopesRaw.flatMap((s) => s.split(/\s+/).filter(Boolean));
  const xAddr = xaddrs[0]?.split(/\s+/)[0] ?? null;
  let ip = null;
  if (xAddr) {
    try {
      ip = new URL(xAddr).hostname;
    } catch {
      ip = null;
    }
  }
  if (!ip) {
    const ipMatch = xml.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    ip = ipMatch?.[1] ?? null;
  }
  if (!ip) return null;

  const nameScope = scopes.find((s) => /\/name\//i.test(s));
  const hwScope = scopes.find((s) => /\/hardware\//i.test(s));
  const name = nameScope ? decodeURIComponent(nameScope.split("/").pop() || "") : null;
  const model = hwScope ? decodeURIComponent(hwScope.split("/").pop() || "") : null;
  let brand = null;
  const joined = scopes.join(" ").toLowerCase();
  if (joined.includes("hikvision")) brand = "Hikvision";
  else if (joined.includes("dahua")) brand = "Dahua";
  else if (joined.includes("axis")) brand = "Axis";
  else if (joined.includes("uniview") || joined.includes("unv")) brand = "Uniview";
  else if (joined.includes("reolink")) brand = "Reolink";
  else if (joined.includes("vigi") || joined.includes("tp-link")) brand = "TP-Link VIGI";

  return {
    discoveryId: `onvif:${ip}:${xAddr ?? ""}`,
    name: name || `Camera ${ip}`,
    ip,
    onvifXAddr: xAddr,
    brand,
    model,
    scopes,
    rtspHint: `rtsp://${ip}:554/`,
    source: "onvif_probe",
  };
}

async function discoverOnvif(timeoutMs = 5000) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const found = new Map();
  const probe = Buffer.from(buildProbe(), "utf8");

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch {
        /* ignore */
      }
      resolve();
    });
  });

  socket.on("message", (msg) => {
    const xml = msg.toString("utf8");
    if (!/ProbeMatch/i.test(xml)) return;
    const cam = parseProbeMatch(xml);
    if (cam) found.set(cam.ip, cam);
  });

  socket.send(probe, 0, probe.length, WS_PORT, MULTICAST);
  // Some stacks also answer unicast probes on the same port after multicast Hello — second send helps noisy LANs.
  setTimeout(() => {
    try {
      socket.send(probe, 0, probe.length, WS_PORT, MULTICAST);
    } catch {
      /* ignore */
    }
  }, 400);

  await new Promise((r) => setTimeout(r, timeoutMs));
  socket.close();
  return [...found.values()];
}

async function tcpProbe(host, port, timeoutMs = 2000) {
  const net = await import("node:net");
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      const latencyMs = Date.now() - started;
      socket.destroy();
      resolve({ ok: true, latencyMs });
    });
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, latencyMs: null });
    });
    socket.on("error", () => resolve({ ok: false, latencyMs: null }));
  });
}

async function testCamera(body) {
  const testedAt = new Date().toISOString();
  let host = null;
  let rtspPort = 554;
  try {
    const u = new URL(body.rtspUrl);
    host = u.hostname;
    rtspPort = u.port ? Number(u.port) : 554;
  } catch {
    return {
      cameraId: null,
      testedAt,
      online: false,
      resolution: null,
      fps: null,
      latencyMs: null,
      signal: "unknown",
      recordingDetected: null,
      onvifSupported: null,
      rtspWorking: false,
      snapshotWorking: null,
      message: "Invalid RTSP URL",
      viaEdgeAgent: true,
    };
  }

  const rtsp = await tcpProbe(host, rtspPort, 2500);
  let onvifSupported = null;
  let snapshotWorking = null;
  let latencyMs = rtsp.latencyMs;

  if (body.onvifXAddr) {
    try {
      const started = Date.now();
      const ctrl = AbortSignal.timeout(4000);
      const res = await fetch(body.onvifXAddr, { method: "GET", signal: ctrl });
      onvifSupported = res.status > 0;
      latencyMs = latencyMs ?? Date.now() - started;
      // Many devices reject GET without SOAP; any HTTP response proves reachability.
      snapshotWorking = null;
    } catch {
      onvifSupported = false;
    }
  }

  const online = Boolean(rtsp.ok || onvifSupported);
  return {
    cameraId: null,
    testedAt,
    online,
    resolution: online ? "Unknown (connect stream in V1.2)" : null,
    fps: null,
    latencyMs,
    signal: !online ? "poor" : (latencyMs ?? 999) < 80 ? "good" : (latencyMs ?? 999) < 200 ? "fair" : "poor",
    recordingDetected: null,
    onvifSupported,
    rtspWorking: rtsp.ok,
    snapshotWorking,
    message: online
      ? "Reachable from Edge Agent (TCP/ONVIF). Full codec probe lands in V1.2 Live View."
      : "Camera did not accept RTSP/ONVIF probe from this machine.",
    viaEdgeAgent: true,
  };
}

function brandForNvrVendor(vendor) {
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

function rtspForNvrVendor(vendor, host, channel) {
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

function demoNvrChannels(vendor, host) {
  const brand = brandForNvrVendor(vendor);
  return [1, 2, 3, 4].map((n) => ({
    channelId: String(n),
    name: `${brand} CH${n}`,
    ip: host,
    rtspUrl: rtspForNvrVendor(vendor, host, n),
    brand,
    model: "NVR",
  }));
}

async function nvrChannels(body) {
  const host = String(body.host || "").trim();
  const vendor = body.vendor || "hikvision";
  if (!host) throw new Error("host required");
  // V1.1: connectivity probe + deterministic channel template.
  // Vendor ISAPI/CGI parsers expand in a later patch without changing this API.
  const port = Number(body.port || (vendor === "hikvision" ? 80 : 80));
  const probe = await tcpProbe(host, port, 2500);
  const channels = demoNvrChannels(vendor, host);
  if (!probe.ok) {
    return { channels, warning: "NVR host TCP probe failed; returning channel template for manual verify." };
  }
  return { channels };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/v1/health") {
      const mediamtx = await getMediaMtxStatus();
      json(res, 200, {
        ok: true,
        version: VERSION,
        service: "waka-vision-edge",
        streaming: true,
        mediamtx,
        sessions: listSessions().length,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/stream/open") {
      const body = await readBody(req);
      const opened = await openStreamSession(body);
      if (!opened.ok) {
        json(res, 400, { error: opened.error });
        return;
      }
      json(res, 200, opened);
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/v1/stream/") && url.pathname.endsWith("/close")) {
      const sessionId = url.pathname.split("/")[3];
      json(res, 200, { ok: closeStreamSession(sessionId) });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/stream/") && url.pathname.endsWith("/health")) {
      const sessionId = url.pathname.split("/")[3];
      const health = await refreshStreamHealth(sessionId);
      if (!health) {
        json(res, 404, { error: "session_not_found" });
        return;
      }
      json(res, 200, health);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/stream/") && url.pathname.split("/").length === 4) {
      const sessionId = url.pathname.split("/")[3];
      const session = getStreamSession(sessionId);
      if (!session) {
        json(res, 404, { error: "session_not_found" });
        return;
      }
      json(res, 200, session);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/discover/onvif") {
      const body = await readBody(req);
      const timeoutMs = Math.min(15_000, Math.max(1_000, Number(body.timeoutMs) || 5000));
      const cameras = await discoverOnvif(timeoutMs);
      json(res, 200, { cameras });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/test/camera") {
      const body = await readBody(req);
      json(res, 200, await testCamera(body));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/nvr/channels") {
      const body = await readBody(req);
      json(res, 200, await nvrChannels(body));
      return;
    }
    json(res, 404, { error: "not_found" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : "error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[waka-vision-edge] v${VERSION} listening on http://${HOST}:${PORT}`);
  console.log(
    "[waka-vision-edge] Endpoints: /v1/health /v1/discover/onvif /v1/test/camera /v1/nvr/channels /v1/stream/*",
  );
  console.log("[waka-vision-edge] For real live RTSP: npm run vision:mediamtx (MediaMTX on :8888/:8889/:9997)");
});
