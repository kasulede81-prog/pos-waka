import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createStaffInviteAcceptAttemptController,
  isStaffAcceptPagePath,
  shouldStartStaffInviteAccept,
} from "./staffInviteAcceptAttempt";
import {
  runStaffInviteAcceptFlow,
  STAFF_INVITE_ACCEPT_TIMEOUT_MS,
  STAFF_INVITE_HYDRATE_TIMEOUT_MS,
} from "./staffInviteAcceptFlow";
import { acceptErrorMessage } from "../pages/StaffAcceptPage";
import {
  clearStaffInviteToken,
  peekStaffInviteToken,
  persistStaffInviteToken,
  staffAcceptLoginHref,
  staffAcceptReturnPath,
} from "./staffInvite";

const ROOT = process.cwd();
const STAFF_ACCEPT = readFileSync(resolve(ROOT, "src/pages/StaffAcceptPage.tsx"), "utf8");
const ONBOARDING = readFileSync(resolve(ROOT, "src/lib/staffInviteOnboarding.ts"), "utf8");

describe("STAFF invite acceptance V3 — self-cancel + single-flight", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearStaffInviteToken();
  });

  it("V3-A authenticated success path reaches ok", async () => {
    const clear = vi.fn();
    const result = await runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "s1",
        membershipRole: "cashier",
        staffId: "st1",
        linkedExisting: true,
      }),
      getAuthUserId: async () => "u1",
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: clear,
    });
    expect(result).toEqual({ ok: true });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("V3-B structured RPC error exits accepting", async () => {
    const result = await runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => ({ ok: false, error: "expired" }),
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "expired" });
    expect(acceptErrorMessage("en", "expired")).toContain("expired");
  });

  it("V3-C/D rejected and thrown RPC map to error", async () => {
    const rejected = await runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => {
        throw new Error("network_failed");
      },
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    expect(rejected).toEqual({ ok: false, error: "network_failed" });
  });

  it("V3-E timeout reaches error", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const flow = runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => pending,
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(STAFF_INVITE_ACCEPT_TIMEOUT_MS + 5);
    await expect(flow).resolves.toEqual({ ok: false, error: "timeout" });
  });

  it("V3-F/G phase ready→accepting must not cancel in-flight attempt", async () => {
    const controller = createStaffInviteAcceptAttemptController();
    const attemptId = controller.tryBegin("tok-a");
    expect(attemptId).toBeTypeOf("number");

    // Simulates setPhase("accepting") rerender: effect would re-evaluate start gates.
    expect(
      shouldStartStaffInviteAccept({
        initializing: false,
        isAuthenticated: true,
        token: "tok-a",
        inFlight: controller.isInFlight(),
        settledToken: controller.settledToken(),
      }),
    ).toBe(false);
    expect(controller.tryBegin("tok-a")).toBeNull();

    let applied: "success" | "none" = "none";
    const ok = controller.complete(attemptId!, () => {
      controller.markSettled("tok-a");
      applied = "success";
    });
    expect(ok).toBe(true);
    expect(applied).toBe("success");
    expect(controller.isInFlight()).toBe(false);
  });

  it("V3-H Strict Mode remount does not duplicate RPC / discards no success", async () => {
    const controller = createStaffInviteAcceptAttemptController();
    controller.noteMounted();
    const attemptId = controller.tryBegin("tok-b");
    expect(attemptId).not.toBeNull();

    // Strict Mode cleanup
    controller.markUnmounted();
    // Remount before async completes — must not start a second attempt
    controller.noteMounted();
    expect(controller.tryBegin("tok-b")).toBeNull();

    let terminal = 0;
    controller.complete(attemptId!, () => {
      controller.markSettled("tok-b");
      terminal += 1;
    });
    expect(terminal).toBe(1);
    expect(controller.tryBegin("tok-b")).toBeNull();
  });

  it("V3-H deferred apply after unmount+remount still applies once", () => {
    const controller = createStaffInviteAcceptAttemptController();
    controller.noteMounted();
    const attemptId = controller.tryBegin("tok-c");
    controller.markUnmounted();

    let terminal = 0;
    const appliedNow = controller.complete(attemptId!, () => {
      controller.markSettled("tok-c");
      terminal += 1;
    });
    expect(appliedNow).toBe(false);
    expect(terminal).toBe(0);

    controller.noteMounted();
    expect(terminal).toBe(1);
    expect(controller.tryBegin("tok-c")).toBeNull();
  });

  it("V3-I exactly one terminal transition per attempt", () => {
    const controller = createStaffInviteAcceptAttemptController();
    const id = controller.tryBegin("tok-d")!;
    let n = 0;
    controller.complete(id, () => {
      n += 1;
      controller.markSettled("tok-d");
    });
    controller.complete(id, () => {
      n += 1;
    });
    expect(n).toBe(1);
  });

  it("V3-J/K/L hydration success / throw / hang do not block invite success", async () => {
    const okHydrate = await runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "s",
        membershipRole: "cashier",
        staffId: null,
        linkedExisting: false,
      }),
      getAuthUserId: async () => "u",
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    expect(okHydrate).toEqual({ ok: true });

    const throwHydrate = await runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "s",
        membershipRole: "cashier",
        staffId: null,
        linkedExisting: false,
      }),
      getAuthUserId: async () => "u",
      hydrateStaffWorkspace: async () => {
        throw new Error("hydrate_failed");
      },
      clearStoredInviteToken: () => undefined,
    });
    expect(throwHydrate).toEqual({ ok: true, hydrateDegraded: true });

    vi.useFakeTimers();
    const hang = runStaffInviteAcceptFlow({
      token: "tok",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "s",
        membershipRole: "cashier",
        staffId: null,
        linkedExisting: false,
      }),
      getAuthUserId: async () => "u",
      hydrateStaffWorkspace: async () => new Promise(() => undefined),
      clearStoredInviteToken: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(STAFF_INVITE_HYDRATE_TIMEOUT_MS + 5);
    await expect(hang).resolves.toEqual({ ok: true, hydrateDegraded: true });
  });

  it("V3-M token survives login next path", () => {
    const href = staffAcceptLoginHref("abc.token");
    expect(href.startsWith("/login?next=")).toBe(true);
    const next = decodeURIComponent(href.slice("/login?next=".length));
    expect(staffAcceptReturnPath(next)).toBe("/staff/accept?token=abc.token");
  });

  it("V3-N same-browser signup keeps token in sessionStorage", () => {
    persistStaffInviteToken("signup-token");
    expect(peekStaffInviteToken()).toBe("signup-token");
  });

  it("V3-O missing token is explicit (page source + helper)", () => {
    expect(STAFF_ACCEPT).toMatch(/staffInviteMissingToken/);
    expect(peekStaffInviteToken()).toBeNull();
    expect(acceptErrorMessage("en", "invalid_token")).toMatch(/missing|invalid/i);
  });

  it("V3-P bootstrap yields accept page ownership (no concurrent consume)", () => {
    expect(isStaffAcceptPagePath("/staff/accept")).toBe(true);
    expect(isStaffAcceptPagePath("/login")).toBe(false);
    expect(ONBOARDING).toMatch(/isStaffAcceptPagePath/);
    expect(ONBOARDING).toMatch(/staff_accept_page_owns_token/);
  });

  it("V3-Q second trigger while in flight does not begin", () => {
    const controller = createStaffInviteAcceptAttemptController();
    expect(controller.tryBegin("tok-e")).not.toBeNull();
    expect(controller.tryBegin("tok-e")).toBeNull();
    expect(controller.tryBegin("other")).toBeNull();
  });

  it("StaffAcceptPage no longer lists phase in accept effect deps", () => {
    expect(STAFF_ACCEPT).toMatch(/\[initializing, isAuthenticated, token\]/);
    expect(STAFF_ACCEPT).not.toMatch(/phase === "accepting"\) return/);
    expect(STAFF_ACCEPT).toMatch(/createStaffInviteAcceptAttemptController/);
    expect(STAFF_ACCEPT).toMatch(/controller\.complete\(/);
  });

  it("maps remaining error codes without infinite spinner messaging", () => {
    expect(acceptErrorMessage("en", "already_member")).toContain("no longer valid");
    expect(acceptErrorMessage("en", "email_not_verified")).toMatch(/confirm|email/i);
    expect(acceptErrorMessage("en", "timeout")).toContain("Could not accept");
    expect(acceptErrorMessage("en", "staff_link_failed")).toContain("Could not accept");
  });
});
