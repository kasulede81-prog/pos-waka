import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  getStartupDiagnosticsSnapshot,
  startupStepLabelKey,
  subscribeStartupDiagnostics,
  type StartupStepId,
} from "../../lib/startupDiagnostics";
import { WakaStartupBrand } from "../brand/WakaStartupBrand";
import { StartupProgressBar } from "./StartupProgressBar";

export const STARTUP_SCREEN_BG = "bg-card";

type Props = {
  lang: Language;
  step?: StartupStepId;
  /** 0–100 when progress is known (e.g. cloud recovery) */
  progress?: number;
  showLogo?: boolean;
  compactLogo?: boolean;
};

export function StartupLoadingScreen({
  lang,
  step,
  progress,
  showLogo = true,
  compactLogo = false,
}: Props) {
  const [currentStep, setCurrentStep] = useState(step ?? getStartupDiagnosticsSnapshot().currentStep);

  useEffect(() => {
    if (step) {
      setCurrentStep(step);
      return;
    }
    const sync = () => setCurrentStep(getStartupDiagnosticsSnapshot().currentStep);
    sync();
    return subscribeStartupDiagnostics(sync);
  }, [step]);

  const labelKey = startupStepLabelKey(currentStep);

  return (
    <div
      className={`flex min-h-dvh flex-col items-center justify-center ${STARTUP_SCREEN_BG} px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]`}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        {showLogo ? <WakaStartupBrand compact={compactLogo} /> : null}

        <div className="w-full space-y-4">
          <StartupProgressBar value={progress} />
          <p className="text-center text-sm font-semibold tracking-wide text-muted-foreground">{t(lang, labelKey)}</p>
        </div>
      </div>
    </div>
  );
}
