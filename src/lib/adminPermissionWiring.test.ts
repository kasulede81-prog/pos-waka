import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE GATES MUST BE WIRED, NOT MERELY DEFINED.
 *
 * `adminRoles.test.ts` proves the four narrowed predicates accept the right
 * roles. That is not enough on its own: the original defect was a component
 * using the WRONG predicate, so a correct helper that nobody calls changes
 * nothing. These assertions pin the wiring at each of the four sites, and fail
 * if a component goes back to the broader flag.
 *
 * (This is the same gap that made an earlier test vacuous — asserting the
 * helper while the caller stayed wrong.)
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const visionTab = read("../components/internal-admin/v2/shop-console/tabs/ShopConsoleVisionTab.tsx");
const supportTab = read("../components/internal-admin/v2/shop-console/tabs/ShopConsoleSupportTab.tsx");
const card = read("../components/internal-admin/v2/EnterpriseSubscriptionCard.tsx");
const shopPage = read("../pages/EnterpriseShopConsolePage.tsx");
const growthPage = read("../components/internal-admin/v2/pages/AdminGrowthCampaignPage.tsx");

describe("the four narrowed gates are actually used", () => {
  it("Vision tab gates on canManageShopVision, not canShopSubs", () => {
    expect(visionTab).toContain("perms.canManageShopVision");
    expect(visionTab).not.toContain("canManage={canSubs}");
  });

  it("shop-console password reset gates on canResetOwnerPassword, not canSupport", () => {
    expect(supportTab).toContain("perms.canResetOwnerPassword");
    // `canSupport` may still gate OTHER panels, but must not gate this one.
    const panel = supportTab.slice(supportTab.indexOf("SupportPasswordResetPanel"));
    expect(panel.slice(0, 400)).not.toContain("canSupport ?");
  });

  it("the subscription card separates lifecycle from grant, button by button", () => {
    expect(card).toContain("canManageLifecycle");
    const lines = card.split("\n");

    /** The `disabled` a button actually uses: the nearest one ABOVE its onClick. */
    const disabledFor = (action: string): string => {
      const at = lines.findIndex((l) => l.includes(`runEngine("${action}"`));
      expect(at, `${action} button not found`).toBeGreaterThan(-1);
      for (let i = at; i >= 0 && i > at - 12; i -= 1) {
        const m = lines[i]!.match(/disabled=\{(\w+)\}/);
        if (m) return m[1]!;
      }
      return "(none)";
    };

    // Lifecycle changes → the narrow flag (server refuses these for the extra roles).
    for (const action of ["extend", "pause", "resume", "cancel"]) {
      expect(disabledFor(action), `${action} must use the lifecycle gate`).toBe("lifecycleDisabled");
    }
    // Grant / renew / reset → the broader flag (the server really does allow it).
    for (const action of ["grant_monthly", "grant_yearly", "renew", "reset"]) {
      expect(disabledFor(action), `${action} must keep the grant gate`).toBe("disabled");
    }
  });

  it("the shop console's lifecycle actions are separated from mark-paid", () => {
    expect(shopPage).toContain("canSubsLifecycle");
    const block = shopPage.slice(shopPage.indexOf("if (subId && canSubs)"), shopPage.indexOf("if (canSubs) {"));
    // lifecycle actions inside the narrow gate...
    expect(block).toContain("if (canSubsLifecycle) {");
    // ...and mark_paid outside it, because the server widened that one.
    const afterLifecycle = block.slice(block.indexOf("if (canSubsLifecycle) {"));
    expect(afterLifecycle.indexOf("mark_paid")).toBeGreaterThan(-1);
  });

  it("the growth campaign page reads a role at all", () => {
    // It previously destructured only `previewMode`, so `adminRow` — already
    // passed in — was never used and no gate existed.
    expect(growthPage).toContain("adminPermissions(adminRow).canManageGrowthCampaigns");
    expect(growthPage).toContain("disabled={saving || !canManage}");
  });
});

/**
 * PHASE 4 — a failed request must not render as "nothing here".
 *
 * Both screens swallowed the failure and drew an empty state, so an operator
 * could not tell a refused RPC or a missing migration from a genuinely empty
 * list. The lib now reports the failure; these pin that the pages act on it.
 */
describe("failed loads are distinguishable from empty ones", () => {
  const activationLib = read("../lib/businessActivation.ts");
  const activationPage = read("../pages/InternalActivationOpsPage.tsx");
  const shopsPage = read("../components/internal-admin/v2/pages/AdminShopsPage.tsx");

  it("the activation list reports its error instead of returning []", () => {
    expect(activationLib).toContain("OpsActivationList");
    expect(activationLib).toContain("error: error.message");
    // The old silent swallow must be gone.
    expect(activationLib).not.toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return \[\];/);
  });

  it("the activation page renders a distinct error state with a retry", () => {
    expect(activationPage).toContain("listError");
    expect(activationPage).toContain("EnterpriseErrorState");
    // error branch must come BEFORE the empty branch
    expect(activationPage.indexOf("listError ?")).toBeLessThan(
      activationPage.indexOf("rows.length === 0 ?"),
    );
  });

  it("the shops page shows an error state, not an empty state, on failure", () => {
    expect(shopsPage).toContain("EnterpriseErrorState");
    expect(shopsPage.indexOf("searchError && !filtered.length")).toBeLessThan(
      shopsPage.indexOf("filtered.length === 0 ?"),
    );
  });

  it("raw database text is kept out of operator-facing copy", () => {
    // The diagnostic still exists, in the log — not interpolated into the UI.
    expect(shopsPage).toContain('console.error("[admin-shops] search failed"');
    expect(shopsPage).not.toContain("Shop search failed. {searchError}");
    expect(activationPage).toContain('console.error("[admin-activations] list failed"');
  });
});
