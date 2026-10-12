/**
 * Discount hardening — the approved decisions, pinned in SQL.
 *
 * Every test here corresponds to one of the approved decisions:
 *
 *   A  the server owns the manual-payment amount, and refuses a mismatch
 *      BEFORE any mutation
 *   B  an individual discount is organization-wide, covered shops are counted,
 *      and no other organization is touched
 *   C  100% is activated by an audited, atomic, idempotent RPC that writes NO
 *      payment row, and no path can create a zero-value payment
 *   D  the public price book carries the GLOBAL discount and never an
 *      individual one
 *   E  only the four billing-authorized internal roles may manage discounts or
 *      authorize a free activation — enforced against direct RPC calls
 *   F  a completed payment is never repriced
 *
 * Precedence is unchanged from `adminSubscriptionDiscounts.sql.integration.test.ts`:
 * campaign first (90% clamp, UGX 5,000 floor), then the individual discount if
 * it is in force, otherwise the global rule, never stacked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

const BUSINESS = 36_000;
const STARTER = 18_000;
/**
 * The annual LIST price for business: 36,000 × 12 × (1 − 20% canonical default)
 * = 345,600. It is the base the annual leg is a percentage OF — deliberately not
 * a multiple of whatever the monthly discount left behind.
 */
const BUSINESS_ANNUAL = 345_600;

