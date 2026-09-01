import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { t, tTemplate } from "../../lib/i18n";
import { readUiLanguageCacheSync, loadPersistedUiLanguage } from "../../lib/uiLanguage";
import type { Language } from "../../types";
import { EnterpriseUpdateEngine } from "../../lib/updateEngine/EnterpriseUpdateEngine";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";
import { shouldShowOverlay } from "../../lib/updateEngine/UpdateNotifications";
import { useUpdateOverlayReady } from "../../lib/updateEngine/UpdateInteractiveGate";
import { useUpdateEngine, useUpdateEngineInit } from "../../lib/updateEngine/useUpdateEngine";

type Props = { children: ReactNode };

export function AppReleaseUpdateProvider({ children }: Props) {
  // Engine evaluation starts immediately — it does NOT wait behind startup. Overlay timing is gated separately.
  useUpdateEngineInit();
  const state = useUpdateEngine();
  const [lang, setLang] = useState<Language>(() => readUiLanguageCacheSync() ?? "en");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fallbackOpened, setFallbackOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedUiLanguage().then((loaded) => {
      if (!cancelled) setLang(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  /**
   * ANDROID-UPDATE-P1: overlay is delayed until the app is interactive AND no
   * startup / recovery / activation surface is mounted. The engine itself is
   * already running — this is display-only (T8).
   */
  const overlayReady = useUpdateOverlayReady(isAndroid);
  const policy = state.policy;
  const playOverlayPhase =
    shouldShowOverlay(state.phase) || state.phase === "update_failed";
  const showAndroidOverlay =
    isAndroid &&
    overlayReady &&
    playOverlayPhase &&
    state.phase !== "pwa_update";

  const versionLabel =
    policy?.versionNumber
      ? `v${policy.versionNumber}`
      : state.playAvailableVersionCode > 0
        ? `#${state.playAvailableVersionCode}`
        : "";

  const handleRetry = useCallback(() => {
    setActionError(null);
    setFallbackOpened(false);
    void EnterpriseUpdateEngine.checkForUpdates();
  }, []);

  const handleOpenPlayStore = useCallback(async () => {
    setBusy(true);
    try {
      const result = await EnterpriseUpdateEngine.openPlayStoreFallback();
      setFallbackOpened(result.opened);
      setActionError(result.opened ? null : result.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleFlexibleStart = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const outcome = await EnterpriseUpdateEngine.startFlexibleUpdate();
      setFallbackOpened(outcome.fallbackOpened);
      setActionError(outcome.ok || outcome.fallbackOpened ? null : outcome.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleImmediateStart = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const outcome = await EnterpriseUpdateEngine.startImmediateUpdate();
      setFallbackOpened(outcome.fallbackOpened);
      setActionError(outcome.ok || outcome.fallbackOpened ? null : outcome.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleComplete = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const outcome = await EnterpriseUpdateEngine.completeFlexibleUpdate();
      setActionError(outcome.ok ? null : outcome.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const recoveryHint = actionError || state.lastActionError;
  const offerFallback = Boolean(state.lastDecision?.fallbackOnly || recoveryHint || fallbackOpened);
  const recoveryBanner =
    showAndroidOverlay && (state.phase === "update_failed" || recoveryHint) ? (
      <div className="fixed inset-x-0 bottom-0 z-[186] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <article className="mx-auto flex max-w-lg flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-lg">
          <p className="text-sm font-bold text-rose-950">
            {fallbackOpened ? t(lang, "updatePlayStoreOpenedBody") : t(lang, "updateFailedBody")}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="min-h-[40px] shrink-0 rounded-xl border border-rose-300 px-4 text-sm font-black text-rose-900"
            >
              {t(lang, "updateRetry")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleOpenPlayStore()}
              className="min-h-[40px] shrink-0 rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "updateOpenPlayStore")}
            </button>
          </div>
        </article>
      </div>
    ) : null;

  return (
    <>
      {children}

      {showAndroidOverlay && state.phase === "force_block" ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/90 p-4">
          <article className="w-full max-w-md rounded-3xl border border-stone-700 bg-foreground p-6 text-background shadow-2xl">
            <h2 className="text-xl font-black">{t(lang, "updateRequiredTitle")}</h2>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {t(lang, "updateRequiredBody")}
              {policy?.minimumSupportedVersion ? (
                <span className="mt-1 block">
                  {tTemplate(lang, "updateMinimumVersion", { version: policy.minimumSupportedVersion })}
                </span>
              ) : null}
            </p>
            {recoveryHint ? (
              <p className="mt-3 text-sm font-semibold text-rose-200">{t(lang, "updatePlayCoreFailedBody")}</p>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleImmediateStart()}
              className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-500 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "updateNow")}
            </button>
            {offerFallback ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleOpenPlayStore()}
                className="mt-2 min-h-[48px] w-full rounded-2xl border border-stone-500 text-sm font-bold text-background disabled:opacity-50"
              >
                {t(lang, "updateOpenPlayStore")}
              </button>
            ) : null}
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && state.phase === "flexible_prompt" ? (
        <div className="fixed inset-0 z-[190] flex items-end justify-center bg-foreground/50 p-4 sm:items-center">
          <article className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-black text-foreground">{t(lang, "updateAvailableTitle")}</h2>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {versionLabel
                ? tTemplate(lang, "updateAvailableBodyVersioned", { version: versionLabel })
                : t(lang, "updateAvailableBody")}
            </p>
            {recoveryHint ? (
              <p className="mt-3 text-sm font-semibold text-rose-700">{t(lang, "updatePlayCoreFailedBody")}</p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void EnterpriseUpdateEngine.skipUpdate()}
                className="min-h-[48px] rounded-2xl border border-border text-sm font-bold text-muted-foreground"
              >
                {t(lang, "updateLater")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFlexibleStart()}
                className="min-h-[48px] rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
              >
                {t(lang, "updateNow")}
              </button>
            </div>
            {offerFallback ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleOpenPlayStore()}
                className="mt-2 min-h-[40px] w-full rounded-2xl text-sm font-bold text-muted-foreground disabled:opacity-50"
              >
                {t(lang, "updateOpenPlayStore")}
              </button>
            ) : null}
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && state.phase === "flexible_downloading" ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 shadow-lg">
            <EnterpriseSpinner size="sm" label={t(lang, "updateDownloadingBody")} className="text-waka-600 shrink-0" />
            <p className="text-sm font-bold text-waka-950">{t(lang, "updateDownloadingBody")}</p>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && state.phase === "flexible_ready" ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg">
            <p className="text-sm font-bold text-emerald-950">{t(lang, "updateReadyTitle")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleComplete()}
              className="min-h-[40px] shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white"
            >
              {t(lang, "updateRestart")}
            </button>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && policy && state.phase === "whats_new" ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-foreground/60 p-4">
          <article className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-black text-foreground">{t(lang, "updateWhatsNewTitle")}</h2>
            {policy.versionNumber ? (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                {tTemplate(lang, "updateWhatsNewVersion", { version: policy.versionNumber })}
              </p>
            ) : null}
            <div
              className="prose prose-sm mt-4 max-w-none text-foreground"
              dangerouslySetInnerHTML={{
                __html: policy.publicNotesHtml || `<p>${t(lang, "updateWhatsNewFallback")}</p>`,
              }}
            />
            <button
              type="button"
              onClick={() => void EnterpriseUpdateEngine.dismissWhatsNew()}
              className="mt-6 min-h-[48px] w-full rounded-2xl bg-foreground text-sm font-black text-background"
            >
              {t(lang, "updateContinue")}
            </button>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && state.phase === "update_failed" ? recoveryBanner : null}
    </>
  );
}

export { EnterpriseUpdateEngine };
