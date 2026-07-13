import { useEffect, useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WakaStartupBrand } from "../brand/WakaStartupBrand";
import { StartupProgressBar } from "../startup/StartupProgressBar";
import { STARTUP_SCREEN_BG } from "../startup/StartupLoadingScreen";
import {
  computeRecoveryProgressPct,
  downloadStepIndex,
} from "../../lib/recoveryProgress";
import {
  type CloudRecoveryStepId,
} from "../../lib/cloudRecoverySession";
import { classifyRecoveryFailure } from "../../lib/recoveryFailureClassification";
import { useCloudRecoverySession } from "../../hooks/useCloudRecoverySession";
import { getDeviceOnline } from "../../lib/deviceOnline";
import { StartupEscapeActions } from "../startup/StartupEscapeActions";
import { RecoveryInProgressEscapeFooter } from "../startup/RecoveryInProgressEscapeFooter";
import { recordStartupStep } from "../../lib/startupDiagnostics";

type Props = {
  lang: Language;
  failed: boolean;
  probeFailed?: boolean;
  onRetry: () => void;
  onSignOut: () => void | Promise<void>;
  onContinueOffline?: () => void;
  canContinueOffline?: boolean;
};

const PROBE_AUTO_RETRY_MS = 4000;

const DISPLAY_STEPS: CloudRecoveryStepId[] = [
  "products",
  "sales",
  "customers",
  "inventory",
  "shifts",
  "day_closes",
  "cash",
];

function stepLabelKey(step: CloudRecoveryStepId): string {
  const map: Record<CloudRecoveryStepId, string> = {
    probing: "recoveryStepProbing",
    snapshot: "recoveryStepSnapshot",
    snapshot_empty_after_restore: "recoveryStepSnapshot",
    products: "recoveryStepProducts",
    sales: "recoveryStepSales",
    customers: "recoveryStepCustomers",
    returns: "recoveryStepReturns",
    inventory: "recoveryStepInventory",
    shifts: "recoveryStepShifts",
    day_closes: "recoveryStepDayCloses",
    cash: "recoveryStepCash",
    staff: "recoveryStepStaff",
    audit: "recoveryStepAudit",
    validation: "recoveryStepValidation",
  };
  return map[step];
}

function stepIndex(step: CloudRecoveryStepId): number {
  return downloadStepIndex(step);
}

function recoveryStepToStartupStep(step: CloudRecoveryStepId | null): void {
  if (!step) return;
  if (step === "probing") recordStartupStep("cloud_probe");
  else if (step === "snapshot") recordStartupStep("cloud_recovery");
  else if (step === "products") recordStartupStep("downloading_products");
  else if (step === "sales") recordStartupStep("downloading_sales");
  else if (step === "customers") recordStartupStep("downloading_customers");
  else if (step === "inventory") recordStartupStep("downloading_inventory");
  else if (step === "shifts") recordStartupStep("downloading_shifts");
  else if (step === "validation") recordStartupStep("cloud_recovery");
  else recordStartupStep("cloud_recovery");
}

