import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { readSnapshotWithFallback, getBackupRecord } from "../offline/localDb";
import { appendManualBackup, buildExportEnvelope, listBackupMeta, parseImportEnvelope } from "../offline/backupEngine";

type Props = { lang: Language };

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

export function BackupSettingsCard({ lang }: Props) {
  const applyRestoredSnapshot = usePosStore((s) => s.applyRestoredSnapshot);
  const [meta, setMeta] = useState<Array<{ id: string; kind: string; createdAt: string; dateKey?: string }>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void listBackupMeta().then(setMeta);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const exportNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const raw = await readSnapshotWithFallback();
      if (!raw?.preferences || !Array.isArray(raw.products) || !Array.isArray(raw.sales)) {
        setMsg(t(lang, "backupExportFail"));
        return;
      }
      const snap = {
        products: raw.products,
        customers: raw.customers ?? [],
        sales: raw.sales,
        preferences: raw.preferences,
        debtPayments: raw.debtPayments ?? [],
        dayCloses: raw.dayCloses ?? [],
        auditLogs: raw.auditLogs ?? [],
        suppliers: raw.suppliers ?? [],
        purchases: raw.purchases ?? [],
        supplierPayments: raw.supplierPayments ?? [],
        stockMovements: raw.stockMovements ?? [],
        updatedAt: raw.updatedAt ?? new Date().toISOString(),
      };
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
    if (!window.confirm(t(lang, "backupRestoreConfirm"))) return;
    setBusy(true);
    setMsg(null);
    try {
      const rec = await getBackupRecord(id);
      if (!rec?.snapshot) {
        setMsg(t(lang, "backupRestoreFail"));
        return;
      }
      applyRestoredSnapshot(rec.snapshot);
      setMsg(t(lang, "backupRestoreOk"));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const env = parseImportEnvelope(text);
      if (!window.confirm(t(lang, "backupRestoreConfirm"))) return;
      applyRestoredSnapshot(env.snapshot);
      setMsg(t(lang, "backupImportOk"));
      refresh();
    } catch {
      setMsg(t(lang, "backupImportFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-3xl border-2 border-emerald-100 bg-emerald-50/30 p-5">
      <p className="text-xl font-black text-emerald-950">{t(lang, "backupTitle")}</p>
      <p className="mt-1 text-sm text-emerald-900">{t(lang, "backupSub")}</p>
      {msg ? <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-800">{msg}</p> : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportNow()}
          className="min-h-[52px] rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm disabled:opacity-50"
        >
          {t(lang, "backupExportFile")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveLocalBackup()}
          className="min-h-[52px] rounded-2xl border-2 border-emerald-600 bg-white px-4 py-3 text-sm font-black text-emerald-900 disabled:opacity-50"
        >
          {t(lang, "backupSaveOnPhone")}
        </button>
        <label className="inline-flex min-h-[52px] cursor-pointer items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">
          <input type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={onPickFile} />
          {t(lang, "backupRestoreFile")}
        </label>
      </div>

      <div className="mt-6">
        <p className="text-sm font-bold text-slate-800">{t(lang, "backupListTitle")}</p>
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
  );
}
