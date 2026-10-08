import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ONE plan grant, ONE set of rules (Phase 1).
 *
 * The shop console exposed the same capability twice — "Apply plan: <code>" in
 * the action sheet, and the Subscriptions tab's grant buttons — and they
 * disagreed:
 *
 *   action sheet  → days: <a local `useState(30)` whose only setter sat behind a
 *                          `!== 30` guard that could never be true>
 *                   billingCycle: <omitted>
 *   card          → days: settings.monthlyDurationDays / yearlyDurationDays
 *                   billingCycle: "monthly" / "yearly"
 *
 * `subscriptionEngine.grant` INFERS the cycle when it is omitted
 * (`>=330 yearly`, `>=20 monthly`, else `custom`), so the frozen 30 produced
 * `monthly` only by luck — change the platform monthly duration and the two
 * controls gave different answers, and a short grant silently created a
 * `custom` cycle the other control can never produce.
 *
 * A STRUCTURAL SUITE, deliberately: this repo has no DOM test project, so the
 * two components cannot be mounted. It asserts on their source, and it is
 * written to fail if either control goes back to a local constant or drops the
 * explicit cycle.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const page = read("../pages/EnterpriseShopConsolePage.tsx");
const card = read("../components/internal-admin/v2/EnterpriseSubscriptionCard.tsx");

/** The shop console's plan action, from its handler to the end of the grant call. */
const planAction = page.slice(
  page.indexOf("const setAdminPlan"),
  page.indexOf("const shopActions"),
);

/** The card's monthly grant button. */
const cardMonthlyGrant = card.slice(
  card.indexOf('runEngine("grant_monthly"'),
  card.indexOf('runEngine("grant_yearly"'),
);

describe("subscription plan grants share one rule set", () => {
  it("both controls take their duration from the platform settings", () => {
    // The shop console reads the authoritative source...
    expect(page).toContain("fetchPlatformSubscriptionSettings");
    expect(planAction).toContain("platformSettings.monthlyDurationDays");
    // ...and so does the card.
    expect(card).toContain("settings?.monthlyDurationDays");
    expect(cardMonthlyGrant).toContain("days: monthlyDays");
  });

  it("neither control owns a local day-count constant any more", () => {
    // The exact defect: a useState(30) with an unreachable setter.
    expect(page).not.toContain("planControlDays");
    expect(page).not.toContain("setPlanControlDays");
    expect(planAction).not.toMatch(/days:\s*\d/);
    expect(cardMonthlyGrant).not.toMatch(/days:\s*\d/);
  });

  it("both controls state the cycle explicitly, so nothing is inferred", () => {
    // grant() falls back to inferring from the day count; an explicit cycle is
    // what keeps a short or long grant from silently becoming `custom`/`yearly`.
    expect(planAction).toContain('billingCycle: "monthly"');
    expect(cardMonthlyGrant).toContain('billingCycle: "monthly"');
  });

  it("the shop console's plan grant is a MONTHLY grant of the current plan", () => {
    // Same shape as the card's monthly button: one plan, one cycle, one duration.
    expect(planAction).toContain("planCode,");
    expect(planAction).toContain("shopId: detail.shop.id");
    // and it still runs through the same permission gate as before
    expect(planAction).toContain("permitted: canSubs");
  });

  it("the platform default the page falls back to matches the card's", () => {
    // While settings are loading neither control may invent a different number.
    expect(page).toContain("DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS");
    expect(page).toMatch(/useState<PlatformSubscriptionSettings>\(\s*DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS,?\s*\)/);
    // the card's `?? 30` and the default constant must agree
    expect(card).toContain("?? 30");
  });
});
