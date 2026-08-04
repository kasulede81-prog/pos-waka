import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Camera, Maximize2, RefreshCw, Volume2, VolumeX } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { VisionCamera, VisionStreamSession } from "../types";
import { useVisionLiveTile } from "../streaming/useVisionLiveTile";
import { Body, Caption, MonoNumber } from "../../../components/enterprise/EnterpriseTypography";

export function VisionLiveTile({
  lang,
  shopScopeId,
  camera,
  active,
  preferSubstream,
  selected,
  onSelect,
  onSession,
}: {
  lang: Language;
  shopScopeId: string;
  camera: VisionCamera;
  active: boolean;
  preferSubstream: boolean;
  selected: boolean;
  onSelect: () => void;
  onSession?: (session: VisionStreamSession | null) => void;
}) {
  const [muted, setMuted] = useState(true);
  const [snapshotHint, setSnapshotHint] = useState(false);
  const { videoRef, connection, session, error, healthStatus, refresh } = useVisionLiveTile({
    shopScopeId,
    camera,
    active,
    preferSubstream,
    muted,
  });

  useEffect(() => {
    if (selected) onSession?.(session);
  }, [selected, session, onSession]);

  const statusLabel =
    healthStatus === "healthy"
      ? t(lang, "visionLiveHealthy")
      : healthStatus === "warning"
        ? t(lang, "visionLiveWarning")
        : healthStatus === "reconnecting"
          ? t(lang, "visionLiveReconnecting")
          : t(lang, "visionLiveOffline");

  const goFullscreen = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen();
    else if ("webkitEnterFullscreen" in el) {
      // Safari video fullscreen
      (el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        "group relative flex min-h-[180px] flex-col overflow-hidden rounded-xl border bg-black text-left shadow-sm",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <div className="relative aspect-video w-full bg-zinc-950">
        <video
          ref={videoRef}
          className={clsx(
            "h-full w-full object-contain",
            (connection === "demo" || connection === "idle" || connection === "connecting") && "opacity-0",
          )}
          playsInline
          muted={muted}
          autoPlay
        />
        {(connection === "demo" || connection === "connecting" || connection === "reconnecting" || connection === "idle") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            <Caption className="text-zinc-300">
              {connection === "demo"
                ? t(lang, "visionLiveDemoTile")
                : connection === "reconnecting"
                  ? t(lang, "visionLiveReconnecting")
                  : t(lang, "visionLiveConnecting")}
            </Caption>
            <Body className="px-3 text-center text-sm text-white">{camera.name}</Body>
          </div>
        )}
        {connection === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/90 px-3">
            <Caption className="text-rose-300">{t(lang, "visionLiveOffline")}</Caption>
            <Caption className="text-center text-zinc-400">{error}</Caption>
          </div>
        ) : null}
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1">
          <Caption
            className={clsx(
              "font-medium",
              healthStatus === "healthy" && "text-emerald-300",
              healthStatus === "warning" && "text-amber-300",
              (healthStatus === "offline" || healthStatus === "reconnecting") && "text-rose-300",
            )}
          >
            ● {statusLabel}
          </Caption>
        </div>
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <ControlIcon
            label={muted ? t(lang, "visionLiveUnmute") : t(lang, "visionLiveMute")}
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </ControlIcon>
          <ControlIcon
            label={t(lang, "visionLiveRefresh")}
            onClick={(e) => {
              e.stopPropagation();
              refresh();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </ControlIcon>
          <ControlIcon
            label={t(lang, "visionLiveFullscreen")}
            onClick={(e) => {
              e.stopPropagation();
              goFullscreen();
            }}
          >
            <Maximize2 className="h-4 w-4" />
          </ControlIcon>
          <ControlIcon
            label={t(lang, "visionLiveSnapshot")}
            onClick={(e) => {
              e.stopPropagation();
              setSnapshotHint(true);
              window.setTimeout(() => setSnapshotHint(false), 1800);
            }}
          >
            <Camera className="h-4 w-4" />
          </ControlIcon>
        </div>
        {snapshotHint ? (
          <div className="absolute inset-x-0 bottom-12 flex justify-center">
            <Caption className="rounded bg-black/80 px-2 py-1 text-zinc-200">
              {t(lang, "visionLiveSnapshotSoon")}
            </Caption>
          </div>
        ) : null}
      </div>
      <div className="space-y-1 border-t border-white/10 bg-zinc-950 px-3 py-2 text-white">
        <Body className="truncate text-sm font-semibold text-white">{camera.name}</Body>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
          <span>
            {t(lang, "visionTestLatency")}:{" "}
            <MonoNumber as="span">
              {session?.health.latencyMs != null ? `${session.health.latencyMs} ms` : "—"}
            </MonoNumber>
          </span>
          <span>
            {t(lang, "visionTestResolution")}: {session?.health.resolution ?? "—"}
          </span>
          <span>
            {t(lang, "visionTestFps")}: {session?.health.fps ?? "—"}
          </span>
          <span>
            {t(lang, "visionFieldRecording")}: {session?.health.recordingSource ?? camera.recordingMode}
          </span>
          <span>
            {t(lang, "visionLiveLastSeen")}:{" "}
            {session?.health.lastSeenAt
              ? new Date(session.health.lastSeenAt).toLocaleTimeString()
              : camera.lastSeenAt
                ? new Date(camera.lastSeenAt).toLocaleTimeString()
                : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ControlIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e as unknown as MouseEvent);
        }
      }}
      className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/70 text-white hover:bg-black"
    >
      {children}
    </span>
  );
}
