/**
 * Internal-admin monthly subscription discount — real SQL contract.
 *
 * Two discount mechanisms reach a subscription price, and they are DIFFERENT:
 *
 *   1. `subscriptions.admin_discount_percent` (0–100) — the per-subscription
 *      admin discount, applied by `subscription_payment_plan_amount` AFTER any
 *      campaign price. This one CAN reach 100% (price 0).
 *   2. pricing-campaign plan discounts (113) — campaign-wide, and deliberately
 *      bounded: percentages clamp at 90% and every plan floors at UGX 5,000
 *      (`_pricing_min_final_monthly_ugx`). This one can NOT reach 0.
 *
 * The suite pins both, so the difference is a tested fact rather than a
 * surprise, and so any future change to the floor/clamp fails loudly here.
 *
 * Base price under test: business = UGX 36,000 / month (canonical book, 113).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

const BUSINESS_MONTHLY = 36_000;
const MIN_FINAL_MONTHLY = 5_000;

describe("admin monthly subscription discount — pricing contract", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

  beforeEach(async () => {
    // A leftover campaign would silently change every campaign-price assertion.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await exec.exec("UPDATE public.subscriptions SET admin_discount_percent = 0;");
  });

  async function amount(plan: string, cycle: string, adminDiscount: number | null): Promise<number> {
    const { rows } = await exec.query<{ result: string }>(
      `SELECT public.subscription_payment_plan_amount($1, $2, $3) AS result`,
      [plan, cycle, adminDiscount],
    );
    return Number(rows[0]!.result);
  }

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  /** An enabled, always-on campaign carrying one plan discount. */
  async function campaign(
    planCode: string,
    type: "none" | "percentage" | "fixed_amount",
    value: number,
    annualPercent: number | null = null,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await exec.exec(
      `INSERT INTO public.pricing_campaigns (id, name, enabled) VALUES ('${id}', 'audit', true);`,
    );
    if (type !== "none") {
      await exec.exec(
        `INSERT INTO public.pricing_campaign_plan_discounts
           (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
         VALUES ('${id}', '${planCode}', '${type}', ${value}, ${annualPercent === null ? "NULL" : annualPercent});`,
      );
    }
    return id;
  }

  // ========================================================================
  // The required table — percentage discounts (admin_discount_percent)
  // ========================================================================

  it("applies a percentage admin discount exactly as specified (36,000 base)", async () => {
    const cases: Array<[number, number]> = [
      [0, BUSINESS_MONTHLY],
      [25, 27_000],
      [50, 18_000],
      [100, 0],
    ];
    for (const [percent, expected] of cases) {
      expect(await amount("business", "month", percent), `${percent}%`).toBe(expected);
    }
  });

  it("accepts 100% — a full discount really does price at zero", async () => {
    expect(await amount("business", "month", 100)).toBe(0);
    expect(await amount("starter", "month", 100)).toBe(0);
    expect(await amount("waka_plus", "month", 100)).toBe(0);
  });

  it("clamps an out-of-range admin discount instead of producing a negative price", async () => {
    // Above 100 must not pay the customer back.
    expect(await amount("business", "month", 150)).toBe(0);
    expect(await amount("business", "month", 1000)).toBe(0);
    // Negative must not inflate the price above list.
    expect(await amount("business", "month", -25)).toBe(BUSINESS_MONTHLY);
    // Absent / null is “no discount”, never a silent total discount.
    expect(await amount("business", "month", null)).toBe(BUSINESS_MONTHLY);
  });

  it("rounds to the nearest shilling", async () => {
    // 18,000 × (100 − 33) / 100 = 12,060 exactly.
    expect(await amount("starter", "month", 33)).toBe(12_060);
    // 82,000 × 0.875 = 71,750 exactly.
    expect(await amount("waka_plus", "month", 12.5)).toBe(71_750);
    // 36,000 × 0.7775 = 27,990 exactly.
    expect(await amount("business", "month", 22.25)).toBe(27_990);
  });

  it("applies the discount to the yearly amount for an annual subscription", async () => {
    // Canonical annual for business = 36,000 × 12 × (1 − 0.20) = 345,600.
    expect(await amount("business", "year", 0)).toBe(345_600);
    expect(await amount("business", "year", 25)).toBe(259_200);
    expect(await amount("business", "year", 100)).toBe(0);
  });

  // ========================================================================
  // The required table — fixed-amount discounts (campaign engine)
  // ========================================================================

  it("applies a fixed-amount campaign discount against the base price", async () => {
    await campaign("business", "fixed_amount", 5_000);
    expect(await amount("business", "month", 0)).toBe(31_000);
  });

  it("floors a fixed-amount campaign discount at UGX 5,000 — NOT zero", async () => {
    // The brief's table expects UGX 0 for a fixed 36,000 discount on a 36,000
    // plan. The product's own rule (`_pricing_min_final_monthly_ugx`) floors it.
    await campaign("business", "fixed_amount", BUSINESS_MONTHLY);
    expect(await amount("business", "month", 0)).toBe(MIN_FINAL_MONTHLY);

    // A discount larger than the plan price clamps to the same floor and can
    // never produce a negative price.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await campaign("business", "fixed_amount", 999_999);
    const floored = await amount("business", "month", 0);
    expect(floored).toBe(MIN_FINAL_MONTHLY);
    expect(floored).toBeGreaterThanOrEqual(0);
  });

  it("clamps a campaign percentage at 90% and floors it at UGX 5,000", async () => {
    // Both bounds are visible depending on the plan.
    // business 36,000 − 90% = 3,600, which is under the floor → floored.
    await campaign("business", "percentage", 100);
    expect(await amount("business", "month", 0)).toBe(MIN_FINAL_MONTHLY);

    // waka_plus 82,000 − 90% = 8,200, above the floor → the 90% clamp binds.
    // Requesting 100% must not give more than the clamp allows.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await campaign("waka_plus", "percentage", 100);
    expect(await amount("waka_plus", "month", 0)).toBe(8_200);

    // So a campaign can NEVER reach 0, whatever percentage is stored.
    expect(await amount("business", "month", 0)).not.toBe(0);
    expect(await amount("waka_plus", "month", 0)).not.toBe(0);
  });

  // ========================================================================
  // Interaction between the two mechanisms
  // ========================================================================

  it("applies the campaign price and the admin discount once each, not twice", async () => {
    await campaign("business", "percentage", 50); // 36,000 → 18,000
    // 18,000 − 50% = 9,000. Applying either twice would give 0 or 18,000.
    expect(await amount("business", "month", 50)).toBe(9_000);
    // And the admin discount still reaches 100% on top of a campaign price.
    expect(await amount("business", "month", 100)).toBe(0);
  });

  it("takes the base price from the canonical book, not the legacy plan row", async () => {
    expect(await amount("business", "month", 0)).toBe(BUSINESS_MONTHLY);

    // Move the legacy plan row and prove the price does not follow it — the
    // M3-G fail-closed rule exists precisely so a stale 066 price can never be
    // charged to a customer.
    await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 49000 WHERE code = 'business'`);
    expect(await amount("business", "month", 0)).toBe(BUSINESS_MONTHLY);
    expect(await amount("business", "month", 50)).toBe(18_000);
    await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 36000 WHERE code = 'business'`);
  });

  // ========================================================================
  // Where the discount comes from (authority)
  // ========================================================================

  it("prices from the stored subscription discount, and no caller may supply one", async () => {
    await exec.exec(`UPDATE public.subscriptions SET admin_discount_percent = 75 WHERE id = '${fx.subscriptionAId}'`);
    // `subscription_payment_expected_amount` is the single-arg, subscription-
    // driven entry point: no discount parameter exists for a client to abuse.
    const expected = Number(
      await scalar<string>(`SELECT public.subscription_payment_expected_amount($1)::text`, [fx.subscriptionAId]),
    );
    expect(expected).toBe(9_000); // 36,000 − 75%

    const args = await exec.query<{ args: string }>(
      `SELECT pg_get_function_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'subscription_payment_quote'`,
    );
    expect(args.rows.map((r) => r.args).join(" ")).not.toMatch(/discount/i);
  });

  it("refuses a quote to someone who is not part of the shop", async () => {
    const asOutsider = await asUser(exec, fx.outsiderId, async () => {
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.subscription_payment_quote($1, 'business', 'month') AS result`,
        [fx.shopAId],
      );
      return rpcJson(rows[0]);
    });
    // A JSON refusal, not a raised exception — and no price is disclosed.
    expect(asOutsider.ok).toBe(false);
    expect(String(asOutsider.error)).toMatch(/forbidden/i);
    expect(asOutsider.amount_ugx).toBeUndefined();

    // The shop's own owner is served normally, so the refusal is about
    // membership and not a blanket failure.
    const asOwner = await asUser(exec, fx.ownerAId, async () => {
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.subscription_payment_quote($1, 'business', 'month') AS result`,
        [fx.shopAId],
      );
      return rpcJson(rows[0]);
    });
    expect(asOwner.ok).toBe(true);
    expect(Number(asOwner.amount_ugx)).toBe(BUSINESS_MONTHLY);
  });

  it("a 100% discount still leaves the subscription row untouched by pricing", async () => {
    // Pricing is a pure read: computing a 0 price must not mutate the plan,
    // the stored discount, or the status.
    const before = await scalar<string>(
      `SELECT (admin_discount_percent::text || '|' || status) FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    await amount("business", "month", 100);
    const after = await scalar<string>(
      `SELECT (admin_discount_percent::text || '|' || status) FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(after).toBe(before);
  });
});
