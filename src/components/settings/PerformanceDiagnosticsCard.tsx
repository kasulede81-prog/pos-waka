import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { readPerformanceSnapshot } from "../../lib/performanceMetrics";
import { useSystemHealthDiagnostics } from "./SystemHealthDiagnosticsProvider";

type MemoryInfo = {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  return `${ms.toLocaleString()} ms`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="font-black text-stone-900">{value}</dd>
    </div>
  );
}

export function PerformanceDiagnosticsCard({ lang }: { lang: Language }) {
  const { queue } = useSystemHealthDiagnostics();
  const snap = useMemo(() => readPerformanceSnapshot(), [queue?.checkedAt]);

  const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
  const memoryUsed = memory?.usedJSHeapSize ?? null;

  const recentComputations = snap.computationMarks.slice(0, 6);

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "performanceDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "performanceDiagnosticsSub")}</p>

      <dl className="mt-3 space-y-2">
        <MetricRow label={t(lang, "performanceBootstrapTime")} value={formatMs(snap.bootstrapDurationMs)} />
        <MetricRow
          label={t(lang, "performanceBootstrapIdbReads")}
          value={snap.bootstrapIdbReads.toLocaleString()}
        />
        <MetricRow
          label={t(lang, "performanceBootstrapRecordsScanned")}
          value={snap.bootstrapRecordsScanned.toLocaleString()}
        />
        <MetricRow
          label={t(lang, "performanceBootstrapFullScan")}
          value={snap.bootstrapUsedFullTableScan ? t(lang, "systemHealthFail") : t(lang, "systemHealthPass")}
        />
        <MetricRow
          label={t(lang, "performanceLastSyncDuration")}
          value={formatMs(snap.lastSyncDurationMs)}
        />
        <MetricRow
          label={t(lang, "performanceLastSyncLabel")}
          value={snap.lastSyncLabel ?? "—"}
        />
        <MetricRow
          label={t(lang, "performanceQueueSize")}
          value={queue ? queue.queuedCount.toLocaleString() : "—"}
        />
        <MetricRow label={t(lang, "performanceMemoryEstimate")} value={formatBytes(memoryUsed)} />
        <MetricRow
          label={t(lang, "performanceSlowestPage")}
          value={
            snap.slowestPage
              ? `${snap.slowestPage.page} (${formatMs(snap.slowestPage.durationMs)})`
              : "—"
          }
        />
      </dl>

      {recentComputations.length > 0 ? (
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-stone-700">
            {t(lang, "performanceRecentComputations")}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-stone-700">
            {recentComputations.map((mark) => (
              <li key={`${mark.label}-${mark.at}`} className="flex justify-between gap-2">
                <span className="font-semibold">{mark.label}</span>
                <span className="font-black">{formatMs(mark.durationMs)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
