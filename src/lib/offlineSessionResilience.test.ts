import type { AuthError, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: vi.fn(() => true),
}));

import { getDeviceOnline } from "./deviceOnline";
import {
  cancelSessionRefreshRetry,
  isSessionLocallyRestorable,
  isSessionRevocationError,
  readPersistedSupabaseSession,
  resolveStartupSession,
  scheduleSessionRefreshRetry,
  shouldDeferSignedOut,
  SESSION_GET_TIMEOUT_MS,
} from "./offlineSessionResilience";
import { getSessionConnectionState, resetSessionConnectionState } from "./sessionConnectionState";

function installBrowserMocks(): void {
  const store: Record<string, string> = {};
  const storage = {
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id: "user-1",
      aud: "authenticated",
      role: "authenticated",
      email: "owner@example.com",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
    ...overrides,
  } as Session;
}

describe("offlineSessionResilience", () => {
  beforeEach(() => {
    installBrowserMocks();
    vi.useFakeTimers();
    localStorage.clear();
    resetSessionConnectionState();
    cancelSessionRefreshRetry();
    vi.mocked(getDeviceOnline).mockReturnValue(true);
  });

  afterEach(() => {
    cancelSessionRefreshRetry();
    vi.useRealTimers();
    localStorage.clear();
    resetSessionConnectionState();
  });

  it("scenario 1: login → offline → resume keeps cached session authenticated", async () => {
    const session = makeSession();
    localStorage.setItem("sb-test-auth-token", JSON.stringify(session));
    vi.mocked(getDeviceOnline).mockReturnValue(false);

    const startupPromise = resolveStartupSession(
      () => new Promise(() => {
        /* never resolves — simulates slow resume */
      }),
    );
    await vi.advanceTimersByTimeAsync(SESSION_GET_TIMEOUT_MS);
    const startup = await startupPromise;

    expect(startup.session?.user.id).toBe("user-1");
    expect(startup.source).toBe("cached");
    expect(startup.timedOut).toBe(true);
    expect(getSessionConnectionState()).toBe("offline_cached");
  });

  it("scenario 2: slow getSession timeout keeps cached session", async () => {
    const session = makeSession();
    localStorage.setItem("sb-test-auth-token", JSON.stringify(session));

    const startupPromise = resolveStartupSession(
      () => new Promise(() => {
        /* hang */
      }),
    );
    await vi.advanceTimersByTimeAsync(SESSION_GET_TIMEOUT_MS);
    const startup = await startupPromise;

    expect(startup.session?.user.id).toBe("user-1");
    expect(startup.source).toBe("cached");
    expect(startup.timedOut).toBe(true);
  });

  it("scenario 3: reconnect refresh succeeds and updates connection state", async () => {
    const session = makeSession();
    const onSessionUpdated = vi.fn();
    const onSessionRevoked = vi.fn();

    scheduleSessionRefreshRetry(
      async () => ({ data: { session }, error: null }),
      { onSessionUpdated, onSessionRevoked },
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(onSessionUpdated).toHaveBeenCalledWith(session);
    expect(onSessionRevoked).not.toHaveBeenCalled();
    expect(getSessionConnectionState()).toBe("online");
  });

  it("scenario 4: token revoked triggers confirmed logout callback", async () => {
    const onSessionUpdated = vi.fn();
    const onSessionRevoked = vi.fn();

    scheduleSessionRefreshRetry(
      async () => ({
        data: { session: null },
        error: {
          name: "AuthApiError",
          message: "Invalid Refresh Token",
          status: 401,
          code: "invalid_grant",
        } as AuthError,
      }),
      { onSessionUpdated, onSessionRevoked },
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(onSessionRevoked).toHaveBeenCalledTimes(1);
    expect(onSessionUpdated).not.toHaveBeenCalled();
    expect(
      isSessionRevocationError({
        name: "AuthApiError",
        message: "Invalid Refresh Token",
        status: 401,
        code: "invalid_grant",
      } as AuthError),
    ).toBe(true);
  });

  it("scenario 5: manual sign out is never deferred", () => {
    const session = makeSession();
    expect(
      shouldDeferSignedOut({
        cachedSession: session,
        explicitSignOut: true,
      }),
    ).toBe(false);
  });

  it("scenario 6: android background resume defers signed_out when cache remains", () => {
    const session = makeSession();
    expect(
      shouldDeferSignedOut({
        cachedSession: session,
        explicitSignOut: false,
      }),
    ).toBe(true);
  });

  it("reads persisted supabase session from localStorage", () => {
    const session = makeSession();
    localStorage.setItem("sb-project-auth-token", JSON.stringify(session));
    expect(readPersistedSupabaseSession()?.user.id).toBe("user-1");
  });

  it("treats refresh token as locally restorable", () => {
    expect(isSessionLocallyRestorable(makeSession())).toBe(true);
    expect(isSessionLocallyRestorable(makeSession({ refresh_token: "", expires_at: Math.floor(Date.now() / 1000) - 10 }))).toBe(false);
  });
});
