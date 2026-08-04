import { useCallback, useEffect, useRef, useState } from "react";
import type { VisionCamera, VisionLiveHealthStatus, VisionStreamSession } from "../types";
import { edgeCloseStream, edgeOpenStream, edgeStreamHealth } from "../edgeClient";
import { vaultGetSecret } from "../credentialVault";
import { startWhepPlayback, type WhepHandle } from "./whepPlayer";
import { startHlsPlayback, type HlsHandle } from "./hlsPlayer";

export type VisionTileConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "error" | "demo";

type Opts = {
  shopScopeId: string;
  camera: VisionCamera;
  active: boolean;
  preferSubstream: boolean;
  muted: boolean;
};

export function useVisionLiveTile({ shopScopeId, camera, active, preferSubstream, muted }: Opts) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<string | null>(null);
  const retryRef = useRef(0);
  const [connection, setConnection] = useState<VisionTileConnectionState>("idle");
  const [session, setSession] = useState<VisionStreamSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    const sid = sessionRef.current;
    sessionRef.current = null;
    if (sid) void edgeCloseStream(sid);
  }, []);

  const attachPlayback = useCallback(
    async (s: VisionStreamSession) => {
      const video = videoRef.current;
      if (!video) return;
      stopRef.current?.();
      stopRef.current = null;

      if (s.mode === "demo" || s.playback.preferred === "demo") {
        setConnection("demo");
        return;
      }

      const tryWhep = async () => {
        if (!s.playback.webrtcUrl) throw new Error("No WebRTC URL");
        const handle: WhepHandle = await startWhepPlayback(s.playback.webrtcUrl, video, { muted });
        stopRef.current = handle.stop;
        setConnection("live");
      };

      const tryHls = async () => {
        if (!s.playback.hlsUrl) throw new Error("No HLS URL");
        const handle: HlsHandle = await startHlsPlayback(s.playback.hlsUrl, video, { muted });
        stopRef.current = handle.stop;
        setConnection("live");
      };

      try {
        if (s.playback.preferred === "webrtc" || s.playback.webrtcUrl) {
          await tryWhep();
        } else {
          await tryHls();
        }
      } catch (webrtcErr) {
        try {
          await tryHls();
        } catch {
          throw webrtcErr instanceof Error ? webrtcErr : new Error("Playback failed");
        }
      }
    },
    [muted],
  );

  const connect = useCallback(async () => {
    if (!active) return;
    setError(null);
    setConnection(retryRef.current > 0 ? "reconnecting" : "connecting");
    cleanup();

    const rtspUrl =
      preferSubstream && camera.rtspUrlSub
        ? camera.rtspUrlSub
        : (camera.rtspUrlMain ?? camera.rtspUrlSub);
    if (!rtspUrl) {
      setConnection("error");
      setError("No RTSP URL");
      return;
    }

    const password = camera.credential?.vaultKey
      ? ((await vaultGetSecret(shopScopeId, camera.credential.vaultKey)) ?? undefined)
      : undefined;

    const opened = await edgeOpenStream({
      cameraId: camera.id,
      rtspUrl,
      username: camera.credential?.username,
      password,
      recordingMode: camera.recordingMode,
      forceDemo: camera.id.startsWith("demo") || false,
    });

    if (!opened.ok) {
      setConnection("error");
      setError(opened.error);
      return;
    }

    sessionRef.current = opened.session.sessionId;
    setSession(opened.session);
    try {
      await attachPlayback(opened.session);
      retryRef.current = 0;
    } catch (e) {
      setConnection("error");
      setError(e instanceof Error ? e.message : "Stream failed");
    }
  }, [active, attachPlayback, camera, cleanup, preferSubstream, shopScopeId]);

  useEffect(() => {
    if (!active) {
      cleanup();
      setConnection("idle");
      return;
    }
    void connect();
    return () => cleanup();
  }, [active, camera.id, preferSubstream]); // eslint-disable-line react-hooks/exhaustive-deps -- reconnect on identity/quality

  useEffect(() => {
    if (!active || !sessionRef.current) return;
    const id = window.setInterval(() => {
      const sid = sessionRef.current;
      if (!sid) return;
      void edgeStreamHealth(sid).then((r) => {
        if (r.ok) setSession(r.session);
      });
    }, 8_000);
    return () => window.clearInterval(id);
  }, [active, session?.sessionId]);

  // Auto-recover from error / offline
  useEffect(() => {
    if (!active) return;
    if (connection !== "error" && session?.health.status !== "offline") return;
    if (retryRef.current >= 8) return;
    const delay = Math.min(15_000, 1_200 * 2 ** retryRef.current);
    const timer = window.setTimeout(() => {
      retryRef.current += 1;
      void connect();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, connection, session?.health.status, connect]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || connection !== "live") return;
    video.muted = muted;
  }, [muted, connection]);

  const healthStatus: VisionLiveHealthStatus =
    connection === "reconnecting"
      ? "reconnecting"
      : connection === "error"
        ? "offline"
        : connection === "demo"
          ? "healthy"
          : (session?.health.status ?? "warning");

  return {
    videoRef,
    connection,
    session,
    error,
    healthStatus,
    refresh: () => {
      retryRef.current = 0;
      void connect();
    },
  };
}
