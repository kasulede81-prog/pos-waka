import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE EDGE FUNCTION'S AUTHORITY SHAPE, PINNED AT THE SOURCE.
 *
 * The Deno edge runtime is not executed here — these lock the properties a reviewer would
 * otherwise have to re-derive from a diff:
 *
 *   * the member branch resolves the account with the CALLER'S JWT and reads no account id from
 *     the request, so the client has nothing to forge;
 *   * the staff branch still reads with the caller's JWT, so RLS is still its authority;
 *   * there is still exactly ONE issuance call and ONE object-id derivation, which is what makes
 *     "merchant card" and "member card" the same Google Wallet object rather than two;
 *   * no second Wallet Edge Function, issuer or pass format was introduced.
 *
 * These are structural assertions, deliberately coarse: they fail if the shape changes, which is
 * the point. The authoritative behaviour tests are the SQL ones.
 */

const SRC = readFileSync(
  join(process.cwd(), "supabase", "functions", "loyalty-wallet-pass", "index.ts"),
  "utf8",
);

describe("loyalty-wallet-pass — the member branch", () => {
  it("resolves the account with the caller's JWT, never the service key", () => {
    // `userClient` is the client built from the caller's Authorization header. The resolver must
    // run on it, because `auth.uid()` inside the function is the whole authority.
    expect(SRC).toMatch(/await\s+userClient\.rpc\(\s*"loyalty_member_wallet_account"/);
    expect(SRC).not.toMatch(/admin\.rpc\(\s*"loyalty_member_wallet_account"/);
  });

  it("passes the shop and nothing else to the resolver", () => {
    const call = SRC.match(/loyalty_member_wallet_account",\s*\{([^}]*)\}/);
    expect(call).not.toBeNull();
    const args = call![1]!;
    expect(args).toMatch(/p_shop_id/);
    // The client-supplied account id must not reach it — there is no such parameter, and no
    // value should be invented for one.
    expect(args).not.toMatch(/account_id|member_id|customer|token/);
  });

  it("uses the account the resolver named, not the one the caller sent", () => {
    expect(SRC).toMatch(/accountIdToIssue\s*=\s*String\(resolved\.account_id\)/);
  });

  it("switches to the service key only after that resolution", () => {
    const resolveAt = SRC.indexOf("loyalty_member_wallet_account");
    const switchAt = SRC.indexOf("readClient = admin");
    expect(resolveAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(resolveAt);
    // Exactly one such switch, and it is inside the member branch.
    expect(SRC.match(/readClient = admin/g)!.length).toBe(1);
  });

  it("fails closed when the resolver itself errors", () => {
    expect(SRC).toMatch(/if \(error\) return json\(\{ ok: false, error: "unauthorized" \}, 403\)/);
  });

  it("refuses the member path's own codes with a status, never a pass", () => {
    for (const code of ["not_a_member", "not_found", "account_inactive", "membership_expired"]) {
      expect(SRC).toContain(`"${code}"`);
    }
  });
});

describe("loyalty-wallet-pass — the staff branch is untouched", () => {
  it("still starts from the caller's JWT client", () => {
    expect(SRC).toMatch(/let readClient = userClient/);
  });

  it("still reads the account by the caller-supplied id when one was supplied", () => {
    expect(SRC).toMatch(/let accountIdToIssue = accountId/);
  });

  it("still refuses non-active accounts before issuing anything", () => {
    expect(SRC).toMatch(/account_revoked/);
    expect(SRC).toMatch(/account_inactive/);
    expect(SRC).toMatch(/membership_expired/);
  });

  it("returns the object id to staff only — the member's browser gets no account identifier", () => {
    expect(SRC).toMatch(/accountId \? \{ object_id:/);
  });
});

describe("one pass, one issuer, one issuance path", () => {
  it("calls the issuance service exactly once", () => {
    expect(SRC.match(/await issueGoogleWalletSaveUrl\(/g)!.length).toBe(1);
  });

  it("derives the Google object id exactly once", () => {
    expect(SRC.match(/deterministicGoogleWalletIds\(env\.issuerId/g)!.length).toBe(1);
  });

  it("loads the Wallet credentials from one place, for the probe and for issuance", () => {
    // The GET probe and the issuing branch — and nothing member-specific, because there is no
    // second credential set to load.
    expect(SRC.match(/loadGoogleWalletEnv\(\)/g)!.length).toBe(2);
  });

  it("adds no member-specific Wallet Edge Function", () => {
    const dirs = readdirSync(join(process.cwd(), "supabase", "functions"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    // The two that already issued passes: the merchant/staff one and the public card one.
    expect(dirs.filter((d) => /wallet/.test(d)).sort()).toEqual([
      "loyalty-public-wallet-issue",
      "loyalty-wallet-pass",
      "loyalty-wallet-sync",
    ]);
    expect(dirs.some((d) => /member/.test(d) && /wallet/.test(d))).toBe(false);
  });

  it("has both client helpers target that one function", () => {
    const client = readFileSync(
      join(process.cwd(), "src", "lib", "loyalty", "loyaltyGoogleWallet.ts"),
      "utf8",
    );
    // Two call sites, one function name: the merchant action and the member action.
    expect(client.match(/"loyalty-wallet-pass"/g)!.length).toBe(2);
    expect(client).not.toMatch(/loyalty-public-wallet-issue/);
  });
});
