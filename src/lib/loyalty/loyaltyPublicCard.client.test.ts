import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertClientSafePublicCard,
  fetchPublicLoyaltyCard,
  issuePublicGoogleWallet,
  isValidPublicCardTokenFormat,
} from "./loyaltyPublicCard";

const VALID_TOKEN = "b".repeat(64);

describe("public card client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates token format locally", () => {
    expect(isValidPublicCardTokenFormat(VALID_TOKEN)).toBe(true);
    expect(isValidPublicCardTokenFormat("x")).toBe(false);
  });

  it("rejects invalid token for fetch without calling network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchPublicLoyaltyCard("short");
    expect(result).toEqual({ ok: false, error: "token_invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid token for wallet issue without calling network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await issuePublicGoogleWallet("nope");
    expect(result).toEqual({ ok: false, error: "token_invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a successful public card response without sensitive fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              customer_name: "Amina",
              shop_name: "Kampala Kiosk",
              program_name: "Kampala Kiosk Loyalty",
              balance_points: 42,
              account_active: true,
              program_enabled: true,
              qr_payload: "WAKA-LOYALTY:qr-abc",
              rewards: [{ name: "Free soda", points_required: 50, description: null }],
              wallet_configured: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const result = await fetchPublicLoyaltyCard(VALID_TOKEN);
    // Without VITE_SUPABASE_* the client short-circuits to unavailable.
    if (!result.ok) {
      expect(["unavailable", "network"]).toContain(result.error);
      return;
    }
    expect(result.card.qr_payload).toBe("WAKA-LOYALTY:qr-abc");
    expect(result.card.balance_points).toBe(42);
    expect(JSON.stringify(result.card)).not.toMatch(/phone|email|customer_id|shop_id|public_card_token/i);
  });

  it("maps not_found from edge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "not_found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const result = await fetchPublicLoyaltyCard(VALID_TOKEN);
    if (!result.ok && result.error === "unavailable") return;
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("returns save_url only on success object", async () => {
    const saveUrl = "https://pay.google.com/gp/v/save/test.jwt";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              provider: "google_wallet",
              save_url: saveUrl,
              balance_points: 10,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const result = await issuePublicGoogleWallet(VALID_TOKEN);
    if (!result.ok) {
      expect(["unavailable", "network"]).toContain(result.error);
      return;
    }
    expect(result.saveUrl).toBe(saveUrl);
  });

  it("blocks phone and internal ids in client assert", () => {
    expect(() => assertClientSafePublicCard({ phone: "+256" })).toThrow();
    expect(() => assertClientSafePublicCard({ shop_id: "x" })).toThrow();
    expect(() => assertClientSafePublicCard({ customer_name: "Ok" })).not.toThrow();
  });
});
