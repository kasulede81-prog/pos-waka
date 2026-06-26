import { useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { StartupLoadingScreen } from "./StartupLoadingScreen";
import { StartupEscapeActions } from "./StartupEscapeActions";
import {
  getStartupDiagnosticsSnapshot,
  markStartupStalled,
  recordStartupStep,
  resetStartupSessionForRetry,
  subscribeStartupDiagnostics,
  type StartupStepId,
} from "../../lib/startupDiagnostics";
import { forceHideNativeSplash, scheduleSplashMaxDuration, scheduleSplashSafetyTimeout } from "../../lib/nativeSplash";
import { isAuthHandoffPath } from "../../lib/nativeApp";
import { STARTUP_SCREEN_BG } from "./StartupLoadingScreen";

export const STARTUP_STALL_MS = 15_000;

type Props = {
  lang: Language;
  langReady: boolean;
  authInitializing: boolean;
  isAuthenticated: boolean;
  onSignOut: () => void | Promise<void>;
  children: ReactNode;
};

export function StartupBootstrapGate({
  lang,
  langReady,
  authInitializing,
  isAuthenticated,
  onSignOut,
  children,
}: Props) {
  const [stalled, setStalled] = useState(false);
  const [step, setStep] = useState<StartupStepId>(() => getStartupDiagnosticsSnapshot().currentStep);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      scheduleSplashMaxDuration();
      scheduleSplashSafetyTimeout();
    }
  }, []);

  useEffect(() => {
    if (!langReady) {
      recordStartupStep("language_load");
      return;
    }
    if (authInitializing) {
      recordStartupStep("auth_session");
      return;
    }
    if (!isAuthenticated) {
      recordStartupStep("ready");
      void forceHideNativeSplash();
    }
  }, [langReady, authInitializing, isAuthenticated]);

  useEffect(() => {
    const sync = () => setStep(getStartupDiagnosticsSnapshot().currentStep);
    sync();
    return subscribeStartupDiagnostics(sync);
  }, []);

  useEffect(() => {
    if (langReady && !authInitializing) {
      setStalled(false);
      return;
    }
    const tick = () => {
      const snap = getStartupDiagnosticsSnapshot();
      const stallMs = Date.now() - new Date(snap.lastStepAt).getTime();
      if (stallMs >= STARTUP_STALL_MS) {
        markStartupStalled();
        setStalled(true);
        void forceHideNativeSplash();
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [langReady, authInitializing]);

  const bypassForAuthHandoff =
    typeof window !== "undefined" && isAuthHandoffPath(window.location.pathname);

  // #region agent log
  useEffect(() => {
    void import("../../lib/debugSessionLog").then(({ debugSessionLog }) =>
      debugSessionLog({
        location: "StartupBootstrapGate",
        message: "gate state",
        hypothesisId: "B",
        data: { langReady, authInitializing, isAuthenticated, bypassForAuthHandoff, path: window.location.pathname },
      }),
    );
  }, [langReady, authInitializing, isAuthenticated, bypassForAuthHandoff]);
  // #endregion

  if ((langReady && !authInitializing) || bypassForAuthHandoff) {
    return <>{children}</>;
  }

  if (stalled) {
    return (
      <div className={`min-h-dvh ${STARTUP_SCREEN_BG} px-5 py-[max(2rem,env(safe-area-inset-top))]`}>
        <StartupLoadingScreen lang={lang} step={step} showLogo={false} />
        <div className="mx-auto mt-6 max-w-md">
          <StartupEscapeActions
            lang={lang}
            title={t(lang, "startupStalledTitle")}
            subtitle={t(lang, "startupStalledSub")}
            onRetry={() => {
              resetStartupSessionForRetry();
              setStalled(false);
              window.location.reload();
            }}
            onSignOut={onSignOut}
          />
        </div>
      </div>
    );
  }

  return <StartupLoadingScreen lang={lang} step={step} />;
}
