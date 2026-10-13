import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertMarketingPricingIntegrity,
  MARKETING_HARDWARE_PACKAGES,
  MARKETING_PLANS,
  isMarketingPriceLive,
  marketingPlanPayableUgx,
} from "./marketingSiteData";
import {
  buildDefaultPublicPricing,
  mapPublicPricingRpc,
  type ComputedPlanPrice,
  type PaidPlanCode,
  type PublicPricingSnapshot,
} from "../lib/subscriptionPricing";

/** A `ComputedPlanPrice` row, with the LIST values derived the way the server does. */
function row(
  planCode: PaidPlanCode,
  listMonthly: number,
  finalMonthly: number,
  finalAnnual: number,
): ComputedPlanPrice {
  return {
    planCode,
    originalMonthlyUgx: listMonthly,
    monthlyDiscountUgx: listMonthly - finalMonthly,
    finalMonthlyUgx: finalMonthly,
    originalAnnualFullUgx: listMonthly * 12,
    finalAnnualUgx: finalAnnual,
    annualDiscountPercent: 20,
    hasMonthlyDiscount: finalMonthly < listMonthly,
    hasAnnualDiscount: true,
  };
}

/**
 * The production shape: no campaign, a live 50% global discount on both cycles.
 * Values are the ones the server charges today.
 */
const LIVE_BOOK: PublicPricingSnapshot = {
  campaignId: null,
  campaignName: null,
  campaignActive: false,
  globalDiscountActive: true,
  asOf: "2026-10-13T00:00:00.000Z",
  plansFromServer: true,
  plans: [
    row("starter", 18_000, 9_000, 86_400),
    row("business", 36_000, 18_000, 172_800),
    row("waka_plus", 82_000, 41_000, 393_600),
  ],
};

describe("marketingSiteData", () => {
  it("keeps marketing plan prices aligned with canonical subscription pricing", () => {
    expect(() => assertMarketingPricingIntegrity()).not.toThrow();
  });

  it("uses brochure hardware prices", () => {
    expect(MARKETING_HARDWARE_PACKAGES[0]?.priceUgx).toBe(780_000);
    expect(MARKETING_HARDWARE_PACKAGES[1]?.priceUgx).toBe(480_000);
    expect(MARKETING_HARDWARE_PACKAGES[2]?.priceUgx).toBe(180_000);
  });

  it("highlights Business as most popular", () => {
    const popular = MARKETING_PLANS.filter((p) => p.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0]?.code).toBe("business");
  });

  it("does not mention AI assistant in public plan features", () => {
    for (const plan of MARKETING_PLANS) {
      for (const feature of plan.features) {
        expect(feature.toLowerCase()).not.toMatch(/\bai\b/);
      }
    }
  });
});

describe("the homepage price is the payable price, never a list price", () => {
  const payable = (code: string, yearly: boolean, snapshot: PublicPricingSnapshot, priceLive: boolean) =>
    marketingPlanPayableUgx({ code, yearly, snapshot, priceLive });

  it("prints the DISCOUNTED monthly price, not the canonical list price", () => {
    // The defect being fixed: the homepage showed 36,000 while checkout charged 18,000.
    expect(payable("business", false, LIVE_BOOK, true)).toBe(18_000);
    expect(payable("business", false, LIVE_BOOK, true)).not.toBe(36_000);
  });

  it("prints the DISCOUNTED annual price, not the list-with-default figure", () => {
    // 345,600 is what the list price with only the 20% default would show.
    expect(payable("business", true, LIVE_BOOK, true)).toBe(172_800);
    expect(payable("business", true, LIVE_BOOK, true)).not.toBe(345_600);
  });

  it("matches the live values for every paid plan, monthly and yearly", () => {
    expect([payable("starter", false, LIVE_BOOK, true), payable("starter", true, LIVE_BOOK, true)]).toEqual([
      9_000, 86_400,
    ]);
    expect([payable("business", false, LIVE_BOOK, true), payable("business", true, LIVE_BOOK, true)]).toEqual([
      18_000, 172_800,
    ]);
    expect([payable("waka_plus", false, LIVE_BOOK, true), payable("waka_plus", true, LIVE_BOOK, true)]).toEqual([
      41_000, 393_600,
    ]);
  });

  it("returns null — NOT a list price — when the live book has not arrived", () => {
    /*
      THE SAFETY PROPERTY. `buildDefaultPublicPricing()` is the hook's initial
      state and it is full of canonical list prices; `pricingForPlan` would hand
      one back quite happily. Rendering it would advertise double what checkout
      charges, which is exactly the bug. `null` forces the caller to a dash.
    */
    const notLoaded = buildDefaultPublicPricing();
    for (const code of ["starter", "business", "waka_plus"]) {
      expect(payable(code, false, notLoaded, false), code).toBeNull();
      expect(payable(code, true, notLoaded, false), code).toBeNull();
    }
  });

  it("still shows Free as zero without any server value", () => {
    const notLoaded = buildDefaultPublicPricing();
    expect(payable("free", false, notLoaded, false)).toBe(0);
    expect(payable("free", true, notLoaded, false)).toBe(0);
    expect(payable("free", false, LIVE_BOOK, true)).toBe(0);
  });
});

