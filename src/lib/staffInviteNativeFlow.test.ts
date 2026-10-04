import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invitation's journey across a native Google round trip.
 *
 * Native OAuth leaves the WebView for the system browser and returns through
 * `wakapos://callback`, which the app maps to `/auth/callback` — NOT to `/staff/accept`, the page
 * that started the flow. Two things have to hold for acceptance to survive that:
 *
 *  1. the stored invitation token must not be consumed while the app is on the return route, or
 *     the workspace bootstrap would accept it, clear it and route to the POS before the app could
 *     hand back to the page that owns acceptance;
 *  2. once control is back on `/staff/accept`, the accept RPC must still run with that same token.
 *
 * The Google handshake itself is NOT simulated. What is exercised is the real continuation
 * logic and the real RPC call shape.
 */

const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform, getPlatform: () => "android" },
}));

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true, shop_id: "shop-1", membership_role: "cashier" }, error: null })));
vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { rpc },
}));

import { isNativeOAuthReturnPath, peekStaffInviteToken, persistStaffInviteToken, STAFF_INVITE_TOKEN_KEY } from "./staffInvite";
import { resolveStaffInviteBeforeOwnerBootstrap } from "./staffInviteOnboarding";
import { runStaffInviteAcceptFlow } from "./staffInviteAcceptFlow";
import { acceptStaffInviteToken } from "./staffInvite";

const INVITE = "invite-token-abcdef0123456789";

/** Minimal in-memory Storage — Node has no sessionStorage, which the token helpers use. */
function installSessionStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

function setPath(pathname: string): void {
  vi.stubGlobal("window", { location: { pathname } });
}

const session = { user: { id: "user-1", email: "cashier@example.com" } } as never;

beforeEach(() => {
  installSessionStorage();
  isNativePlatform.mockReturnValue(true);
  rpc.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isNativeOAuthReturnPath", () => {
  it("is true only on the native shell's OAuth return route", () => {
    expect(isNativeOAuthReturnPath("/auth/callback", true)).toBe(true);
    // Query strings are ignored — the deep link carries ?code=… here.
    expect(isNativeOAuthReturnPath("/auth/callback?code=abc", true)).toBe(true);
    // Web keeps its previous behaviour on this route.
    expect(isNativeOAuthReturnPath("/auth/callback", false)).toBe(false);
    // Any other route is untouched, so a merchant sign-in is unaffected.
    expect(isNativeOAuthReturnPath("/login", true)).toBe(false);
    expect(isNativeOAuthReturnPath("/", true)).toBe(false);
    expect(isNativeOAuthReturnPath("/staff/accept", true)).toBe(false);
    expect(isNativeOAuthReturnPath(null, true)).toBe(false);
  });
});

describe("invitation token survives the native OAuth round trip", () => {
  it("is not consumed while the app is on the OAuth return route", async () => {
    persistStaffInviteToken(INVITE);
    setPath("/auth/callback");

    const gate = await resolveStaffInviteBeforeOwnerBootstrap(session);

    // Bootstrap stays out of the way (no shop is provisioned for an invitee)…
    expect(gate).toEqual({ skipOwnerBootstrap: true, accepted: false });
    // …the RPC was NOT called here…
    expect(rpc).not.toHaveBeenCalled();
    // …and the token is still stored for the page that owns acceptance.
    expect(peekStaffInviteToken()).toBe(INVITE);
  });

  it("still defers on the invitation page itself", async () => {
    persistStaffInviteToken(INVITE);
    setPath("/staff/accept");

    const gate = await resolveStaffInviteBeforeOwnerBootstrap(session);

    expect(gate).toEqual({ skipOwnerBootstrap: true, accepted: false });
    expect(peekStaffInviteToken()).toBe(INVITE);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does NOT defer on the web OAuth return route, where accepting in the callback is designed", async () => {
    isNativePlatform.mockReturnValue(false);
    persistStaffInviteToken(INVITE);
    setPath("/auth/callback");

    const gate = await resolveStaffInviteBeforeOwnerBootstrap(session);

    // Web behaviour is unchanged: the callback accepts the invitation itself.
    expect(gate).toEqual({ skipOwnerBootstrap: true, accepted: true });
    expect(rpc).toHaveBeenCalledWith("shop_accept_staff_invite", { p_token: INVITE });
    expect(peekStaffInviteToken()).toBeNull();
  });
});

describe("acceptance still runs after the native return", () => {
  it("runs shop_accept_staff_invite with the token that crossed the round trip", async () => {
    persistStaffInviteToken(INVITE);
    setPath("/auth/callback");

    // The native return: bootstrap defers, the app routes to /staff/accept…
    await resolveStaffInviteBeforeOwnerBootstrap(session);
    expect(peekStaffInviteToken()).toBe(INVITE);

    // …where the accept page runs its flow with the token it finds in storage.
    setPath("/staff/accept");
    const token = peekStaffInviteToken() ?? "";
    const result = await runStaffInviteAcceptFlow({
      token,
      acceptInviteToken: acceptStaffInviteToken,
      getAuthUserId: async () => "user-1",
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => sessionStorage.removeItem(STAFF_INVITE_TOKEN_KEY),
    });

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("shop_accept_staff_invite", { p_token: INVITE });
    expect(peekStaffInviteToken()).toBeNull();
  });
});

describe("no secret is logged", () => {
  it("never writes the invitation token to the console during the native continuation", async () => {
    const spies = ["log", "warn", "error", "info", "debug"].map((level) =>
      vi.spyOn(console, level as "log").mockImplementation(() => undefined),
    );

    persistStaffInviteToken(INVITE);
    setPath("/auth/callback");
    await resolveStaffInviteBeforeOwnerBootstrap(session);

    setPath("/staff/accept");
    await runStaffInviteAcceptFlow({
      token: peekStaffInviteToken() ?? "",
      acceptInviteToken: acceptStaffInviteToken,
      getAuthUserId: async () => "user-1",
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => sessionStorage.removeItem(STAFF_INVITE_TOKEN_KEY),
    });

    const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args ?? [])));
    expect(logged.some((line) => line.includes(INVITE))).toBe(false);

    spies.forEach((spy) => spy.mockRestore());
  });
});
