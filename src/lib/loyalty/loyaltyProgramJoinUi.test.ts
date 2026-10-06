import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";

/**
 * Phase 2C — the customer-facing WPL join surface.
 *
 * The page now carries TWO enrollment paths and must not confuse them:
 *
 *   anonymous      → name/phone → the public Edge Function → merchant approval
 *   authenticated  → Google → auth.uid() → member_id → merchant approval
 *
 * The assertions that matter are about what crosses the boundary: the pending store must hold the
 * code and nothing else, and the authenticated join must send the code and nothing else. The
 * component cannot be rendered here (vitest only includes `*.test.ts`, not `.tsx`), so the page is
 * asserted at the source level — the same approach `memberSignupDiscoverability.test.ts` uses — and
 * the RPC client, which is plain TypeScript, is exercised directly.
 */

const rpc = vi.fn();

vi.mock("../supabase", () => ({
  hasSupabaseConfig: true,
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const { joinLoyaltyProgramByCode, memberJoinErrorText } = await import("./loyaltyMemberJoin");

const PAGE = () => readFileSync(join(process.cwd(), "src/pages/PublicLoyaltyProgramPage.tsx"), "utf8");
const APP = () => readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const JOIN = () => readFileSync(join(process.cwd(), "src/lib/loyalty/loyaltyMemberJoin.ts"), "utf8");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ok: true, status: "pending" }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// Anonymous path
// ===========================================================================

describe("anonymous WPL page", () => {
  it("offers the Google CTA through the existing, still-disabled component", () => {
    const src = PAGE();
    expect(src).toContain("GoogleSignInButton");
    // Gated by the same flag as the merchant login: rendering nothing until Google is switched on.
    expect(src).toContain("isGoogleAuthUiAvailable");
    expect(src).toContain("showGoogle ?");
  });

  it("stores ONLY the code before handing off to Google", () => {
    const src = PAGE();
    const call = src.slice(src.indexOf("const googleSubmit"));
    expect(call.slice(0, 400)).toMatch(/storePendingProgramCode\(code\)/);
    // And nothing else is written to storage on the way out.
    expect(call.slice(0, 400)).not.toMatch(/storePendingProgramCode\([^)]*[,+]/);
  });

  it("keeps the existing anonymous name/phone form and its submit path", () => {
    const src = PAGE();
    expect(src).toContain("submitProgramJoin");
    expect(src).toContain("normalizeUgPhoneE164");
    expect(src).toContain("loyaltyJoinConsent");
  });

  it("does NOT route the anonymous form through the authenticated RPC", () => {
    const src = PAGE();
    const submit = src.slice(src.indexOf("const submit = async ()"));
    expect(submit.slice(0, 600)).not.toMatch(/joinLoyaltyProgramByCode/);
  });
});

// ===========================================================================
// Authenticated path
// ===========================================================================

describe("authenticated WPL page", () => {
  it("exposes a join action keyed on membership resolved from the SERVER", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="loyalty-program-join"');
    // Membership is decided by the dashboard read, not by anything stored client-side.
    expect(src).toContain("fetchMemberDashboard");
    expect(src).toContain('r.error === "not_a_member"');
  });

  it("only offers the profile form when the server says there is no member row", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="loyalty-program-profile-name"');
    expect(src).toContain('data-testid="loyalty-program-profile-phone"');
    // The form lives in the not_member branch, never in the anonymous one.
    const notMember = src.indexOf('member.kind === "member" || member.kind === "not_member"');
    const form = src.indexOf('data-testid="loyalty-program-profile-name"');
    expect(notMember).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(notMember);
  });

  it("creates the member only as part of the explicit join, never on sign-in", () => {
    const src = PAGE();
    // The only caller of becomeLoyaltyMember is the join handler...
    const calls = src.match(/becomeLoyaltyMember\(/g) ?? [];
    expect(calls.length).toBe(1);
    // ...and the Google handler does not touch member creation.
    const google = src.slice(src.indexOf("const googleSubmit"), src.indexOf("const runJoin"));
    expect(google).not.toMatch(/becomeLoyaltyMember|registerLoyaltyMember/);
  });

  it("explains why a phone is required rather than fabricating one", () => {
    const src = PAGE();
    // Phase A moved the explanation into the i18n architecture — assert the key is
    // wired and resolves to the DKASU wording in every language.
    expect(src).toContain('t(lang, "programPhoneHint")');
    expect(t("en", "programPhoneHint")).toBe(
      "DKASU shops match your loyalty cards by phone number, so it is required to join.",
    );
    expect(t("lg", "programPhoneHint")).not.toBe(t("en", "programPhoneHint"));
    expect(t("sw", "programPhoneHint")).not.toBe(t("en", "programPhoneHint"));
    expect(src).not.toMatch(/000000000|placeholderPhone|\+256000/);
  });
});

// ===========================================================================
// The join RPC client — what actually crosses the wire
// ===========================================================================

describe("the authenticated join sends the code and nothing else", () => {
  it("calls the code-based RPC with exactly one argument", async () => {
    const r = await joinLoyaltyProgramByCode("WPL2026001");
    expect(r).toEqual({ ok: true, status: "pending", alreadyRequested: false });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("loyalty_member_join_by_code");
    expect(Object.keys(args as object)).toEqual(["p_code"]);
    expect(args).toEqual({ p_code: "WPL2026001" });
  });

  it("never sends an id of any kind", async () => {
    await joinLoyaltyProgramByCode("WPL2026001");
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    for (const forbidden of ["p_member_id", "member_id", "p_account_id", "account_id", "p_shop_id", "shop_id", "p_organization_id", "organization_id"]) {
      expect(args, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it("the module has no way to send one — one parameter, one argument", () => {
    const src = JOIN();
    expect(src).toMatch(/joinLoyaltyProgramByCode\(code: string\)/);
    const rpcCall = src.slice(src.indexOf("supabase.rpc("));
    expect(rpcCall.slice(0, 200)).toMatch(/supabase\.rpc\("loyalty_member_join_by_code", \{ p_code: normalized \}\)/);
  });

  it("refuses an invalid code WITHOUT calling the RPC", async () => {
    for (const bad of ["", "nope", "WPL2026", "WPL2026001X"]) {
      const r = await joinLoyaltyProgramByCode(bad);
      expect(r.ok, bad).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalises case before sending", async () => {
    await joinLoyaltyProgramByCode("  wpl2026001 ");
    expect(rpc.mock.calls[0]![1]).toEqual({ p_code: "WPL2026001" });
  });

  it("maps already_member through, and reports a refusal without leaking the raw code", async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: "already_member" }, error: null });
    expect(await joinLoyaltyProgramByCode("WPL2026001")).toEqual({ ok: true, status: "already_member" });

    rpc.mockResolvedValue({ data: { ok: false, error: "not_a_member" }, error: null });
    const bad = await joinLoyaltyProgramByCode("WPL2026001");
    expect(bad.ok).toBe(false);
  });

  it("never surfaces a raw server error code to the customer", () => {
    for (const code of [
      "not_authenticated",
      "not_a_member",
      "member_phone_required",
      "code_invalid",
      "not_found",
      "unavailable",
      "loyalty_request_queue_full",
      "offline",
      "something_new",
    ]) {
      expect(memberJoinErrorText(code)).not.toContain(code);
      expect(memberJoinErrorText(code).length).toBeGreaterThan(10);
    }
  });
});

// ===========================================================================
// Wiring
// ===========================================================================

describe("/j/:programCode wiring", () => {
  it("the route passes the signed-in state and the Google handler", () => {
    const src = APP();
    expect(src).toMatch(/path="\/j\/:programCode"/);
    expect(src).toMatch(/isAuthenticated=\{auth\.isAuthenticated\}/);
    expect(src).toMatch(/onGoogleLogin=\{auth\.signInWithGoogle\}/);
  });

  it("uses the ONE existing Google implementation — no second sign-in path", () => {
    const src = PAGE();
    expect(src).toContain('from "../components/auth/GoogleSignInButton"');
    expect(src).not.toMatch(/signInWithOAuth|signInWithIdToken|googleIdentity/);
  });
});
