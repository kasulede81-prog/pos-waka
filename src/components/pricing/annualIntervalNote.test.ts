/**
 * The annual pricing card explains that it is priced separately from monthly
 * promotions.
 *
 * WHY THE COPY EXISTS. Monthly and annual discounts became independent in
 * `20261012100000_discount_interval_isolation`. A monthly campaign discount no
 * longer feeds the annual price, so during a promotion the yearly figure sits
 * ABOVE the monthly one. That is correct, and it reads as a bug unless the page
 * says so.
 *
 * HOW THIS IS TESTED. This repo has no DOM test project — vitest runs
 * `environment: "node"` — but `react-dom/server` renders a component tree to
 * markup without one, and the loyalty suites import it for the same reason. The
 * behaviour below is therefore asserted against real rendered output rather than
 * against source text. Only the placement in the two PAGES is a source contract:
 * rendering them needs a router, a session and a live price book, so the wiring
 * is pinned the way `liveRefreshWiring.contract.test.ts` pins its own.
 *
 * NOTE ON THE FILE EXTENSION. This is `.ts`, not `.tsx`, because the repo's
 * vitest `include` is `src/**\/*.test.ts`: a `.test.tsx` file is never collected
 * and would sit here looking like coverage while running nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnualIntervalNote } from "./AnnualIntervalNote";
import { PlanPriceDisplay } from "./PlanPriceDisplay";
import { t } from "../../lib/i18n";
import { computePlanDisplayPrice } from "../../lib/subscriptionPricing";

const EXACT_COPY =
  "Annual pricing is separate from monthly promotions. Monthly discounts do not apply to annual subscriptions.";

/** A plan whose monthly price is on promotion. The annual figure must ignore it. */
const business = computePlanDisplayPrice("business", {
  monthlyDiscountType: "percentage",
  monthlyDiscountValue: 50,
  annualDiscountPercent: 20,
});

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("the annual pricing card explains interval isolation", () => {
  it("renders the wording verbatim", () => {
    expect(render(createElement(AnnualIntervalNote))).toContain(EXACT_COPY);
    expect(t("en", "annualIntervalNote")).toBe(EXACT_COPY);
  });

  it("appears on the annual price when asked for", () => {
    const html = render(createElement(PlanPriceDisplay, { price: business, interval: "year", showIntervalNote: true }));
    expect(html).toContain(EXACT_COPY);
    // Beside the annual figure it qualifies, not instead of it: 345,600 is the
    // year at the 20% annual leg, untouched by the 50% monthly promotion.
    expect(html).toContain("345,600");
    expect(html).not.toContain("172,800");
  });

  it("does NOT appear on a monthly card, whatever the caller asks for", () => {
    // The monthly price is the one a promotion IS allowed to move, so the
    // sentence would be false there. No prop can put it there.
    const html = render(createElement(PlanPriceDisplay, { price: business, interval: "month", showIntervalNote: true }));
    expect(html).not.toContain(EXACT_COPY);
    expect(html).not.toContain("annual-interval-note");
  });

  it("is opt-in, so an existing annual call site gains no copy it did not ask for", () => {
    const html = render(createElement(PlanPriceDisplay, { price: business, interval: "year" }));
    expect(html).not.toContain("annual-interval-note");
  });

  it("survives the branch where the annual price needs no strikethrough", () => {
    // `PlanPriceDisplay` has a separate early return for a price at list. The
    // rule being described is not conditional on a discount being live, so the
    // note has to come through that branch too.
    const atList = computePlanDisplayPrice("starter", {
      monthlyDiscountType: "none",
      monthlyDiscountValue: 0,
      annualDiscountPercent: 0,
    });
    const html = render(createElement(PlanPriceDisplay, { price: atList, interval: "year", showIntervalNote: true }));
    expect(html).toContain(EXACT_COPY);
  });

  it("falls back to the English wording for a language without a translation", () => {
    // No Luganda entry exists yet; `t` resolves to English rather than leaking
    // the raw key onto the page.
    const html = render(createElement(AnnualIntervalNote, { lang: "lg" }));
    expect(html).toContain(EXACT_COPY);
    expect(html).not.toContain("annualIntervalNote");
  });
});

// ---------------------------------------------------------------------------
// Placement — the copy has to sit with the price it explains
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("the note is placed with the annual price, in both surfaces", () => {
  it("the public pricing page puts it under the ANNUAL display, not the monthly one", () => {
    const pricingPage = read("src/pages/public/PricingPage.tsx");
    const annualStart = pricingPage.indexOf('interval="year"');
    expect(annualStart, "the annual display is rendered").toBeGreaterThan(-1);

    // The monthly display is rendered before it and carries no note, so the
    // sentence cannot end up beside a monthly figure.
    const monthly = pricingPage.slice(0, annualStart);
    expect(monthly).not.toContain("showIntervalNote");
    expect(monthly).not.toContain("AnnualIntervalNote");
    expect(pricingPage.slice(annualStart)).toContain("showIntervalNote");
  });

  it("the upgrade page puts it inside the yearly card, once for all three plans", () => {
    const upgradePage = read("src/pages/UpgradePage.tsx");
    const yearlyCard = upgradePage.slice(upgradePage.indexOf("upgradeYearlyTitle"));

    const note = yearlyCard.indexOf("<AnnualIntervalNote");
    expect(note, "the yearly card renders the note").toBeGreaterThan(-1);
    // Exactly one occurrence, inside the card rather than after it.
    expect(yearlyCard.split("<AnnualIntervalNote").length - 1).toBe(1);
    expect(note).toBeLessThan(yearlyCard.indexOf("</section>"));
    // And not repeated under each of the three yearly prices above it.
    expect(yearlyCard.slice(0, note)).not.toContain("showIntervalNote");
  });
});
