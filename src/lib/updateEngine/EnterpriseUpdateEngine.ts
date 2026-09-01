import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "../supabase";
import { androidUpdateAdapter } from "./AndroidUpdateAdapter";
import { iosUpdateAdapter } from "./IOSUpdateAdapter";
import type { AndroidUpdateDecision } from "./UpdateDecision";
import { markUpdateDismissed, updateDismissalKey } from "./UpdateDismissal";
import {
  isVerifiedUpdate,
  markWhatsNewSeen,
  readLastPolicyGeneration,
  shouldLogUpdateAvailable,
  updateAvailableLogKey,
  writeLastPolicyGeneration,
} from "./UpdateEligibility";
import { logUpdateEvent } from "./UpdateEvents";
import { isUpdatePathOffline } from "./UpdateNetwork";
import { fetchReleasePolicy, type ResolvedUpdatePolicy } from "./UpdatePolicyResolver";
import { resolveUpdateNotification, type UpdateNotificationState } from "./UpdateNotifications";
import { openPlayStoreListing, type PlayStoreFallbackResult } from "./PlayStoreFallback";
import type {
  UpdateActionOutcome,
  UpdateEvaluateReason,
  UpdatePhase,
  UpdatePlatform,
  UpdatePlatformAdapter,
} from "./UpdatePlatformAdapter";
import { detectUpdatePlatform, readInstalledVersion, resolveVersions, type VersionResolution } from "./UpdateVersionResolver";
import { webUpdateAdapter } from "./WebUpdateAdapter";
import { windowsUpdateAdapter } from "./WindowsUpdateAdapter";

const FOREGROUND_POLL_MS = 20 * 60 * 1000;

export type UpdateEngineState = {
  phase: UpdatePhase;
  platform: UpdatePlatform;
  policy: ResolvedUpdatePolicy | null;
  versions: VersionResolution;
  playAvailableVersionCode: number;
  error: string | null;
  notification: UpdateNotificationState;
  lastReason: UpdateEvaluateReason | null;
  evaluating: boolean;
  /** ANDROID-UPDATE-P1 — last Android decision (severity / source / fallback). */
  lastDecision: AndroidUpdateDecision | null;
  /** ANDROID-UPDATE-P1 — last user-triggered action error, never swallowed. */
  lastActionError: string | null;
  fallbackOffered: boolean;
};

type StateListener = (state: UpdateEngineState) => void;

function pickAdapter(platform: UpdatePlatform): UpdatePlatformAdapter {
  if (platform === "android") return androidUpdateAdapter;
  if (platform === "web") return webUpdateAdapter;
  if (platform === "ios") return iosUpdateAdapter;
  return windowsUpdateAdapter;
}

function baseState(platform: UpdatePlatform): UpdateEngineState {
  return {
    phase: "idle",
    platform,
    policy: null,
    versions: {
      installedVersion: import.meta.env.VITE_APP_VERSION?.trim() || "0",
      installedVersionCode: 0,
      publishedVersion: null,
      publishedVersionCode: null,
      minimumSupportedVersion: null,
      minimumSupportedVersionCode: null,
      updateType: null,
      forceUpdate: false,
      pilotEligible: true,
      platform,
    },
    playAvailableVersionCode: 0,
    error: null,
    notification: resolveUpdateNotification("idle"),
    lastReason: null,
    evaluating: false,
    lastDecision: null,
    lastActionError: null,
    fallbackOffered: false,
  };
}

class EnterpriseUpdateEngineImpl {
  private initialized = false;
  private listeners = new Set<StateListener>();
  private state: UpdateEngineState = baseState(detectUpdatePlatform());
  private adapter: UpdatePlatformAdapter = pickAdapter(this.state.platform);
  private disposeFns: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private lastLoggedReleaseId: string | null = null;
  private evaluateQueue: Promise<void> = Promise.resolve();
  private appActive = true;

  getState(): UpdateEngineState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(next: UpdateEngineState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private patch(partial: Partial<UpdateEngineState>): void {
    const next = {
      ...this.state,
      ...partial,
      notification: partial.phase
        ? resolveUpdateNotification(partial.phase)
        : partial.notification ?? this.state.notification,
    };
    this.emit(next);
  }

  initialize(): () => void {
    if (this.initialized) return () => this.dispose();
    this.initialized = true;

    const platform = detectUpdatePlatform();
    this.adapter = pickAdapter(platform);
    this.state = baseState(platform);

    const onSignal = (reason: UpdateEvaluateReason) => {
      void this.evaluate(reason);
    };

    const adapterDispose = this.adapter.initialize?.({ onPlatformSignal: onSignal });
    if (adapterDispose) this.disposeFns.push(adapterDispose);

    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => {
        this.appActive = isActive;
        if (isActive) {
          void this.evaluate("foreground");
          this.startPolling();
        } else {
          this.stopPolling();
        }
      }).then((handle) => {
        this.disposeFns.push(() => {
          void handle.remove();
        });
      });
    } else {
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          void this.evaluate("foreground");
          this.startPolling();
        } else {
          this.stopPolling();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      this.disposeFns.push(() => document.removeEventListener("visibilitychange", onVisible));
    }

