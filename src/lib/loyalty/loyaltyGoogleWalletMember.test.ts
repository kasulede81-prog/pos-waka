import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ hasSupabaseConfig: false, supabase: null }));
vi.mock("../supabaseEdgeInvoke", () => ({ invokeSupabaseEdgeFunction: vi.fn() }));

import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { issueGoogleWalletPass, issueMemberGoogleWalletPass } from "./loyaltyGoogleWallet";

const invoke = vi.mocked(invokeSupabaseEdgeFunction);

/**
 * THE REQUEST IS THE SECURITY BOUNDARY, SO THE REQUEST IS WHAT IS ASSERTED.
 *
 * The member call must name a shop and nothing else. If an account id, a member id or a card
 * token ever appeared in this body the server would still refuse it (it derives the account from
 * `auth.uid()` and reads no account id on that path), but the browser would have been handed
 * something it should not be handling — so the absence is pinned here rather than left implicit.
 *
 * The merchant call is asserted in the same file, because the change that added the member path
 * was not allowed to alter the merchant one.
 */

beforeEach(() => {
  invoke.mockReset();
});

describe("issueMemberGoogleWalletPass — the member's own card", () => {
  it("sends the shop and nothing else", async () => {
    invoke.mockResolvedValue({ ok: true, data: { ok: true, save_url: "https://pay.google.com/x" } });

    await issueMemberGoogleWalletPass("shop-1");

    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, body] = invoke.mock.calls[0]!;
    expect(fn).toBe("loyalty-wallet-pass");
    expect(body).toEqual({ provider: "google", shop_id: "shop-1" });
    // Spelled out rather than implied by the equality above: none of these may ever appear.
    expect(body).not.toHaveProperty("account_id");
    expect(body).not.toHaveProperty("member_id");
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("customer_id");
  });

  it("returns the Save URL the server issued, unchanged", async () => {
    invoke.mockResolvedValue({
      ok: true,
      data: { ok: true, save_url: "https://pay.google.com/gp/v/save/jwt", balance_points: 420 },
    });

    const r = await issueMemberGoogleWalletPass("shop-1");
    expect(r).toEqual({ ok: true, saveUrl: "https://pay.google.com/gp/v/save/jwt", balancePoints: 420 });
  });

  it("does not accept a shop-less call, and does not reach the edge", async () => {
    const r = await issueMemberGoogleWalletPass("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("shop_required");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("maps the server's refusals to the codes the UI branches on", async () => {
    const cases: Array<[string, string]> = [
      ["not_a_member", "not_a_member"],
      ["not_found", "not_found"],
      ["account_inactive", "account_inactive"],
      ["account_revoked", "account_revoked"],
      ["membership_expired", "membership_expired"],
      ["wallet_not_configured", "wallet_not_configured"],
      ["unauthorized", "unauthorized"],
    ];
    for (const [server, expected] of cases) {
      invoke.mockResolvedValue({ ok: false, message: server });
      const r = await issueMemberGoogleWalletPass("shop-1");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(expected);
    }
  });

  it("a transport failure is reported as network, not as a refusal", async () => {
    invoke.mockResolvedValue({ ok: false, message: "Request failed.", errorCode: "network" });
    const r = await issueMemberGoogleWalletPass("shop-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("network");
  });

  it("an ok response with no Save URL is a failure, never a silent success", async () => {
    invoke.mockResolvedValue({ ok: true, data: { ok: true } });
    const r = await issueMemberGoogleWalletPass("shop-1");
    expect(r.ok).toBe(false);
  });
});

describe("issueGoogleWalletPass — the merchant contract is unchanged", () => {
  it("still names both the shop and the account", async () => {
    invoke.mockResolvedValue({
      ok: true,
      data: { ok: true, save_url: "https://pay.google.com/x", object_id: "issuer.acct_a1" },
    });

    await issueGoogleWalletPass("shop-1", "account-1");

    expect(invoke.mock.calls[0]![0]).toBe("loyalty-wallet-pass");
    expect(invoke.mock.calls[0]![1]).toEqual({
      provider: "google",
      shop_id: "shop-1",
      account_id: "account-1",
    });
  });

  it("still returns the object id to staff, and still maps its own refusals identically", async () => {
    invoke.mockResolvedValue({
      ok: true,
      data: { ok: true, save_url: "u", object_id: "issuer.acct_a1", balance_points: 5 },
    });
    const ok = await issueGoogleWalletPass("shop-1", "account-1");
    expect(ok).toEqual({ ok: true, saveUrl: "u", objectId: "issuer.acct_a1", balancePoints: 5 });

    invoke.mockResolvedValue({ ok: false, message: "account_not_found" });
    const denied = await issueGoogleWalletPass("shop-1", "account-1");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("account_not_found");
  });

  it("still refuses to call the edge without both ids", async () => {
    expect((await issueGoogleWalletPass("", "account-1")).ok).toBe(false);
    expect((await issueGoogleWalletPass("shop-1", "")).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
