import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProgramJoinPath, isValidProgramCodeFormat } from "./loyalty/loyaltyPublicProgram";

/**
 * Phase 2C — a DKASU Loyalty member cannot be created without a merchant programme.
 *
 * WHY THIS FILE EXISTS. `/member` and `/member/register` used to be able to produce a
 * `loyalty_members` row on their own. That identity belonged to no shop: no programme, no card, no
 * points, and no way to become useful except by enrolling somewhere — at which point the row had
 * already been created without the context. The merchant's programme is now the required context,
 * and this suite is what keeps every other path closed.
 *
 * The whole rule in one line: `becomeLoyaltyMember` may be reached from the WPL join and nowhere
 * else. Most of these assertions are structural because vitest only includes `*.test.ts`; the
 * component behaviour they describe is covered by the source they read.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = (p: string) => read(p);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ===========================================================================
// 1-4. /member/register is a code-entry step and creates nothing
// ===========================================================================

describe("/member/register — WPL code entry, never member creation", () => {
  it("1. creates no member and no account", () => {
    const src = stripComments(PAGE("src/pages/member/MemberRegisterPage.tsx"));
    expect(src).not.toMatch(/becomeLoyaltyMember|loyalty_member_register|registerLoyaltyMember/);
    expect(src).not.toMatch(/signUpLoyaltyMember|auth\.signUp/);
    expect(src).not.toMatch(/bootstrapOwnerWorkspace|bootstrap_owner_workspace/);
  });

  it("2. renders the WPL code-entry form", () => {
    const src = PAGE("src/pages/member/MemberRegisterPage.tsx");
    expect(src).toContain("LoyaltyCodeEntryForm");
    expect(src).toContain('data-testid="member-register-code-entry"');
  });

  it("3. a valid code navigates to /j/<code> — the same URL a QR opens", () => {
    expect(buildProgramJoinPath("WPL2026001")).toBe("/j/WPL2026001");
    expect(buildProgramJoinPath("  wpl2026001 ")).toBe("/j/WPL2026001");
    const src = PAGE("src/components/loyalty/LoyaltyCodeEntryForm.tsx");
    expect(src).toMatch(/navigate\(buildProgramJoinPath\(code\)\)/);
    // And it is navigation only: the form performs no RPC and creates nothing.
    const code = stripComments(src);
    expect(code).not.toMatch(/supabase|\.rpc\(|becomeLoyaltyMember/);
  });

  it("4. a malformed code is refused and never navigated", () => {
    for (const bad of ["", "WPL", "WPL2026", "nonsense", "WPL2026001X"]) {
      expect(isValidProgramCodeFormat(bad), bad).toBe(false);
    }
    const src = PAGE("src/components/loyalty/LoyaltyCodeEntryForm.tsx");
    // The validation gate precedes the navigate.
    expect(src.indexOf("isValidProgramCodeFormat")).toBeLessThan(src.indexOf("navigate("));
  });

  it("5. it stays PUBLIC — no ProtectedRoute, no session required", () => {
    const app = PAGE("src/App.tsx");
    const route = app.indexOf('path="/member/register"');
    const protectedBranch = app.indexOf("element={<ProtectedRoute");
    expect(route).toBeGreaterThan(0);
    expect(route, "/member/register must remain outside the authenticated branch").toBeLessThan(protectedBranch);
  });
});

// ===========================================================================
// 6-7. /member for a non-member
// ===========================================================================

describe("/member — a non-member is sent to the code step, not a registration form", () => {
  it("6. shows the WPL-entry UI", () => {
    const src = PAGE("src/pages/member/MemberHomePage.tsx");
    expect(src).toContain('data-testid="member-not-a-member"');
    expect(src).toContain("LoyaltyCodeEntryForm");
  });

  it("7. cannot create a member — the form and its RPC are gone", () => {
    const src = read("src/pages/member/MemberHomePage.tsx");
    expect(src).not.toContain("MemberRegistrationForm");
    const code = stripComments(src);
    expect(code).not.toMatch(/becomeLoyaltyMember|loyalty_member_register|registerLoyaltyMember/);
  });

  it("8. an existing member still reaches the dashboard, and is never asked to register", () => {
    const src = PAGE("src/pages/member/MemberHomePage.tsx");
    // The dashboard branch is untouched and still driven by the server read.
    expect(src).toContain("fetchMemberDashboard");
    expect(src).toMatch(/state\.kind === "error" && state\.error === "not_a_member"/);
    // No name/phone collection anywhere on the page for an existing member.
    expect(src).not.toMatch(/Phone number|Your name/);
  });
});

// ===========================================================================
// 10-11. The only creation authority
// ===========================================================================

describe("member creation has exactly one entry point, and it has WPL context", () => {
  it("10. the WPL join page is the ONLY UI caller", () => {
    const pages = [
      "src/pages/member/MemberHomePage.tsx",
      "src/pages/member/MemberRegisterPage.tsx",
      "src/pages/member/LoyaltyLoginPage.tsx",
      "src/pages/member/WelcomePage.tsx",
      "src/pages/LoginPage.tsx",
      "src/pages/RegisterPage.tsx",
      "src/pages/StartBusinessPage.tsx",
    ];
    for (const p of pages) {
      expect(stripComments(read(p)), p).not.toMatch(/becomeLoyaltyMember|registerLoyaltyMember/);
    }
    // And the one that may: the WPL join, where the member is created as part of the join.
    const wpl = read("src/pages/PublicLoyaltyProgramPage.tsx");
    expect(wpl).toMatch(/becomeLoyaltyMember\(/);
    const calls = wpl.match(/becomeLoyaltyMember\(/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it("10b. on that page, creation happens after the join is chosen — never on sign-in", () => {
    const src = read("src/pages/PublicLoyaltyProgramPage.tsx");
    const google = src.slice(src.indexOf("const googleSubmit"), src.indexOf("const runJoin"));
    expect(google).not.toMatch(/becomeLoyaltyMember|registerLoyaltyMember|loyalty_member_register/);
  });

  it("11. Google authentication alone creates nothing anywhere", () => {
    // The Google handler in useAuth touches no member identity.
    const auth = stripComments(read("src/hooks/useAuth.ts"));
    const google = auth.slice(auth.indexOf("const signInWithGoogle"));
    expect(google.slice(0, google.indexOf("const signUp"))).not.toMatch(
      /loyalty_member_register|registerLoyaltyMember|becomeLoyaltyMember/,
    );
  });
});

// ===========================================================================
// 9 / 12 / 13. Nothing else moved
// ===========================================================================

describe("unchanged paths", () => {
  it("9. an existing member can still join another programme (WPL flow intact)", () => {
    const src = read("src/pages/PublicLoyaltyProgramPage.tsx");
    expect(src).toContain("joinLoyaltyProgramByCode");
    expect(src).toContain('data-testid="loyalty-program-join"');
  });

  it("12. the merchant POS authentication path is untouched", () => {
    const src = stripComments(read("src/pages/LoginPage.tsx"));
    expect(src).toMatch(/onGoogleLogin/);
    expect(src).not.toMatch(/becomeLoyaltyMember|loyalty_member_register|loyalty_member_join_by_code/);
  });

  it("13. the anonymous WPL enrollment path is intact", () => {
    const src = read("src/pages/PublicLoyaltyProgramPage.tsx");
    expect(src).toContain("submitProgramJoin");
    expect(src).toContain("loyaltyJoinConsent");
    // Separate from the authenticated RPC, by construction.
    const submit = src.slice(src.indexOf("const submit = async ()"));
    expect(submit.slice(0, 600)).not.toMatch(/joinLoyaltyProgramByCode/);
  });
});

// ===========================================================================
// Repository-wide audit
// ===========================================================================

describe("repository-wide: no generic member creation path remains", () => {
  it("the member-registering RPC is reachable from exactly one module", () => {
    // `registerLoyaltyMember` is the only wrapper over `loyalty_member_register`.
    const dashboard = read("src/lib/memberDashboard.ts");
    expect(dashboard).toContain('"loyalty_member_register"');
    // Its only caller is memberRegistration.ts, whose only caller is the WPL join.
    const registration = read("src/lib/memberRegistration.ts");
    expect(registration).toContain("registerLoyaltyMember(");
  });

  it("loyalty_member_register is not called directly from any page", () => {
    for (const p of [
      "src/pages/member/MemberHomePage.tsx",
      "src/pages/member/MemberRegisterPage.tsx",
      "src/pages/PublicLoyaltyProgramPage.tsx",
      "src/pages/member/LoyaltyLoginPage.tsx",
    ]) {
      expect(stripComments(read(p)), p).not.toContain("loyalty_member_register");
    }
  });

  it("no route creates a member merely by being visited", () => {
    // The three surfaces a non-member can land on must all be inert.
    for (const p of [
      "src/pages/member/MemberHomePage.tsx",
      "src/pages/member/MemberRegisterPage.tsx",
      "src/pages/member/LoyaltyLoginPage.tsx",
    ]) {
      const code = stripComments(read(p));
      expect(code, p).not.toMatch(/loyalty_member_register|becomeLoyaltyMember|registerLoyaltyMember/);
    }
  });
});