    const onOnline = () => void this.evaluate("reconnect");
    window.addEventListener("online", onOnline);
    this.disposeFns.push(() => window.removeEventListener("online", onOnline));
    window.addEventListener("waka:network-online", onOnline);
    this.disposeFns.push(() => window.removeEventListener("waka:network-online", onOnline));

    this.startPolling();
    void this.setupRealtime();
    void this.evaluate("startup");

    return () => this.dispose();
  }

  private dispose(): void {
    this.stopPolling();
    if (this.realtimeChannel) {
      void supabase?.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
    this.initialized = false;
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (this.appActive || !Capacitor.isNativePlatform()) {
        void this.evaluate("poll");
      }
    }, FOREGROUND_POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async setupRealtime(): Promise<void> {
    if (!hasSupabaseConfig || !supabase) return;
    try {
      const channel = supabase
        .channel("waka-app-release-policy")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_releases", filter: "status=eq.published" },
          () => {
            void this.evaluate("realtime");
          },
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            /* polling fallback remains active */
          }
        });
      this.realtimeChannel = channel;
      this.disposeFns.push(() => {
        void supabase?.removeChannel(channel);
      });
    } catch {
      /* polling fallback */
    }
  }

  async evaluate(reason: UpdateEvaluateReason): Promise<UpdateEngineState> {
    this.evaluateQueue = this.evaluateQueue.then(() => this.evaluateInternal(reason));
    await this.evaluateQueue;
    return this.state;
  }

  async checkForUpdates(): Promise<UpdateEngineState> {
    return this.evaluate("manual");
  }

  private async evaluateInternal(reason: UpdateEvaluateReason): Promise<void> {
    this.patch({ evaluating: true, lastReason: reason });

    try {
      const installed = await readInstalledVersion();
      const offline = await isUpdatePathOffline();
      let policy: ResolvedUpdatePolicy | null = null;

      if (this.state.platform === "android") {
        try {
          policy = await fetchReleasePolicy();
        } catch {
          policy = null;
        }
      }

      const versions = resolveVersions(installed, policy);
      const preserveDownloadingPhase = this.state.phase === "flexible_downloading";
      const pwaUpdatePending =
        this.state.platform === "web" && "isPwaUpdatePending" in this.adapter
          ? (this.adapter as typeof webUpdateAdapter).isPwaUpdatePending()
          : false;

      if (policy && this.state.platform === "android") {
        const lastGeneration = await readLastPolicyGeneration();
        if (policy.policyGeneration > lastGeneration) {
          await writeLastPolicyGeneration(policy.policyGeneration);
        }
      }

      const evaluation = await this.adapter.evaluate({
        policy,
        versions,
        reason,
        offline,
        pwaUpdatePending,
        preserveDownloadingPhase,
      });

      const previousPhase = this.state.phase;
      let phase = evaluation.phase;
      const error = evaluation.error;
      const lastDecision = evaluation.decision ?? this.state.lastDecision;

      if (phase === "flexible_ready" && previousPhase !== "flexible_ready" && policy) {
        await logUpdateEvent("update_download_completed", { policy, versions });
      }

      if (offline && phase !== "pwa_update") {
        phase = "offline";
      }

      if (
        policy &&
        isVerifiedUpdate(versions, policy) &&
        (phase === "no_update" || phase === "idle") &&
        (reason === "startup" || reason === "foreground" || reason === "manual")
      ) {
        await logUpdateEvent("update_verified", { policy, versions });
      }

      if (shouldLogUpdateAvailable(phase, policy, this.lastLoggedReleaseId, evaluation.playAvailableVersionCode)) {
        await logUpdateEvent("update_available", { policy, versions, metadata: { reason } });
        this.lastLoggedReleaseId = updateAvailableLogKey(policy, evaluation.playAvailableVersionCode);
      }

      this.patch({
        phase,
        policy,
        versions,
        playAvailableVersionCode: evaluation.playAvailableVersionCode,
        error,
        evaluating: false,
        lastDecision,
        lastActionError: null,
        fallbackOffered: lastDecision?.fallbackOnly === true,
        notification: resolveUpdateNotification(phase),
      });
    } catch (err) {
      const message = (err as Error).message ?? "evaluate_failed";
      this.patch({
        phase: "update_failed",
        error: message,
        evaluating: false,
        lastActionError: message,
        notification: resolveUpdateNotification("update_failed"),
      });
    }
  }

  /** ANDROID-UPDATE-P1: Play Store listing — only when Play Core cannot start. */
  async openPlayStoreFallback(): Promise<PlayStoreFallbackResult> {
    const result = await openPlayStoreListing({ isAndroid: this.state.platform === "android" });
    this.patch({
      lastActionError: result.opened ? this.state.lastActionError : result.error,
      fallbackOffered: true,
    });
    return result;
  }

  private async runPlayCoreAction(
    kind: "flexible" | "immediate" | "complete",
  ): Promise<UpdateActionOutcome> {
    const policy = this.state.policy;
    const decision = this.state.lastDecision;

    const hasFn =
      kind === "flexible"
        ? Boolean(this.adapter.startFlexibleUpdate)
        : kind === "immediate"
          ? Boolean(this.adapter.startImmediateUpdate)
          : Boolean(this.adapter.completeFlexibleUpdate);

    if (!hasFn) {
      return { ok: false, fallbackOpened: false, fallbackVia: "none", error: "adapter_missing" };
    }

    const shouldFallbackDirectly = decision?.fallbackOnly === true || decision?.playCoreUsable === false;
    if (shouldFallbackDirectly && kind !== "complete") {
      const fallback = await this.openPlayStoreFallback();
      this.patch({
        lastActionError: fallback.opened ? null : fallback.error,
        fallbackOffered: true,
        error: fallback.opened ? this.state.error : fallback.error,
      });
      return {
        ok: fallback.opened,
        fallbackOpened: fallback.opened,
        fallbackVia: fallback.via,
        error: fallback.opened ? null : fallback.error,
      };
    }

    try {
      const raw =
        kind === "flexible"
          ? await this.adapter.startFlexibleUpdate?.(policy)
          : kind === "immediate"
            ? await this.adapter.startImmediateUpdate?.(policy)
            : await this.adapter.completeFlexibleUpdate?.(policy);
      const started =
        raw == null
          ? true
          : "started" in raw
            ? Boolean(raw.started)
            : "completed" in raw
              ? Boolean(raw.completed)
              : true;
      if (!started) {
        // User cancelled the Play UI — not a failure, and not a fallback case.
        return { ok: false, fallbackOpened: false, fallbackVia: "none", error: "user_cancelled" };
      }
      if (kind === "flexible") {
        this.patch({
          phase: "flexible_downloading",
          lastActionError: null,
          notification: resolveUpdateNotification("flexible_downloading"),
        });
      }
      return { ok: true, fallbackOpened: false, fallbackVia: "none", error: null };
    } catch (err) {
      const message = (err as Error).message ?? `${kind}_start_failed`;
      await logUpdateEvent("update_failed", {
        policy,
        versions: this.state.versions,
        metadata: { step: `start_${kind}`, message },
      }).catch(() => undefined);

      // ANDROID-UPDATE-P1: never swallow — offer the Play Store listing as recovery.
      const fallback = kind === "complete" ? { opened: false, via: "none" as const, error: message } : await this.openPlayStoreFallback();
      this.patch({
        phase: kind === "complete" ? this.state.phase : "update_failed",
        lastActionError: message,
        error: message,
        fallbackOffered: fallback.opened || kind !== "complete",
        notification: resolveUpdateNotification(kind === "complete" ? this.state.phase : "update_failed"),
      });
      return {
        ok: false,
        fallbackOpened: fallback.opened,
        fallbackVia: fallback.via,
        error: message,
      };
    }
  }

  async startFlexibleUpdate(): Promise<UpdateActionOutcome> {
    return this.runPlayCoreAction("flexible");
  }

  async startImmediateUpdate(): Promise<UpdateActionOutcome> {
    return this.runPlayCoreAction("immediate");
  }

  async completeFlexibleUpdate(): Promise<UpdateActionOutcome> {
    return this.runPlayCoreAction("complete");
  }

  async skipUpdate(): Promise<void> {
    const policy = this.state.policy;
    const decision = this.state.lastDecision;
    if (decision?.severity === "mandatory") {
      // Mandatory updates cannot be dismissed — leave the overlay in place.
      return;
    }
    if (policy) {
      await logUpdateEvent("update_cancelled", { policy, versions: this.state.versions }).catch(() => undefined);
    }
    const key = updateDismissalKey({
      availableVersionCode: this.state.playAvailableVersionCode,
      releaseId: policy?.releaseId ?? null,
    });
    await markUpdateDismissed(key);
    this.patch({
      phase: "idle",
      lastDecision: decision ? { ...decision, dismissed: true } : decision,
      notification: resolveUpdateNotification("idle"),
    });
  }

  async dismissWhatsNew(): Promise<void> {
    await markWhatsNewSeen(this.state.versions.installedVersionCode);
    this.patch({ phase: "idle", notification: resolveUpdateNotification("idle") });
  }

  async logDownloadCompleted(): Promise<void> {
    const policy = this.state.policy;
    if (!policy) return;
    await logUpdateEvent("update_download_completed", { policy, versions: this.state.versions });
  }

  reloadWebApp(): void {
    if (this.adapter.reloadWebApp) {
      this.adapter.reloadWebApp();
    } else if (this.adapter.markPwaUpdateSeen) {
      this.adapter.markPwaUpdateSeen();
    }
    this.patch({ phase: "idle", notification: resolveUpdateNotification("idle") });
  }

  dismissPwaUpdateBanner(): void {
    if (this.adapter.markPwaUpdateSeen) {
      this.adapter.markPwaUpdateSeen();
    }
    this.patch({ phase: "idle", notification: resolveUpdateNotification("idle") });
  }
}

export const EnterpriseUpdateEngine = new EnterpriseUpdateEngineImpl();

export type { ResolvedUpdatePolicy, VersionResolution };
