import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { t } from "../../lib/i18n";
import { readUiLanguageCacheSync, loadPersistedUiLanguage } from "../../lib/uiLanguage";
import type { Language } from "../../types";
import { EnterpriseUpdateEngine } from "../../lib/updateEngine/EnterpriseUpdateEngine";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";
import { shouldShowOverlay } from "../../lib/updateEngine/UpdateNotifications";
import { useUpdateOverlayReady } from "../../lib/updateEngine/UpdateInteractiveGate";
import { useUpdateEngine, useUpdateEngineInit } from "../../lib/updateEngine/useUpdateEngine";
import { UpdateFullScreen, UPDATE_LAYER, type UpdateScreenVariant } from "./UpdateFullScreen";

type Props = { children: ReactNode };

/**
 * PRESENTATION/CONTROLLER for the update engine — it holds no update logic of its own.
 *
 * Every surface maps onto an engine phase and every action calls straight back into
 * `EnterpriseUpdateEngine` (`startFlexibleUpdate` / `startImmediateUpdate` / `skipUpdate` /
 * `openPlayStoreFallback`). Dismissal persistence, Play Core, the Play Store fallback ladder and the
 * policy/dismissal keys all stay in the engine.
 *
 * Layering: one full-screen surface (`UPDATE_LAYER.fullScreen`, z-210) for anything that needs the
 * merchant's attention (available / mandatory / failed / post-install notes), and one bottom banner
 * layer (`UPDATE_LAYER.banner`, z-205) for the passive downloading/ready states. The old ad-hoc
 * z-180/185/186/190/200 ladder is gone.
 */
export function AppReleaseUpdateProvider({ children }: Props) {
  useUpdateEngineInit();
  const state = useUpdateEngine();
  const [lang, setLang] = useState<Language>(() => readUiLanguageCacheSync() ?? "en");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fallbackOpened, setFallbackOpened] = useState(false);
  const [openingStore, setOpeningStore] = useState(false);

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
  /** Display-only gate: the engine already runs; the surface waits for an interactive app. */
  const overlayReady = useUpdateOverlayReady(isAndroid);
  const policy = state.policy;

  const variant: UpdateScreenVariant | null =
    state.phase === "force_block"
      ? "mandatory"
      : state.phase === "flexible_prompt"
        ? "flexible"
        : state.phase === "update_failed"
          ? "failure"
          : state.phase === "whats_new"
            ? "info"
            : null;

  // The engine's own policy decides whether a phase deserves a surface; the UI only maps it.
  const phaseDeservesSurface = shouldShowOverlay(state.phase) || state.phase === "update_failed";
  const surfaceOpen =
    isAndroid && overlayReady && variant !== null && phaseDeservesSurface && state.phase !== "pwa_update";

  const versionLabel = policy?.versionNumber || null;
  const versionCodeLabel = state.playAvailableVersionCode > 0 ? `#${state.playAvailableVersionCode}` : null;

  const handleRetry = useCallback(() => {
    setActionError(null);
    setFallbackOpened(false);
    void EnterpriseUpdateEngine.checkForUpdates();
  }, []);

  const handleOpenPlayStore = useCallback(async () => {
    setBusy(true);
    setOpeningStore(true);
    try {
      const result = await EnterpriseUpdateEngine.openPlayStoreFallback();
      setFallbackOpened(result.opened);
      setActionError(result.opened ? null : result.error);
    } finally {
      setOpeningStore(false);
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

  const handleCancel = useCallback(() => {
    // Preserves the engine's version/release-keyed dismissal — no second dismissal mechanism.
    void EnterpriseUpdateEngine.skipUpdate();
  }, []);

  const handleContinue = useCallback(() => {
    void EnterpriseUpdateEngine.dismissWhatsNew();
  }, []);

  const recoveryHint = actionError || state.lastActionError;
  const offerFallback = Boolean(state.lastDecision?.fallbackOnly || recoveryHint || fallbackOpened);

  /**
   * ANDROID BACK. Registered ONLY while a surface is open and removed with it, so the app never
   * carries a permanent global back listener.
   *  - flexible → exactly Cancel (`skipUpdate()`), dismissal key included
   *  - mandatory / info / failure → swallowed: Back must not walk behind a blocking update
   */
  useEffect(() => {
    if (!isAndroid || !surfaceOpen || variant === null) return;
    let handle: { remove: () => void } | undefined;
    let disposed = false;
    void App.addListener("backButton", () => {
      if (variant === "flexible") {
        void EnterpriseUpdateEngine.skipUpdate();
      }
      // Every other variant swallows the press on purpose.
    }).then((h) => {
      if (disposed) void h.remove();
      else handle = h;
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [isAndroid, surfaceOpen, variant]);

  return (
    <>
      {children}

      {surfaceOpen && variant ? (
        <UpdateFullScreen
          variant={variant}
          lang={lang}
          versionLabel={versionLabel}
          versionCodeLabel={versionCodeLabel}
          releaseName={policy?.releaseName || null}
          notesHtml={policy?.publicNotesHtml ?? null}
          showNotes={policy ? policy.showWhatsNew !== false : false}
          busy={busy}
          openingStore={openingStore}
          errorMessage={recoveryHint}
          fallbackOffered={offerFallback}
          onCancel={variant === "flexible" ? handleCancel : undefined}
          onRetry={handleRetry}
          onOpenPlayStore={handleOpenPlayStore}
          onContinue={handleContinue}
          onUpdate={variant === "mandatory" ? handleImmediateStart : handleFlexibleStart}
        />
      ) : null}

      {isAndroid && overlayReady && state.phase === "flexible_downloading" ? (
        <div
          className={`fixed inset-x-0 bottom-0 ${UPDATE_LAYER.banner} p-4 pb-[max(1rem,env(safe-area-inset-bottom))]`}
        >
          <article className="mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 shadow-lg dark:border-waka-900">
            <EnterpriseSpinner
              size="sm"
              label={t(lang, "updateDownloadingTitle")}
              className="shrink-0 text-waka-700 dark:text-waka-300"
            />
            <p className="text-sm font-bold text-waka-950 dark:text-waka-100">
              {t(lang, "updateDownloadingBody")}
            </p>
          </article>
        </div>
      ) : null}

      {isAndroid && overlayReady && state.phase === "flexible_ready" ? (
        <div
          className={`fixed inset-x-0 bottom-0 ${UPDATE_LAYER.banner} p-4 pb-[max(1rem,env(safe-area-inset-bottom))]`}
        >
          <article className="mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg dark:border-emerald-900">
            <p className="text-sm font-bold text-emerald-950 dark:text-emerald-100">
              {t(lang, "updateReadyTitle")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleComplete()}
              className="min-h-[44px] shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-60"
            >
              {t(lang, "updateRestart")}
            </button>
          </article>
        </div>
      ) : null}
    </>
  );
}

export { EnterpriseUpdateEngine };
