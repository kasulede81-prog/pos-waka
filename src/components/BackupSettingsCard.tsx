import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import {
  applyRestoredSnapshotFromBackup,
  cancelBackupRestoreInProgress,
  persistRestoredSnapshotToDisk,
} from "../store/usePosStore";
import { readSnapshotWithFallback, getBackupRecord } from "../offline/localDb";
import {
  appendManualBackup,
  buildExportEnvelope,
  listBackupMeta,
  MAX_BACKUP_IMPORT_BYTES,
  parseImportEnvelopeFromFile,
  snapshotFromPartial,
} from "../offline/backupEngine";
import {
  beginBackupRestoreSession,
  cancelBackupRestoreSession,
  isBackupRestoreAborted,
} from "../lib/backupRestoreSession";
import { yieldUiTick } from "../lib/uiYield";
import type { PersistedSnapshot } from "../offline/localDb";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { assessRestoreRisk, confirmRestoreWithSafetyChecks } from "../lib/restoreSafety";
import { appendPilotEvent } from "../lib/pilotEventLog";
import { captureAppException } from "../lib/crashReporting";

type Props = { lang: Language; compact?: boolean; /** When false, show upgrade hint instead of backup actions. */ actionsEnabled?: boolean };

type RestorePhase = "reading" | "parsing" | "restoring" | "saving" | null;

