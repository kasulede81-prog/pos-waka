/**
 * M3-A — PAYMENT INTENT FOUNDATION (real SQL).
 *
 * Runs the full production chain through the new
 * 20261007100000_subscription_payment_intent.sql and proves, against the
 * production privilege posture:
 *   - price parity: every intent's server amount equals the public price page
 *     (canonical + active campaign, monthly & annual, floor, expiry),
 *   - client cannot override amount / campaign / org / shop / plan directly,
 *   - confirm applies the purchased plan + billing interval exactly once,
 *     atomically (subscription_conflict never half-confirms),
 *   - stale pending intents are auto-cancelled with stale_replaced,
 *   - M1 idempotency (payment_id, provider/reference) is unchanged,
 *   - owner/admin/billing may initiate; staff/manager/viewer may not,
 *   - payment rows stay unreadable to customers (no M3-A read exposure).
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

type RpcResult = Record<string, unknown>;

describe("M3-A — payment intent foundation (real SQL)", () => {
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

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<RpcResult> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  const internal = () => fx.internalAdminId;

  /** Intent creation — the extended9-parameter subscription_payment_create. */
  async function intent(opts: {
    shopId?: string;
    subscriptionId?: string | null;
    provider?: string;
    reference?: string | null;
    amount?: number | null;
    paymentId?: string | null;
    plan?: string | null;
    cycle?: string | null;
  }): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_create", [
      opts.shopId ?? fx.shopAId,
      opts.provider ?? "mtn_momo",
      opts.reference ?? null,
      opts.amount === undefined ? null : opts.amount,
      null,
      opts.paymentId ?? null,
      opts.subscriptionId === undefined ? fx.subscriptionAId : opts.subscriptionId,
      opts.plan ?? null,
      opts.cycle ?? null,
    ]);
  }

  async function confirm(paymentId: string, reference: string | null = null): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_confirm", [paymentId, reference, null]);
  }

  async function subState(subscriptionId: string) {
    const { rows } = await exec.query<{
      plan_code: string;
      billing_interval: string;
      status: string;
      payment_status: string;
      current_period_start: string;
      current_period_end: string;
    }>(
      `SELECT sp.code AS plan_code, s.billing_interval, s.status, s.payment_status,
              s.current_period_start::text AS current_period_start,
              s.current_period_end::text AS current_period_end
       FROM public.subscriptions s
       JOIN public.subscription_plans sp ON sp.id = s.plan_id
       WHERE s.id = $1`,
      [subscriptionId],
    );
    return rows[0]!;
  }

  async function paymentRow(paymentId: string) {
    const { rows } = await exec.query<{
      status: string;
      amount_ugx: string;
      status_reason: string | null;
      checkout: unknown;
    }>(
      `SELECT status, amount_ugx::text, status_reason,
              (metadata -> 'checkout') AS checkout
       FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    return rows[0];
  }

  async function historyCount(subscriptionId: string, action: string, payloadFilter?: string): Promise<number> {
    return Number(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history
         WHERE subscription_id = $1 AND action = $2
           AND ($3::text IS NULL OR payload ->> 'status_reason' = $3)`,
        [subscriptionId, action, payloadFilter ?? null],
      ),
    );
  }

  /** True when current_period_start/end equal the given expressions exactly. */
  async function periodEquals(
    subscriptionId: string,
    startExpr: string,
    endExpr: string,
    params: unknown[],
  ): Promise<boolean> {
    return scalar<boolean>(
      `SELECT current_period_start = (${startExpr}) AND current_period_end = (${endExpr})
       FROM public.subscriptions WHERE id = $1`,
      [subscriptionId, ...params],
    );
  }

  async function resetSubA(
    plan = "starter",
    cycle: "month" | "year" = "month",
    status = "trialing",
  ) {
    await exec.exec(`
      DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}';
      DELETE FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions s
      SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = '${plan}'),
          billing_interval = '${cycle}',
          status = '${status}',
          payment_status = 'unknown',
          current_period_start = now() - interval '10 days',
          current_period_end = now() + interval '20 days',
          trial_ends_at = NULL,
          metadata = '{}'::jsonb,
          updated_at = now()
      WHERE s.id = '${fx.subscriptionAId}';
    `);
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
    expect(row, `public pricing missing plan ${code}`).toBeTruthy();
    return row!;
  }

  async function enableCampaign(name: string): Promise<string> {
    const campaignId = crypto.randomUUID();
    await exec.exec(
      `INSERT INTO public.pricing_campaigns (id, name, enabled) VALUES ('${campaignId}', '${name}', true)`,
    );
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
  // 10. PRICE PARITY + TAMPERING
  // ========================================================================

  it("P1 every valid plan/cycle intent equals public_subscription_pricing (A–D)", async () => {
    const pricing = await publicPricing();
    expect(publicPlan(pricing, "starter").final_monthly_ugx).toBe(18_000);
    expect(publicPlan(pricing, "business").final_monthly_ugx).toBe(36_000);
    expect(publicPlan(pricing, "waka_plus").final_monthly_ugx).toBe(82_000);
    expect(publicPlan(pricing, "business").final_annual_ugx).toBe(345_600); // 36,000 × 12 × 0.8

    for (const plan of ["starter", "business", "waka_plus"]) {
      for (const cycle of ["monthly", "yearly"]) {
        const r = await intent({ plan, cycle, reference: `P1-${plan}-${cycle}` });
        expect(r.ok, `intent ${plan}/${cycle} → ${JSON.stringify(r)}`).toBe(true);
        const pub =
          cycle === "monthly"
            ? publicPlan(pricing, plan).final_monthly_ugx
            : publicPlan(pricing, plan).final_annual_ugx;
        expect(Number(r.amount_ugx)).toBe(pub);
        expect(Number(r.expected_amount_ugx)).toBe(pub);
      }
    }
  });

  it("P2 percentage campaign discount flows into the intent and matches public pricing (E)", async () => {
    const campaignId = await enableCampaign("M3 pct");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);
    const pricing = await publicPricing();

    const r = await intent({ plan: "business", cycle: "monthly", reference: "P2" });
    expect(r.ok).toBe(true);
    expect(Number(r.amount_ugx)).toBe(27_000);
    expect(Number(r.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
  });

  it("P3 fixed discount and the minimum floor flow into the intent (F, G)", async () => {
    const campaignId = await enableCampaign("M3 fixed");
    await setCampaignDiscount(campaignId, "business", "fixed_amount", 10_000);
    let pricing = await publicPricing();
    let r = await intent({ plan: "business", cycle: "monthly", reference: "P3a" });
    expect(Number(r.amount_ugx)).toBe(26_000);
    expect(Number(r.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);

    // Discount larger than the plan is clamped to the 5,000 UGX floor.
    await exec.exec(
      `UPDATE public.pricing_campaign_plan_discounts SET monthly_discount_value = 50000
       WHERE campaign_id = '${campaignId}' AND plan_code = 'business'`,
    );
    pricing = await publicPricing();
    r = await intent({ plan: "business", cycle: "monthly", reference: "P3b" });
    expect(Number(r.amount_ugx)).toBe(5_000);
    expect(Number(r.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
  });

  it("P4 expired campaign is ignored (H)", async () => {
    const campaignId = await enableCampaign("M3 expired");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);
    await exec.exec(
      `UPDATE public.pricing_campaigns SET ends_at = now() - interval '1 day' WHERE id = '${campaignId}'`,
    );
    const pricing = await publicPricing();
    const r = await intent({ plan: "business", cycle: "monthly", reference: "P4" });
    expect(Number(r.amount_ugx)).toBe(36_000);
    expect(Number(r.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
  });

  it("P5 client-supplied amount can never override the server price (I)", async () => {
    await resetSubA();
    const cheap = await intent({ plan: "business", cycle: "monthly", amount: 1, reference: "P5a" });
    expect(cheap.ok).toBe(false);
    expect(String(cheap.error)).toBe("amount_mismatch");
    expect(Number(cheap.expected_amount_ugx)).toBe(36_000);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`)).toBe("0");

    const honest = await intent({ plan: "business", cycle: "monthly", amount: 36_000, reference: "P5b" });
    expect(honest.ok).toBe(true);
    expect(Number(honest.amount_ugx)).toBe(36_000);
  });

  it("P6 campaign selection is server-side — client cannot ignore the active campaign (J)", async () => {
    await resetSubA();
    const campaignId = await enableCampaign("M3 forced");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);

    // Client tries to pay the undiscounted price while the campaign is live.
    const full = await intent({ plan: "business", cycle: "monthly", amount: 36_000, reference: "P6a" });
    expect(full.ok).toBe(false);
    expect(String(full.error)).toBe("amount_mismatch");
    expect(Number(full.expected_amount_ugx)).toBe(27_000);

    // Only the server-selected (discounted) price is accepted.
    const discounted = await intent({ plan: "business", cycle: "monthly", amount: 27_000, reference: "P6b" });
    expect(discounted.ok).toBe(true);
    expect(Number(discounted.amount_ugx)).toBe(27_000);
    // There is no campaign parameter to send: the selection cannot be client-controlled.
    expect(String(discounted.plan_code)).toBe("business");
  });

  it("P7 client cannot select another organization or shop (K, L)", async () => {
    // Same shop, someone else's subscription (cross-organization).
    const wrongSub = await intent({
      shopId: fx.shopAId,
      subscriptionId: fx.subscriptionBId,
      reference: "P7a",
    });
    expect(wrongSub.ok).toBe(false);
    expect(String(wrongSub.error)).toBe("shop_subscription_mismatch");

    // Own subscription, another shop (cross-shop; anchor rule).
    const wrongShop = await intent({
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionAId,
      reference: "P7b",
    });
    expect(wrongShop.ok).toBe(false);
    expect(String(wrongShop.error)).toBe("shop_subscription_mismatch");
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionBId}'`)).toBe("0");
  });

  it("P8 client cannot change the plan through direct subscriptions DML (M)", async () => {
    await resetSubA("starter");
    const otherPlan = await scalar<string>(`SELECT id::text FROM public.subscription_plans WHERE code = 'waka_plus'`);
    let err = "no-error";
    try {
      await asUser(exec, fx.ownerAId, () =>
        exec.query(`UPDATE public.subscriptions SET plan_id = '${otherPlan}' WHERE id = $1`, [fx.subscriptionAId]),
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    expect(err).toMatch(/permission denied/i);
    expect(await scalar<string>(`SELECT sp.code::text FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id WHERE s.id = '${fx.subscriptionAId}'`)).toBe("starter");
  });

  it("P9 unknown plan and unknown cycle are rejected before anything is stored", async () => {
    await resetSubA();
    const badPlan = await intent({ plan: "does_not_exist", reference: "P9a" });
    expect(badPlan.ok).toBe(false);
    expect(String(badPlan.error)).toBe("plan_not_available");

    const badCycle = await intent({ plan: "business", cycle: "weekly", reference: "P9b" });
    expect(badCycle.ok).toBe(false);
    expect(String(badCycle.error)).toBe("invalid_billing_interval");

    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`)).toBe("0");
  });

  // ========================================================================
  // 11. CONFIRMATION — plan/interval settlement, exact-once, conflict
  // ========================================================================

  it("C1 Starter → paid Starter: plan + interval applied, period advanced exactly once", async () => {
    await resetSubA("starter");
    const before = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);

    const i = await intent({ plan: "starter", cycle: "monthly", reference: "C1" });
    expect(i.ok).toBe(true);
    const c = await confirm(i.payment_id as string);

    expect(c.ok).toBe(true);
    expect(c.idempotent).toBe(false);
    expect(c.plan_code).toBe("starter");
    expect(c.billing_interval).toBe("month");

    const s = await subState(fx.subscriptionAId);
    expect(s.plan_code).toBe("starter");
    expect(s.billing_interval).toBe("month");
    expect(s.status).toBe("active");
    expect(s.payment_status).toBe("paid");
    // exact period semantics: start = previous end, end = previous end + 1 month
    expect(await periodEquals(fx.subscriptionAId, "$2::timestamptz", "$2::timestamptz + interval '1 month'", [before])).toBe(true);
    expect((await paymentRow(i.payment_id as string))!.status).toBe("confirmed");
  });

  it("C2 Starter → paid Business", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C2" });
    expect(i.ok).toBe(true);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(true);
    expect(c.plan_code).toBe("business");
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("business");
  });

  it("C3 Starter → paid Waka Plus", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "waka_plus", cycle: "monthly", reference: "C3" });
    expect(i.ok).toBe(true);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(true);
    expect(c.plan_code).toBe("waka_plus");
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("waka_plus");
  });

  it("C4 monthly → yearly: interval applied before the period advance", async () => {
    await resetSubA("starter", "month");
    const before = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);

    const i = await intent({ plan: "starter", cycle: "yearly", reference: "C4" });
    expect(Number(i.amount_ugx)).toBe(172_800); // 18,000 × 12 × 0.8
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(true);
    expect(c.billing_interval).toBe("year");

    const s = await subState(fx.subscriptionAId);
    expect(s.billing_interval).toBe("year");
    expect(await periodEquals(fx.subscriptionAId, "$2::timestamptz", "$2::timestamptz + interval '1 year'", [before])).toBe(true);
  });

  it("C5 yearly → monthly", async () => {
    await resetSubA("starter", "year");
    const before = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);

    const i = await intent({ plan: "starter", cycle: "monthly", reference: "C5" });
    expect(i.ok).toBe(true);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(true);
    expect(c.billing_interval).toBe("month");

    const s = await subState(fx.subscriptionAId);
    expect(s.billing_interval).toBe("month");
    expect(await periodEquals(fx.subscriptionAId, "$2::timestamptz", "$2::timestamptz + interval '1 month'", [before])).toBe(true);
  });

  it("C6 campaign-discounted payment settles at the quoted price", async () => {
    await resetSubA("starter");
    const campaignId = await enableCampaign("M3 settle");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);

    const i = await intent({ plan: "business", cycle: "monthly", reference: "C6" });
    expect(Number(i.amount_ugx)).toBe(27_000);
    const checkout = (await paymentRow(i.payment_id as string))!.checkout as Record<string, unknown>;
    expect(Number(checkout.quoted_amount)).toBe(27_000);
    expect(checkout.campaign_id).toBe(campaignId);

    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(true);
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("business");
    expect(Number((await paymentRow(i.payment_id as string))!.amount_ugx)).toBe(27_000);
  });

  it("C7 confirm applies the plan exactly once (replay does not re-apply)", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C7" });
    await confirm(i.payment_id as string);
    const planAfterFirst = await scalar<string>(`SELECT plan_id::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);

    const replay = await confirm(i.payment_id as string);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await scalar<string>(`SELECT plan_id::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`)).toBe(planAfterFirst);
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("business");
  });

  it("C8 confirm applies the billing interval exactly once", async () => {
    await resetSubA("starter", "month");
    const i = await intent({ plan: "starter", cycle: "yearly", reference: "C8" });
    await confirm(i.payment_id as string);
    expect((await subState(fx.subscriptionAId)).billing_interval).toBe("year");

    await confirm(i.payment_id as string);
    const s = await subState(fx.subscriptionAId);
    expect(s.billing_interval).toBe("year");
    expect(s.plan_code).toBe("starter");
  });

  it("C9 repeated confirm does not advance the period twice", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "starter", cycle: "monthly", reference: "C9" });
    await confirm(i.payment_id as string);
    const afterFirst = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);

    await confirm(i.payment_id as string);
    expect(await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`)).toBe(afterFirst);
  });

  it("C10 repeated confirm does not duplicate history", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "starter", cycle: "monthly", reference: "C10" });
    await confirm(i.payment_id as string);
    await confirm(i.payment_id as string);
    await confirm(i.payment_id as string);
    expect(await historyCount(fx.subscriptionAId, "payment_confirmed")).toBe(1);
    expect(await historyCount(fx.subscriptionAId, "payment_created")).toBe(1);
  });

  it("C11 concurrent-style confirmation serializes: second call is idempotent success", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C11" });
    const first = await confirm(i.payment_id as string);
    const second = await confirm(i.payment_id as string);
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect((await paymentRow(i.payment_id as string))!.status).toBe("confirmed");
    // (PGLite is single-session; TEST_DATABASE_URL enables true two-session runs.)
  });

  it("C12 subscription_conflict leaves the payment pending — never half-confirmed", async () => {
    // subA expired (not live) + a live sibling → activating subA collides with
    // subscriptions_one_active_per_org inside the guarded settlement block.
    await resetSubA("starter", "month", "expired");
    await exec.exec(`
      INSERT INTO public.subscriptions (id, organization_id, shop_id, plan_id, status, billing_interval, current_period_start, current_period_end, payment_status, created_at)
      VALUES ('${crypto.randomUUID()}', '${fx.orgAId}', '${fx.shopAId}',
              (SELECT id FROM public.subscription_plans WHERE code = 'starter'),
              'active', 'month', now() - interval '1 hour', now() + interval '5 days', 'paid',
              now() - interval '2 hours');
    `);
    try {
      const i = await intent({ plan: "business", cycle: "monthly", reference: "C12" });
      expect(i.ok).toBe(true);
      const c = await confirm(i.payment_id as string);
      expect(c.ok).toBe(false);
      expect(String(c.error)).toBe("subscription_conflict");

      // Payment untouched (pending), plan NOT applied, period NOT moved.
      expect((await paymentRow(i.payment_id as string))!.status).toBe("pending");
      const s = await subState(fx.subscriptionAId);
      expect(s.plan_code).toBe("starter"); // business was NOT applied
      expect(s.status).toBe("expired");
      expect(await historyCount(fx.subscriptionAId, "payment_confirmed")).toBe(0);
    } finally {
      await exec.exec(
        `DELETE FROM public.subscriptions WHERE organization_id = '${fx.orgAId}' AND id <> '${fx.subscriptionAId}'`,
      );
    }
  });

  it("C13 a failed payment can never be confirmed", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C13" });
    const failed = await rpc(internal(), "subscription_payment_fail", [i.payment_id, "declined"]);
    expect(failed.ok).toBe(true);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(false);
    expect(String(c.error)).toBe("payment_not_confirmable");
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("starter");
  });

  it("C14 a cancelled payment can never be confirmed", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C14" });
    await rpc(internal(), "subscription_payment_cancel", [i.payment_id, "abandoned"]);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(false);
    expect(String(c.error)).toBe("payment_not_confirmable");
    expect((await subState(fx.subscriptionAId)).plan_code).toBe("starter");
  });

  it("C15 a refunded payment can never be confirmed again", async () => {
    await resetSubA("starter");
    const i = await intent({ plan: "business", cycle: "monthly", reference: "C15" });
    await confirm(i.payment_id as string);
    await rpc(internal(), "subscription_payment_refund", [i.payment_id, "requested"]);
    const c = await confirm(i.payment_id as string);
    expect(c.ok).toBe(false);
    expect(String(c.error)).toBe("payment_not_confirmable");
    expect((await paymentRow(i.payment_id as string))!.status).toBe("refunded");
  });

  // ========================================================================
  // 12. STALE PENDING INTENTS
  // ========================================================================

  it("S1 a new intent auto-cancels the previous pending intent (stale_replaced)", async () => {
    await resetSubA("starter");
    const first = await intent({ plan: "starter", cycle: "monthly", reference: "S1a" });
    expect(first.ok).toBe(true);
    expect((await paymentRow(first.payment_id as string))!.status).toBe("pending");

    const second = await intent({ plan: "business", cycle: "monthly", reference: "S1b" });
    expect(second.ok).toBe(true);

    const firstRow = (await paymentRow(first.payment_id as string))!;
    expect(firstRow.status).toBe("cancelled");
    expect(firstRow.status_reason).toBe("stale_replaced");
    expect((await paymentRow(second.payment_id as string))!.status).toBe("pending");
    expect(
      await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`),
    ).toBe("2");
    expect(await historyCount(fx.subscriptionAId, "payment_cancelled", "stale_replaced")).toBe(1);
  });

  it("S2 confirmed payments are never auto-cancelled", async () => {
    await resetSubA("starter");
    const settled = await intent({ plan: "starter", cycle: "monthly", reference: "S2a" });
    await confirm(settled.payment_id as string);
    expect((await paymentRow(settled.payment_id as string))!.status).toBe("confirmed");

    const next = await intent({ plan: "business", cycle: "monthly", reference: "S2b" });
    expect(next.ok).toBe(true);
    expect((await paymentRow(settled.payment_id as string))!.status).toBe("confirmed");
    expect((await paymentRow(next.payment_id as string))!.status).toBe("pending");
  });

  it("S3 failed payments are never auto-cancelled", async () => {
    await resetSubA("starter");
    const failed = await intent({ plan: "starter", cycle: "monthly", reference: "S3a" });
    await rpc(internal(), "subscription_payment_fail", [failed.payment_id, "declined"]);
    expect((await paymentRow(failed.payment_id as string))!.status).toBe("failed");

    const next = await intent({ plan: "business", cycle: "monthly", reference: "S3b" });
    expect(next.ok).toBe(true);
    const row = (await paymentRow(failed.payment_id as string))!;
    expect(row.status).toBe("failed");
    expect(row.status_reason).toBe("declined");
  });

  it("S4 refunded payments are never auto-cancelled", async () => {
    await resetSubA("starter");
    const refunded = await intent({ plan: "starter", cycle: "monthly", reference: "S4a" });
    await confirm(refunded.payment_id as string);
    await rpc(internal(), "subscription_payment_refund", [refunded.payment_id, "requested"]);
    expect((await paymentRow(refunded.payment_id as string))!.status).toBe("refunded");

    const next = await intent({ plan: "business", cycle: "monthly", reference: "S4b" });
    expect(next.ok).toBe(true);
    expect((await paymentRow(refunded.payment_id as string))!.status).toBe("refunded");
  });

  // ========================================================================
  // 8. AUTHORIZATION
  // ========================================================================

  it("A1 the org billing role may initiate a payment", async () => {
    const user = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${user}', 'm3-billing@test.local');
      INSERT INTO public.organization_members (organization_id, user_id, role)
      VALUES ('${fx.orgAId}', '${user}', 'billing');
    `);
    const r = await rpc(user, "subscription_payment_create", [
      fx.shopAId,
      "mtn_momo",
      "A1",
      null,
      null,
      null,
      fx.subscriptionAId,
      "business",
      "monthly",
    ]);
    expect(r.ok).toBe(true);
    expect(String(r.plan_code)).toBe("business");
  });

  it("A2 org staff cannot initiate", async () => {
    const user = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${user}', 'm3-staff@test.local');
      INSERT INTO public.organization_members (organization_id, user_id, role)
      VALUES ('${fx.orgAId}', '${user}', 'staff');
    `);
    const r = await rpc(user, "subscription_payment_create", [
      fx.shopAId,
      "mtn_momo",
      "A2",
      null,
      null,
      null,
      fx.subscriptionAId,
      "business",
      "monthly",
    ]);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toBe("forbidden");
  });

  it("A3 manager and viewer (no owner/admin/billing org role) cannot initiate", async () => {
    for (const [role, email] of [
      ["manager", "m3-manager@test.local"],
      ["viewer", "m3-viewer@test.local"],
    ] as const) {
      const user = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${user}', '${email}');
        INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ('${fx.shopAId}', '${user}', '${role}');
      `);
      const r = await rpc(user, "subscription_payment_create", [
        fx.shopAId,
        "mtn_momo",
        `A3-${role}`,
        null,
        null,
        null,
        fx.subscriptionAId,
        "business",
        "monthly",
      ]);
      expect(r.ok, `${role} should be forbidden`).toBe(false);
      expect(String(r.error)).toBe("forbidden");
    }
  });

  // ========================================================================
  // 7. IDEMPOTENCY (M1 guarantees preserved)
  // ========================================================================

  it("I1 durable payment_id replay returns the existing intent", async () => {
    await resetSubA("starter");
    const paymentId = crypto.randomUUID();
    const first = await intent({ paymentId, reference: "I1", plan: "business", cycle: "monthly" });
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBe(false);

    const replay = await intent({ paymentId, reference: "I1", plan: "business", cycle: "monthly" });
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(replay.payment_id).toBe(paymentId);
    expect(String(replay.status)).toBe("pending"); // replay must not cancel its own row
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`)).toBe("1");
  });

  it("I2 provider/reference replay cannot create a second payment", async () => {
    await resetSubA("starter");
    const first = await intent({ reference: "I2", plan: "starter", cycle: "monthly" });
    expect(first.ok).toBe(true);
    const second = await intent({ reference: "I2", plan: "starter", cycle: "monthly" });
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.payment_id).toBe(first.payment_id);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`)).toBe("1");
  });

  it("I3 a provider reference cannot be reused across subscriptions", async () => {
    await resetSubA("starter");
    const own = await intent({ reference: "I3", plan: "starter", cycle: "monthly" });
    expect(own.ok).toBe(true);

    const foreign = await intent({
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionBId,
      reference: "I3",
      plan: "starter",
      cycle: "monthly",
    });
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toMatch(/reference/i);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionBId}'`)).toBe("0");
  });

  it("I4 the (provider, reference) unique index is still enforced at the database level", async () => {
    await resetSubA("starter");
    const created = await intent({ reference: "I4", plan: "starter", cycle: "monthly" });
    expect(created.ok).toBe(true);

    let err = "no-error";
    try {
      await exec.query(
        `INSERT INTO public.subscription_payments (subscription_id, organization_id, shop_id, amount_ugx, provider, reference, status)
         SELECT subscription_id, organization_id, shop_id, amount_ugx, provider, reference, 'pending'
         FROM public.subscription_payments WHERE id = $1`,
        [created.payment_id],
      );
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    expect(err).toMatch(/duplicate key|unique/i);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`)).toBe("1");
  });

  // ========================================================================
  // 9. NO CUSTOMER READ PATH IN M3-A
  // ========================================================================

  it("SEC payment rows stay hidden from customers (only the internal SELECT policy exists)", async () => {
    const policies = (
      await exec.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_payments'`,
      )
    ).rows.map((r) => r.policyname);
    expect(policies).toEqual(["subscription_payments_internal_select"]);

    const ownerRead = await asUser(exec, fx.ownerAId, () =>
      exec.query(`SELECT id FROM public.subscription_payments WHERE organization_id = $1`, [fx.orgAId]),
    );
    expect(ownerRead.rows.length).toBe(0);
  });

  // Two-session concurrency is NOT claimed here (PGlite/single session).
  // The genuine suite is subscriptionPaymentConcurrency.sql.integration.test.ts,
  // which FAILS LOUDLY without TEST_DATABASE_URL instead of passing as a no-op.
});
