import { describe, expect, it, vi, afterEach } from "vitest";
import { acceptErrorMessage } from "../pages/StaffAcceptPage";
import { runStaffInviteAcceptFlow, STAFF_INVITE_ACCEPT_TIMEOUT_MS } from "./staffInviteAcceptFlow";

describe("staff invite accept flow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("I1 accepts valid invite and clears spinner path", async () => {
    const clear = vi.fn();
    const hydrate = vi.fn(async () => undefined);
    const result = await runStaffInviteAcceptFlow({
      token: "valid-token",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "shop-1",
        membershipRole: "cashier",
        staffId: "staff-1",
        linkedExisting: true,
      }),
      getAuthUserId: async () => "user-1",
      hydrateStaffWorkspace: hydrate,
      clearStoredInviteToken: clear,
    });
    expect(result).toEqual({ ok: true });
    expect(hydrate).toHaveBeenCalledWith("user-1");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("I2 handles RPC-resolved error", async () => {
    const result = await runStaffInviteAcceptFlow({
      token: "expired-token",
      acceptInviteToken: async () => ({ ok: false, error: "expired" }),
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("I3 handles rejected promise", async () => {
    const result = await runStaffInviteAcceptFlow({
      token: "bad-token",
      acceptInviteToken: async () => {
        throw new Error("network_failed");
      },
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "network_failed" });
  });

  it("I4 handles unexpected post-accept exception", async () => {
    const result = await runStaffInviteAcceptFlow({
      token: "valid-token",
      acceptInviteToken: async () => ({
        ok: true,
        shopId: "shop-1",
        membershipRole: "cashier",
        staffId: null,
        linkedExisting: false,
      }),
      getAuthUserId: async () => "user-1",
      hydrateStaffWorkspace: async () => {
        throw new Error("hydrate_failed");
      },
      clearStoredInviteToken: () => undefined,
    });
    expect(result).toEqual({ ok: false, error: "hydrate_failed" });
  });

  it("I8 returns timeout for unresolved acceptance request", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const flow = runStaffInviteAcceptFlow({
      token: "slow-token",
      acceptInviteToken: async () => pending,
      getAuthUserId: async () => null,
      hydrateStaffWorkspace: async () => undefined,
      clearStoredInviteToken: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(STAFF_INVITE_ACCEPT_TIMEOUT_MS + 10);
    await expect(flow).resolves.toEqual({ ok: false, error: "timeout" });
  });

  it("I5/I6/I7 map known invitation errors", () => {
    expect(acceptErrorMessage("en", "expired")).toContain("expired");
    expect(acceptErrorMessage("en", "already_accepted")).toContain("no longer valid");
    expect(acceptErrorMessage("en", "revoked")).toContain("no longer valid");
    expect(acceptErrorMessage("en", "email_mismatch")).toContain("received the invite");
  });
});
