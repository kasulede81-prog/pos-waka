import type { AuthError, Session } from "@supabase/supabase-js";
import { getDeviceOnline } from "./deviceOnline";
import { withTimeout } from "./promiseTimeout";
import { setSessionConnectionState } from "./sessionConnectionState";

export const SESSION_GET_TIMEOUT_MS = 6000;
export const SESSION_REFRESH_TIMEOUT_MS = 8000;
export const SESSION_REFRESH_BACKOFF_MS = [1000, 5000, 15000, 30000, 60000] as const;

export type SessionRestoreSource = "live" | "cached" | "none";

export type StartupSessionResult = {
  session: Session | null;
  source: SessionRestoreSource;
  timedOut: boolean;
  offline: boolean;
};

type GetSessionResult = { data: { session: Session | null } };

function parseStoredSession(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const candidate = (root.user ? root : root.currentSession ?? root.session) as Record<string, unknown> | undefined;
    if (!candidate?.user || typeof candidate.user !== "object") return null;
    const user = candidate.user as Record<string, unknown>;
    if (typeof user.id !== "string") return null;
    if (typeof candidate.access_token !== "string") return null;
    return candidate as unknown as Session;
  } catch {
    return null;
  }
}

/** Read the last Supabase session persisted in localStorage (sync, no network). */
export function readPersistedSupabaseSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.includes("auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const session = parseStoredSession(raw);
      if (session) return session;
    }
  } catch {
    return null;
  }
  return null;
}

/** True when a cached owner session can keep the user authenticated offline. */
export function isSessionLocallyRestorable(session: Session | null | undefined): boolean {
  if (!session?.user?.id) return false;
  const refresh = session.refresh_token?.trim();
  if (refresh) return true;
  const expiresAt = session.expires_at;
  return typeof expiresAt === "number" && expiresAt * 1000 > Date.now() + 30_000;
}