function downloadJson(filename: string, body: string) {
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RestoreProgressOverlay({
  label,
  hint,
  percent,
  onCancel,
  cancelLabel,
}: {
  label: string;
  hint: string;
  percent?: number;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  if (typeof document === "undefined") return null;
  const pct = typeof percent === "number" ? Math.max(4, Math.min(100, percent)) : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-stone-900/75 px-5 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal
      aria-busy="true"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl">
        <p className="text-center text-base font-black leading-snug text-stone-900">{label}</p>
        <p className="mt-2 text-center text-xs font-semibold text-stone-500">{hint}</p>
        <div className="mx-auto mt-5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
          {pct != null ? (
            <div className="h-full rounded-full bg-waka-600 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-2/5 animate-pulse rounded-full bg-waka-600" />
          )}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="mt-5 min-h-[48px] w-full rounded-xl border-2 border-rose-300 bg-rose-50 px-4 text-sm font-black text-rose-900 active:bg-rose-100"
          >
            {cancelLabel ?? "Stop"}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function BackupSettingsCard({ lang, compact, actionsEnabled = true }: Props) {
  const sync = useSyncStatus();
  const [meta, setMeta] = useState<Array<{ id: string; kind: string; createdAt: string; dateKey?: string }>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>(null);
  const [restorePercent, setRestorePercent] = useState<number | undefined>(undefined);
  const restoreSessionRef = useRef(0);

  const refresh = useCallback(() => {
    void listBackupMeta().then(setMeta);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const phaseLabel =
    restorePhase === "reading"
      ? t(lang, "backupImportReading")
      : restorePhase === "parsing"
        ? t(lang, "backupImportParsing")
        : restorePhase === "restoring"
          ? t(lang, "backupImportRestoring")
          : restorePhase === "saving"
            ? t(lang, "backupImportSaving")
            : null;

  const cancelRestore = () => {
    cancelBackupRestoreSession();
    cancelBackupRestoreInProgress();
    setRestorePhase(null);
    setRestorePercent(undefined);
    setBusy(false);
    setMsg(t(lang, "backupImportCancelled"));
  };

  const runRestorePipeline = async (
    loadSnapshot: () => Promise<{ snapshot: PersistedSnapshot }>,
    existingSessionId?: number,
  ) => {
    const sessionId = existingSessionId ?? beginBackupRestoreSession();
    restoreSessionRef.current = sessionId;
    setRestorePercent(0);

    try {
      setRestorePhase("restoring");
      await yieldUiTick();
      const { snapshot } = await loadSnapshot();
      if (isBackupRestoreAborted(sessionId)) throw new Error("backup_restore_aborted");

      await applyRestoredSnapshotFromBackup(snapshot, {
        sessionId,
        onProgress: (p) => setRestorePercent(p),
      });

      setRestorePhase(null);
      setRestorePercent(undefined);
      setBusy(false);
      setMsg(t(lang, "backupRestoreMemoryOk"));

      setRestorePhase("saving");
      await yieldUiTick();
      await persistRestoredSnapshotToDisk(sessionId);
      appendPilotEvent("restore", "Backup restore completed");
      setMsg(t(lang, "backupRestoreOk"));
    } catch (err) {
      if ((err as Error).message === "backup_restore_aborted") {
        setMsg(t(lang, "backupImportCancelled"));
      } else {
        captureAppException(err, { scope: "backup_restore" });
        throw err;
      }
    }
  };

  const exportNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const raw = await readSnapshotWithFallback();
      const snap = snapshotFromPartial(raw ?? {});
      if (!snap) {
        setMsg(t(lang, "backupExportFail"));
        return;
      }
      const env = buildExportEnvelope(snap);
      downloadJson(`waka-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(env, null, 2));
      setMsg(t(lang, "backupExportOk"));
    } finally {
      setBusy(false);
    }
  };

  const saveLocalBackup = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await appendManualBackup();
      setMsg(r.ok ? t(lang, "backupManualOk") : t(lang, "backupManualFail"));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const restoreFromId = async (id: string) => {
    const risk = assessRestoreRisk(sync.pendingCount);
    if (!confirmRestoreWithSafetyChecks(lang, risk, t, tTemplate)) return;
    setBusy(true);
    setMsg(null);
    try {
      await runRestorePipeline(async () => {
        const rec = await getBackupRecord(id);
        if (!rec?.snapshot) throw new Error("missing");
        return { snapshot: rec.snapshot };
      });
      refresh();
    } catch (err) {
      if ((err as Error).message !== "backup_restore_aborted" && (err as Error).message !== "missing") {
        setMsg(t(lang, "backupRestoreFail"));
      } else if ((err as Error).message === "missing") {
        setMsg(t(lang, "backupRestoreFail"));
      }
    } finally {
      setRestorePhase(null);
      setRestorePercent(undefined);
      setBusy(false);
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_BACKUP_IMPORT_BYTES) {
      setMsg(t(lang, "backupImportTooLarge"));
      return;
    }

    const risk = assessRestoreRisk(sync.pendingCount);
    if (!confirmRestoreWithSafetyChecks(lang, risk, t, tTemplate)) return;

    const sessionId = beginBackupRestoreSession();
    restoreSessionRef.current = sessionId;
    setBusy(true);
    setMsg(null);
    setRestorePercent(undefined);

    try {
      setRestorePhase("reading");
      await yieldUiTick();
      if (isBackupRestoreAborted(sessionId)) throw new Error("backup_restore_aborted");

      setRestorePhase("parsing");
      await yieldUiTick();
      const env = await parseImportEnvelopeFromFile(file, sessionId);

      await runRestorePipeline(async () => env, sessionId);
      refresh();
    } catch (err) {
      if ((err as Error).message !== "backup_restore_aborted") {
        setMsg(t(lang, "backupImportFail"));
      }
    } finally {
      setRestorePhase(null);
      setRestorePercent(undefined);
      setBusy(false);
    }
  };

  const showStop = restorePhase != null;

  return (
    <>
      {phaseLabel ? (
        <RestoreProgressOverlay
          label={phaseLabel}
          hint={t(lang, "backupImportOverlayHint")}
          percent={restorePercent}
          cancelLabel={t(lang, "backupImportCancel")}
          onCancel={showStop ? cancelRestore : undefined}
        />
      ) : null}

      <article className={compact ? "rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" : "rounded-3xl border-2 border-waka-100 bg-waka-50/30 p-5"}>
        {!compact ? (
          <>
            <p className="text-xl font-black text-waka-950">{t(lang, "backupTitle")}</p>
            <p className="mt-1 text-sm text-waka-900">{t(lang, "backupSub")}</p>
            <p className="mt-2 rounded-xl border border-waka-200/80 bg-white/80 px-3 py-2 text-xs font-medium leading-relaxed text-stone-700">
              {t(lang, "backupRestoreTip")}
            </p>
            <p className="mt-2 text-xs font-semibold text-stone-600">{t(lang, "restoreCallWakaHint")}</p>
          </>
        ) : null}
        {msg ? (
          <div className="mt-2 space-y-1 rounded-xl bg-stone-50 px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">{msg}</p>
            {msg === t(lang, "backupExportOk") || msg === t(lang, "backupManualOk") ? (
              <p className="text-xs font-medium text-stone-600">{t(lang, "backupExportOkHint")}</p>
            ) : null}
          </div>
        ) : null}

        {!actionsEnabled ? (
          <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-sm font-semibold text-orange-950">{t(lang, "backupUpgradeRequired")}</p>
            <Link to="/upgrade" className="mt-2 inline-block text-sm font-black text-orange-800 underline">
              {t(lang, "backupUpgradeCta")} →
            </Link>
          </div>
        ) : null}

        <div
          className={
            compact ? "mt-2 flex flex-col gap-2" : "mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
          }
          style={actionsEnabled ? undefined : { pointerEvents: "none", opacity: 0.45 }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveLocalBackup()}
            className="min-h-[48px] rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "backupSaveOnPhone")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportNow()}
            className="min-h-[48px] rounded-2xl border-2 border-waka-600 bg-white px-4 py-3 text-sm font-black text-waka-900 disabled:opacity-50"
          >
            {t(lang, "backupDownloadCopy")}
          </button>
          <label className="inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">
            <input type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={onPickFile} />
            {t(lang, "backupRestoreFile")}
          </label>
        </div>

        <div className={compact ? "mt-4" : "mt-6"}>
          <p className="text-sm font-bold text-slate-800">{t(lang, "backupListTitle")}</p>
          <p className="mt-0.5 text-xs font-medium text-stone-500">{t(lang, "backupListHint")}</p>
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-white/60 bg-white/80 p-3">
            {meta.length === 0 ? (
              <li className="text-sm text-slate-500">{t(lang, "backupListEmpty")}</li>
            ) : (
              meta.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-800">
                    {m.kind === "daily_auto" ? t(lang, "backupKindDaily") : t(lang, "backupKindManual")} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restoreFromId(m.id)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {t(lang, "backupRestore")}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </article>
    </>
  );
}
