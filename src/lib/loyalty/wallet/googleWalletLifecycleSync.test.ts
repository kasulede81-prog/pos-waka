import { describe, expect, it } from "vitest";
import {
  deterministicGoogleWalletIds,
  googleWalletResourceIds,
  patchGoogleLoyaltyObjectState,
  GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX,
  type FetchLike,
} from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletRest.ts";
import { syncGoogleWalletObjectState } from "../../../../supabase/functions/_shared/loyaltyWallet/loyaltyWalletService.ts";
import { buildGoogleLoyaltyObject } from "../../../../supabase/functions/_shared/loyaltyWallet/googleWalletPass.ts";

/**
 * Phase 5 — the lifecycle PATCH, at the Wallet API boundary.
 *
 * The point of these tests is narrowness: a membership change must send ONLY `state`, so
 * points, barcode/QR identity, account name, program info and design are left exactly as
 * the pass was issued. Anything broader would rewrite fields this phase has no business
 * touching.
 */

const IDS = { issuerId: "338800000023208320", classId: "waka_loyalty", objectId: "acct_abc" };

function capturingFetch(): { fetchImpl: FetchLike; body: () => string; url: () => string } {
  let body = "";
  let url = "";
  const fetchImpl: FetchLike = async (u, init) => {
    url = String(u);
    body = init?.body ?? "";
    return { ok: true, status: 200, text: async () => "{}" };
  };
  return { fetchImpl, body: () => body, url: () => url };
}

describe("lifecycle state patch", () => {
  it("sends only `state` — never points or identity", async () => {
    const cap = capturingFetch();
    const result = await patchGoogleLoyaltyObjectState("token", IDS, "INACTIVE", cap.fetchImpl);

    expect(result.ok).toBe(true);
    expect(JSON.parse(cap.body())).toEqual({ state: "INACTIVE" });
    expect(cap.body()).not.toContain("loyaltyPoints");
    expect(cap.body()).not.toContain("barcode");
    expect(cap.body()).not.toContain("accountName");
  });

  it("targets the SAME deterministic object, using the existing class", async () => {
    const cap = capturingFetch();
    await patchGoogleLoyaltyObjectState("token", IDS, "EXPIRED", cap.fetchImpl);

    expect(cap.url()).toContain("/loyaltyObject/");
    expect(cap.url()).toContain(encodeURIComponent("338800000023208320.acct_abc"));
    expect(googleWalletResourceIds(IDS).classResourceId).toBe(
      `338800000023208320.${GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX}`,
    );
  });

  it("carries the three supported states and nothing else", async () => {
    for (const state of ["ACTIVE", "INACTIVE", "EXPIRED"] as const) {
      const cap = capturingFetch();
      await patchGoogleLoyaltyObjectState("token", IDS, state, cap.fetchImpl);
      expect(JSON.parse(cap.body())).toEqual({ state });
    }
  });
});

describe("syncGoogleWalletObjectState", () => {
  const signer = {
    serviceAccountEmail: "wallet@waka.test",
    signJwt: async () => "h.p.s",
  };

  it("returns ok:false instead of throwing when Google is unreachable", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network_down");
    };
    const result = await syncGoogleWalletObjectState(IDS, "INACTIVE", signer, 1_700_000_000, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it("refuses to act without a configured object and never invents one", async () => {
    const result = await syncGoogleWalletObjectState(
      { issuerId: "", classId: "waka_loyalty", objectId: "" },
      "INACTIVE",
      signer,
      1_700_000_000,
      async () => ({ ok: true, status: 200, text: async () => "{}" }),
    );
    expect(result.ok).toBe(false);
  });

  it("surfaces a Google rejection as a retryable failure, not a throw", async () => {
    const fetchImpl: FetchLike = async (url) =>
      String(url).includes("oauth2")
        ? { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "t", expires_in: 3600 }) }
        : { ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 503 } }) };
    const result = await syncGoogleWalletObjectState(IDS, "INACTIVE", signer, 1_700_000_000, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });
});

describe("issuance is unchanged by this phase", () => {
  it("a new pass is still built ACTIVE with the same identity and class", () => {
    const object = buildGoogleLoyaltyObject(
      {
        customerName: "Ada",
        balancePoints: 120,
        shopName: "Waka Shop",
        programName: "Loyalty",
        qrPayload: "WAKA-LOYALTY:token",
        qrToken: "token",
      } as never,
      deterministicGoogleWalletIds("338800000023208320", "shop-1", "acct-abc"),
    );
    expect(object.state).toBe("ACTIVE");
    expect(object.id).toBe("338800000023208320.acct_acct-abc");
    expect(object.classId).toBe(`338800000023208320.${GOOGLE_WALLET_PUBLISHED_CLASS_SUFFIX}`);
    expect(object.loyaltyPoints).toMatchObject({ balance: { int: 120 } });
  });
});
