import { useEffect, useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WakaPosLogo } from "../brand/WakaLogo";
import {
  CLOUD_RECOVERY_STEP_ORDER,
  type CloudRecoveryStepId,
} from "../../lib/cloudRecoverySession";
import { useCloudRecoverySession } from "../../hooks/useCloudRecoverySession";
import { getDeviceOnline } from "../../lib/deviceOnline";

type Props = {
  lang: Language;
  failed: boolean;
  probeFailed?: boolean;
  onRetry: () => void;
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
    products: "recoveryStepProducts",
    sales: "recoveryStepSales",
    customers: "recoveryStepCustomers",
    inventory: "recoveryStepInventory",
    shifts: "recoveryStepShifts",
    day_closes: "recoveryStepDayCloses",
    cash: "recoveryStepCash",
    validation: "recoveryStepValidation",
  };
  return map[step];
}

function stepIndex(step: CloudRecoveryStepId): number {
  return CLOUD_RECOVERY_STEP_ORDER.indexOf(step);
}

export function CloudRecoveryScreen({ lang, failed, probeFailed = false, onRetry }: Props) {
  const session = useCloudRecoverySession();
  const lastIdx = session.lastCompletedStep ? stepIndex(session.lastCompletedStep) : -1;
  const currentIdx = session.currentStep ? stepIndex(session.currentStep) : -1;

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

  const progressPct = useMemo(() => {
    if (probeFailed) return 0;
    const total = CLOUD_RECOVERY_STEP_ORDER.length;
    const done = Math.max(lastIdx + 1, 0);
    return Math.min(100, Math.round((done / total) * 100));
  }, [lastIdx, probeFailed]);

  const counts = session.entityCounts;

  if (probeFailed) {
    return (
      <div className="flex min-h-dvh flex-col items-center bg-[#fffaf5] px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <WakaPosLogo size="splash" className="mb-6 mt-4" />
        <div className="mx-auto w-full max-w-md space-y-5">
          <div className="text-center">
            <p className="text-lg font-black text-stone-900">{t(lang, "recoveryProbeTitle")}</p>
            <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "recoveryProbeSub")}</p>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-waka-600" />
          </div>

          {session.errorMessage ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
              {session.errorMessage}
            </p>
          ) : null}

          <p className="text-center text-sm font-medium leading-relaxed text-waka-900/90">
            {getDeviceOnline() ? t(lang, "recoveryProbeRetrying") : t(lang, "recoveryProbeOffline")}
          </p>

          <button
            type="button"
            onClick={onRetry}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-stone-900 text-base font-black text-white"
          >
            {t(lang, "recoveryRetry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#fffaf5] px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <WakaPosLogo size="splash" className="mb-6 mt-4" />
      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="text-center">
          <p className="text-lg font-black text-stone-900">
            {failed ? t(lang, "recoveryFailedTitle") : t(lang, "recoveryTitle")}
          </p>
          <p className="mt-1 text-sm font-medium text-stone-600">
            {failed ? t(lang, "recoveryFailedSub") : t(lang, "recoverySub")}
          </p>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-stone-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${failed ? "bg-rose-500" : "bg-waka-600"}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-center text-xs font-bold tabular-nums text-stone-500">{progressPct}%</p>

        <ul className="space-y-2 rounded-2xl border border-stone-100 bg-white/95 p-4 shadow-waka-sm">
          {DISPLAY_STEPS.map((step) => {
            const idx = stepIndex(step);
            const done = lastIdx >= idx;
            const active = currentIdx === idx && session.status === "active";
            let countLabel = "";
            if (step === "products") countLabel = String(counts.products);
            if (step === "sales") countLabel = String(counts.sales);
            if (step === "customers") countLabel = String(counts.customers);
            if (step === "inventory") countLabel = String(counts.inventory);
            if (step === "shifts") countLabel = String(counts.shifts);
            if (step === "day_closes") countLabel = String(counts.dayCloses);
            if (step === "cash") countLabel = String(counts.cashRecords);

            return (
              <li
                key={step}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${
                  active ? "bg-waka-50 font-bold text-waka-950" : done ? "text-stone-800" : "text-stone-400"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      done ? "bg-emerald-100 text-emerald-800" : active ? "bg-waka-200 text-waka-900" : "bg-stone-100"
                    }`}
                  >
                    {done ? "✓" : active ? "…" : ""}
                  </span>
                  {t(lang, stepLabelKey(step))}
                </span>
                {done && countLabel !== "0" ? (
                  <span className="tabular-nums text-xs font-black text-stone-600">{countLabel}</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {session.lastCompletedStep ? (
          <p className="text-center text-xs font-semibold text-stone-500">
            {t(lang, "recoveryLastStep")}: {t(lang, stepLabelKey(session.lastCompletedStep))}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold uppercase tracking-wide text-stone-500">
          <div className="rounded-xl bg-stone-50 px-2 py-2">
            <p>{t(lang, "recoveryCountProducts")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-stone-900">{counts.products}</p>
          </div>
          <div className="rounded-xl bg-stone-50 px-2 py-2">
            <p>{t(lang, "recoveryCountSales")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-stone-900">{counts.sales}</p>
          </div>
          <div className="rounded-xl bg-stone-50 px-2 py-2">
            <p>{t(lang, "recoveryCountCustomers")}</p>
            <p className="mt-0.5 text-base font-black tabular-nums text-stone-900">{counts.customers}</p>
          </div>
        </div>

        {failed ? (
          <div className="space-y-3">
            {session.errorMessage ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
                {session.errorMessage}
              </p>
            ) : null}
            {session.validation?.failures.length ? (
              <ul className="space-y-1 text-xs text-rose-900">
                {session.validation.failures.slice(0, 4).map((f) => (
                  <li key={f.code}>{f.message}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={onRetry}
              className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-stone-900 text-base font-black text-white"
            >
              {t(lang, "recoveryRetry")}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm font-medium leading-relaxed text-waka-900/90">{t(lang, "loadingTrustLine")}</p>
        )}
      </div>
    </div>
  );
}
