import { describe, expect, it } from "vitest";
import {
  CARD_READ_IP_LIMIT,
  CARD_READ_TOKEN_LIMIT,
  UNTRUSTED_IP_MATERIAL,
  WALLET_ISSUE_TOKEN_LIMIT,
  WALLET_ISSUE_TOKEN_WINDOW_MS,
  hashRateLimitKey,
  resolveTrustedClientIp,
  sha256Hex,
} from "../../../supabase/functions/_shared/loyaltyWallet/publicCardDurableRateLimitCore.ts";

describe("publicCardDurableRateLimit helpers", () => {
  it("hashes deterministically with SHA-256 hex", async () => {
    const a = await sha256Hex("token:abc");
    const b = await hashRateLimitKey("token:abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toContain("abc");
  });

  it("trusts cf-connecting-ip and x-real-ip, not leftmost XFF", () => {
    expect(
      resolveTrustedClientIp(
        new Request("https://example.test", { headers: { "cf-connecting-ip": "203.0.113.10" } }),
      ),
    ).toEqual({ trusted: true, ip: "203.0.113.10" });

    expect(
      resolveTrustedClientIp(
        new Request("https://example.test", { headers: { "x-real-ip": "198.51.100.7" } }),
      ),
    ).toEqual({ trusted: true, ip: "198.51.100.7" });

    expect(
      resolveTrustedClientIp(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
        }),
      ),
    ).toEqual({ trusted: false, reason: "spoofable_xff_only" });

    expect(resolveTrustedClientIp(new Request("https://example.test"))).toEqual({
      trusted: false,
      reason: "missing",
    });
  });

  it("documents production limits", () => {
    expect(CARD_READ_IP_LIMIT).toBe(60);
    expect(CARD_READ_TOKEN_LIMIT).toBe(30);
    expect(WALLET_ISSUE_TOKEN_LIMIT).toBe(5);
    expect(WALLET_ISSUE_TOKEN_WINDOW_MS).toBe(600_000);
    expect(UNTRUSTED_IP_MATERIAL).toBe("untrusted");
  });

  it("disabled isolate Map throws instead of allowing bypass", async () => {
    const mod = await import("../../../supabase/functions/_shared/loyaltyWallet/publicCardRateLimit.ts");
    expect(() => mod.checkRateLimit("k", 1, 1000)).toThrow(/disabled|durable/i);
  });
});

describe("wallet rate limit ordering contract", () => {
  it("enforceWalletIssueRateLimit runs before Wallet work in edge entry", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "supabase/functions/loyalty-public-wallet-issue/index.ts"),
      "utf8",
    );
    const rateIdx = src.indexOf("await enforceWalletIssueRateLimit");
    const envIdx = src.indexOf("loadGoogleWalletEnv()");
    const signIdx = src.indexOf("await issueGoogleWalletSaveUrl");
    expect(rateIdx).toBeGreaterThan(0);
    expect(envIdx).toBeGreaterThan(rateIdx);
    expect(signIdx).toBeGreaterThan(envIdx);
  });
});