export function CloudRecoveryScreen({
  lang,
  failed,
  probeFailed = false,
  onRetry,
  onSignOut,
  onContinueOffline,
  canContinueOffline = false,
}: Props) {
  const session = useCloudRecoverySession();
  const lastIdx = session.lastCompletedStep ? stepIndex(session.lastCompletedStep) : -1;
  const currentIdx = session.currentStep ? stepIndex(session.currentStep) : -1;

  useEffect(() => {
    recoveryStepToStartupStep(session.currentStep);
  }, [session.currentStep]);

  useEffect(() => {
    if (!probeFailed) return;

    const retryIfOnline = () => {
      if (getDeviceOnline()) onRetry();
    };

    retryIfOnline();
    const intervalId = window.setInterval(retryIfOnline, PROBE_AUTO_RETRY_MS);
    window.addEventListener("waka:network-online", retryIfOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("waka:network-online", retryIfOnline);
    };
  }, [probeFailed, onRetry]);

  const progressPct = useMemo(() => computeRecoveryProgressPct(session), [session]);

  const failurePresentation = useMemo(
    () =>
      classifyRecoveryFailure(session.errorKey, {
        coreUnlocked: session.status === "core_unlocked",
      }),
    [session.errorKey, session.status],
  );

  const downloaded = session.downloadedCounts;
  const restored = session.restoredCounts;
  const hasRestoredCounts =
    restored.products > 0 || restored.sales > 0 || restored.customers > 0 || restored.cashRecords > 0;
  const showEscape = failed || probeFailed;

  if (probeFailed) {
    return (
      <div className={`flex min-h-dvh flex-col items-center ${STARTUP_SCREEN_BG} px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]`}>
        <WakaStartupBrand compact className="mb-6 mt-2" />
        <div className="mx-auto w-full max-w-md space-y-5">
          <div className="text-center">
            <p className="text-base font-black text-foreground">{t(lang, "recoveryProbeTitle")}</p>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "recoveryProbeSub")}</p>
          </div>

          <StartupProgressBar />

          {session.errorMessage ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
              {session.errorMessage}
            </p>
          ) : null}

          <p className="text-center text-sm font-medium leading-relaxed text-waka-900/90">
            {getDeviceOnline() ? t(lang, "recoveryProbeRetrying") : t(lang, "recoveryProbeOffline")}
          </p>

          <StartupEscapeActions
            lang={lang}
            onRetry={onRetry}
            onContinueOffline={onContinueOffline}
            canContinueOffline={canContinueOffline}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col items-center ${STARTUP_SCREEN_BG} px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]`}>
      <WakaStartupBrand compact className="mb-5 mt-2" />
      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="text-center">
          <p className="text-base font-black text-foreground">
            {failed ? t(lang, failurePresentation.titleKey) : t(lang, "recoveryTitle")}
          </p>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {failed ? t(lang, failurePresentation.subKey) : t(lang, "recoverySub")}
          </p>
        </div>

        <StartupProgressBar value={probeFailed ? 0 : progressPct} />
        <p className="text-center text-xs font-bold tabular-nums text-muted-foreground">
          {probeFailed ? "…" : `${progressPct}%`}
          {session.progressPhase === "validating" && !failed ? ` · ${t(lang, "recoveryStepValidation")}` : null}
        </p>

        <ul className="space-y-2 rounded-2xl border border-border bg-card/95 p-4 shadow-waka-sm">
          {DISPLAY_STEPS.map((step) => {
            const idx = stepIndex(step);
            const done = lastIdx >= idx;
            const active = currentIdx === idx && session.status === "active";
            let countLabel = "";
            if (step === "products") countLabel = String(downloaded.products);
            if (step === "sales") countLabel = String(downloaded.sales);
            if (step === "customers") countLabel = String(downloaded.customers);
            if (step === "inventory") countLabel = String(downloaded.inventory);
            if (step === "shifts") countLabel = String(downloaded.shifts);
            if (step === "day_closes") countLabel = String(downloaded.dayCloses);
            if (step === "cash") countLabel = String(downloaded.cashRecords);

            return (
              <li
                key={step}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${
                  active ? "bg-waka-50 font-bold text-waka-950" : done ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      done ? "bg-emerald-100 text-emerald-800" : active ? "bg-waka-200 text-waka-900" : "bg-muted"
                    }`}
                  >
                    {done ? "✓" : active ? "…" : ""}
                  </span>
                  {t(lang, stepLabelKey(step))}
                </span>
                {done && countLabel !== "0" ? (
                  <span className="tabular-nums text-xs font-black text-muted-foreground">{countLabel}</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {session.lastCompletedStep ? (
          <p className="text-center text-xs font-semibold text-muted-foreground">
            {t(lang, "recoveryLastStep")}: {t(lang, stepLabelKey(session.lastCompletedStep))}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <div className="rounded-xl bg-muted px-2 py-2">
            <p>{t(lang, "recoveryCountProducts")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-foreground">
              {hasRestoredCounts ? restored.products : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted px-2 py-2">
            <p>{t(lang, "recoveryCountSales")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-foreground">
              {hasRestoredCounts ? restored.sales : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-muted px-2 py-2">
            <p>{t(lang, "recoveryCountCustomers")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-foreground">
              {hasRestoredCounts ? restored.customers : "—"}
            </p>
          </div>
        </div>

        {hasRestoredCounts ? (
          <p className="text-center text-xs font-semibold text-emerald-800">{t(lang, "recoveryRestoredToDevice")}</p>
        ) : downloaded.products > 0 || downloaded.sales > 0 ? (
          <p className="text-center text-xs font-semibold text-muted-foreground">{t(lang, "recoveryDownloadedFromCloud")}</p>
        ) : null}

        {showEscape ? (
          <div className="space-y-3">
            {session.errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
                {session.errorMessage}
              </p>
            ) : null}
            {session.errorKey ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
                {t(lang, "recoveryErrorKey")}: {session.errorKey}
              </p>
            ) : null}
            {session.validation?.failures.length ? (
              <ul className="space-y-1 text-xs text-rose-900">
                {session.validation.failures.slice(0, 4).map((f) => (
                  <li key={f.code}>{f.message}</li>
                ))}
              </ul>
            ) : null}
            {session.validation?.inventoryMismatches?.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                <p className="font-black uppercase text-amber-950">{t(lang, "recoveryInventoryMismatchTitle")}</p>
                <ul className="mt-1 space-y-1 font-medium text-amber-900">
                  {session.validation.inventoryMismatches.slice(0, 5).map((m) => (
                    <li key={m.productId}>
                      <span className="font-bold">{m.productName}</span>
                      <span className="block text-[11px]">
                        {t(lang, "recoveryInventoryRecorded")}: {m.recordedStock} ·{" "}
                        {t(lang, "recoveryInventoryExpected")}: {m.expectedFromMovements} ·{" "}
                        {t(lang, "recoveryInventoryDelta")}: {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {session.integrityDiagnostics.inventoryReconciliation ? (
              <div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-foreground">
                <p className="font-black uppercase text-muted-foreground">
                  {t(lang, "recoveryInventoryReconciliationTitle")}
                </p>
                <p className="mt-1">
                  {t(lang, "recoverySyntheticMovements")}:{" "}
                  {session.integrityDiagnostics.inventoryReconciliation.syntheticMovementsGenerated}
                </p>
                <p>
                  {t(lang, "recoveryRemainingMismatches")}:{" "}
                  {session.integrityDiagnostics.inventoryReconciliation.remainingMismatchCount}
                </p>
              </div>
            ) : null}
            <StartupEscapeActions
              lang={lang}
              onRetry={onRetry}
              onContinueOffline={onContinueOffline}
              canContinueOffline={canContinueOffline}
              onSignOut={onSignOut}
            />
          </div>
        ) : (
          <>
            <p className="text-center text-sm font-medium leading-relaxed text-waka-900/90">{t(lang, "loadingTrustLine")}</p>
            <RecoveryInProgressEscapeFooter lang={lang} onSignOut={onSignOut} />
          </>
        )}
      </div>
    </div>
  );
}
