import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  getStartupDiagnosticsSnapshot,
  readPersistedStartupDiagnostics,
  startupStepLabelKey,
} from "../../lib/startupDiagnostics";
import { readLastCloudRecoveryDiagnostics } from "../../lib/cloudRecoverySession";

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function StartupDiagnosticsPanel({ lang }: { lang: Language }) {
  const live = getStartupDiagnosticsSnapshot();
  const persisted = readPersistedStartupDiagnostics();
  const recovery = readLastCloudRecoveryDiagnostics();

  const snap = live.sessionId ? live : persisted;

  return (
    <section className="rounded-2xl border border-border bg-muted p-4 text-left text-xs">
      <p className="font-black uppercase tracking-wide text-muted-foreground">{t(lang, "startupDiagnosticsTitle")}</p>
      <dl className="mt-3 space-y-2 font-semibold text-foreground">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t(lang, "startupDiagCurrentStep")}</dt>
          <dd>{snap ? t(lang, startupStepLabelKey(snap.currentStep)) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t(lang, "startupDiagLastSuccess")}</dt>
          <dd>
            {snap?.lastSuccessfulStep ? t(lang, startupStepLabelKey(snap.lastSuccessfulStep)) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t(lang, "startupDiagDuration")}</dt>
          <dd>{formatMs(snap?.durationMs)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t(lang, "startupDiagRecoveryDuration")}</dt>
          <dd>{formatMs(snap?.recoveryDurationMs ?? recovery?.durationMs)}</dd>
        </div>
        {snap?.failureReason ? (
          <div>
            <dt className="text-muted-foreground">{t(lang, "startupDiagFailure")}</dt>
            <dd className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-950">{snap.failureReason}</dd>
          </div>
        ) : null}
        {recovery?.completedWithInventoryWarnings ? (
          <div>
            <dt className="text-muted-foreground">{t(lang, "recoveryCompletedWithWarnings")}</dt>
            <dd className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-amber-950">
              {recovery.completionMessage ?? t(lang, "recoveryCompletedWithWarningsSub")}
            </dd>
          </div>
        ) : null}
        {recovery?.integrityDiagnostics.inventoryReconciliation?.mismatches.length ? (
          <div>
            <dt className="text-muted-foreground">{t(lang, "recoveryInventoryMismatchTitle")}</dt>
            <dd className="mt-1 space-y-1">
              {recovery.integrityDiagnostics.inventoryReconciliation.mismatches.slice(0, 5).map((m) => (
                <p key={m.productId} className="rounded-lg bg-amber-50 px-2 py-1 text-amber-950">
                  {m.productName}: {m.recordedStock} vs {m.expectedFromMovements} (Δ {m.delta > 0 ? "+" : ""}
                  {m.delta})
                </p>
              ))}
            </dd>
          </div>
        ) : null}
        {recovery?.errorMessage ? (
          <div>
            <dt className="text-muted-foreground">{t(lang, "startupDiagRecoveryError")}</dt>
            <dd className="mt-1 rounded-lg bg-rose-50 px-2 py-1 text-rose-950">{recovery.errorMessage}</dd>
          </div>
        ) : null}
        {recovery?.errorKey || snap?.recoveryErrorKey ? (
          <div>
            <dt className="text-muted-foreground">{t(lang, "startupDiagRecoveryErrorKey")}</dt>
            <dd className="mt-1 rounded-lg bg-amber-50 px-2 py-1 font-mono text-amber-950">
              {recovery?.errorKey ?? snap?.recoveryErrorKey}
            </dd>
          </div>
        ) : null}
        {snap?.crashRecoveryApplied ? (
          <p className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-900">{t(lang, "startupDiagCrashRecovery")}</p>
        ) : null}
      </dl>
    </section>
  );
}