describe("discount hardening — SQL contract", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;
  let shopA2Id: string;
  let supportAdminId: string;
  let fieldAgentId: string;
  let financeAdminId: string;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);

    shopA2Id = crypto.randomUUID();
    supportAdminId = crypto.randomUUID();
    fieldAgentId = crypto.randomUUID();
    financeAdminId = crypto.randomUUID();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${supportAdminId}', 'support@test.local'),
        ('${fieldAgentId}', 'field-agent@test.local'),
        ('${financeAdminId}', 'finance@test.local');

      INSERT INTO public.internal_admins (user_id, role, active) VALUES
        ('${supportAdminId}', 'support_admin', true),
        ('${fieldAgentId}', 'field_agent', true),
        ('${financeAdminId}', 'finance_admin', true);

      -- The harness is_waka_internal_role is a test double that reads
      -- shop_members (see loyaltyBootstrap.sql:512). Giving each actor its real
      -- role name means the refusals below are decided by the ROLE, exactly as
      -- production decides them, not by a missing row.
      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${fx.shopAId}', '${supportAdminId}', 'support_admin'),
        ('${fx.shopAId}', '${fieldAgentId}', 'field_agent'),
        ('${fx.shopAId}', '${financeAdminId}', 'finance_admin');

      INSERT INTO public.shops (id, organization_id, name, shop_number)
      VALUES ('${shopA2Id}', '${fx.orgAId}', 'Payment Shop A2', 'PAY-A2');

      UPDATE public.subscriptions
         SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business')
       WHERE id IN ('${fx.subscriptionAId}', '${fx.subscriptionBId}');
    `);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

  beforeEach(async () => {
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await exec.exec("DELETE FROM public.admin_plan_discounts;");
    await exec.exec("DELETE FROM public.subscription_free_activations;");
    await exec.exec("DELETE FROM public.subscription_payments;");
    await exec.exec("DELETE FROM public.subscription_history;");
    await exec.exec("DELETE FROM public.org_billing_offers;");
    // No test may inherit another's subscription shape: status, cycle, anchor,
    // period and discount all go back to the fixture's starting position.
    await exec.exec(`
      DELETE FROM public.subscriptions
       WHERE organization_id = '${fx.orgAId}' AND id <> '${fx.subscriptionAId}';

      UPDATE public.subscriptions
         SET admin_discount_percent = 0, admin_discount_percent_annual = 0,
             admin_discount_note = NULL,
             admin_discount_starts_at = NULL, admin_discount_expires_at = NULL,
             status = 'trialing', payment_status = 'unknown',
             billing_interval = 'month', trial_ends_at = NULL,
             current_period_start = now() - interval '10 days',
             current_period_end = now() + interval '20 days',
             shop_id = case when id = '${fx.subscriptionAId}' then '${fx.shopAId}'::uuid else '${fx.shopBId}'::uuid end,
             metadata = '{}'::jsonb;
    `);
  });

  // ---------------------------------------------------------------- helpers

  /** The raw row. Void RPCs return no jsonb, so callers that don't need a value
   *  must go through this rather than through `rpc`. */
  async function callRaw(
    userId: string,
    fn: string,
    args: unknown[],
  ): Promise<Record<string, unknown> | undefined> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.${fn}(${placeholders}) AS result`,
        args,
      );
      return rows[0];
    });
  }

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    return rpcJson(await callRaw(userId, fn, args));
  }

  /** A void RPC (`admin_subscription_mark_payment`): success means "did not raise". */
  async function callVoid(userId: string, fn: string, args: unknown[]): Promise<void> {
    await callRaw(userId, fn, args);
  }

  /** Run a call expected to RAISE; returns the message. */
  async function refusal(userId: string, fn: string, args: unknown[]): Promise<string> {
    try {
      await callRaw(userId, fn, args);
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error(`${fn} was expected to refuse, but it succeeded`);
  }

  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<{ v: T }>(sql, params);
    return rows[0]!.v;
  }

  const paymentCount = (subId: string) =>
    scalar<number>(
      `SELECT count(*)::int AS v FROM public.subscription_payments WHERE subscription_id = $1`,
      [subId],
    );

  const periodEnd = (subId: string) =>
    scalar<string | null>(`SELECT current_period_end::text AS v FROM public.subscriptions WHERE id = $1`, [subId]);

  const historyCount = (subId: string, action: string) =>
    scalar<number>(
      `SELECT count(*)::int AS v FROM public.subscription_history WHERE subscription_id = $1 AND action = $2`,
      [subId, action],
    );

  /**
   * `annual` is the ANNUAL leg. Omitting it does not clear the annual leg — the
   * server reads an absent annual percentage as "leave it alone", which is what
   * keeps a client bundle that predates the interval split from wiping a rule.
   * Pass `annual: 0` to clear it deliberately.
   */
  const saveIndividual = (shopId: string, pct: number, extra: Record<string, unknown> = {}) => {
    const args: unknown[] = [
      shopId,
      pct,
      extra.reason ?? "hardening",
      extra.startsAt ?? null,
      extra.expiresAt ?? null,
    ];
    if (extra.annual !== undefined) args.push(extra.annual);
    return rpc(fx.internalAdminId, "admin_subscription_discount_save", args);
  };

  const saveGlobal = (plan: string, pct: number, extra: Record<string, unknown> = {}) => {
    const args: unknown[] = [
      plan,
      pct,
      extra.active ?? true,
      extra.startsAt ?? null,
      extra.expiresAt ?? null,
      extra.reason ?? "hardening",
    ];
    if (extra.annual !== undefined) args.push(extra.annual);
    return rpc(fx.internalAdminId, "admin_plan_discount_save", args);
  };

  const quote = (shopId: string, plan: string, cycle: string, userId: string) =>
    rpc(userId, "subscription_payment_quote", [shopId, plan, cycle]);

  async function price(plan: string, cycle: string, pct = 0): Promise<number> {
    return scalar<number>(
      `SELECT public.subscription_payment_plan_amount($1, $2, $3)::bigint AS v`,
      [plan, cycle, pct],
    );
  }

  async function publicPlan(plan: string): Promise<Record<string, unknown>> {
    const { rows } = await exec.query<{ result: Record<string, unknown> }>(
      `SELECT public.public_subscription_pricing() AS result`,
    );
    const plans = (rows[0]!.result.plans ?? []) as Record<string, unknown>[];
    return plans.find((p) => p.plan_code === plan)!;
  }

  /**
   * Give a subscription the 100% rate the setters deliberately cannot write.
   *
   * BOTH legs: "fully discounted" is a statement about each interval now, so a
   * helper that set only the monthly leg would leave an annual subscription at
   * list price and every free-grant assertion below would be measuring the wrong
   * thing. The interval-specific cases are asserted separately, by name.
   */
  async function forceFullDiscount(subId: string, legs: "both" | "month" | "year" = "both") {
    const monthly = legs === "year" ? 0 : 100;
    const annual = legs === "month" ? 0 : 100;
    await exec.exec(
      `UPDATE public.subscriptions
          SET admin_discount_percent = ${monthly}, admin_discount_percent_annual = ${annual}
        WHERE id = '${subId}'`,
    );
  }

  // ======================================================================
  // E — authorization
  // ======================================================================

  describe("E — only the billing-authorized roles may touch a discount", () => {
    // Thunks, because the fixture ids only exist after beforeAll.
    const ADMIN_RPCS: Array<[string, () => unknown[]]> = [
      ["admin_plan_discount_save", () => ["business", 50, true, null, null, "x"]],
      ["admin_plan_discount_delete", () => ["business"]],
      ["admin_subscription_discount_save", () => [fx.shopAId, 50, "x", null, null]],
      ["admin_discount_overview", () => []],
      ["admin_discount_preview", () => ["business", 50, false]],
      ["admin_subscription_expected_amount", () => [fx.subscriptionAId]],
      ["admin_subscription_activate_free", () => [fx.subscriptionAId, "x"]],
      ["admin_pricing_campaign_save", () => [null, "audit", "", true, null, null]],
      ["admin_pricing_campaign_plan_discount_save", () => [null, "starter", "percentage", 10, null, "r"]],
    ];

    it("refuses support_admin and field_agent on every discount RPC", async () => {
      for (const actor of [supportAdminId, fieldAgentId]) {
        for (const [fn, buildArgs] of ADMIN_RPCS) {
          const message = await refusal(actor, fn, buildArgs());
          expect(message.toLowerCase(), `${fn} for ${actor}`).toContain("forbidden");
        }
      }
    });

    it("refuses a shop owner, a cashier and an outsider on the new RPCs too", async () => {
      for (const actor of [fx.ownerAId, fx.cashierAId, fx.outsiderId]) {
        expect((await refusal(actor, "admin_subscription_expected_amount", [fx.subscriptionAId])).toLowerCase()).toContain("forbidden");
        expect((await refusal(actor, "admin_subscription_activate_free", [fx.subscriptionAId, "x"])).toLowerCase()).toContain("forbidden");
        expect((await refusal(actor, "admin_discount_overview", [])).toLowerCase()).toContain("forbidden");
      }
    });

    it("accepts each of the four billing roles", async () => {
      for (const actor of [fx.internalAdminId, financeAdminId]) {
        const res = await rpc(actor, "admin_discount_overview", []);
        expect(res.ok, `overview for ${actor}`).toBe(true);
      }
      // subscriptions_admin and operations_admin are the same array element in
      // the gate; covered by the pinned suite for the pre-existing RPCs.
      const saved = await rpc(financeAdminId, "admin_plan_discount_save", ["business", 10, true, null, null, "finance"]);
      expect(saved.ok).toBe(true);
    });

    it("has no PUBLIC EXECUTE left on the internal pricing helpers", async () => {
      for (const [fn, args] of [
        ["_pricing_audit", ['"pricing_audit_probe"' as unknown as string, "{}"]],
        ["_pricing_require_admin", []],
        ["_pricing_compute_plan_row", ["business", "none", 0, null]],
        ["_pricing_min_final_monthly_ugx", []],
        ["_pricing_active_campaign_id", []],
        ["_admin_discount_effective", [0, "business", "month"]],
        ["_subscription_latest_for_org", [null]],
      ] as Array<[string, unknown[]]>) {
        const message = await refusal(fx.ownerAId, fn, args);
        expect(message.toLowerCase(), fn).toMatch(/permission denied|forbidden/);
      }
    });

    it("keeps the free-activation ledger unreadable by any client role", async () => {
      for (const actor of [fx.internalAdminId, fx.ownerAId]) {
        await expect(
          asUser(exec, actor, () => exec.query(`SELECT * FROM public.subscription_free_activations`)),
        ).rejects.toThrow(/permission denied|denied/i);
      }
    });
  });

  // ======================================================================
  // A — the manual payment amount
  // ======================================================================

  describe("A — the server calculates the manual-payment amount", () => {
    it("reports the discounted price, and the list price with no discount", async () => {
      const plain = await rpc(fx.internalAdminId, "admin_subscription_expected_amount", [fx.subscriptionAId]);
      expect(Number(plain.expected_amount_ugx)).toBe(BUSINESS);
      expect(Number(plain.effective_discount_percent)).toBe(0);

      await saveIndividual(fx.shopAId, 50);

      const discounted = await rpc(fx.internalAdminId, "admin_subscription_expected_amount", [fx.subscriptionAId]);
      expect(Number(discounted.expected_amount_ugx)).toBe(18_000);
      expect(Number(discounted.effective_discount_percent)).toBe(50);
      expect(Number(discounted.monthly_ugx)).toBe(18_000);
    });

    it("refuses the LIST price for a discounted shop, changing nothing", async () => {
      await saveIndividual(fx.shopAId, 50);
      const before = { end: await periodEnd(fx.subscriptionAId), payments: await paymentCount(fx.subscriptionAId) };

      const message = await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        BUSINESS,
        "list price",
      ]);
      expect(message).toContain("amount_mismatch");

      expect(await periodEnd(fx.subscriptionAId)).toBe(before.end);
      expect(await paymentCount(fx.subscriptionAId)).toBe(before.payments);
      expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(0);
    });

    it("records the DISCOUNTED amount when it is the amount supplied", async () => {
      await saveIndividual(fx.shopAId, 50);
      const before = await periodEnd(fx.subscriptionAId);

      await callVoid(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        18_000,
        "goodwill rate",
      ]);

      const recorded = await scalar<number>(
        `SELECT amount_ugx::bigint AS v FROM public.subscription_payments WHERE subscription_id = $1`,
        [fx.subscriptionAId],
      );
      expect(Number(recorded)).toBe(18_000);
      expect(await periodEnd(fx.subscriptionAId)).not.toBe(before);
      expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(1);
    });

    it("refuses zero and negative amounts", async () => {
      for (const bad of [0, -1]) {
        expect(await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [fx.subscriptionAId, bad, null])).toContain(
          "invalid_amount",
        );
      }
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    it("refuses a fully-discounted subscription and points at the free-activation flow", async () => {
      await forceFullDiscount(fx.subscriptionAId);

      const message = await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        1,
        null,
      ]);
      expect(message).toContain("fully_discounted");
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    /** The offer's current state, read straight from the table. */
    async function offerState(offerId: string): Promise<{ status: string; fulfilled_at: string | null }> {
      const { rows } = await exec.query<{ status: string; fulfilled_at: string | null }>(
        `SELECT status, fulfilled_at::text AS fulfilled_at FROM public.org_billing_offers WHERE id = $1`,
        [offerId],
      );
      return rows[0]!;
    }

    async function seedOffer(amount = 490_000, status = "claimed_paid") {
      const offerId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.org_billing_offers (id, organization_id, shop_id, amount_ugx, status)
        VALUES ('${offerId}', '${fx.orgAId}', '${fx.shopAId}', ${amount}, '${status}');
      `);
      return offerId;
    }

    it("still honours a negotiated organization billing offer, and CONSUMES it (F2)", async () => {
      const offerId = await seedOffer();

      await callVoid(fx.internalAdminId, "admin_subscription_mark_payment", [fx.subscriptionAId, 490_000, "annual offer"]);

      const recorded = await scalar<number>(
        `SELECT amount_ugx::bigint AS v FROM public.subscription_payments WHERE subscription_id = $1`,
        [fx.subscriptionAId],
      );
      expect(Number(recorded)).toBe(490_000);

      // One commitment, one payment: the offer is spent, in the schema's own
      // terminal state, so the next call cannot lean on it again.
      const spent = await offerState(offerId);
      expect(spent.status).toBe("fulfilled");
      expect(spent.fulfilled_at).not.toBeNull();
    });

    it("REFUSES a repeated confirmation against a spent offer", async () => {
      const offerId = await seedOffer();
      await callVoid(fx.internalAdminId, "admin_subscription_mark_payment", [fx.subscriptionAId, 490_000, "first"]);
      const afterFirst = await periodEnd(fx.subscriptionAId);
      const paymentsAfterFirst = await paymentCount(fx.subscriptionAId);

      const message = await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        490_000,
        "again",
      ]);
      expect(message).toContain("amount_mismatch");

      // Nothing was recorded a second time, and nothing moved.
      expect(await paymentCount(fx.subscriptionAId)).toBe(paymentsAfterFirst);
      expect(await periodEnd(fx.subscriptionAId)).toBe(afterFirst);
      expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(1);
      expect((await offerState(offerId)).status).toBe("fulfilled");
    });

    it("an OFFER amount is not a general licence: an unrelated amount is still refused", async () => {
      await seedOffer(490_000);

      const message = await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        250_000,
        "not the offer",
      ]);
      expect(message).toContain("amount_mismatch");
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
      // The live offer was NOT consumed by a refused call.
      const { rows } = await exec.query<{ status: string }>(
        `SELECT status FROM public.org_billing_offers WHERE amount_ugx = 490000`,
      );
      expect(rows[0]!.status).toBe("claimed_paid");
    });

    it("a manual payment at the offer amount closes the fulfilment path too", async () => {
      // The staff queue only offers "Fulfil" while an offer is claimed_paid, so
      // a manual payment that left the offer live used to leave a SECOND way to
      // grant the year: fulfil would record another payment and another period.
      const offerId = await seedOffer();
      await callVoid(fx.internalAdminId, "admin_subscription_mark_payment", [fx.subscriptionAId, 490_000, "manual"]);
      const servedEnd = await periodEnd(fx.subscriptionAId);
      const payments = await paymentCount(fx.subscriptionAId);

      const result = await rpc(fx.internalAdminId, "internal_ops_org_billing_offer_fulfill", [
        offerId,
        "second fulfilment",
      ]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_status");

      // No second payment, and the period the queue's fulfil would have
      // overwritten with a year is untouched.
      expect(await paymentCount(fx.subscriptionAId)).toBe(payments);
      expect(await periodEnd(fx.subscriptionAId)).toBe(servedEnd);
    });

    it("the annual-offer fulfilment flow is unchanged end to end (F2 preservation)", async () => {
      const offerId = await seedOffer();

      const result = await rpc(fx.internalAdminId, "internal_ops_org_billing_offer_fulfill", [
        offerId,
        "Annual plan payment",
      ]);
      expect(result.ok).toBe(true);
      expect(result.subscription_id).toBe(fx.subscriptionAId);

      // 039's own behaviour: the year period, one payment, an audited history row.
      const near = await scalar<boolean>(
        `SELECT (abs(extract(epoch from (
           current_period_end - ((timezone('Africa/Kampala', now())::date + interval '365 days')::timestamptz)
         ))) <= 60) AS v FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );
      expect(near).toBe(true);
      expect(await paymentCount(fx.subscriptionAId)).toBe(1);
      expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(1);

      // And the offer ends in the same terminal state, once.
      const spent = await offerState(offerId);
      expect(spent.status).toBe("fulfilled");
      expect(spent.fulfilled_at).not.toBeNull();
    });

    it("refuses an amount that only another organization has offered", async () => {
      const offerId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.org_billing_offers (id, organization_id, shop_id, amount_ugx, status)
        VALUES ('${offerId}', '${fx.orgBId}', '${fx.shopBId}', 490000, 'claimed_paid');
      `);

      const message = await refusal(fx.internalAdminId, "admin_subscription_mark_payment", [
        fx.subscriptionAId,
        490_000,
        "not this org",
      ]);
      expect(message).toContain("amount_mismatch");
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    it("never writes a zero-value payment row, on any path", async () => {
      await forceFullDiscount(fx.subscriptionAId);

      // 1. the RPC that creates checkout intents
      const created = await rpc(fx.ownerAId, "subscription_payment_create", [
        fx.shopAId,
        "manual",
        `zero-${Date.now()}`,
        0,
        null,
        null,
        null,
        "business",
        "monthly",
      ]);
      expect(created.ok).toBe(false);
      expect(created.error).toBe("fully_discounted");
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);

      // 2. the ledger's own guard, whatever writer tries it
      await expect(
        exec.exec(
          `INSERT INTO public.subscription_payments (subscription_id, organization_id, amount_ugx, provider, status)
           VALUES ('${fx.subscriptionAId}', '${fx.orgAId}', 0, 'manual_admin', 'confirmed')`,
        ),
      ).rejects.toThrow(/payment_invalid_amount/);
    });
  });

  // ======================================================================
  // C — free activation
  // ======================================================================

  describe("C — audited, atomic, idempotent zero-payment activation", () => {
    it("refuses a subscription that is not fully discounted", async () => {
      await saveIndividual(fx.shopAId, 50);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "should not work",
      ]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("not_fully_discounted");
      expect(Number(res.effective_discount_percent)).toBe(50);
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    it("refuses a 99% GLOBAL rule — the global mechanism cannot reach 100", async () => {
      await saveGlobal("business", 99);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, null]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("not_fully_discounted");
    });

    it("grants exactly one period, with no payment row and a full audit trail", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      const before = await periodEnd(fx.subscriptionAId);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "Partner account",
      ]);

      expect(res.ok).toBe(true);
      expect(res.idempotent).toBe(false);
      expect(Number(res.discount_percent)).toBe(100);
      expect(Number(res.payment_required)).toBe(0);

      const state = await exec.query<{ status: string; payment_status: string; end: string }>(
        `SELECT status, payment_status, current_period_end::text AS end
           FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );
      expect(state.rows[0]!.status).toBe("active");
      expect(state.rows[0]!.payment_status).toBe("waived");
      expect(state.rows[0]!.end).not.toBe(before);

      // NO ledger row — that is the whole point of this flow.
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);

      expect(await historyCount(fx.subscriptionAId, "free_activation")).toBe(1);
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.subscription_free_activations WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        ),
      ).toBe(1);
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.internal_ops_admin_audit
            WHERE action = 'admin_subscription_free_activation'`,
        ),
      ).toBe(1);
    });

    it("is idempotent: a retry returns the same activation and grants nothing more", async () => {
      await forceFullDiscount(fx.subscriptionAId);

      const first = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "once"]);
      const end1 = await periodEnd(fx.subscriptionAId);

      const second = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "retry"]);
      const third = await rpc(financeAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "another admin"]);

      expect(second.ok).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(second.activation_id).toBe(first.activation_id);
      expect(third.idempotent).toBe(true);
      expect(third.activation_id).toBe(first.activation_id);

      // The period did NOT move a second time, and only one activation exists.
      expect(await periodEnd(fx.subscriptionAId)).toBe(end1);
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.subscription_free_activations WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        ),
      ).toBe(1);
      expect(await historyCount(fx.subscriptionAId, "free_activation")).toBe(1);
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    it("advances a YEAR for an annual subscription", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      await exec.exec(`UPDATE public.subscriptions SET billing_interval = 'year' WHERE id = '${fx.subscriptionAId}'`);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "annual"]);
      expect(res.ok).toBe(true);

      const near = await scalar<boolean>(
        `SELECT (abs(extract(epoch from (current_period_end - (current_period_start + interval '1 year')))) < 5) AS v
           FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );
      expect(near).toBe(true);

      await exec.exec(`UPDATE public.subscriptions SET billing_interval = 'month' WHERE id = '${fx.subscriptionAId}'`);
    });

    it("a 100% MONTHLY rule does not make an annual period free", async () => {
      // The eligibility check reads the leg for the subscription's OWN cycle. A
      // monthly rate that reaches 100 says nothing about the year, so the grant
      // must refuse rather than hand out twelve months for nothing.
      await forceFullDiscount(fx.subscriptionAId, "month");
      await exec.exec(`UPDATE public.subscriptions SET billing_interval = 'year' WHERE id = '${fx.subscriptionAId}'`);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "nope"]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("not_fully_discounted");
      expect(Number(res.effective_discount_percent)).toBe(0);
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);

      await exec.exec(`UPDATE public.subscriptions SET billing_interval = 'month' WHERE id = '${fx.subscriptionAId}'`);
    });

    it("a 100% ANNUAL rule does not make a monthly period free", async () => {
      await forceFullDiscount(fx.subscriptionAId, "year");

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "nope"]);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("not_fully_discounted");
      expect(Number(res.effective_discount_percent)).toBe(0);
    });

    it("reactivates a lapsed subscription", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      await exec.exec(
        `UPDATE public.subscriptions
            SET status = 'expired', current_period_start = now() - interval '60 days',
                current_period_end = now() - interval '30 days'
          WHERE id = '${fx.subscriptionAId}'`,
      );

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "win back"]);
      expect(res.ok).toBe(true);

      const status = await scalar<string>(`SELECT status AS v FROM public.subscriptions WHERE id = $1`, [
        fx.subscriptionAId,
      ]);
      expect(status).toBe("active");
      expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    });

    /** A payment handed to the provider but not yet settled (or the reverse). */
    async function seedPayment(opts: { status: string; initiated: boolean; amount?: number }) {
      const id = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.subscription_payments
          (id, subscription_id, organization_id, shop_id, amount_ugx, provider, reference, status, metadata)
        VALUES (
          '${id}', '${fx.subscriptionAId}', '${fx.orgAId}', '${fx.shopAId}',
          ${opts.amount ?? BUSINESS}, 'mtn_momo', 'ref-${id.slice(0, 8)}', '${opts.status}',
          ${opts.initiated ? `jsonb_build_object('initiated_at', now()::text)` : "'{}'::jsonb"}
        );
      `);
      return id;
    }

    it("REFUSES while a provider payment could still settle, granting nothing", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      await seedPayment({ status: "pending", initiated: true });
      const before = await periodEnd(fx.subscriptionAId);

      const message = await refusal(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "must not grant",
      ]);
      expect(message).toContain("payment_reconciliation_required");

      // Nothing moved: no period, no marker, no stamp, no ledger row.
      expect(await periodEnd(fx.subscriptionAId)).toBe(before);
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.subscription_free_activations WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        ),
      ).toBe(0);
      expect(await historyCount(fx.subscriptionAId, "free_activation")).toBe(0);
      expect(
        await scalar<string>(`SELECT payment_status AS v FROM public.subscriptions WHERE id = $1`, [
          fx.subscriptionAId,
        ]),
      ).not.toBe("waived");
    });

    it("an ABANDONED checkout does not block a free activation", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      // Pending, but never handed to the provider: it can never settle.
      await seedPayment({ status: "pending", initiated: false });
      const before = await periodEnd(fx.subscriptionAId);

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "abandoned checkout present",
      ]);

      expect(res.ok).toBe(true);
      expect(await periodEnd(fx.subscriptionAId)).not.toBe(before);
    });

    it("a SETTLED payment does not block a free activation", async () => {
      await forceFullDiscount(fx.subscriptionAId);
      await seedPayment({ status: "confirmed", initiated: true });

      const res = await rpc(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "already settled",
      ]);

      expect(res.ok).toBe(true);
      expect(Number(res.payment_required)).toBe(0);
    });

    it("an impossible duplicate window RAISES and rolls the granted period back (F3)", async () => {
      await forceFullDiscount(fx.subscriptionAId);

      // Move the subscription to a period whose end is a fixed, known instant:
      // the activation's anchor is `max(now(), current_period_end)`, so the
      // window it would cover is exactly this timestamp.
      const endIso = await scalar<string>(
        `SELECT (now() + interval '10 days')::text AS v`,
      );
      await exec.exec(`
        UPDATE public.subscriptions
           SET current_period_start = now() - interval '20 days',
               current_period_end = '${endIso}'::timestamptz,
               status = 'active'
         WHERE id = '${fx.subscriptionAId}';
      `);

      // Seed the marker that makes the activation's own window already-covered —
      // the state the guard exists for.
      await exec.exec(`
        INSERT INTO public.subscription_free_activations
          (subscription_id, organization_id, discount_percent, covered_from)
        VALUES ('${fx.subscriptionAId}', '${fx.orgAId}', 100, '${endIso}'::timestamptz);
      `);

      const message = await refusal(fx.internalAdminId, "admin_subscription_activate_free", [
        fx.subscriptionAId,
        "must not double-grant",
      ]);
      expect(message).toContain("free_activation_conflict");

      // THE POINT OF RAISING: the period the advance already granted is rolled
      // back with the transaction, so nothing was handed out.
      expect(await periodEnd(fx.subscriptionAId)).toBe(endIso);
      expect(await historyCount(fx.subscriptionAId, "free_activation")).toBe(0);
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.subscription_free_activations WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        ),
      ).toBe(1); // only the one this test seeded
    });

    it("does not touch a settled payment or its snapshot", async () => {
      await callVoid(fx.internalAdminId, "admin_subscription_mark_payment", [fx.subscriptionAId, BUSINESS, "paid first"]);
      const [settled] = (
        await exec.query<{ id: string; amount: string; status: string }>(
          `SELECT id, amount_ugx::text AS amount, status FROM public.subscription_payments WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        )
      ).rows;

      await forceFullDiscount(fx.subscriptionAId);
      await rpc(fx.internalAdminId, "admin_subscription_activate_free", [fx.subscriptionAId, "top-up"]);

      const after = (
        await exec.query<{ amount: string; status: string }>(
          `SELECT amount_ugx::text AS amount, status FROM public.subscription_payments WHERE id = $1`,
          [settled!.id],
        )
      ).rows[0]!;

      expect(after.amount).toBe(settled!.amount);
      expect(after.status).toBe(settled!.status);
      expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    });
  });

  // ======================================================================
  // B — scope and isolation
  // ======================================================================

  describe("B — organization-wide scope, and no cross-tenant leak", () => {
    it("reports the scope and the number of shops it covers", async () => {
      const res = await saveIndividual(fx.shopAId, 25);

      expect(res.ok).toBe(true);
      expect(res.scope).toBe("organization");
      expect(Number(res.shop_count)).toBe(2); // shop A and shop A2
      expect(res.organization_id).toBe(fx.orgAId);
    });

    it("discounts the account's subscription, and nothing outside the organization", async () => {
      await saveIndividual(shopA2Id, 50);

      // The discount is stored on the organization's single subscription, which
      // is what makes it account-wide.
      expect(
        await scalar<number>(`SELECT admin_discount_percent::int AS v FROM public.subscriptions WHERE id = $1`, [
          fx.subscriptionAId,
        ]),
      ).toBe(50);
      expect(Number((await quote(fx.shopAId, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(18_000);

      // Another organization, and another organization's subscription row.
      expect(Number((await quote(fx.shopBId, "business", "monthly", fx.ownerId)).amount_ugx)).toBe(BUSINESS);
      expect(
        await scalar<number>(`SELECT admin_discount_percent::int AS v FROM public.subscriptions WHERE id = $1`, [
          fx.subscriptionBId,
        ]),
      ).toBe(0);
    });

    it("prices a SIBLING shop from the same discounted subscription when it is account-level", async () => {
      await saveIndividual(shopA2Id, 50);

      // PRE-EXISTING ANCHOR RULE (017/M1, untouched here): a subscription can be
      // anchored to one shop, and a sibling shop is then refused a quote rather
      // than priced from another shop's row.
      const anchored = await quote(shopA2Id, "business", "monthly", fx.ownerAId);
      expect(anchored.ok).toBe(false);
      expect(anchored.error).toBe("shop_subscription_mismatch");

      // With the account's subscription at organization level, every shop of the
      // organization prices from the one discounted row.
      await exec.exec(`UPDATE public.subscriptions SET shop_id = NULL WHERE id = '${fx.subscriptionAId}'`);
      try {
        expect(Number((await quote(fx.shopAId, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(18_000);
        expect(Number((await quote(shopA2Id, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(18_000);
      } finally {
        await exec.exec(`UPDATE public.subscriptions SET shop_id = '${fx.shopAId}' WHERE id = '${fx.subscriptionAId}'`);
      }
    });

    it("targets the LIVE subscription even when a newer dead row exists", async () => {
      const deadId = crypto.randomUUID();
      await exec.exec(`
        INSERT INTO public.subscriptions (id, organization_id, shop_id, plan_id, status, billing_interval, created_at)
        VALUES ('${deadId}', '${fx.orgAId}', '${shopA2Id}',
                (SELECT id FROM public.subscription_plans WHERE code = 'business'),
                'expired', 'month', now())
      `);


      const res = await saveIndividual(fx.shopAId, 30);

      // Under the old "newest row wins" rule this wrote to the expired row and
      // the live subscription kept the list price.
      expect(res.subscription_id).toBe(fx.subscriptionAId);
      expect(
        await scalar<number>(`SELECT admin_discount_percent::int AS v FROM public.subscriptions WHERE id = $1`, [
          deadId,
        ]),
      ).toBe(0);
      expect(Number((await quote(fx.shopAId, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(25_200);

      await exec.exec(`DELETE FROM public.subscriptions WHERE id = '${deadId}'`);
    });
  });

  // ======================================================================
  // D — public pricing
  // ======================================================================

  describe("D — the public book carries the global rule and never an individual one", () => {
    it("publishes the authoritative price when a global rule is live", async () => {
      await saveGlobal("business", 50);

      const row = await publicPlan("business");
      expect(Number(row.final_monthly_ugx)).toBe(18_000);
      expect(Number(row.final_annual_ugx)).toBe(await price("business", "year", 0));
      expect(Number(row.campaign_monthly_ugx)).toBe(BUSINESS);
      expect(Number(row.global_discount_percent)).toBe(50);
      expect(Number(row.final_monthly_ugx)).toBe(await price("business", "month", 0));
    });

    it("keeps an INDIVIDUAL discount private", async () => {
      await saveIndividual(fx.shopAId, 50);

      const row = await publicPlan("business");
      expect(Number(row.final_monthly_ugx)).toBe(BUSINESS);
      expect(Number(row.global_discount_percent)).toBe(0);
      // ...while that organization's own checkout is discounted.
      expect(Number((await quote(fx.shopAId, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(18_000);
    });

    it("publishes the campaign layer alone when there is no global rule", async () => {
      await exec.exec(`
        INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
        VALUES ('public-parity', true, now() - interval '1 day')
      `);
      await exec.exec(`
        INSERT INTO public.pricing_campaign_plan_discounts
          (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
        VALUES ((SELECT id FROM public.pricing_campaigns WHERE name = 'public-parity'),
                'starter', 'percentage', 50, 20)
      `);

      const row = await publicPlan("starter");
      expect(Number(row.campaign_monthly_ugx)).toBe(9_000);
      expect(Number(row.final_monthly_ugx)).toBe(9_000);
      expect(Number(row.global_discount_percent)).toBe(0);
    });

    it("returns to list once a global rule expires", async () => {
      await saveGlobal("business", 50, { expiresAt: "2001-01-01T00:00:00Z" });

      const row = await publicPlan("business");
      expect(Number(row.final_monthly_ugx)).toBe(BUSINESS);
      expect(Number(row.global_discount_percent)).toBe(0);
    });
  });

  // ======================================================================
  // Item 8 — window reporting
  // ======================================================================

  describe("window reporting tells the truth about a rule that is not live", () => {
    it("a LIVE rule reports its discounted price as effective", async () => {
      await saveGlobal("business", 25);
      const overview = await rpc(fx.internalAdminId, "admin_discount_overview", []);
      const row = (overview.global as Record<string, unknown>[])[0]!;

      expect(row.is_active_now).toBe(true);
      expect(row.applies_now).toBe(true);
      expect(Number(row.effective_monthly_ugx)).toBe(27_000);
      expect(Number(row.configured_monthly_ugx)).toBe(27_000);
    });

    it("a FUTURE rule reports the price that is actually charged", async () => {
      await saveGlobal("business", 25, { startsAt: "2999-01-01T00:00:00Z" });
      const overview = await rpc(fx.internalAdminId, "admin_discount_overview", []);
      const row = (overview.global as Record<string, unknown>[])[0]!;

      expect(row.is_active_now).toBe(false);
      expect(Number(row.effective_monthly_ugx)).toBe(BUSINESS); // what is charged now
      expect(Number(row.configured_monthly_ugx)).toBe(27_000); // what it would be worth
      expect(Number(row.base_monthly_ugx)).toBe(BUSINESS);
    });

    it("an EXPIRED rule reports the same, and the checkout agrees", async () => {
      await saveGlobal("business", 25, { expiresAt: "2001-01-01T00:00:00Z" });
      const overview = await rpc(fx.internalAdminId, "admin_discount_overview", []);
      const row = (overview.global as Record<string, unknown>[])[0]!;

      expect(row.is_active_now).toBe(false);
      expect(Number(row.effective_monthly_ugx)).toBe(BUSINESS);
      expect(Number((await quote(fx.shopAId, "business", "monthly", fx.ownerAId)).amount_ugx)).toBe(BUSINESS);
    });
  });

  // ======================================================================
  // Item 9 + 10 — campaign annual bound and the savings figure
  // ======================================================================

  describe("campaign annual bound and honest savings", () => {
    async function campaignWith() {
      const { rows } = await exec.query<{ id: string }>(
        `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
         VALUES ('annual-bound', true, now() - interval '1 day') RETURNING id`,
      );
      return rows[0]!.id;
    }

    it("refuses an out-of-range annual percentage at the RPC", async () => {
      const campaignId = await campaignWith();
      for (const bad of [100, 120, -5]) {
        const res = await rpc(fx.internalAdminId, "admin_pricing_campaign_plan_discount_save", [
          campaignId,
          "business",
          "percentage",
          10,
          bad,
          "too deep",
        ]);
        expect(res.ok, `annual=${bad}`).toBe(false);
        expect(res.error).toBe("annual_discount_out_of_range");
        expect(Number(res.max_percent)).toBe(90);
      }
      expect(
        await scalar<number>(
          `SELECT count(*)::int AS v FROM public.pricing_campaign_plan_discounts WHERE campaign_id = $1`,
          [campaignId],
        ),
      ).toBe(0);
    });

    it("refuses it at the database too", async () => {
      const campaignId = await campaignWith();
      await expect(
        exec.exec(
          `INSERT INTO public.pricing_campaign_plan_discounts
             (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
           VALUES ('${campaignId}', 'business', 'none', 0, 100)`,
        ),
      ).rejects.toThrow(/pricing_campaign_plan_discounts_annual_pct_range|check constraint/i);
    });

    it("clamps a legacy value in the price primitive instead of pricing a year at zero", async () => {
      const { rows } = await exec.query<{ v: string }>(
        `SELECT (public._pricing_compute_plan_row('business', 'none', 0, 100) ->> 'annual_discount_percent') AS v`,
      );
      expect(Number(rows[0]!.v)).toBe(90);

      const annual = await scalar<number>(
        `SELECT (public._pricing_compute_plan_row('business', 'none', 0, 100) ->> 'final_annual_ugx')::bigint AS v`,
      );
      expect(annual).toBe(43_200); // 36,000 x 12 x 10%, never 0
    });

    it("reports the saving the floor actually leaves", async () => {
      const computed = await exec.query<{ d: string; f: string }>(
        `SELECT (public._pricing_compute_plan_row('starter', 'percentage', 90, 20) ->> 'monthly_discount_ugx') AS d,
                (public._pricing_compute_plan_row('starter', 'percentage', 90, 20) ->> 'final_monthly_ugx') AS f`,
      );
      expect(Number(computed.rows[0]!.f)).toBe(5_000);
      // Not 16,200 (90% of 18,000) — the price only falls by 13,000.
      expect(Number(computed.rows[0]!.d)).toBe(13_000);
      expect(Number(computed.rows[0]!.d)).toBe(STARTER - 5_000);
    });
  });

  // ======================================================================
  // G — the two billing intervals are independent
  // ======================================================================
  //
  // WHAT THESE PIN. Before migration 20261012100000 one percentage governed both
  // cycles: `admin_plan_discounts` was keyed by plan alone, `subscriptions` had a
  // single `admin_discount_percent`, and `_pricing_compute_plan_row` built the
  // ANNUAL price from the already-monthly-discounted month. Every test here
  // changes ONE interval and asserts the OTHER price did not move — which is the
  // negative the old code could not satisfy at any percentage.
  //
  // The prices are read through `subscription_payment_plan_amount`, the same
  // function checkout, the manual-payment guard and the free grant all call, so
  // a passing assertion is a statement about money and not about a report.

  describe("G — a change to one interval never moves the other", () => {
    /** The two prices every other assertion in this block is measured against. */
    async function bothPrices() {
      return {
        monthly: await price("business", "month", 0),
        annual: await price("business", "year", 0),
      };
    }

    /**
     * Shop A's prices, cycle by cycle, from the checkout quote.
     *
     * Deliberately not `price()`: that helper hands the primitive a percentage
     * directly, and a 0 there means "this account has no individual discount", so
     * it can only ever measure the GLOBAL rules. An INDIVIDUAL leg has to be read
     * from the subscription's own row, which is what the quote does — and it is
     * also the number a shop would actually be charged.
     */
    async function shopPrices() {
      const monthly = await quote(fx.shopAId, "business", "monthly", fx.ownerAId);
      const annual = await quote(fx.shopAId, "business", "yearly", fx.ownerAId);
      return { monthly: Number(monthly.amount_ugx), annual: Number(annual.amount_ugx) };
    }

    it("a GLOBAL monthly rule leaves the annual price untouched, and back again", async () => {
      const before = await bothPrices();

      await saveGlobal("business", 40, { annual: 0 });
      const afterMonthly = await bothPrices();
      expect(afterMonthly.monthly).toBe(21_600); // 36,000 × 0.60
      expect(afterMonthly.annual).toBe(before.annual); // 345,600 — untouched

      // Now move the ANNUAL leg only. The monthly price must not follow.
      await saveGlobal("business", 40, { annual: 50 });
      const afterAnnual = await bothPrices();
      expect(afterAnnual.monthly).toBe(afterMonthly.monthly);
      expect(afterAnnual.annual).toBe(172_800); // 345,600 × 0.50
    });

    it("an ANNUAL-only global rule never moves the monthly price", async () => {
      const before = await bothPrices();

      await saveGlobal("business", 0, { annual: 30 });
      const after = await bothPrices();
      expect(after.monthly).toBe(before.monthly); // 36,000
      expect(after.annual).toBe(241_920); // 345,600 × 0.70
    });

    it("an INDIVIDUAL monthly rule leaves the annual price untouched, and back again", async () => {
      const before = await shopPrices();

      await saveIndividual(fx.shopAId, 50, { annual: 0 });
      const afterMonthly = await shopPrices();
      expect(afterMonthly.monthly).toBe(18_000);
      expect(afterMonthly.annual).toBe(before.annual);

      await saveIndividual(fx.shopAId, 50, { annual: 10 });
      const afterAnnual = await shopPrices();
      expect(afterAnnual.monthly).toBe(afterMonthly.monthly);
      expect(afterAnnual.annual).toBe(311_040); // 345,600 × 0.90
    });

    it("an absent annual percentage leaves the annual leg alone rather than clearing it", async () => {
      // The compatibility contract. An older client bundle sends only the monthly
      // percent; if that cleared the annual leg, the first such save would throw
      // away a rule the admin never touched.
      await saveIndividual(fx.shopAId, 20, { annual: 60 });
      expect((await shopPrices()).annual).toBe(138_240); // 345,600 × 0.40

      await saveIndividual(fx.shopAId, 20); // no annual argument
      expect((await shopPrices()).annual).toBe(138_240); // unchanged
    });

    it("each interval resolves its own precedence — individual leg, else global leg", async () => {
      await saveGlobal("business", 10, { annual: 60 });
      await saveIndividual(fx.shopAId, 50, { annual: 0 });

      const prices = await shopPrices();
      // Monthly: the individual leg wins outright. 50%, never 60% and never 55%.
      expect(prices.monthly).toBe(18_000);
      // Annual: this account has NO individual annual leg, so the GLOBAL annual
      // leg applies. Before the split, holding an individual rule suppressed the
      // global one for both cycles and this would have been the annual list price.
      expect(prices.annual).toBe(138_240); // 345,600 × 0.40
    });

    it("the two legs never stack", async () => {
      await saveGlobal("business", 10, { annual: 10 });
      await saveIndividual(fx.shopAId, 50, { annual: 50 });

      const prices = await shopPrices();
      // 50% on both cycles, not 60% and not 55%.
      expect(prices.monthly).toBe(18_000);
      expect(prices.annual).toBe(172_800);
    });

    it("quotes each cycle from its own leg, so checkout cannot disagree", async () => {
      await saveGlobal("business", 40, { annual: 50 });

      const monthly = await quote(fx.shopAId, "business", "monthly", fx.ownerAId);
      const annual = await quote(fx.shopAId, "business", "yearly", fx.ownerAId);

      expect(Number(monthly.amount_ugx)).toBe(await price("business", "month", 0));
      expect(Number(annual.amount_ugx)).toBe(await price("business", "year", 0));
      // And they are genuinely different discounts: 40% off the month, 50% off
      // the annual LIST price (not 50% off the 40%-discounted year).
      expect(Number(monthly.amount_ugx)).toBe(21_600);
      expect(Number(annual.amount_ugx)).toBe(172_800);
    });

    it("a monthly campaign discount leaves the annual price at the campaign's annual leg", async () => {
      const campaignId = crypto.randomUUID();
      await exec.exec(
        `INSERT INTO public.pricing_campaigns (id, name, enabled, starts_at)
         VALUES ('${campaignId}', 'monthly-only-sale', true, now() - interval '1 day')`,
      );
      await exec.exec(
        `INSERT INTO public.pricing_campaign_plan_discounts
           (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
         VALUES ('${campaignId}', 'business', 'percentage', 50, 20)`,
      );

      // Monthly: 36,000 − 50% = 18,000.
      expect(await price("business", "month", 0)).toBe(18_000);
      // Annual: 36,000 × 12 × (1 − 20%) = 345,600 — the LIST month drives the
      // year, so the monthly promotion contributes nothing to it. Built on the
      // discounted month this was 18,000 × 12 × 0.8 = 172,800.
      expect(await price("business", "year", 0)).toBe(BUSINESS_ANNUAL);
      // The public book agrees, so no screen advertises a different story.
      const book = await publicPlan("business");
      expect(Number(book.final_monthly_ugx)).toBe(18_000);
      expect(Number(book.final_annual_ugx)).toBe(BUSINESS_ANNUAL);
    });

    it("an extreme MONTHLY campaign discount cannot discount the year", async () => {
      // The measured worst case before the fix: a legal 13,000 fixed-amount
      // monthly discount on starter priced a year at 60,000 against a 216,000
      // list, with the annual percentage left at 0 — a 72% annual discount from a
      // monthly-only input, and no annual floor to catch it.
      const campaignId = crypto.randomUUID();
      await exec.exec(
        `INSERT INTO public.pricing_campaigns (id, name, enabled, starts_at)
         VALUES ('${campaignId}', 'extreme', true, now() - interval '1 day')`,
      );
      await exec.exec(
        `INSERT INTO public.pricing_campaign_plan_discounts
           (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
         VALUES ('${campaignId}', 'starter', 'fixed_amount', 13000, 0)`,
      );

      expect(await price("starter", "month", 0)).toBe(5_000); // the floor binds
      expect(await price("starter", "year", 0)).toBe(216_000); // 18,000 × 12
    });

    it("bounds both legs, on both mechanisms", async () => {
      // Global: 0-99 on either leg, refused through the table CHECK and the RPC.
      const tooHighGlobal = await saveGlobal("business", 10, { annual: 100 });
      expect(tooHighGlobal.ok).toBe(false);
      expect(tooHighGlobal.error).toBe("annual_discount_out_of_range");
      expect(Number(tooHighGlobal.max_percent)).toBe(99);

      const negativeGlobal = await saveGlobal("business", 10, { annual: -1 });
      expect(negativeGlobal.ok).toBe(false);
      expect(negativeGlobal.error).toBe("annual_discount_out_of_range");

      // Individual: the same bound. 100 is not settable through the RPC — the
      // reachable 100 is only the hand-set row the free grant re-checks.
      const tooHighIndividual = await saveIndividual(fx.shopAId, 10, { annual: 100 });
      expect(tooHighIndividual.ok).toBe(false);
      expect(tooHighIndividual.error).toBe("annual_discount_out_of_range");

      // ...and the monthly leg still refuses 100, exactly as before.
      const monthlyTooHigh = await saveIndividual(fx.shopAId, 100, { annual: 0 });
      expect(monthlyTooHigh.ok).toBe(false);
      expect(monthlyTooHigh.error).toBe("discount_out_of_range");

      await expect(
        exec.exec(
          `INSERT INTO public.admin_plan_discounts (plan_code, discount_percent, annual_discount_percent)
           VALUES ('business', 10, 100)`,
        ),
      ).rejects.toThrow(/admin_plan_discounts_annual_percent_check|check constraint/i);
    });

    it("a rule is cleared by BOTH legs reaching zero, and by nothing less", async () => {
      await saveIndividual(fx.shopAId, 30, { annual: 30, reason: "both" });

      // Zeroing the monthly leg leaves the annual rule standing.
      await saveIndividual(fx.shopAId, 0, { annual: 30 });
      const partial = await shopPrices();
      expect(partial.monthly).toBe(36_000);
      expect(partial.annual).toBe(241_920); // 345,600 × 0.70

      // Zeroing the annual leg too is what clears the rule — and its window.
      await saveIndividual(fx.shopAId, 0, { annual: 0 });
      const { rows } = await exec.query<{ m: string; a: string; s: string | null; e: string | null }>(
        `SELECT admin_discount_percent::text AS m, admin_discount_percent_annual::text AS a,
                admin_discount_starts_at::text AS s, admin_discount_expires_at::text AS e
           FROM public.subscriptions WHERE id = $1`,
        [fx.subscriptionAId],
      );
      expect(Number(rows[0]!.m)).toBe(0);
      expect(Number(rows[0]!.a)).toBe(0);
      expect(rows[0]!.s).toBeNull();
      expect(rows[0]!.e).toBeNull();
      expect(await price("business", "year", 0)).toBe(BUSINESS_ANNUAL);
    });

    it("a rule that predates the split still prices both cycles at its own percentage", async () => {
      // EXISTING DISCOUNTS REMAIN VALID. Every rule that existed before
      // 20261012100000 carried ONE percent, and the migration copies it into the
      // new annual leg because that is what the row meant. So a rule with the
      // same percent on both legs has to price exactly as it did before the
      // split: 25% off the month AND 25% off the year.
      //
      // 259,200 is not a new number invented here — it is what the coupled code
      // charged for an annual business subscription at 25% (345,600 × 0.75), and
      // it is still asserted for the primitive in
      // `subscriptionAdminDiscount.sql.integration.test.ts`. This test is the
      // statement that the same rule still produces it after the split.
      await saveGlobal("business", 25, { annual: 25 });
      const global = await bothPrices();
      expect(global.monthly).toBe(27_000); // 36,000 × 0.75
      expect(global.annual).toBe(259_200); // 345,600 × 0.75 — the pre-split figure

      await saveIndividual(fx.shopAId, 25, { annual: 25 });
      const account = await shopPrices();
      expect(account.monthly).toBe(27_000);
      expect(account.annual).toBe(259_200);
    });

    it("the migration back-fills both mechanisms, and defaults the new leg to none", () => {
      // The behavioural test above pins the SHAPE a back-filled rule has. This
      // one guards the mechanism that produces it: without these statements an
      // existing discount would silently lose its annual half, and the test
      // above would still pass because it sets both legs by hand.
      const migration = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261012100000_discount_interval_isolation.sql"),
        "utf8",
      );

      // Global: the annual leg := the percent the rule already carried.
      expect(migration).toMatch(/set\s+annual_discount_percent\s*=\s*discount_percent/);
      // Individual: the same, and only where a rule exists at all.
      expect(migration).toMatch(/set\s+admin_discount_percent_annual\s*=\s*admin_discount_percent/);
      expect(migration).toMatch(/where coalesce \(admin_discount_percent, 0\) > 0/);

      // Both columns arrive NOT NULL DEFAULT 0, so a row the back-fill skips
      // reads as "no annual discount" rather than as NULL — which the resolver
      // would have to treat separately.
      expect(migration).toMatch(/annual_discount_percent numeric\(5, 2\) not null default 0/);
      expect(migration).toMatch(/admin_discount_percent_annual numeric\(6, 2\) not null default 0/);
    });

    it("an expired window lapses BOTH legs together", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      await saveIndividual(fx.shopAId, 50, { annual: 50, startsAt: past, expiresAt: future });
      const live = await shopPrices();
      expect(live.monthly).toBe(18_000);
      expect(live.annual).toBe(172_800);

      // The window is one per rule, so both legs lapse at the same instant.
      await exec.exec(
        `UPDATE public.subscriptions SET admin_discount_expires_at = now() - interval '1 second'
          WHERE id = '${fx.subscriptionAId}'`,
      );
      const lapsed = await shopPrices();
      expect(lapsed.monthly).toBe(36_000);
      expect(lapsed.annual).toBe(BUSINESS_ANNUAL);
    });
  });

  // ======================================================================
  // F — nothing reprices a settled payment
  // ======================================================================

  describe("F — a settled payment keeps its amount", () => {
    it("does not touch a confirmed payment when a discount is granted afterwards", async () => {
      await rpc(fx.ownerAId, "subscription_payment_create", [
        fx.shopAId,
        "mtn_momo",
        `settled-${Date.now()}`,
        BUSINESS,
        null,
        null,
        null,
        "business",
        "monthly",
      ]);
      const [payment] = (
        await exec.query<{ id: string; amount: string }>(
          `SELECT id, amount_ugx::text AS amount FROM public.subscription_payments WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        )
      ).rows;

      await saveGlobal("business", 90);
      await saveIndividual(fx.shopAId, 99);

      const after = (
        await exec.query<{ amount: string }>(
          `SELECT amount_ugx::text AS amount FROM public.subscription_payments WHERE id = $1`,
          [payment!.id],
        )
      ).rows[0]!;
      expect(after.amount).toBe(payment!.amount);
    });
  });
});
