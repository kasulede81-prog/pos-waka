import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { buildAndroidDiagnosticsReport, formatAndroidDiagnosticsReport } from "../lib/androidDiagnostics";
import { saveExportedFile } from "../lib/fileDownload";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { readSyncHealthMeta } from "../lib/syncMeta";
import { StartupDiagnosticsPanel } from "../components/startup/StartupDiagnosticsPanel";
import { SyncHealthDashboard } from "../components/SyncHealthDashboard";
import { CloudTrustCenter } from "../components/settings/CloudTrustCenter";
import { SelfDeleteHealthPanel } from "../components/settings/SelfDeleteHealthPanel";
import type { User } from "@supabase/supabase-js";

function yesNo(lang: Language, ok: boolean): string {
  return ok ? t(lang, "diagnosticsSupported") : t(lang, "diagnosticsNotSupported");
}

export function SettingsDiagnosticsPage({ lang, user }: { lang: Language; user: User | null }) {
  const sync = useSyncStatus();
  const [exportHint, setExportHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof buildAndroidDiagnosticsReport>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void buildAndroidDiagnosticsReport().then((r) => {
      if (!cancelled) setReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [sync.isOnline, sync.health.lastSuccessAt]);

  const health = readSyncHealthMeta();
  const lastSyncLabel = health.lastSuccessAt
    ? new Date(health.lastSuccessAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })
    : t(lang, "diagnosticsNever");

  const exportReport = async () => {
    setBusy(true);
    try {
      const next = report ?? (await buildAndroidDiagnosticsReport());
      const body = formatAndroidDiagnosticsReport(next);
      const ok = await saveExportedFile("waka-diagnostics.json", body, "application/json", {
        shareDialogTitle: "Export diagnostics",
      });
      setExportHint(ok ? t(lang, "diagnosticsExportOk") : t(lang, "diagnosticsExportFail"));
      window.setTimeout(() => setExportHint(null), 3500);
    } finally {
      setBusy(false);
    }
  };

  const hw = report?.hardware;

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "diagnosticsPageTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "diagnosticsPageSub")}</p>
      </div>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <StartupDiagnosticsPanel lang={lang} />
      </section>

      <SyncHealthDashboard lang={lang} lazy />

      <CloudTrustCenter lang={lang} />

      <SelfDeleteHealthPanel lang={lang} user={user} />

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsDeviceName")}</dt>
            <dd className="max-w-[65%] text-right font-semibold text-stone-900">{report?.deviceName ?? "…"}</dd>
          </div>
          {Capacitor.getPlatform() === "android" ? (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="font-bold text-stone-600">{t(lang, "diagnosticsAndroidVersion")}</dt>
              <dd className="font-semibold text-stone-900">{report?.androidVersion ?? "—"}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsAppVersion")}</dt>
            <dd className="font-mono font-semibold text-stone-900">
              {report ? `${report.appVersion} (${report.build})` : "…"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsOfflineStatus")}</dt>
            <dd className="font-semibold text-stone-900">
              {sync.isOnline ? t(lang, "diagnosticsOnline") : t(lang, "diagnosticsOffline")}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsLastSync")}</dt>
            <dd className="font-semibold text-stone-900">{lastSyncLabel}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsScannerSupport")}</dt>
            <dd className="font-semibold text-stone-900">{yesNo(lang, Boolean(hw?.barcodeWedge))}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsCameraSupport")}</dt>
            <dd className="font-semibold text-stone-900">{yesNo(lang, Boolean(hw?.camera && hw?.barcodeCamera))}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-stone-600">{t(lang, "diagnosticsThermalPrint")}</dt>
            <dd className="font-semibold text-stone-900">{yesNo(lang, Boolean(hw?.escPos))}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportReport()}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {t(lang, "diagnosticsExportReport")}
        </button>
        {exportHint ? <p className="mt-3 text-center text-sm font-bold text-waka-800">{exportHint}</p> : null}
      </section>
    </div>
  );
}
