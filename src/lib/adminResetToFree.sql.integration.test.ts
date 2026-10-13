/**
 * Reset to Free — the canonical state, and what it deliberately does NOT touch.
 *
 * `admin_shop_set_subscription_plan(shop, 'free')` is the only supported way to
 * put a shop back on Free. It is reached from the shop console's "Reset to Free"
 * button. Two things need pinning:
 *
 *  1. WHAT IT MUST FIX. The Free branch cleared the period end, the trial end
 *     and the payment status but left `billing_interval` alone, so a shop coming
 *     off ANNUAL Business kept `billing_interval='year'` on a zero-price plan —
 *     a row that contradicts itself.
 *
 *  2. WHAT IT MUST NOT DO. It must not erase an admin's recorded discount, must
 *     not revoke a promotional grant as a side effect, must not rewrite payment
 *     history, and must not widen its own role gate. Those are deliberate
 *     decisions, so they are pinned here rather than left to drift.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

const PROMO = "business_annual_printer_v1";

describe("reset to Free — canonical state and deliberate non-effects", () => {
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
    await exec.exec("DELETE FROM public.promotional_grants;");
    await exec.exec("DELETE FROM public.subscription_payments;");
    // Every subscription except the fixture's, in ANY organization. One test
    // deliberately inserts a second row for ORG A; clearing it here keeps each
    // test independent of the one before it, so `_subscription_latest_for_org`
    // can never be answering about a row a previous test left behind.
    await exec.exec(`DELETE FROM public.subscriptions WHERE id <> '${fx.subscriptionAId}'`);
    // The baseline every test starts from: ORG A on ANNUAL Business, active,
    // with a future period end — i.e. exactly what qualifies for the printer
    // promotion, so the reset has something real to take away.
    await exec.exec(`
      UPDATE public.subscriptions
         SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business'),
             status = 'active',
             billing_interval = 'year',
             trial_ends_at = null,
             current_period_start = now(),
             current_period_end = now() + interval '1 year',
             payment_status = 'paid',
             admin_discount_percent = 0,
             admin_discount_note = null
       WHERE id = '${fx.subscriptionAId}';
    `);
  });

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.${fn}(${placeholders}) AS result`,
        args,
      );
      return rpcJson(rows[0]);
    });
  }

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  const subRow = () =>
    exec
      .query<Record<string, unknown>>(
        `SELECT s.status,
                s.billing_interval,
                s.trial_ends_at,
                s.current_period_start,
                s.current_period_end,
                s.payment_status,
                s.external_provider,
                s.admin_discount_percent,
                sp.code AS plan_code
           FROM public.subscriptions s
           LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
          WHERE s.id = $1`,
        [fx.subscriptionAId],
      )
      .then((r) => r.rows[0]!);

  const resetToFree = () =>
    rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "free", 1]);

  // ========================================================================
  // The canonical Free state
  // ========================================================================

  it("lands on the canonical Free row shape", async () => {
    expect((await resetToFree()).ok).toBe(true);

    const row = await subRow();
    expect(row.plan_code).toBe("free");
    expect(row.status).toBe("active");
    expect(row.trial_ends_at).toBeNull();
    expect(row.current_period_end).toBeNull();
    expect(row.payment_status).toBe("waived");
    expect(row.current_period_start).not.toBeNull();
    // Matches the shape free-onboarding writes (044), so a reset shop and a
    // freshly onboarded shop are indistinguishable.
    expect(row.external_provider).toBe("manual_admin");
  });

  it("normalises billing_interval to 'month' — the BUG this migration fixes", async () => {
    expect(await scalar(`SELECT billing_interval FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]))
      .toBe("year");

    await resetToFree();

    expect(await scalar(`SELECT billing_interval FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]))
      .toBe("month");
  });

  it("ignores p_days for Free — a 365-day reset still has no period end", async () => {
    // p_days is only meaningful for a paid grant. If Free ever honoured it, an
    // "annual" period could be written onto a plan that has no period.
    const res = await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "free", 365]);
    expect(res.ok).toBe(true);
    expect(res.current_period_end).toBeNull();
    expect((await subRow()).current_period_end).toBeNull();
  });

  it("leaves a PAID plan's billing interval alone — annual Business stays annual", async () => {
    // The fix must not touch the paid path: annual is exactly what qualifies a
    // Business subscription for the printer promotion.
    await resetToFree();
    await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "business", 365]);
    expect(await scalar(`SELECT billing_interval FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]))
      .toBe("month"); // unchanged by the fix; it was month, and the paid path does not rewrite it

    await exec.exec(`UPDATE public.subscriptions SET billing_interval = 'year' WHERE id = '${fx.subscriptionAId}'`);
    await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "business", 365]);
    expect(await scalar(`SELECT billing_interval FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]))
      .toBe("year");
  });

  // ========================================================================
  // What it deliberately does NOT do
  // ========================================================================

  it("RETAINS admin_discount_percent rather than silently erasing it", async () => {
    await exec.exec(
      `UPDATE public.subscriptions
          SET admin_discount_percent = 25, admin_discount_note = 'agreed with owner'
        WHERE id = '${fx.subscriptionAId}'`,
    );

    await resetToFree();

    const row = await subRow();
    // A Free plan is zero-priced, so this is inert while the shop sits on Free —
    // but it is an admin's recorded decision and the history row this RPC writes
    // does not capture it, so erasing it would leave no trace. It is warned
    // about in the UI instead.
    expect(Number(row.admin_discount_percent)).toBe(25);
    expect(await scalar(`SELECT admin_discount_note FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]))
      .toBe("agreed with owner");
  });

  it("does NOT revoke a promotional grant — the subscription goes Free, the grant survives", async () => {
    await exec.exec(`
      INSERT INTO public.promotional_grants (organization_id, shop_id, plan_code, granted_by, reason, expires_at)
      VALUES ('${fx.orgAId}', '${fx.shopAId}', 'business', 'manual_admin', 'retained on purpose', now() + interval '1 year');
    `);

    await resetToFree();

    // The subscription row IS Free...
    expect((await subRow()).plan_code).toBe("free");

    // ...and the grant is untouched: not revoked, not expired, not deleted.
    // This is the claim the UI warning rests on, and it is asserted directly.
    const grant = await exec.query<Record<string, unknown>>(
      `SELECT revoked_at, expires_at > now () AS still_live, plan_code
         FROM public.promotional_grants WHERE organization_id = $1`,
      [fx.orgAId],
    );
    expect(grant.rows).toHaveLength(1);
    expect(grant.rows[0]!.revoked_at).toBeNull();
    expect(grant.rows[0]!.still_live).toBe(true);
    expect(grant.rows[0]!.plan_code).toBe("business");

    // BOUNDARY — what this harness cannot execute. The step from "grant is live"
    // to "the shop still USES Business" is `shop_effective_plan_code()`, which
    // resolves a grant above the subscription's base tier. It is defined in
    // migration 134, which this harness (bootstrap-through-043) does not build,
    // so it is NOT asserted here. That resolution was verified by reading 134
    // directly, and no trigger or side effect revokes a grant on subscription
    // change (the only writer of `revoked_at` is 097's explicit revoke RPC) —
    // which is why the UI warns rather than revoking.
  });

  it("preserves payment history untouched", async () => {
    await exec.exec(`
      INSERT INTO public.subscription_payments (subscription_id, organization_id, amount_ugx, provider, reference, status)
      VALUES ('${fx.subscriptionAId}', '${fx.orgAId}', 36000, 'mtn', 'REF-KEEP-1', 'confirmed');
    `);
    const before = await scalar<number>(
      `SELECT count(*)::int FROM public.subscription_payments WHERE organization_id = $1`,
      [fx.orgAId],
    );

    await resetToFree();

    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_payments WHERE organization_id = $1`,
        [fx.orgAId],
      ),
    ).toBe(before);
    expect(
      await scalar<number>(
        `SELECT amount_ugx FROM public.subscription_payments WHERE reference = 'REF-KEEP-1'`,
      ),
    ).toBe(36000);
  });

  it("cancels the organization's OTHER active subscription and keeps the audited row", async () => {
    // The unique index allows at most one ACTIVE row per org, so the reachable
    // shape is: an older ACTIVE row plus a newer non-active one. The reset picks
    // the newest and must cancel the older active row first, or it would collide.
    await exec.exec(`
      UPDATE public.subscriptions
         SET status = 'expired', current_period_end = now() - interval '1 day'
       WHERE id = '${fx.subscriptionAId}';

      INSERT INTO public.subscriptions
        (organization_id, shop_id, plan_id, status, billing_interval, created_at, current_period_start, current_period_end)
      VALUES
        ('${fx.orgAId}', '${fx.shopAId}',
         (SELECT id FROM public.subscription_plans WHERE code = 'starter'),
         'active', 'month', now() - interval '10 days', now() - interval '10 days', now() + interval '20 days');
    `);

    expect((await resetToFree()).ok).toBe(true);

    expect(await scalar(`SELECT sp.code FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id WHERE s.id = $1`, [fx.subscriptionAId]))
      .toBe("free");
    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscriptions
          WHERE organization_id = $1 AND status IN ('trial','trialing','active','past_due')`,
        [fx.orgAId],
      ),
    ).toBe(1);
  });

  it("writes subscription history and an audit row", async () => {
    await resetToFree();

    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_history WHERE subscription_id = $1 AND action = 'admin_set_shop_plan'`,
        [fx.subscriptionAId],
      ),
    ).toBeGreaterThan(0);
    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.audit_logs WHERE action = 'admin_shop_set_subscription_plan' AND shop_id = $1`,
        [fx.shopAId],
      ),
    ).toBeGreaterThan(0);
  });

  // ========================================================================
  // The gates stay authoritative
  // ========================================================================

  it("removes printer-promotion eligibility for a previously eligible annual Business shop", async () => {
    const before = await rpc(fx.internalAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
    expect(before.eligible).toBe(true);

    await resetToFree();

    const after = await rpc(fx.internalAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
    expect(after.eligible).toBe(false);
    expect(after.can_reserve).toBe(false);
    // Refused on the plan itself, not merely on the lapsed period.
    expect(String(after.reason)).toBe("not_business");
  });

  it("names the PLAN, not the billing interval, when a shop is wrong on both", async () => {
    // The reason ORDER is what makes the reset message useful. A monthly Starter
    // shop fails both component tests; the operator needs to hear about the plan,
    // because that is the change they have to make. Before 20261013120200 this
    // reported 'not_annual'.
    await exec.exec(`
      UPDATE public.subscriptions
         SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'starter'),
             billing_interval = 'month',
             status = 'active',
             current_period_end = now() + interval '1 month'
       WHERE id = '${fx.subscriptionAId}';
    `);

    const res = await rpc(fx.internalAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
    expect(res.eligible).toBe(false);
    expect(String(res.reason)).toBe("not_business");
    // Both facts are still reported verbatim, so nothing is concealed.
    expect(String(res.plan_code)).toBe("starter");
    expect(String(res.billing_interval)).toBe("month");
  });

  it("still reports the interval when the plan is correct but the billing is monthly", async () => {
    // The cases the existing printer tests pin must not move.
    await exec.exec(`
      UPDATE public.subscriptions
         SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business'),
             billing_interval = 'month',
             status = 'active',
             current_period_end = now() + interval '1 month'
       WHERE id = '${fx.subscriptionAId}';
    `);

    const res = await rpc(fx.internalAdminId, "internal_ops_printer_eligibility", [fx.shopAId, PROMO]);
    expect(res.eligible).toBe(false);
    expect(String(res.reason)).toBe("not_annual");
  });

  it("still refuses a caller who is not an internal billing admin", async () => {
    await expect(
      rpc(fx.ownerAId, "admin_shop_set_subscription_plan", [fx.shopAId, "free", 1]),
    ).rejects.toThrow(/forbidden/i);
    await expect(
      rpc(fx.outsiderId, "admin_shop_set_subscription_plan", [fx.shopAId, "free", 1]),
    ).rejects.toThrow(/forbidden/i);
  });
});