export function logAuthSessionEvent(event: string, detail?: Record<string, unknown>): void {
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[waka-auth] ${event}`, detail);
    return;
  }
  console.info(`[waka-auth] ${event}`);
}

export function isSessionRevocationError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (isLikelyConnectivityError(error)) return false;
  const code = String(error.code ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();
  if (code === "session_not_found" || code === "refresh_token_not_found" || code === "invalid_grant") {
    return true;
  }
  return message.includes("invalid refresh token") || message.includes("refresh token not found");
}

export function isLikelyConnectivityError(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  if (!getDeviceOnline()) return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("connection")
  );
}

export function shouldDeferSignedOut(opts: {
  cachedSession: Session | null;
  explicitSignOut: boolean;
}): boolean {
  if (opts.explicitSignOut) return false;
  return isSessionLocallyRestorable(opts.cachedSession);
}

type TimedGetSessionResult =
  | { timedOut: false; result: GetSessionResult }
  | { timedOut: true; result: null };

export async function resolveStartupSession(
  getSession: () => Promise<GetSessionResult>,
): Promise<StartupSessionResult> {
  const offline = !getDeviceOnline();
  const timedOutResult = await withTimeout<TimedGetSessionResult>(
    getSession().then((result) => ({ timedOut: false as const, result })),
    SESSION_GET_TIMEOUT_MS,
    { timedOut: true as const, result: null },
  );

  if (!timedOutResult.timedOut && timedOutResult.result?.data.session?.user) {
    setSessionConnectionState("online");
    logAuthSessionEvent("session_restore", { source: "live", offline });
    return {
      session: timedOutResult.result.data.session,
      source: "live",
      timedOut: false,
      offline,
    };
  }

  const cached = readPersistedSupabaseSession();
  if (isSessionLocallyRestorable(cached)) {
    if (timedOutResult.timedOut) {
      logAuthSessionEvent("session_restore", {
        source: "cached",
        offline,
        reason: "getSession_timeout",
      });
      logAuthSessionEvent("refresh_postponed", { offline });
    } else {
      logAuthSessionEvent("session_restore", {
        source: "cached",
        offline,
        reason: "getSession_empty",
      });
    }
    // Keep the app feeling instant: cached session is usable while refresh runs in background.
    setSessionConnectionState(offline ? "offline_cached" : "online");
    return {
      session: cached,
      source: "cached",
      timedOut: timedOutResult.timedOut,
      offline,
    };
  }

  if (timedOutResult.timedOut) {
    logAuthSessionEvent("session_restore", { source: "none", offline, reason: "getSession_timeout" });
  }

  setSessionConnectionState("online");
  return {
    session: null,
    source: "none",
    timedOut: timedOutResult.timedOut,
    offline,
  };
}

type RefreshSessionFn = () => Promise<{ data: { session: Session | null }; error: AuthError | null }>;

type SessionRefreshCallbacks = {
  onSessionUpdated: (session: Session) => void;
  onSessionRevoked: () => void;
};

let retryTimer: number | null = null;
let retryAttempt = 0;
let refreshInFlight = false;
let activeRefreshFn: RefreshSessionFn | null = null;
let activeCallbacks: SessionRefreshCallbacks | null = null;

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function cancelSessionRefreshRetry(): void {
  clearRetryTimer();
  retryAttempt = 0;
  refreshInFlight = false;
}

export function scheduleSessionRefreshRetry(
  refreshSession: RefreshSessionFn,
  callbacks: SessionRefreshCallbacks,
): void {
  activeRefreshFn = refreshSession;
  activeCallbacks = callbacks;
  clearRetryTimer();

  const delay = SESSION_REFRESH_BACKOFF_MS[Math.min(retryAttempt, SESSION_REFRESH_BACKOFF_MS.length - 1)];
  if (!getDeviceOnline()) {
    setSessionConnectionState("offline_cached");
  }
  logAuthSessionEvent("refresh_scheduled", { delayMs: delay, attempt: retryAttempt + 1 });

  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void runSessionRefreshAttempt();
  }, delay);
}

export async function runSessionRefreshAttempt(): Promise<void> {
  if (refreshInFlight || !activeRefreshFn || !activeCallbacks) return;
  refreshInFlight = true;
  const offline = !getDeviceOnline();

  try {
    if (offline) {
      setSessionConnectionState("offline_cached");
      logAuthSessionEvent("refresh_postponed", { offline: true });
      scheduleSessionRefreshRetry(activeRefreshFn, activeCallbacks);
      return;
    }

    logAuthSessionEvent("refresh_attempt", { attempt: retryAttempt + 1 });

    const { data, error } = await withTimeout(
      activeRefreshFn(),
      SESSION_REFRESH_TIMEOUT_MS,
      {
        data: { session: null },
        error: {
          name: "AuthRetryableFetchError",
          message: "refresh timeout",
          status: 0,
        } as AuthError,
      },
    );
    if (data.session?.user) {
      retryAttempt = 0;
      setSessionConnectionState("online");
      logAuthSessionEvent("refresh_succeeded", { userId: data.session.user.id });
      activeCallbacks.onSessionUpdated(data.session);
      return;
    }

    if (isSessionRevocationError(error)) {
      retryAttempt = 0;
      logAuthSessionEvent("refresh_revoked", { code: error?.code ?? null });
      activeCallbacks.onSessionRevoked();
      return;
    }

    const cached = readPersistedSupabaseSession();
    if (isSessionLocallyRestorable(cached)) {
      retryAttempt += 1;
      setSessionConnectionState(getDeviceOnline() ? "online" : "offline_cached");
      logAuthSessionEvent("refresh_failed", {
        code: error?.code ?? null,
        connectivity: isLikelyConnectivityError(error) || offline,
      });
      scheduleSessionRefreshRetry(activeRefreshFn, activeCallbacks);
      return;
    }

    if (error) {
      retryAttempt = 0;
      logAuthSessionEvent("refresh_revoked", { code: error.code ?? null });
      activeCallbacks.onSessionRevoked();
    }
  } finally {
    refreshInFlight = false;
  }
}

export function triggerSessionRefreshOnReconnect(
  refreshSession: RefreshSessionFn,
  callbacks: SessionRefreshCallbacks,
): void {
  retryAttempt = 0;
  scheduleSessionRefreshRetry(refreshSession, callbacks);
}
