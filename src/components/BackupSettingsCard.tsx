import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { createPortal } from "react-dom";

import type { Language } from "../types";

import { t } from "../lib/i18n";

import { applyRestoredSnapshotFromBackup } from "../store/usePosStore";

import { readSnapshotWithFallback, getBackupRecord } from "../offline/localDb";

import {

  appendManualBackup,

  buildExportEnvelope,

  listBackupMeta,

  MAX_BACKUP_IMPORT_BYTES,

  parseImportEnvelopeFromFile,

} from "../offline/backupEngine";



type Props = { lang: Language; compact?: boolean };



type RestorePhase = "reading" | "parsing" | "restoring" | null;



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



function yieldToUi(): Promise<void> {

  return new Promise((resolve) => {

    setTimeout(resolve, 0);

  });

}



function RestoreProgressOverlay({ label, hint }: { label: string; hint: string }) {

  if (typeof document === "undefined") return null;

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

          <div className="h-full w-2/5 animate-pulse rounded-full bg-waka-600" />

        </div>

      </div>

    </div>,

    document.body,

  );

}



export function BackupSettingsCard({ lang, compact }: Props) {

  const [meta, setMeta] = useState<Array<{ id: string; kind: string; createdAt: string; dateKey?: string }>>([]);

  const [msg, setMsg] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const [restorePhase, setRestorePhase] = useState<RestorePhase>(null);



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

          : null;



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

    setRestorePhase("restoring");

    setMsg(null);

    try {

      const rec = await getBackupRecord(id);

      if (!rec?.snapshot) {

        setMsg(t(lang, "backupRestoreFail"));

        return;

      }

      await applyRestoredSnapshotFromBackup(rec.snapshot);

      setMsg(t(lang, "backupRestoreOk"));

      refresh();

    } catch {

      setMsg(t(lang, "backupRestoreFail"));

    } finally {

      setRestorePhase(null);

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



    if (!window.confirm(t(lang, "backupRestoreConfirm"))) return;



    setBusy(true);

    setMsg(null);

    try {

      setRestorePhase("reading");

      await yieldToUi();



      setRestorePhase("parsing");

      await yieldToUi();

      const env = await parseImportEnvelopeFromFile(file);



      setRestorePhase("restoring");

      await yieldToUi();

      await applyRestoredSnapshotFromBackup(env.snapshot);

      setMsg(t(lang, "backupImportOk"));

      refresh();

    } catch {

      setMsg(t(lang, "backupImportFail"));

    } finally {

      setRestorePhase(null);

      setBusy(false);

    }

  };



  return (

    <>

      {phaseLabel ? (
        <RestoreProgressOverlay label={phaseLabel} hint={t(lang, "backupImportOverlayHint")} />
      ) : null}

      <article className={compact ? "rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" : "rounded-3xl border-2 border-waka-100 bg-waka-50/30 p-5"}>

        {!compact ? (

          <>

            <p className="text-xl font-black text-waka-950">{t(lang, "backupTitle")}</p>

            <p className="mt-1 text-sm text-waka-900">{t(lang, "backupSub")}</p>

          </>

        ) : null}

        {msg ? <p className="mt-2 rounded-xl bg-stone-50 px-3 py-2 text-sm font-semibold text-slate-800">{msg}</p> : null}



        <div className={compact ? "mt-2 flex flex-col gap-2" : "mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap"}>

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

