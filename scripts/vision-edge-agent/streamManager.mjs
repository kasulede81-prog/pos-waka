/**
 * Vision Edge Agent — stream session manager (V1.2).
 * Registers RTSP sources with MediaMTX; browser receives only WHEP/HLS URLs (no credentials).
 */

const MEDIAMTX_API = (process.env.VISION_MEDIAMTX_API || "http://127.0.0.1:9997").replace(/\/$/, "");
const MEDIAMTX_WEBRTC = (process.env.VISION_MEDIAMTX_WEBRTC || "http://127.0.0.1:8889").replace(/\/$/, "");
const MEDIAMTX_HLS = (process.env.VISION_MEDIAMTX_HLS || "http://127.0.0.1:8888").replace(/\/$/, "");

/** @type {Map<string, any>} */
const sessions = new Map();

function pathNameFor(cameraId) {
  const safe = String(cameraId || "cam").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `waka_${safe}`;
}

function injectCredentials(rtspUrl, username, password) {
  try {
    const u = new URL(rtspUrl);
    if (username) u.username = username;
    if (password != null && password !== "") u.password = password;
    return u.toString();
  } catch {
    return rtspUrl;
  }
}

async function mediamtxFetch(path, init) {
  const res = await fetch(`${MEDIAMTX_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export async function getMediaMtxStatus() {
  try {
    const r = await mediamtxFetch("/v3/config/global/get", { method: "GET" });
    if (!r.ok) return { available: false, message: `MediaMTX API HTTP ${r.status}` };
    return { available: true, message: null, api: MEDIAMTX_API, webrtc: MEDIAMTX_WEBRTC, hls: MEDIAMTX_HLS };
  } catch (e) {
    return {
      available: false,
      message: e instanceof Error ? e.message : "MediaMTX unreachable",
      api: MEDIAMTX_API,
      webrtc: MEDIAMTX_WEBRTC,
      hls: MEDIAMTX_HLS,
    };
  }
}

async function ensurePath(pathName, sourceUrl) {
  const payload = {
    name: pathName,
    source: sourceUrl,
    sourceOnDemand: true,
    sourceOnDemandStartTimeout: "15s",
    sourceOnDemandCloseAfter: "30s",
  };

  // Prefer patch/add; MediaMTX v1.x uses /v3/config/paths/add/{name}
  let r = await mediamtxFetch(`/v3/config/paths/add/${encodeURIComponent(pathName)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (r.ok || r.status === 409) return { ok: true };
  // Some versions use PATCH replace
  r = await mediamtxFetch(`/v3/config/paths/patch/${encodeURIComponent(pathName)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (r.ok) return { ok: true };
  r = await mediamtxFetch(`/v3/config/paths/replace/${encodeURIComponent(pathName)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (r.ok) return { ok: true };
  return { ok: false, error: r.data?.error || `MediaMTX path register failed (${r.status})` };
}

function demoSession(body) {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = {
    sessionId,
    cameraId: body.cameraId ?? null,
    mode: "demo",
    pathName: null,
    createdAt: now,
    lastHealthAt: now,
    health: {
      status: "healthy",
      latencyMs: 40 + Math.floor(Math.random() * 30),
      resolution: "1920×1080",
      fps: 25,
      codec: "H.264 (demo)",
      recordingSource: body.recordingMode || "nvr",
      lastSeenAt: now,
      message: "Demo live tile — start MediaMTX for real RTSP→WebRTC.",
    },
    playback: {
      webrtcUrl: null,
      hlsUrl: null,
      preferred: "demo",
    },
  };
  sessions.set(sessionId, session);
  return session;
}

export async function openStreamSession(body) {
  const mtx = await getMediaMtxStatus();
  const rtspUrl = String(body.rtspUrl || "").trim();
  if (!rtspUrl) {
    return { ok: false, error: "rtspUrl required" };
  }

  // Explicit demo / unreachable fake IPs from V1.1 demo discovery
  const forceDemo = body.forceDemo === true || /demo/i.test(String(body.cameraId || ""));
  if (forceDemo || !mtx.available) {
    const session = demoSession(body);
    return {
      ok: true,
      session: publicSession(session),
      mediamtx: mtx,
    };
  }

  const sourceUrl = injectCredentials(rtspUrl, body.username, body.password);
  const pathName = pathNameFor(body.cameraId || crypto.randomUUID());
  const ensured = await ensurePath(pathName, sourceUrl);
  if (!ensured.ok) {
    const session = demoSession(body);
    session.health.status = "warning";
    session.health.message = ensured.error;
    return { ok: true, session: publicSession(session), mediamtx: mtx };
  }

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = {
    sessionId,
    cameraId: body.cameraId ?? null,
    mode: "live",
    pathName,
    createdAt: now,
    lastHealthAt: now,
    health: {
      status: "healthy",
      latencyMs: null,
      resolution: null,
      fps: null,
      codec: "H.264/H.265",
      recordingSource: body.recordingMode || "unknown",
      lastSeenAt: now,
      message: "Stream registered with MediaMTX (on-demand).",
    },
    playback: {
      webrtcUrl: `${MEDIAMTX_WEBRTC}/${pathName}/whep`,
      hlsUrl: `${MEDIAMTX_HLS}/${pathName}/index.m3u8`,
      preferred: "webrtc",
    },
  };
  sessions.set(sessionId, session);
  return { ok: true, session: publicSession(session), mediamtx: mtx };
}

export function closeStreamSession(sessionId) {
  return sessions.delete(sessionId);
}

export function getStreamSession(sessionId) {
  const s = sessions.get(sessionId);
  return s ? publicSession(s) : null;
}

export async function refreshStreamHealth(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  const now = new Date().toISOString();
  s.lastHealthAt = now;
  s.health.lastSeenAt = now;

  if (s.mode === "demo") {
    s.health.latencyMs = 35 + Math.floor(Math.random() * 40);
    s.health.status = "healthy";
    return publicSession(s);
  }

  try {
    const r = await mediamtxFetch(`/v3/paths/get/${encodeURIComponent(s.pathName)}`, { method: "GET" });
    if (r.ok && r.data) {
      const ready = Boolean(r.data.ready ?? r.data.sourceReady ?? true);
      s.health.status = ready ? "healthy" : "warning";
      s.health.message = ready ? "MediaMTX path ready" : "Waiting for RTSP source";
      if (r.data.tracks && Array.isArray(r.data.tracks)) {
        const v = r.data.tracks.find((t) => /video/i.test(String(t.type || t.codec || "")));
        if (v?.codec) s.health.codec = String(v.codec);
      }
    } else {
      s.health.status = "warning";
      s.health.message = "Path health unavailable";
    }
  } catch {
    s.health.status = "offline";
    s.health.message = "MediaMTX health check failed";
  }
  return publicSession(s);
}

function publicSession(s) {
  return {
    sessionId: s.sessionId,
    cameraId: s.cameraId,
    mode: s.mode,
    createdAt: s.createdAt,
    health: s.health,
    playback: s.playback,
  };
}

export function listSessions() {
  return [...sessions.values()].map(publicSession);
}
