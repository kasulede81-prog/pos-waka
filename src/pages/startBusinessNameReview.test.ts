import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const PAGE = "src/pages/StartBusinessPage.tsx";

/**
 * THE NAME REVIEW, where it actually appears.
 *
 * `/start-business` is the existing first-time merchant gate — it already sits outside
 * `KnownIdentityGate`, already collects the owner's name, and already writes metadata only. The
 * review was added there rather than on a new route, so the workspace-first provisioning order and
 * every gate that depends on it are untouched.
 *
 * There is no DOM test project in this repository (vitest runs `environment: "node"`), so the
 * rendered screen is asserted the way the rest of the suite asserts UI structure. The rule itself
 * is tested for real in `src/lib/nameReview.test.ts`.
 *
 * What must not regress, and is asserted below because these invariants already existed here:
 *   * the member redirect happens BEFORE the form can render;
 *   * `data-testid="start-business-shop-name"` stays;
 *   * the page still creates nothing — it navigates to /onboarding and no further.
 */
function page(): string {
  return src(PAGE);
}

describe("the review is shown to the right people", () => {
  it("H. it is decided by needsNameReview, which excludes members and existing tenants", () => {
    const source = page();
    expect(source).toContain("needsNameReview({ kind: identityKind, hasTenancy, metadata })");
    // One decision, used by the header, the fields and the submit alike — so the screen can never
    // disagree with the write about whether this person is reviewing.
    expect(source).toMatch(/const reviewing = needsNameReview\(/);
  });

  it("the member redirect still precedes the form", () => {
    const source = page();
    const redirect = source.indexOf('<Navigate to="/member"');
    const form = source.indexOf('data-testid="start-business-shop-name"');
    expect(redirect).toBeGreaterThan(0);
    expect(form).toBeGreaterThan(0);
    expect(redirect, "the member redirect must precede the form").toBeLessThan(form);
  });

  it("it still consults the classifier the same way, and still navigates to /onboarding", () => {
    const source = page();
    expect(source).toMatch(/resolveAccountIdentity\(/);
    expect(source).toMatch(/resolution\.kind === "member" \? "member" : "allowed"/);
    expect(source).toContain('navigate("/onboarding"');
  });

  it("a tenancy is read from the classifier's own reason, not guessed", () => {
    const source = page();
    expect(source).toContain('reason === "existing_tenancy"');
    expect(source).toContain('reason === "pending_staff_invite"');
  });
});

describe("A/B. the fields the person reviews", () => {
  it("renders first and last name, both required, both editable", () => {
    const source = page();
    expect(source).toContain('data-testid="name-review-first-name"');
    expect(source).toContain('data-testid="name-review-last-name"');
    expect(source).toContain("nameReviewFirstNameLabel");
    expect(source).toContain("nameReviewLastNameLabel");
    // Required on both, and no `readOnly`/`disabled` on either.
    expect(source.match(/\brequired\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source).not.toContain("readOnly");
  });

  it("pre-fills from reviewPrefill — the provider's suggestion, never invented", () => {
    expect(page()).toContain("setParts(reviewPrefill(meta))");
    expect(page()).toContain("reviewPrefill");
  });

  it("says what the name is for, and that it came from Google", () => {
    expect(page()).toContain("nameReviewTitle");
    expect(page()).toContain("nameReviewSub");
    expect(page()).toContain("nameReviewFromGoogleHint");
  });

  it("validates both parts and shows the message beside the field it is about", () => {
    const source = page();
    expect(source).toContain("namePartsProblem(parts)");
    expect(source).toMatch(/setPartError\(\{\s*field: problem\.field/);
    expect(source).toContain('partError?.field === "firstName"');
    expect(source).toContain('partError?.field === "lastName"');
  });

  it("the optional owner-name field is only offered when there is no review", () => {
    // Otherwise a merchant would be asked for their name twice on the same screen.
    const source = page();
    const optional = source.indexOf("Your name (optional)");
    expect(optional).toBeGreaterThan(0);
    expect(source.slice(Math.max(0, optional - 300), optional)).toContain("{!reviewing ? (");
  });
});

describe("the confirmed name is what gets persisted", () => {
  it("composes the confirmed name from both parts", () => {
    expect(page()).toContain("composeFullName(parts.firstName, parts.lastName)");
  });

  it("writes the confirmation BEFORE the intent declaration", () => {
    // So a failure leaves the account exactly as it was, rather than intent-declared with an
    // unconfirmed name.
    const source = page();
    const confirm = source.indexOf("await confirmWakaName(");
    const intent = source.indexOf("await declareMerchantIntent(");
    expect(confirm).toBeGreaterThan(0);
    expect(intent).toBeGreaterThan(confirm);
  });

  it("the reviewed name is the owner name handed to the intent", () => {
    expect(page()).toMatch(/const intentOwnerName = reviewing \? confirmedName : normalizeNamePart\(ownerName\)/);
  });

  it("a failed confirmation stops the flow instead of continuing", () => {
    const source = page();
    expect(source).toMatch(/if \(!confirmed\.ok\) \{[\s\S]{0,160}return;/);
  });
});

describe("E. the review state is durable, not per-tab", () => {
  it("confirmation is written through the metadata merge, not to browser storage", () => {
    const source = page();
    // A marker in sessionStorage or localStorage would re-ask on a new tab or a cleared cache —
    // and would never survive the browser restart this has to survive.
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("localStorage");
    expect(src("src/lib/wakaName.ts")).toContain("supabase.auth.updateUser(");
  });

  it("it survives a refresh by re-reading the session's own metadata", () => {
    // The decision is made from `supabase.auth.getUser()` on every mount, so a reload re-reads the
    // marker the merge wrote rather than relying on anything held in memory.
    expect(page()).toMatch(/supabase\.auth\.getUser\(\)/);
  });

  it("it creates nothing — provisioning stays where it was", () => {
    const source = page();
    expect(source).not.toContain("bootstrap_owner_workspace");
    expect(source).not.toContain("bootstrapOwnerWorkspace");
    expect(source).not.toContain("ensureOwnerWorkspaceIfNeeded");
  });
});