describe("isMarketingPriceLive", () => {
  it("is false while the first load is in flight", () => {
    expect(isMarketingPriceLive({ loading: true, refreshError: null, everLoaded: false })).toBe(false);
  });

  it("is true once a server book has arrived", () => {
    expect(isMarketingPriceLive({ loading: false, refreshError: null, everLoaded: false })).toBe(true);
  });

  it("is FALSE when the FIRST load failed — the case `!loading` alone gets wrong", () => {
    // loading is false and the snapshot still holds list prices at this point.
    expect(isMarketingPriceLive({ loading: false, refreshError: "boom", everLoaded: false })).toBe(false);
  });

  it("stays true after a later refresh failure, because the last good book is kept", () => {
    // The hook deliberately retains the last valid book; stale beats fabricated.
    expect(isMarketingPriceLive({ loading: false, refreshError: "boom", everLoaded: true })).toBe(true);
  });
});

/**
 * THE WIRING, NOT MERELY THE HELPERS. A correct helper nobody calls changes
 * nothing — the original defect was exactly that: the homepage rendered
 * `plan.monthlyUgx` while a live-discounted book existed one import away.
 * There is no DOM test project here, so this reads the component's source, the
 * same approach `printerAdminWiring.contract.test.ts` takes.
 */
describe("the homepage is wired to the live book", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sections = readFileSync(
    join(here, "../components/marketing/website2026/MarketingSections.tsx"),
    "utf8",
  );
  const pricingSection = sections.slice(
    sections.indexOf("export function MarketingPricingSection"),
    sections.indexOf("export function MarketingComparisonSection"),
  );

  it("reads the same server-backed pricing source the app uses", () => {
    expect(pricingSection).toContain("usePublicPricing()");
    expect(pricingSection).toContain("marketingPlanPayableUgx(");
    expect(pricingSection).toContain("isMarketingPriceLive(");
  });

  it("no longer prints the static list prices on the plan cards", () => {
    // `MARKETING_PLANS` keeps its prices for `assertMarketingPricingIntegrity`,
    // but the card must not render them.
    expect(pricingSection).not.toContain("plan.monthlyUgx");
    expect(pricingSection).not.toContain("plan.annualUgx");
  });

  it("renders a placeholder rather than a number when no price is known", () => {
    expect(pricingSection).toContain('"—"');
  });

  it("does not compute a discount in the browser", () => {
    // The figure comes from the snapshot the server priced; a second formula
    // here is how a marketing page drifts from checkout.
    expect(pricingSection).not.toMatch(/finalMonthlyUgx\s*[*/+-]/);
    expect(pricingSection).not.toMatch(/finalAnnualUgx\s*[*/+-]/);
    // ...and it reaches for no local price computation either.
    expect(pricingSection).not.toContain("computePlanDisplayPrice");
    expect(pricingSection).not.toContain("CANONICAL_PLAN_PRICES");
    expect(pricingSection).not.toMatch(/monthlyUgx\s*[*/]/);
  });
});

