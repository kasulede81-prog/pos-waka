import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { DataRetentionPolicy, Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { usePosStore } from "../store/usePosStore";
import { DATA_RETENTION_OPTIONS, retentionPolicyLabelKey } from "../lib/dataRetention";

export function SettingsDataRetentionPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const runDataArchive = usePosStore((s) => s.runDataArchive);
  const archivedSales = usePosStore((s) => s.archivedSales);
  const archivedAuditLogs = usePosStore((s) => s.archivedAuditLogs);

  const [msg, setMsg] = useState<string | null>(null);
  const policy = preferences.dataRetentionPolicy ?? "3m";

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  const applyPolicy = (p: DataRetentionPolicy) => {
    setPreferences({ dataRetentionPolicy: p });
    setMsg(t(lang, "retentionPolicySaved"));
  };

  const runNow = () => {
    const { moved } = runDataArchive();
    const total = moved.sales + moved.auditLogs + moved.dayCloses + moved.shifts;
    setMsg(total > 0 ? tTemplate(lang, "retentionArchiveRan", { count: String(total) }) : t(lang, "retentionArchiveNone"));
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "retentionSettingsTitle")}
        subtitle={t(lang, "retentionSettingsSub")}
      />

      <p className="rounded-2xl border border-waka-100 bg-waka-50/80 px-4 py-3 text-sm font-medium text-waka-950">
        {t(lang, "retentionNeverDeleteNote")}
      </p>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-stone-800">{t(lang, "retentionPolicyLabel")}</p>
        <div className="mt-3 space-y-2">
          {DATA_RETENTION_OPTIONS.map((opt) => (
            <label
              key={opt}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 ${
                policy === opt ? "border-waka-500 bg-waka-50" : "border-stone-200"
              }`}
            >
              <input
                type="radio"
                name="retention"
                checked={policy === opt}
                onChange={() => applyPolicy(opt)}
                className="h-4 w-4"
              />
              <span className="text-sm font-bold text-stone-900">
                {t(lang, retentionPolicyLabelKey(opt))}
                {opt === "3m" ? (
                  <span className="ml-2 rounded-full bg-waka-600 px-2 py-0.5 text-xs font-black text-white">
                    {t(lang, "retentionRecommended")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-stone-800">{t(lang, "retentionArchiveSummary")}</p>
        <p className="mt-2 text-sm text-stone-600">
          {tTemplate(lang, "retentionArchiveCounts", {
            sales: String(archivedSales.length),
            activity: String(archivedAuditLogs.length),
          })}
        </p>
        <Link
          to="/settings/archive"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-bold text-stone-800"
        >
          {t(lang, "archivePageTitle")}
        </Link>
        <button
          type="button"
          onClick={runNow}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-sm font-black text-white"
        >
          {t(lang, "retentionRunArchiveNow")}
        </button>
      </section>

      {msg ? <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-800">{msg}</p> : null}
    </div>
  );
}
