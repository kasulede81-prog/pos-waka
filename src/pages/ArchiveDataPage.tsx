import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { usePosStore } from "../store/usePosStore";

export function ArchiveDataPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const archivedSales = usePosStore((s) => s.archivedSales);
  const archivedAuditLogs = usePosStore((s) => s.archivedAuditLogs);
  const archivedDayCloses = usePosStore((s) => s.archivedDayCloses);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const archivedShifts = usePosStore((s) => s.preferences.archivedShifts ?? []);
  const permanentlyDeleteArchived = usePosStore((s) => s.permanentlyDeleteArchived);
  const runDataArchive = usePosStore((s) => s.runDataArchive);

  const [msg, setMsg] = useState<string | null>(null);

  const totalArchived = useMemo(
    () =>
      archivedSales.length +
      archivedAuditLogs.length +
      archivedDayCloses.length +
      archivedVoidRecords.length +
      archivedReturnRecords.length +
      archivedShifts.length,
    [
      archivedSales.length,
      archivedAuditLogs.length,
      archivedDayCloses.length,
      archivedVoidRecords.length,
      archivedReturnRecords.length,
      archivedShifts.length,
    ],
  );

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/office" replace />;
  }

  const handleDelete = () => {
    if (totalArchived === 0) return;
    if (!window.confirm(t(lang, "retentionDeleteConfirm"))) return;
    permanentlyDeleteArchived();
    setMsg(t(lang, "retentionDeleteDone"));
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "archivePageTitle")}
        subtitle={t(lang, "archivePageSub")}
        backFallback="/settings/retention"
        backLabel={t(lang, "retentionSettingsTitle")}
      />

      <ul className="space-y-2 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <li className="flex justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold">
          <span>{t(lang, "archiveSalesReceipts")}</span>
          <span className="font-black">{archivedSales.length}</span>
        </li>
        <li className="flex justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold">
          <span>{t(lang, "staffActivityTitle")}</span>
          <span className="font-black">{archivedAuditLogs.length}</span>
        </li>
        <li className="flex justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold">
          <span>{t(lang, "archiveDayCloses")}</span>
          <span className="font-black">{archivedDayCloses.length}</span>
        </li>
        <li className="flex justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold">
          <span>{t(lang, "archiveShifts")}</span>
          <span className="font-black">{archivedShifts.length}</span>
        </li>
        <li className="flex justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold">
          <span>{t(lang, "archiveVoidsReturns")}</span>
          <span className="font-black">
            {archivedVoidRecords.length + archivedReturnRecords.length}
          </span>
        </li>
      </ul>

      <button
        type="button"
        onClick={() => {
          const { moved } = runDataArchive();
          setMsg(
            moved.sales + moved.auditLogs > 0 ? t(lang, "retentionArchiveRan").replace("{count}", "✓") : t(lang, "retentionArchiveNone"),
          );
        }}
        className="min-h-[48px] w-full rounded-2xl border-2 border-waka-600 bg-white py-3 text-sm font-black text-waka-900"
      >
        {t(lang, "retentionRunArchiveNow")}
      </button>

      {totalArchived > 0 ? (
        <button
          type="button"
          onClick={handleDelete}
          className="min-h-[48px] w-full rounded-2xl border-2 border-rose-300 bg-rose-50 py-3 text-sm font-black text-rose-900"
        >
          {t(lang, "retentionDeleteArchived")}
        </button>
      ) : null}

      <p className="text-xs font-medium text-stone-500">{t(lang, "retentionDeleteWarning")}</p>
      {msg ? <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-800">{msg}</p> : null}
    </div>
  );
}