/**
 * THE EMPTY / PARTIAL BOOK. This is the path that a `!loading`-only guard gets
 * wrong, and it cannot be caught by looking at `priceLive` alone:
 *
 *   `mapPublicPricingRpc` replaces an empty server plan list with
 *   `buildDefaultPublicPricing().plans` — canonical LIST prices delivered on a
 *   SUCCESSFUL response, with `refreshError` null. So `isMarketingPriceLive()`
 *   is true and the book looks perfectly loaded.
 *
 * The only thing standing between that and a customer seeing double the payable
 * price is that the price is LOOKED UP rather than asked for. These tests drive
 * the real mapper, so they fail if that ever goes back to `pricingForPlan`.
 */
describe("an empty or partial server book is never a payable price", () => {
  const payableFor = (code: string, snapshot: PublicPricingSnapshot, yearly = false) =>
    marketingPlanPayableUgx({ code, yearly, snapshot, priceLive: true });

  it("EMPTY plan list from the server → every paid card is a dash, not a list price", () => {
    const snapshot = mapPublicPricingRpc({ plans: [], global_discount_active: true });

    // Sanity: the mapper really did substitute a list-price book, and the hook
    // would consider it loaded. This is the trap, stated explicitly.
    expect(snapshot.plans.length).toBeGreaterThan(0);
    expect(snapshot.plans.find((p) => p.planCode === "business")?.finalMonthlyUgx).toBe(36_000);
    expect(isMarketingPriceLive({ loading: false, refreshError: null, everLoaded: true })).toBe(true);

    // ...and despite all of that, nothing is offered as payable.
    for (const code of ["starter", "business", "waka_plus"]) {
      expect(payableFor(code, snapshot), `${code} monthly`).toBeNull();
      expect(payableFor(code, snapshot, true), `${code} yearly`).toBeNull();
    }
  });

  it("a MISSING paid plan is a dash for that plan only", () => {
    const snapshot = mapPublicPricingRpc({
      plans: [
        { plan_code: "starter", original_monthly_ugx: 18000, monthly_discount_ugx: 9000, final_monthly_ugx: 9000, original_annual_full_ugx: 216000, final_annual_ugx: 86400, annual_discount_percent: 20, has_monthly_discount: true, has_annual_discount: true },
        { plan_code: "waka_plus", original_monthly_ugx: 82000, monthly_discount_ugx: 41000, final_monthly_ugx: 41000, original_annual_full_ugx: 984000, final_annual_ugx: 393600, annual_discount_percent: 20, has_monthly_discount: true, has_annual_discount: true },
      ],
    });

    expect(payableFor("business", snapshot)).toBeNull();
    expect(payableFor("starter", snapshot)).toBe(9_000);
    expect(payableFor("waka_plus", snapshot)).toBe(41_000);
  });

  it("a MALFORMED price is a dash — NaN, null or zero never becomes a figure", () => {
    const bad = (finalMonthly: unknown, finalAnnual: unknown): PublicPricingSnapshot =>
      mapPublicPricingRpc({
        plans: [
          { plan_code: "business", original_monthly_ugx: 36000, monthly_discount_ugx: 0, final_monthly_ugx: finalMonthly, original_annual_full_ugx: 432000, final_annual_ugx: finalAnnual, annual_discount_percent: 20, has_monthly_discount: false, has_annual_discount: true },
        ],
      });

    // Absent field → Number(undefined) → NaN
    expect(payableFor("business", bad(undefined, 172_800))).toBeNull();
    // Explicit null → Number(null) → 0, which would otherwise read as "free"
    expect(payableFor("business", bad(null, 172_800))).toBeNull();
    expect(payableFor("business", bad(0, 172_800))).toBeNull();
    // A NaN annual leg is refused on its own
    expect(payableFor("business", bad(18_000, "not a number"), true)).toBeNull();
    // ...while the sound leg still works
    expect(payableFor("business", bad(18_000, 172_800))).toBe(18_000);
  });

  it("a FAILED first load shows dashes, then a good book fills them in", () => {
    // Before any server contact: never loaded, list prices in hand.
    const notLoaded = buildDefaultPublicPricing();
    const priceLiveFirstTry = isMarketingPriceLive({ loading: false, refreshError: "network", everLoaded: false });
    expect(priceLiveFirstTry).toBe(false);
    expect(marketingPlanPayableUgx({ code: "business", yearly: false, snapshot: notLoaded, priceLive: priceLiveFirstTry })).toBeNull();

    // Then a real book arrives.
    const good = mapPublicPricingRpc({
      plans: [
        { plan_code: "business", original_monthly_ugx: 36000, monthly_discount_ugx: 18000, final_monthly_ugx: 18000, original_annual_full_ugx: 432000, final_annual_ugx: 172800, annual_discount_percent: 20, has_monthly_discount: true, has_annual_discount: true },
      ],
    });
    expect(marketingPlanPayableUgx({ code: "business", yearly: true, snapshot: good, priceLive: true })).toBe(172_800);
  });

  it("a LATER refresh failure keeps the last good book on screen", () => {
    // The hook retains the last valid snapshot on a failed refresh; the guard
    // must not blank a book that is still perfectly good.
    const stillGood: PublicPricingSnapshot = {
      ...LIVE_BOOK,
      asOf: "2026-10-13T00:00:00.000Z",
    };
    expect(isMarketingPriceLive({ loading: false, refreshError: "blip", everLoaded: true })).toBe(true);
    expect(marketingPlanPayableUgx({ code: "business", yearly: false, snapshot: stillGood, priceLive: true })).toBe(18_000);
    expect(marketingPlanPayableUgx({ code: "business", yearly: true, snapshot: stillGood, priceLive: true })).toBe(172_800);
  });

  it("Free is zero in every state — empty book, failed load, live book", () => {
    const empty = mapPublicPricingRpc({ plans: [] });
    const notLoaded = buildDefaultPublicPricing();
    expect(marketingPlanPayableUgx({ code: "free", yearly: false, snapshot: empty, priceLive: true })).toBe(0);
    expect(marketingPlanPayableUgx({ code: "free", yearly: true, snapshot: empty, priceLive: true })).toBe(0);
    expect(marketingPlanPayableUgx({ code: "free", yearly: false, snapshot: notLoaded, priceLive: false })).toBe(0);
    expect(marketingPlanPayableUgx({ code: "free", yearly: false, snapshot: LIVE_BOOK, priceLive: true })).toBe(0);
  });

  it("a MALFORMED top-level response cannot authorize a paid price", () => {
    /*
      Not `{ plans: [] }` but nothing at all — a null or undefined body, as a
      truncated or non-JSON response would produce. `mapPublicPricingRpc` opens
      with `(data ?? {})`, so both must land on the same empty-book path rather
      than throwing or inventing a book.
    */
    for (const [label, raw] of [["null", null], ["undefined", undefined]] as const) {
      const snapshot = mapPublicPricingRpc(raw);

      // It produces the list-price SUBSTITUTE — a complete-looking book...
      expect(snapshot.plans.length, label).toBeGreaterThan(0);
      expect(snapshot.plans.find((p) => p.planCode === "business")?.finalMonthlyUgx, label).toBe(36_000);
      // ...which is labelled as not-from-the-server.
      expect(snapshot.plansFromServer, label).toBe(false);

      // `payableFor` passes `priceLive: true` — the harshest case, as though the
      // hook believed the book had loaded. Provenance alone must refuse it.
      for (const code of ["starter", "business", "waka_plus"]) {
        expect(payableFor(code, snapshot), `${label} ${code} monthly`).toBeNull();
        expect(payableFor(code, snapshot, true), `${label} ${code} yearly`).toBeNull();
      }

      // Free is genuinely free regardless.
      expect(payableFor("free", snapshot), label).toBe(0);
      expect(payableFor("free", snapshot, true), label).toBe(0);
    }
  });
});
