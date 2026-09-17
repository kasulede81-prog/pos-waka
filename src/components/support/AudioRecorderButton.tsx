import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Mic, Square, X } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

/**
 * Microphone capture for support voice notes. Permission is requested ONLY
 * when the user explicitly presses Record — never on page open. Record →
 * stop → preview → send/cancel, with graceful errors when the mic is
 * unavailable or denied.
 */
export function AudioRecorderButton({
  lang,
  disabled,
  onRecorded,
  onError,
}: {
  lang: Language;
  disabled?: boolean;
  onRecorded: (blob: Blob) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "preview">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const liveUrlRef = useRef<string | null>(null);

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const releasePreview = () => {
    if (liveUrlRef.current) {
      URL.revokeObjectURL(liveUrlRef.current);
      liveUrlRef.current = null;
    }
    setPreviewUrl(null);
  };

  const reset = () => {
    stopTimer();
    releaseStream();
    releasePreview();
    blobRef.current = null;
    chunksRef.current = [];
    recorderRef.current = null;
    setElapsed(0);
    setPhase("idle");
  };

  // Never leak the mic or object URLs on unmount/navigation.
  useEffect(() => reset, []);

  const start = async () => {
    if (disabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError(t(lang, "supportCenterMicUnavailable"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopTimer();
        releaseStream();
        const type = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (blob.size === 0) {
          reset();
          onError(t(lang, "supportCenterMicUnavailable"));
          return;
        }
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        liveUrlRef.current = url;
        setPreviewUrl(url);
        setPhase("preview");
      };
      recorder.start();
      setElapsed(0);
      setPhase("recording");
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      reset();
      onError(t(lang, "supportCenterMicDenied"));
    }
  };

  const stop = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      reset();
    }
  };

  const send = () => {
    const blob = blobRef.current;
    if (!blob) return;
    onRecorded(blob);
    reset();
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  if (phase === "recording") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 py-1.5 pl-3 pr-1.5 ring-1 ring-rose-200">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden />
        <span className="text-xs font-black tabular-nums text-rose-700">
          {mm}:{ss}
        </span>
        <button
          type="button"
          onClick={stop}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm active:scale-95"
          aria-label={t(lang, "supportCenterStopRecording")}
          title={t(lang, "supportCenterStopRecording")}
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-95"
          aria-label={t(lang, "supportCenterCancelRecording")}
          title={t(lang, "supportCenterCancelRecording")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    );
  }

  if (phase === "preview") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-2xl bg-muted/70 px-2.5 py-1.5 ring-1 ring-border">
        <audio controls preload="metadata" src={previewUrl ?? undefined} className="h-9 max-w-[220px]" />
        <button
          type="button"
          onClick={send}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-waka-600 px-3 text-xs font-black text-white shadow-sm active:scale-95"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t(lang, "supportCenterSendRecording")}
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:scale-95"
          aria-label={t(lang, "supportCenterCancelRecording")}
          title={t(lang, "supportCenterCancelRecording")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={disabled}
      className={clsx(
        "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground shadow-sm transition-colors hover:text-foreground active:scale-95 disabled:opacity-40",
      )}
      aria-label={t(lang, "supportCenterRecordButton")}
      title={t(lang, "supportCenterRecordButton")}
    >
      <Mic className="h-4.5 w-4.5" aria-hidden />
    </button>
  );
}
