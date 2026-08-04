export type ParsedRtspTarget = {
  ok: true;
  rtspUrl: string;
  host: string;
  port: number;
  path: string;
  username: string | null;
};

export type ParsedRtspError = { ok: false; errorKey: "visionRtspInvalidUrl" | "visionRtspInvalidHost" };

/** Normalize and validate an RTSP URL for manual camera add (V1.1 — no stream open). */
export function parseManualRtspUrl(raw: string): ParsedRtspTarget | ParsedRtspError {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, errorKey: "visionRtspInvalidUrl" };

  let candidate = trimmed;
  if (!/^rtsp:\/\//i.test(candidate) && !/^rtsps:\/\//i.test(candidate)) {
    candidate = `rtsp://${candidate.replace(/^\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, errorKey: "visionRtspInvalidUrl" };
  }

  if (url.protocol !== "rtsp:" && url.protocol !== "rtsps:") {
    return { ok: false, errorKey: "visionRtspInvalidUrl" };
  }
  if (!url.hostname) return { ok: false, errorKey: "visionRtspInvalidHost" };

  const port = url.port ? Number(url.port) : url.protocol === "rtsps:" ? 322 : 554;
  return {
    ok: true,
    rtspUrl: url.toString(),
    host: url.hostname,
    port: Number.isFinite(port) ? port : 554,
    path: url.pathname || "/",
    username: url.username || null,
  };
}

export function buildRtspUrl(input: {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
}): string {
  const host = input.host.trim();
  const port = input.port && input.port > 0 ? input.port : 554;
  const path = (input.path?.trim() || "/Streaming/Channels/101").replace(/^\/*/, "/");
  const user = input.username?.trim() ?? "";
  const pass = input.password ?? "";
  const auth =
    user.length > 0
      ? `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ""}@`
      : "";
  return `rtsp://${auth}${host}:${port}${path}`;
}
