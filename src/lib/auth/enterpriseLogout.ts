/**
 * Phase M0.1 — Enterprise mobile logout reliability.
 *
 * Single local-first logout path for iOS / Android / Desktop / Web.
 * Must clear the authenticated session even when the device is offline.
 */

import { Capacitor } from "@capacitor/core";
import { clearStaffSessionPersistence } from "./staffSession";
import { clearStaffAuth, clearRememberedStaffDevice } from "../staffOfflineAuth";
import {
  cancelSessionRefreshRetry,
  logAuthSessionEvent,
} from "../offlineSessionResilience";
import { resetSessionConnectionState } from "../sessionConnectionState";
import { flushPendingPersist, usePosStore } from "../../store/usePosStore";
import { setActiveAccountKey } from "../../offline/accountScope";
import { hasSupabaseConfig, supabase } from "../supabase";
import { getDeviceOnline } from "../deviceOnline";
import { withTimeout } from "../promiseTimeout";
import { queryClient } from "../queryClient";
import { appendPilotEvent } from "../pilotEventLog";

const LOCAL_AUTH_KEY = "waka-pos-local-session";
const SIGN_OUT_TIMEOUT_MS = 2500;

let logoutInFlight: Promise<void> | null = null;
let explicitLogoutLatch = false;

export function isExplicitLogoutInProgress(): boolean {
  return explicitLogoutLatch || logoutInFlight != null;
}

/** Remove persisted Supabase auth tokens so offline restore cannot revive the session. */
export function clearPersistedSupabaseAuthTokens(): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      // Supabase persists as `sb-<project-ref>-auth-token` (and related auth keys).
      if (key.includes("auth-token") || /-auth-token$/i.test(key)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    /* ignore quota / private mode */
  }
  return removed;
}

function clearSessionStorageSafely(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

async function signOutSupabaseLocalFirst(): Promise<void> {
  if (!hasSupabaseConfig || !supabase) return;

  // Local scope does not require network — critical for offline + iOS WebView.
  await withTimeout(
    supabase.auth.signOut({ scope: "local" }).then(() => undefined),
    SIGN_OUT_TIMEOUT_MS,
    undefined,
  );

  // Best-effort server revoke when online; never block logout on network.
  if (getDeviceOnline()) {
    void withTimeout(
      supabase.auth.signOut({ scope: "global" }).then(() => undefined).catch(() => undefined),
      SIGN_OUT_TIMEOUT_MS,
      undefined,
    );
  }
}

export type EnterpriseLogoutOptions = {
  /** Hard replace navigation history with Login (default true). */
  hardNavigate?: boolean;
  /** Optional React-state cleanup before navigation. */
  onLocalSessionCleared?: () => void;
  /** Keep remembered staff device marker (default false — clear it). */
  keepRememberedStaffDevice?: boolean;
};

/**
 * Central logout. Safe to call from every UI entry point.
 * Double-taps coalesce onto the same in-flight promise.
 */
export function performEnterpriseLogout(opts: EnterpriseLogoutOptions = {}): Promise<void> {
  if (logoutInFlight) return logoutInFlight;

  const hardNavigate = opts.hardNavigate !== false;

  logoutInFlight = (async () => {
    explicitLogoutLatch = true;
    appendPilotEvent("logout", "Enterprise logout");
    logAuthSessionEvent("enterprise_logout_start", {
      online: getDeviceOnline(),
      native: Capacitor.isNativePlatform(),
    });

    try {
      // 1–3. Stop background auth/sync work before mutating storage.
      cancelSessionRefreshRetry();
      resetSessionConnectionState();
      try {
        const { cancelBackgroundCloudSync } = await import("../../offline/cloudSync");
        cancelBackgroundCloudSync();
      } catch {
        /* sync module optional during early boot */
      }

      // 4. Flush outgoing account writes, then clear in-memory shop/session state.
      try {
        flushPendingPersist();
        const store = usePosStore.getState();
        if (store.preferences.activeStaffId) {
          store.switchStaffAccount(null, { force: true });
          await flushPendingPersist();
        }
      } catch {
        /* never block logout on persist */
      }

      usePosStore.getState().resetForSignOut();
      setActiveAccountKey(null);

      // 5. Clear staff + local auth markers.
      clearStaffAuth();
      clearStaffSessionPersistence();
      if (!opts.keepRememberedStaffDevice) {
        clearRememberedStaffDevice();
      }
      try {
        window.localStorage.removeItem(LOCAL_AUTH_KEY);
      } catch {
        /* ignore */
      }

      // 6. Clear React Query cache (in-memory).
      try {
        queryClient.clear();
        queryClient.getQueryCache().clear();
        queryClient.getMutationCache().clear();
      } catch {
        /* ignore */
      }

      // 7. Wipe persisted Supabase tokens BEFORE signOut event handlers run,
      //    so offline "defer SIGNED_OUT" cannot restore a cached session.
      const tokensRemoved = clearPersistedSupabaseAuthTokens();
      clearSessionStorageSafely();

      // 8. Supabase local sign-out (timeout-bounded).
      await signOutSupabaseLocalFirst();

      // Belt-and-suspenders: tokens may be rewritten by the client — clear again.
      clearPersistedSupabaseAuthTokens();

      opts.onLocalSessionCleared?.();

      logAuthSessionEvent("enterprise_logout_complete", {
        tokensRemoved,
        hardNavigate,
      });

      if (hardNavigate && typeof window !== "undefined") {
        window.location.replace("/login");
        // Leave latch/inFlight set — page is unloading.
        return;
      }
    } catch (err) {
      logAuthSessionEvent("enterprise_logout_failed", {
        message: err instanceof Error ? err.message : "unknown",
      });
      clearPersistedSupabaseAuthTokens();
      if (hardNavigate && typeof window !== "undefined") {
        window.location.replace("/login");
        return;
      }
      throw err;
    } finally {
      // Keep latch true until navigation tears down the page so SIGNED_OUT
      // handlers cannot restore a session in the same tick.
      if (!hardNavigate) {
        explicitLogoutLatch = false;
        logoutInFlight = null;
      }
    }
  })();

  return logoutInFlight;
}
