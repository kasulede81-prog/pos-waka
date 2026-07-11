import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "../supabase";
import { androidUpdateAdapter } from "./AndroidUpdateAdapter";
import { iosUpdateAdapter } from "./IOSUpdateAdapter";
import {
  isVerifiedUpdate,
  markWhatsNewSeen,
  readLastPolicyGeneration,
  shouldLogUpdateAvailable,
  writeLastPolicyGeneration,
} from "./UpdateEligibility";
import { logUpdateEvent } from "./UpdateEvents";
import { fetchReleasePolicy, type ResolvedUpdatePolicy } from "./UpdatePolicyResolver";
import { resolveUpdateNotification, type UpdateNotificationState } from "./UpdateNotifications";
import type {
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
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
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
      let error = evaluation.error;

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

      if (shouldLogUpdateAvailable(phase, policy, this.lastLoggedReleaseId) && policy) {
        await logUpdateEvent("update_available", { policy, versions, metadata: { reason } });
        this.lastLoggedReleaseId = policy.releaseId;
      }

      this.patch({
        phase,
        policy,
        versions,
        playAvailableVersionCode: evaluation.playAvailableVersionCode,
        error,
        evaluating: false,
        notification: resolveUpdateNotification(phase),
      });
    } catch (err) {
      const message = (err as Error).message ?? "evaluate_failed";
      this.patch({
        phase: "update_failed",
        error: message,
        evaluating: false,
        notification: resolveUpdateNotification("update_failed"),
      });
    }
  }

  async startFlexibleUpdate(): Promise<void> {
    const policy = this.state.policy;
    if (!policy || !this.adapter.startFlexibleUpdate) return;
    await this.adapter.startFlexibleUpdate(policy);
    this.patch({ phase: "flexible_downloading", notification: resolveUpdateNotification("flexible_downloading") });
  }

  async startImmediateUpdate(): Promise<void> {
    const policy = this.state.policy;
    if (!policy || !this.adapter.startImmediateUpdate) return;
    await this.adapter.startImmediateUpdate(policy);
  }

  async completeFlexibleUpdate(): Promise<void> {
    const policy = this.state.policy;
    if (!policy || !this.adapter.completeFlexibleUpdate) return;
    await this.adapter.completeFlexibleUpdate(policy);
  }

  async skipUpdate(): Promise<void> {
    const policy = this.state.policy;
    if (policy) {
      await logUpdateEvent("update_cancelled", { policy, versions: this.state.versions });
    }
    this.patch({ phase: "idle", notification: resolveUpdateNotification("idle") });
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
