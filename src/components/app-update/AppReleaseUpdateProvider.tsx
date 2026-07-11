import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { t, tTemplate } from "../../lib/i18n";
import { readUiLanguageCacheSync, loadPersistedUiLanguage } from "../../lib/uiLanguage";
import type { Language } from "../../types";
import { EnterpriseUpdateEngine } from "../../lib/updateEngine/EnterpriseUpdateEngine";
import { shouldShowOverlay } from "../../lib/updateEngine/UpdateNotifications";
import { useUpdateEngine, useUpdateEngineInit } from "../../lib/updateEngine/useUpdateEngine";

type Props = { children: ReactNode };

export function AppReleaseUpdateProvider({ children }: Props) {
  useUpdateEngineInit();
  const state = useUpdateEngine();
  const [lang, setLang] = useState<Language>(() => readUiLanguageCacheSync() ?? "en");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedUiLanguage().then((loaded) => {
      if (!cancelled) setLang(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const policy = state.policy;
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  const showAndroidOverlay =
    isAndroid &&
    (shouldShowOverlay(state.phase) || state.phase === "update_failed") &&
    state.phase !== "pwa_update" &&
    (state.phase === "update_failed" || policy != null);

  const versionLabel = policy?.versionNumber ? `v${policy.versionNumber}` : "";

  const handleRetry = useCallback(() => {
    void EnterpriseUpdateEngine.checkForUpdates();
  }, []);

  return (
    <>
      {children}

      {showAndroidOverlay && policy && state.phase === "force_block" ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-foreground/90 p-4">
          <article className="w-full max-w-md rounded-3xl border border-stone-700 bg-foreground p-6 text-background shadow-2xl">
            <h2 className="text-xl font-black">{t(lang, "updateRequiredTitle")}</h2>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {t(lang, "updateRequiredBody")}
              {policy.minimumSupportedVersion ? (
                <span className="mt-1 block">
                  {tTemplate(lang, "updateMinimumVersion", { version: policy.minimumSupportedVersion })}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void EnterpriseUpdateEngine.startImmediateUpdate()
                  .catch(() => undefined)
                  .finally(() => setBusy(false));
              }}
              className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-500 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "updateNow")}
            </button>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && policy && state.phase === "flexible_prompt" ? (
        <div className="fixed inset-0 z-[190] flex items-end justify-center bg-foreground/50 p-4 sm:items-center">
          <article className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-black text-foreground">{t(lang, "updateAvailableTitle")}</h2>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {versionLabel
                ? tTemplate(lang, "updateAvailableBodyVersioned", { version: versionLabel })
                : t(lang, "updateAvailableBody")}
            </p>
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
                onClick={() => {
                  setBusy(true);
                  void EnterpriseUpdateEngine.startFlexibleUpdate()
                    .catch(() => undefined)
                    .finally(() => setBusy(false));
                }}
                className="min-h-[48px] rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
              >
                {t(lang, "updateNow")}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && state.phase === "flexible_downloading" ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 shadow-lg">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-waka-600 border-t-transparent" />
            <p className="text-sm font-bold text-waka-950">{t(lang, "updateDownloadingBody")}</p>
          </article>
        </div>
      ) : null}

      {showAndroidOverlay && policy && state.phase === "flexible_ready" ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg">
            <p className="text-sm font-bold text-emerald-950">{t(lang, "updateReadyTitle")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void EnterpriseUpdateEngine.completeFlexibleUpdate().finally(() => setBusy(false));
              }}
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

      {showAndroidOverlay && state.phase === "update_failed" ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-lg">
            <p className="text-sm font-bold text-rose-950">{t(lang, "updateFailedBody")}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="min-h-[40px] shrink-0 rounded-xl bg-rose-700 px-4 text-sm font-black text-white"
            >
              {t(lang, "updateRetry")}
            </button>
          </article>
        </div>
      ) : null}
    </>
  );
}

export { EnterpriseUpdateEngine };
