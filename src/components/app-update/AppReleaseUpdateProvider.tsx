import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import {
  completeFlexibleAppUpdate,
  evaluateAppReleaseUpdate,
  logDownloadCompleted,
  logUpdateSkipped,
  markWhatsNewSeen,
  startFlexibleAppUpdate,
  startImmediateAppUpdate,
  type AppReleaseUpdateState,
} from "../../lib/appReleaseUpdate";
import { WakaAppUpdate } from "../../lib/nativeAppUpdate";

type Props = { children: ReactNode };

export function AppReleaseUpdateProvider({ children }: Props) {
  const [state, setState] = useState<AppReleaseUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const policyRef = useRef(state?.policy);

  policyRef.current = state?.policy;

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
    const next = await evaluateAppReleaseUpdate();
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
    const sub = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refresh();
    });
    let flexHandle: { remove: () => void } | undefined;
    void WakaAppUpdate.addListener("flexibleUpdateDownloaded", () => {
      const p = policyRef.current;
      if (p) void logDownloadCompleted(p);
      void refresh();
    }).then((h) => {
      flexHandle = h;
    });
    return () => {
      void sub.then((s) => s.remove());
      flexHandle?.remove();
    };
  }, [refresh]);

  const policy = state?.policy;
  const blockForForce = state?.phase === "force_block" && policy != null;
  const showFlexiblePrompt = state?.phase === "flexible_prompt" && policy != null;
  const showFlexibleReady = state?.phase === "flexible_ready" && policy != null;
  const showWhatsNew = state?.phase === "whats_new" && policy != null;

  return (
    <>
      {children}

      {blockForForce ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-950/90 p-4">
          <article className="w-full max-w-md rounded-3xl border border-stone-700 bg-stone-900 p-6 text-white shadow-2xl">
            <h2 className="text-xl font-black">Update required</h2>
            <p className="mt-2 text-sm font-medium text-stone-300">
              A newer version of WakaPOS is required before continuing.
              {policy.minimumSupportedVersion ? (
                <span className="mt-1 block">Minimum version: {policy.minimumSupportedVersion}</span>
              ) : null}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void startImmediateAppUpdate(policy)
                  .catch(() => undefined)
                  .finally(() => setBusy(false));
              }}
              className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-500 text-sm font-black text-white disabled:opacity-50"
            >
              Update now
            </button>
          </article>
        </div>
      ) : null}

      {showFlexiblePrompt ? (
        <div className="fixed inset-0 z-[190] flex items-end justify-center bg-stone-950/50 p-4 sm:items-center">
          <article className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-black text-stone-950">Update available</h2>
            <p className="mt-2 text-sm font-medium text-stone-600">
              A new version of WakaPOS is available.
              {policy.versionNumber ? ` (v${policy.versionNumber})` : ""}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void logUpdateSkipped(policy);
                  setState((s) => (s ? { ...s, phase: "idle" } : s));
                }}
                className="min-h-[48px] rounded-2xl border border-stone-200 text-sm font-bold text-stone-700"
              >
                Later
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void startFlexibleAppUpdate(policy)
                    .then(() => setState((s) => (s ? { ...s, phase: "flexible_downloading" } : s)))
                    .catch(() => undefined)
                    .finally(() => setBusy(false));
                }}
                className="min-h-[48px] rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
              >
                Update now
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {showFlexibleReady ? (
        <div className="fixed inset-x-0 bottom-0 z-[185] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <article className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg">
            <p className="text-sm font-bold text-emerald-950">Update ready.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void completeFlexibleAppUpdate(policy).finally(() => setBusy(false));
              }}
              className="min-h-[40px] shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-black text-white"
            >
              Restart
            </button>
          </article>
        </div>
      ) : null}

      {showWhatsNew ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-stone-950/60 p-4">
          <article className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black text-stone-950">What&apos;s New</h2>
            {policy.versionNumber ? (
              <p className="mt-1 text-sm font-semibold text-stone-500">Version {policy.versionNumber}</p>
            ) : null}
            <div
              className="prose prose-sm mt-4 max-w-none text-stone-800"
              dangerouslySetInnerHTML={{ __html: policy.publicNotesHtml || "<p>Thanks for updating WakaPOS!</p>" }}
            />
            <button
              type="button"
              onClick={() => {
                void markWhatsNewSeen(state!.currentVersionCode);
                setState((s) => (s ? { ...s, phase: "idle" } : s));
              }}
              className="mt-6 min-h-[48px] w-full rounded-2xl bg-stone-900 text-sm font-black text-white"
            >
              Continue
            </button>
          </article>
        </div>
      ) : null}
    </>
  );
}
