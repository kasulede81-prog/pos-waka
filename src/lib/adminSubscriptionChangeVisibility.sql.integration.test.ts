/**
 * Internal-admin subscription changes — do they actually reach the shop?
 *
 * The reported symptom was "an admin changes a shop's plan and the user-facing
 * app does not show it". That splits into two very different failures, and this
 * suite settles which one it is:
 *
 *   A. the change never reaches the database / the effective-plan read, or
 *   B. the database is right and the shop's running app simply never re-reads.
 *
 * Everything here is (A): the admin RPC persists, the read the shop's app
 * actually makes reflects it, and a fresh quote prices the NEW plan. (B) is a
 * client concern, covered by scripts/verify-subscription-refresh.mjs.
 *
 * Also pinned: a change to the GLOBAL plan book must not silently rewrite an
 * existing subscription's plan or terms.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

describe("admin subscription changes — server-side visibility contract", () => {
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
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await exec.exec("UPDATE public.subscriptions SET admin_discount_percent = 0;");
    await exec.exec("DELETE FROM public.promotional_grants;");
    // Every test starts from the fixture's plan so ordering cannot leak.
    await exec.exec(
      `UPDATE public.subscriptions
          SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = 'business')
        WHERE id = '${fx.subscriptionAId}'`,
    );
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

  /** Exactly the read the shop's app makes (fetchShopSubscription.ts). */
  async function effectiveForShop(shopId: string, asUserId = fx.internalAdminId) {
    return rpc(asUserId, "shop_get_effective_subscription", [shopId]);
  }

  async function quote(shopId: string, plan: string, cycle = "month"): Promise<Record<string, unknown>> {
    return rpc(fx.ownerAId, "subscription_payment_quote", [shopId, plan, cycle]);
  }

  async function storedPlanCode(): Promise<string> {
    return scalar(
      `SELECT sp.code FROM public.subscriptions s
         JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = $1`,
      [fx.subscriptionAId],
    );
  }

  // ========================================================================
  // A — the change persists and the shop's own read reflects it
  // ========================================================================

  it("an admin plan change persists and the shop's effective-plan read follows it", async () => {
    expect(await storedPlanCode()).toBe("business");

    const res = await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "waka_plus", 30]);
    expect(res.ok).toBe(true);

    // 2. the database stored the intended value
    expect(await storedPlanCode()).toBe("waka_plus");

    // 3./4. the read the shop's app makes reports the new plan
    const effective = await effectiveForShop(fx.shopAId);
    expect(effective.ok).toBe(true);
    const sub = effective.subscription as Record<string, unknown>;
    expect(sub).toBeTruthy();
    expect(String(sub.plan_code)).toBe("waka_plus");
  });

  it("the change is visible to the SHOP's own members, not just to admins", async () => {
    await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "starter", 30]);
    const asOwner = await effectiveForShop(fx.shopAId, fx.ownerAId);
    expect(asOwner.ok).toBe(true);
    expect(String((asOwner.subscription as Record<string, unknown>).plan_code)).toBe("starter");
  });

  it("a fresh server quote prices the NEW plan, not the old one", async () => {
    const before = await quote(fx.shopAId, "business");
    expect(before.ok).toBe(true);
    expect(Number(before.amount_ugx)).toBe(36_000);

    await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "waka_plus", 30]);

    // The quote is asked for the plan being bought, so it must price that plan.
    const after = await quote(fx.shopAId, "waka_plus");
    expect(after.ok).toBe(true);
    expect(Number(after.amount_ugx)).toBe(82_000);
  });

  it("an admin discount adjustment is reflected in a fresh quote", async () => {
    expect(Number((await quote(fx.shopAId, "business")).amount_ugx)).toBe(36_000);

    await exec.exec(`UPDATE public.subscriptions SET admin_discount_percent = 25 WHERE id = '${fx.subscriptionAId}'`);

    const discounted = await quote(fx.shopAId, "business");
    expect(Number(discounted.amount_ugx)).toBe(27_000);
  });

  it("the admin screen's own re-read shows the persisted value", async () => {
    await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "starter", 14]);
    // What reopening the console reads back.
    const row = await exec.query<{ plan_code: string; status: string }>(
      `SELECT sp.code AS plan_code, s.status
         FROM public.subscriptions s
         JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = $1`,
      [fx.subscriptionAId],
    );
    expect(row.rows[0]?.plan_code).toBe("starter");
  });

  // ========================================================================
  // Global changes must not rewrite an existing subscription
  // ========================================================================

  it("changing the global plan price does NOT change an existing subscription's plan or terms", async () => {
    const before = await exec.query<{ plan_code: string; period_end: string; discount: string }>(
      `SELECT sp.code AS plan_code, s.current_period_end::text AS period_end, s.admin_discount_percent::text AS discount
         FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = $1`,
      [fx.subscriptionAId],
    );

    await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 99000 WHERE code = 'business'`);

    const after = await exec.query<{ plan_code: string; period_end: string; discount: string }>(
      `SELECT sp.code AS plan_code, s.current_period_end::text AS period_end, s.admin_discount_percent::text AS discount
         FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = $1`,
      [fx.subscriptionAId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    // And the price charged still comes from the canonical book, not the legacy row.
    await expect(effectiveForShop(fx.shopAId)).resolves.toBeTruthy();
    expect(Number((await quote(fx.shopAId, "business")).amount_ugx)).toBe(36_000);

    await exec.exec(`UPDATE public.subscription_plans SET monthly_price_ugx = 36000 WHERE code = 'business'`);
  });

  it("the canonical price book is not writable by a shop member", async () => {
    // `subscription_canonical_prices` is created by 113, i.e. AFTER 010's
    // `alter default privileges`, so `authenticated` inherits INSERT/UPDATE/DELETE
    // on it. The only thing standing between a merchant and rewriting every price
    // in the product is RLS — and RLS refuses by affecting ZERO ROWS, silently,
    // not by raising. So the assertion is the stored value, not an exception.
    await asUser(exec, fx.ownerAId, async () => {
      const res = await exec.query<{ plan_code: string }>(
        `UPDATE public.subscription_canonical_prices SET monthly_price_ugx = 1 WHERE plan_code = 'business' RETURNING plan_code`,
      );
      expect(res.rows.length, "the update must not reach a single row").toBe(0);
    });

    expect(
      Number(await scalar(`SELECT monthly_price_ugx::text FROM public.subscription_canonical_prices WHERE plan_code = 'business'`)),
    ).toBe(36_000);
    // …and the price every shop is quoted is therefore untouched.
    expect(Number((await quote(fx.shopAId, "business")).amount_ugx)).toBe(36_000);
  });

  // ========================================================================
  // Authorization
  // ========================================================================

  it("refuses a plan change to a non-admin", async () => {
    // This RPC raises rather than returning a JSON refusal.
    await expect(
      rpc(fx.ownerAId, "admin_shop_set_subscription_plan", [fx.shopAId, "waka_plus", 30]),
    ).rejects.toThrow(/forbidden/i);
    // The shop's plan is untouched by the attempt.
    expect(await storedPlanCode()).toBe("business");
  });

  it("refuses an unknown plan code rather than writing it", async () => {
    const res = await rpc(fx.internalAdminId, "admin_shop_set_subscription_plan", [fx.shopAId, "not_a_plan", 30]);
    expect(res.ok).toBe(false);
    expect(await storedPlanCode()).toBe("business");
  });

  it("a shop that cannot be reached does not leak another shop's plan", async () => {
    const asOutsider = await effectiveForShop(fx.shopAId, fx.outsiderId);
    // Either a refusal or "not found" — never a populated subscription.
    const sub = asOutsider.subscription ?? null;
    expect(sub).toBeNull();
  });
});
