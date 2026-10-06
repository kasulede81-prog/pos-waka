/**
 * M1 follow-up (H1 + H2 + campaign attribution) — real SQL.
 *
 * Runs against the full production migration chain (039 → 043 → 113 → M1 →
 * follow-up) so every assertion exercises the same function bodies production
 * runs: the real `admin_shop_set_subscription_plan`, the real pricing campaign
 * book, and the real `admin_pricing_campaign_metrics`.
 *
 * PGLite is single-connection: true two-session concurrency needs
 * TEST_DATABASE_URL (reported at the end of the suite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

describe("M1 follow-up — H1 period compounding, H2 price authority, attribution", () => {
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
    // A leftover active campaign would change every price assertion.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
  });

  // ---- helpers ----------------------------------------------------------

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  /** Call a void RPC (no jsonb payload to unwrap). */
  async function callVoid(userId: string, fn: string, args: unknown[]): Promise<void> {
    await asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      await exec.query(`SELECT public.${fn}(${placeholders})`, args);
    });
  }

  async function periodEnd(subscriptionId: string): Promise<string> {
    return scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`, [
      subscriptionId,
    ]);
  }

  async function subState(subscriptionId: string) {
    const { rows } = await exec.query<{
      status: string;
      payment_status: string;
      current_period_end: string;
      plan_id: string;
      trial_ends_at: string | null;
    }>(
      `SELECT status, payment_status, current_period_end::text, plan_id::text, trial_ends_at::text
       FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    return rows[0]!;
  }

  /** True when the stored period_end equals <expr> (both computed by Postgres). */
  async function periodEquals(
    subscriptionId: string,
    expectedSqlExpr: string,
    params: unknown[] = [],
  ): Promise<boolean> {
    return scalar<boolean>(
      `SELECT current_period_end = (${expectedSqlExpr}) FROM public.subscriptions WHERE id = $1`,
      [subscriptionId, ...params],
    );
  }

  /** True when the stored period_end is within ±toleranceSeconds of <expr>. */
  async function periodNear(
    subscriptionId: string,
    expectedSqlExpr: string,
    toleranceSeconds = 15,
  ): Promise<boolean> {
    return scalar<boolean>(
      `SELECT abs(extract(epoch from (current_period_end - (${expectedSqlExpr})))) <= ${toleranceSeconds}
       FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
  }

  async function paymentCount(subscriptionId: string): Promise<number> {
    return Number(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = $1`,
        [subscriptionId],
      ),
    );
  }

  async function historyCount(subscriptionId: string, action: string): Promise<number> {
    return Number(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history
         WHERE subscription_id = $1 AND action = $2`,
        [subscriptionId, action],
      ),
    );
  }

  /** Reset subscription A to a known, never-plan-granted baseline. */
  async function resetSubA() {
    await exec.exec(`
      DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}';
      DELETE FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions
      SET status = 'trialing',
          payment_status = 'unknown',
          current_period_start = now() - interval '10 days',
          current_period_end = now() + interval '20 days',
          trial_ends_at = NULL,
          metadata = '{}'::jsonb,
          updated_at = now()
      WHERE id = '${fx.subscriptionAId}';
    `);
  }

  const internal = () => fx.internalAdminId;

  async function planSet(shopId: string, planCode: string, days: number) {
    return rpc(internal(), "admin_shop_set_subscription_plan", [shopId, planCode, days]);
  }

  async function markPaid(subscriptionId: string, amountUgx: number, note = "m1 follow-up") {
    return asUser(exec, internal(), async () => {
      const { rows } = await exec.query(
        `SELECT public.admin_subscription_mark_payment($1::uuid, $2::bigint, $3::text)`,
        [subscriptionId, amountUgx, note],
      );
      return rows;
    });
  }

  async function createPayment(opts: {
    shopId: string;
    subscriptionId: string;
    reference?: string | null;
    amount?: number | null;
  }): Promise<Record<string, unknown>> {
    return rpc(internal(), "subscription_payment_create", [
      opts.shopId,
      "mtn_momo",
      opts.reference ?? null,
      opts.amount === undefined ? null : opts.amount,
      null,
      null,
      opts.subscriptionId,
    ]);
  }

  async function confirm(paymentId: string): Promise<Record<string, unknown>> {
    return rpc(internal(), "subscription_payment_confirm", [paymentId, null, null]);
  }

  /** Org + shop + active subscription on an existing canonical plan. */
  async function seedCanonicalSub(label: string, planCode: string, interval: "month" | "year") {
    const orgId = crypto.randomUUID();
    const shopId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'H2 ${label}');
      INSERT INTO public.shops (id, organization_id, name) VALUES ('${shopId}', '${orgId}', 'H2 Shop ${label}');
      INSERT INTO public.subscriptions (
        id, organization_id, shop_id, plan_id, status, billing_interval,
        current_period_start, current_period_end, payment_status
      )
      SELECT '${subId}', '${orgId}', '${shopId}', sp.id, 'active', '${interval}',
             now(), now() + interval '30 days', 'unknown'
      FROM public.subscription_plans sp WHERE sp.code = '${planCode}';
    `);
    const exists = await scalar<string>(
      `SELECT count(*)::text FROM public.subscriptions WHERE id = '${subId}'`,
    );
    expect(Number(exists)).toBe(1);
    return { orgId, shopId, subId };
  }

  async function expectedAmount(subscriptionId: string): Promise<number> {
    return Number(
      await scalar<string>(`SELECT public.subscription_payment_expected_amount($1)`, [subscriptionId]),
    );
  }

  async function publicPricing(): Promise<{
    plans: Array<{ plan_code: string; final_monthly_ugx: number; final_annual_ugx: number }>;
  }> {
    const { rows } = await exec.query(`SELECT public.public_subscription_pricing() AS result`);
    const raw = rpcJson(rows[0]) as unknown as {
      plans: Array<{ plan_code: string; final_monthly_ugx: number; final_annual_ugx: number }>;
    };
    return {
      plans: raw.plans.map((p) => ({
        plan_code: String(p.plan_code),
        final_monthly_ugx: Number(p.final_monthly_ugx),
        final_annual_ugx: Number(p.final_annual_ugx),
      })),
    };
  }

  function publicPlan(
    pricing: { plans: Array<{ plan_code: string; final_monthly_ugx: number; final_annual_ugx: number }> },
    code: string,
  ) {
    const row = pricing.plans.find((p) => p.plan_code === code);
    expect(row).toBeTruthy();
    return row!;
  }

  async function enableCampaign(name: string): Promise<string> {
    const campaignId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.pricing_campaigns (id, name, enabled)
      VALUES ('${campaignId}', '${name}', true);
    `);
    return campaignId;
  }

  async function setCampaignDiscount(
    campaignId: string,
    planCode: string,
    type: "percentage" | "fixed_amount",
    value: number,
    annualPercent: number | null = null,
  ) {
    await exec.exec(`
      INSERT INTO public.pricing_campaign_plan_discounts (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
      VALUES ('${campaignId}', '${planCode}', '${type}', ${value}, ${annualPercent === null ? "NULL" : annualPercent});
    `);
  }

  // ========================================================================
  // H1 — plan-grant x mark-paid must not compound
  // ========================================================================

  it("H1.1 normal paid renewal advances exactly once", async () => {
    await resetSubA();

    // A fresh admin grant (043 semantics: period = now + 30 days).
    await planSet(fx.shopAId, "business", 30);
    const afterGrant = await periodEnd(fx.subscriptionAId);
    expect(await periodNear(fx.subscriptionAId, "now() + interval '30 days'")).toBe(true);

    // First payment settles that same billing action — no second period.
    await markPaid(fx.subscriptionAId, 36_000);
    expect(await periodEnd(fx.subscriptionAId)).toBe(afterGrant);
    expect((await subState(fx.subscriptionAId)).payment_status).toBe("paid");

    // Renewal payment (provider path) advances EXACTLY one interval.
    const created = await createPayment({
      shopId: fx.shopAId,
      subscriptionId: fx.subscriptionAId,
      reference: "H1-RENEWAL",
    });
    expect(created.ok).toBe(true);
    await confirm(created.payment_id as string);
    // Stored end == granted end + exactly one month (both computed by Postgres).
    expect(
      await periodEquals(fx.subscriptionAId, "$2::timestamptz + interval '1 month'", [afterGrant]),
    ).toBe(true);

    // Replaying the confirmation must not move the period again.
    const replay = await confirm(created.payment_id as string);
    expect(replay.idempotent).toBe(true);
    expect(
      await periodEquals(fx.subscriptionAId, "$2::timestamptz + interval '1 month'", [afterGrant]),
    ).toBe(true);
    expect(await paymentCount(fx.subscriptionAId)).toBe(2); // adopted + renewal
  });

  it("H1.2 Apply Plan then Mark Paid cannot double the billing period", async () => {
    // Order A: grant, then record the payment for that same action.
    await resetSubA();
    await planSet(fx.shopAId, "business", 30);
    const afterGrant = await periodEnd(fx.subscriptionAId);
    await markPaid(fx.subscriptionAId, 36_000);
    expect(await periodEnd(fx.subscriptionAId)).toBe(afterGrant);
    // Definitely NOT ~60 days (30-day grant + a stacked billing month).
    expect(await periodNear(fx.subscriptionAId, "now() + interval '60 days'", 60 * 60 * 24)).toBe(false);
    expect(await periodNear(fx.subscriptionAId, "now() + interval '30 days'")).toBe(true);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);

    // Order B: record the payment first, then apply the plan — the grant
    // overwrite (pre-M1 behaviour) still wins, so this order never stacks.
    await resetSubA();
    await markPaid(fx.subscriptionAId, 36_000);
    const afterPayment = await periodEnd(fx.subscriptionAId);
    await planSet(fx.shopAId, "business", 30);
    expect(await periodNear(fx.subscriptionAId, "now() + interval '30 days'")).toBe(true);
    const { rows } = await exec.query<{ after: string }>(
      `SELECT current_period_end::text AS after FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(rows[0]!.after).not.toBe(afterPayment);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
  });

  it("H1.3 annual offer fulfilment still produces now + 365 days", async () => {
    await resetSubA();
    const offerId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.org_billing_offers (id, organization_id, shop_id, amount_ugx, status)
      VALUES ('${offerId}', '${fx.orgAId}', '${fx.shopAId}', 490000, 'claimed_paid');
    `);

    const result = await rpc(
      internal(),
      "internal_ops_org_billing_offer_fulfill",
      [offerId, "Annual plan payment"],
    );
    expect(result.ok).toBe(true);
    expect(result.subscription_id).toBe(fx.subscriptionAId);

    // 039 sets the period itself: (Kampala today + 365 days) at midnight.
    const near = await scalar<boolean>(
      `SELECT abs(extract(epoch from (
         current_period_end - ((timezone('Africa/Kampala', now())::date + interval '365 days')::timestamptz)
       ))) <= 60
       FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(near).toBe(true);

    const state = await subState(fx.subscriptionAId);
    expect(state.status).toBe("active");
    expect(state.payment_status).toBe("paid");

    const offerStatus = await scalar<string>(
      `SELECT status::text FROM public.org_billing_offers WHERE id = '${offerId}'`,
    );
    expect(offerStatus).toBe("fulfilled");

    // The manual payment was still recorded exactly once.
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(1);
  });

  it("H1.4 explicit grant and trial extension behaviour is unchanged", async () => {
    await resetSubA();

    // Grant: period is still exactly now + N days (043 contract).
    const grant = await planSet(fx.shopAId, "starter", 7);
    expect(grant.ok).toBe(true);
    expect(await periodNear(fx.subscriptionAId, "now() + interval '7 days'")).toBe(true);
    const periodAfterGrant = await periodEnd(fx.subscriptionAId);

    // Trial extension: adds N days to trial_ends_at and never touches the period.
    const before = await scalar<string | null>(
      `SELECT trial_ends_at::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(before).toBeNull();
    await callVoid(internal(), "admin_extend_subscription_trial", [fx.subscriptionAId, 5]);
    const trialEnd = await scalar<string>(
      `SELECT trial_ends_at::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    const nearTrial = await scalar<boolean>(
      // 028 computes (Kampala wall clock + N days) and stores it as timestamptz,
      // so the expectation mirrors that arithmetic instead of now() + N days.
      `SELECT abs(extract(epoch from (trial_ends_at - ((timezone('Africa/Kampala', now()) + interval '5 days')::timestamptz)))) <= 60
       FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(nearTrial).toBe(true);
    expect(trialEnd).not.toBeNull();
    expect(await periodEnd(fx.subscriptionAId)).toBe(periodAfterGrant);
    expect(await historyCount(fx.subscriptionAId, "extend_trial")).toBe(1);
  });

  // ========================================================================
  // H2 — one authoritative price source (canonical + campaign)
  // ========================================================================

  it("H2.1 expected amount equals the public canonical price for every plan (monthly)", async () => {
    const pricing = await publicPricing();
    for (const code of ["starter", "business", "waka_plus"]) {
      const { subId } = await seedCanonicalSub(`monthly-${code}`, code, "month");
      expect(await expectedAmount(subId)).toBe(publicPlan(pricing, code).final_monthly_ugx);
    }
    // Explicit anchors (not just self-consistency).
    expect(publicPlan(pricing, "starter").final_monthly_ugx).toBe(18_000);
    expect(publicPlan(pricing, "business").final_monthly_ugx).toBe(36_000);
    expect(publicPlan(pricing, "waka_plus").final_monthly_ugx).toBe(82_000);
  });

  it("H2.2 annual pricing matches public pricing including the annual discount", async () => {
    const pricing = await publicPricing();
    const { subId } = await seedCanonicalSub("annual-business", "business", "year");
    const expected = await expectedAmount(subId);
    expect(expected).toBe(publicPlan(pricing, "business").final_annual_ugx);
    // 36,000 × 12 months × (1 − 20% annual discount) = 345,600
    expect(expected).toBe(345_600);
  });

  it("H2.3 the canonical book wins over subscription_plans drift", async () => {
    const { subId } = await seedCanonicalSub("drift", "business", "month");
    // Simulate the production divergence (066's 49,000 vs canonical 36,000).
    await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 490000 WHERE code = 'business'`);
    try {
      expect(await expectedAmount(subId)).toBe(36_000);
      const pricing = await publicPricing();
      expect(publicPlan(pricing, "business").final_monthly_ugx).toBe(36_000);
    } finally {
      await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 36000 WHERE code = 'business'`);
    }
    expect(await expectedAmount(subId)).toBe(36_000);
  });

  it("H2.4 a cheaper client amount is still rejected", async () => {
    const { shopId, subId } = await seedCanonicalSub("tamper", "business", "month");
    const attempt = await createPayment({
      shopId,
      subscriptionId: subId,
      reference: "H2-TAMPER",
      amount: 35_999,
    });
    expect(attempt.ok).toBe(false);
    expect(String(attempt.error)).toBe("amount_mismatch");
    expect(Number(attempt.expected_amount_ugx)).toBe(36_000);
    expect(await paymentCount(subId)).toBe(0);

    // The honest amount is accepted and stored as the server price.
    const ok = await createPayment({
      shopId,
      subscriptionId: subId,
      reference: "H2-HONEST",
      amount: 36_000,
    });
    expect(ok.ok).toBe(true);
    expect(Number(ok.amount_ugx)).toBe(36_000);
  });

  it("H2.5 an active campaign percentage discount is reflected consistently", async () => {
    const { subId } = await seedCanonicalSub("pct", "business", "month");
    const campaignId = await enableCampaign("H2 percentage");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);

    const pricing = await publicPricing();
    expect(publicPlan(pricing, "business").final_monthly_ugx).toBe(27_000);
    expect(await expectedAmount(subId)).toBe(27_000);

    // The tamper check now guards the DISCOUNTED price too.
    const attempt = await createPayment({
      shopId: (await scalar<string>(`SELECT shop_id::text FROM public.subscriptions WHERE id = '${subId}'`)),
      subscriptionId: subId,
      reference: "H2-PCT-TAMPER",
      amount: 36_000, // full price while a 25% campaign is live
    });
    expect(attempt.ok).toBe(false);
    expect(String(attempt.error)).toBe("amount_mismatch");
    expect(Number(attempt.expected_amount_ugx)).toBe(27_000);
  });

  it("H2.6 fixed discounts and the minimum-price floor apply", async () => {
    const { subId } = await seedCanonicalSub("fixed", "business", "month");
    const campaignId = await enableCampaign("H2 fixed");
    await setCampaignDiscount(campaignId, "business", "fixed_amount", 10_000);

    expect(await expectedAmount(subId)).toBe(26_000);
    expect(await expectedAmount(subId)).toBe(publicPlan(await publicPricing(), "business").final_monthly_ugx);

    // A discount larger than the plan is clamped to the 5,000 UGX floor.
    await exec.exec(
      `UPDATE public.pricing_campaign_plan_discounts SET monthly_discount_value = 50000
       WHERE campaign_id = '${campaignId}' AND plan_code = 'business'`,
    );
    expect(await expectedAmount(subId)).toBe(5_000);
    expect(await expectedAmount(subId)).toBe(publicPlan(await publicPricing(), "business").final_monthly_ugx);
  });

  it("H2.7 inactive, expired and future campaigns do not affect the price", async () => {
    const { subId } = await seedCanonicalSub("inactive", "business", "month");
    const campaignId = await enableCampaign("H2 inactive");

    await setCampaignDiscount(campaignId, "business", "percentage", 25);
    expect(await expectedAmount(subId)).toBe(27_000);

    // Disabled campaign: full price again.
    await exec.exec(`UPDATE public.pricing_campaigns SET enabled = false WHERE id = '${campaignId}'`);
    expect(await expectedAmount(subId)).toBe(36_000);

    // Enabled but already ended: full price again.
    await exec.exec(
      `UPDATE public.pricing_campaigns SET enabled = true, ends_at = now() - interval '1 day' WHERE id = '${campaignId}'`,
    );
    expect(await expectedAmount(subId)).toBe(36_000);

    // Enabled but not started yet: full price again.
    await exec.exec(
      `UPDATE public.pricing_campaigns SET ends_at = NULL, starts_at = now() + interval '1 day' WHERE id = '${campaignId}'`,
    );
    expect(await expectedAmount(subId)).toBe(36_000);
    expect(await expectedAmount(subId)).toBe(publicPlan(await publicPricing(), "business").final_monthly_ugx);
  });

  it("H2.8 the free plan still prices at zero", async () => {
    const { subId } = await seedCanonicalSub("free", "free", "month");
    expect(await expectedAmount(subId)).toBe(0);
  });

  // ========================================================================
  // Campaign revenue attribution — settled payments only
  // ========================================================================

  type AttributionCase = { shopId: string; subId: string; windowFrom: string; windowTo: string };

  async function seedAttributionCase(label: string, minutesAgo: number): Promise<AttributionCase> {
    const created = new Date(Date.now() - minutesAgo * 60_000);
    const orgId = crypto.randomUUID();
    const shopId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Attribution ${label}');
      INSERT INTO public.shops (id, organization_id, name) VALUES ('${shopId}', '${orgId}', 'Attribution Shop ${label}');
      INSERT INTO public.subscriptions (
        id, organization_id, shop_id, plan_id, status, billing_interval,
        current_period_start, current_period_end, payment_status, created_at
      )
      SELECT '${subId}', '${orgId}', '${shopId}', sp.id, 'active', 'month',
             now(), now() + interval '30 days', 'unknown', '${created.toISOString()}'
      FROM public.subscription_plans sp WHERE sp.code = 'business';
    `);
    return {
      shopId,
      subId,
      windowFrom: new Date(created.getTime() - 30_000).toISOString(),
      windowTo: new Date(created.getTime() + 120_000).toISOString(),
    };
  }

  async function revenueFor(c: AttributionCase): Promise<number> {
    const result = await rpc(internal(), "admin_pricing_campaign_metrics", [null, c.windowFrom, c.windowTo]);
    return Number(result.revenue_recorded_ugx ?? 0);
  }

  async function settle(c: AttributionCase, reference: string): Promise<string> {
    const created = await createPayment({
      shopId: c.shopId,
      subscriptionId: c.subId,
      reference,
    });
    expect(created.ok).toBe(true);
    return created.payment_id as string;
  }

  it("ATTR.1 a confirmed payment counts as revenue", async () => {
    const c = await seedAttributionCase("confirmed", 10);
    await confirm(await settle(c, "ATTR-CONFIRMED"));
    expect(await revenueFor(c)).toBe(36_000);
  });

  it("ATTR.2 a legacy recorded payment counts as revenue", async () => {
    const c = await seedAttributionCase("recorded", 15);
    await exec.exec(`
      INSERT INTO public.subscription_payments (subscription_id, organization_id, shop_id, amount_ugx, provider, status, note)
      SELECT '${c.subId}', s.organization_id, s.shop_id, 18000, 'manual_admin', 'recorded', 'legacy row'
      FROM public.subscriptions s WHERE s.id = '${c.subId}';
    `);
    expect(await revenueFor(c)).toBe(18_000);
  });

  it("ATTR.3 a pending payment does not count", async () => {
    const c = await seedAttributionCase("pending", 20);
    const paymentId = await settle(c, "ATTR-PENDING");
    const row = await scalar<string>(
      `SELECT status::text FROM public.subscription_payments WHERE id = '${paymentId}'`,
    );
    expect(row).toBe("pending");
    expect(await revenueFor(c)).toBe(0);
  });

  it("ATTR.4 a failed payment does not count", async () => {
    const c = await seedAttributionCase("failed", 25);
    const paymentId = await settle(c, "ATTR-FAILED");
    const failed = await rpc(internal(), "subscription_payment_fail", [paymentId, "declined"]);
    expect(failed.ok).toBe(true);
    expect(await revenueFor(c)).toBe(0);
  });

  it("ATTR.5 a cancelled payment does not count", async () => {
    const c = await seedAttributionCase("cancelled", 30);
    const paymentId = await settle(c, "ATTR-CANCELLED");
    const cancelled = await rpc(internal(), "subscription_payment_cancel", [paymentId, "abandoned"]);
    expect(cancelled.ok).toBe(true);
    expect(await revenueFor(c)).toBe(0);
  });

  it("ATTR.6 a refunded payment does not count", async () => {
    const c = await seedAttributionCase("refunded", 35);
    const paymentId = await settle(c, "ATTR-REFUNDED");
    await confirm(paymentId);
    const refunded = await rpc(internal(), "subscription_payment_refund", [paymentId, "requested"]);
    expect(refunded.ok).toBe(true);
    expect(await revenueFor(c)).toBe(0);
  });

  it("ATTR.7 a newer pending payment cannot hide an older confirmed payment", async () => {
    const c = await seedAttributionCase("mixed", 40);
    await confirm(await settle(c, "ATTR-MIXED-CONFIRMED"));
    // A newer row that never settled, with a different amount so a wrong pick is visible.
    await exec.exec(`
      INSERT INTO public.subscription_payments (subscription_id, organization_id, shop_id, amount_ugx, provider, reference, status)
      SELECT '${c.subId}', s.organization_id, s.shop_id, 999999, 'mtn_momo', 'ATTR-MIXED-PENDING', 'pending'
      FROM public.subscriptions s WHERE s.id = '${c.subId}';
    `);
    expect(await revenueFor(c)).toBe(36_000);
  });

  it("reports whether real two-session PostgreSQL ran", () => {
    if (!exec.isRealPostgres) {
      console.info("Concurrent two-session PostgreSQL test not executed.");
    }
    expect(true).toBe(true);
  });
});
