import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleWalletOAuthClaims,
  deterministicGoogleWalletIds,
  googleWalletResourceIds,
  patchGoogleLoyaltyObjectBalance,
  upsertGoogleLoyaltyClass,
  upsertGoogleLoyaltyObject,
  type FetchLike,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletRest.ts";
import { syncGoogleWalletObjectBalance } from "../../../../supabase/functions/_shared/loyaltyWallet/loyaltyWalletService.ts";
import {
  buildGoogleWalletClassId,
  buildGoogleWalletObjectId,
} from "../loyaltyGoogleWallet";

describe("deterministic Google Wallet object identity", () => {
  it("scopes class to shop and object to loyalty account", () => {
    const ids = deterministicGoogleWalletIds("3388", "shop-aaa", "acct-bbb");
    expect(ids.classId).toBe("waka_loyalty_shop-aaa");
    expect(ids.objectId).toBe("acct_acct-bbb");
    expect(googleWalletResourceIds(ids)).toEqual({
      classResourceId: "3388.waka_loyalty_shop-aaa",
      objectResourceId: "3388.acct_acct-bbb",
    });
    expect(buildGoogleWalletClassId("3388", "shop-aaa")).toBe("3388.waka_loyalty_shop-aaa");
    expect(buildGoogleWalletObjectId("3388", "acct-bbb")).toBe("3388.acct_acct-bbb");
  });

  it("keeps Shop A and Shop B cards distinct for the same person concept", () => {
    const a = deterministicGoogleWalletIds("3388", "shop-a", "acct-1");
    const b = deterministicGoogleWalletIds("3388", "shop-b", "acct-2");
    expect(googleWalletResourceIds(a).classResourceId).not.toBe(googleWalletResourceIds(b).classResourceId);
    expect(googleWalletResourceIds(a).objectResourceId).not.toBe(googleWalletResourceIds(b).objectResourceId);
  });
});

describe("Google Wallet REST upsert / patch", () => {
  it("surfaces safe Google API reason on class insert failure", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "Google Wallet API has not been used in project before",
            errors: [{ reason: "accessNotConfigured" }],
          },
        }),
    });
    const result = await upsertGoogleLoyaltyClass("token", { id: "3388.class" }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.googleStatus).toBe("PERMISSION_DENIED");
    expect(result.googleReason).toBe("accessNotConfigured");
    expect(result.googleMessage).toContain("Google Wallet API");
  });

  it("on object 409, PUTs the full resource (re-issue safe)", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "POST") return { ok: false, status: 409, text: async () => "exists" };
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const result = await upsertGoogleLoyaltyObject(
      "token",
      { id: "3388.acct_1", loyaltyPoints: { balance: { int: 10 } } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["POST", "PUT"]);
  });

  it("patches balance only", async () => {
    let body = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      body = init?.body ?? "";
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const result = await patchGoogleLoyaltyObjectBalance(
      "token",
      { issuerId: "3388", classId: "c", objectId: "acct_1" },
      99,
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(body).toContain('"int":99');
  });
});

describe("syncGoogleWalletObjectBalance", () => {
  it("does not throw when Google is unavailable — returns ok:false", async () => {
    const signer = {
      serviceAccountEmail: "wallet@waka.test",
      signJwt: async () => "h.p.s",
    };
    const fetchImpl: FetchLike = async () => {
      throw new Error("network_down");
    };
    const result = await syncGoogleWalletObjectBalance(
      { issuerId: "3388", classId: "c", objectId: "o" },
      5,
      signer,
      1_700_000_000,
      fetchImpl,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid balance without calling Google", async () => {
    const signJwt = vi.fn(async () => "h.p.s");
    const result = await syncGoogleWalletObjectBalance(
      { issuerId: "3388", classId: "c", objectId: "o" },
      -1,
      { serviceAccountEmail: "wallet@waka.test", signJwt },
      1_700_000_000,
      async () => ({ ok: true, status: 200, text: async () => "{}" }),
    );
    expect(result).toEqual({ ok: false, error: "invalid_balance" });
    expect(signJwt).not.toHaveBeenCalled();
  });
});

describe("OAuth claims", () => {
  it("requests wallet_object.issuer scope", () => {
    const claims = buildGoogleWalletOAuthClaims("wallet@waka.test", 1000);
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/wallet_object.issuer");
    expect(claims.exp).toBe(4600);
  });
});
