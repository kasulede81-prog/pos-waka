/**
 * Admin subscription discounts — real SQL contract.
 *
 * THREE mechanisms now reach a subscription price, and the whole point of this
 * suite is that they stay distinguishable:
 *
 *   1. `subscriptions.admin_discount_percent` — the per-ACCOUNT admin discount.
 *      0–100, applied last, can reach zero. Set only by
 *      `admin_subscription_discount_save`.
 *   2. `admin_plan_discounts` — the GLOBAL per-plan admin discount added in
 *      `20261010120000`. 0–99, optional window, applies only where no individual
 *      discount exists. It REPLACES, never stacks.
 *   3. pricing-campaign plan discounts (113) — campaign-wide and deliberately
 *      bounded: 90% clamp, UGX 5,000 floor. **This suite pins that the campaign
 *      rules are untouched by the admin feature.**
 *
 * The floor question, settled here: the UGX 5,000 floor lives in
 * `_pricing_compute_plan_row`, which only campaign pricing passes through. The
 * admin discount is applied AFTER it, so a 99% admin discount on Business really
 * is UGX 360 — the floor never binds on the admin path. That is asserted
 * directly below rather than assumed.
 *
 * Base prices (canonical book, 113): starter 18,000 / business 36,000 /
 * waka_plus 82,000 per month; default annual discount 20%.
 */
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
const WAKA_PLUS = 82_000;
/** 20% default annual discount, so the undiscounted annual for business is 345,600. */
const BUSINESS_ANNUAL = 345_600;

describe("admin subscription discounts — SQL contract", () => {
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
    // Nothing may leak between tests: a stray campaign or rule would silently
    // change every price assertion below.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
    await exec.exec("DELETE FROM public.admin_plan_discounts;");
    await exec.exec(
      `UPDATE public.subscriptions
          SET admin_discount_percent = 0, admin_discount_note = NULL,
              admin_discount_starts_at = NULL, admin_discount_expires_at = NULL;`,
    );
    /**
     * The fixture's own subscription sits on `business_m1`, a LEGACY non-catalog
     * plan that prices from the `subscription_plans` row (monthly 36,000, annual
     * 432,000 — no annual discount). Pinning the catalog `business` plan here is
     * what makes the canonical book — and therefore every number in this file —
     * the thing under test. Without it the RPCs would still be exercised, but
     * against a price book this suite's constants do not describe.
     */
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

  /** The price every money path uses — quote, create and validation all call this. */
  async function price(plan: string, cycle: string, individualPercent = 0): Promise<number> {
    const { rows } = await exec.query<{ result: string }>(
      `SELECT public.subscription_payment_plan_amount($1, $2, $3) AS result`,
      [plan, cycle, individualPercent],
    );
    return Number(rows[0]!.result);
  }

  async function adminSaveGlobal(
    plan: string,
    percent: number,
    extra: {
      active?: boolean;
      startsAt?: string | null;
      expiresAt?: string | null;
      reason?: string | null;
      /**
       * The ANNUAL leg. Left undefined it is not sent, which asks the server to
       * leave any existing annual leg alone — see the setter's contract.
       */
      annual?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    const args: unknown[] = [
      plan,
      percent,
      extra.active ?? true,
      extra.startsAt ?? null,
      extra.expiresAt ?? null,
      extra.reason ?? "test",
    ];
    if (extra.annual !== undefined) args.push(extra.annual);
    return rpc(fx.internalAdminId, "admin_plan_discount_save", args);
  }

  async function adminSaveIndividual(
    shopId: string,
    percent: number,
    reason: string | null = "test",
  ): Promise<Record<string, unknown>> {
    return rpc(fx.internalAdminId, "admin_subscription_discount_save", [shopId, percent, reason]);
  }

  /**
   * What the SERVER resolves this subscription's individual discount to be right
   * now — the value every money path feeds into the pricing primitive.
   */
  async function effectiveFor(subscriptionId: string, interval = "month"): Promise<number> {
    const { rows } = await exec.query<{ v: string }>(
      `SELECT public._admin_discount_for_row (s, $2) AS v FROM public.subscriptions s WHERE s.id = $1`,
      [subscriptionId, interval],
    );
    return Number(rows[0]!.v);
  }

  async function individualStored(subscriptionId: string): Promise<number> {
    const { rows } = await exec.query<{ pct: string }>(
      `SELECT admin_discount_percent AS pct FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    return Number(rows[0]!.pct);
  }

  // ========================================================================
  // A — the price is right at every requested percentage
  // ========================================================================

  it("prices 0%, 1%, 90% and 99% from the canonical book, with correct rounding", async () => {
    expect(await price("business", "month", 0)).toBe(BUSINESS);
    expect(await price("business", "month", 1)).toBe(35_640);
    expect(await price("business", "month", 90)).toBe(3_600);
    expect(await price("business", "month", 99)).toBe(360);
  });

  it("keeps fractional percentages exact", async () => {
    // 36,000 × 0.7775 = 27,990 exactly (the existing contract's own case).
    expect(await price("business", "month", 22.25)).toBe(27_990);
    // 18,000 × (100 − 33) / 100 = 12,060 exactly.
    expect(await price("starter", "month", 33)).toBe(12_060);
  });

  it("applies the same percentage to the annual cycle", async () => {
    expect(await price("business", "year", 0)).toBe(BUSINESS_ANNUAL);
    expect(await price("business", "year", 99)).toBe(3_456);
  });

  // ========================================================================
  // B — the UGX 5,000 floor does NOT bind on the admin path
  // ========================================================================

  it("lets a 99% admin discount fall far below the UGX 5,000 campaign floor", async () => {
    // Every plan at 99% is well under 5,000. If the floor applied here these
    // would each come back as 5,000.
    expect(await price("business", "month", 99)).toBe(360);
    expect(await price("starter", "month", 99)).toBe(180);
    expect(await price("waka_plus", "month", 99)).toBe(820);

    for (const value of [await price("business", "month", 99), await price("starter", "month", 99)]) {
      expect(value).toBeLessThan(5_000);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("never produces a negative amount, however extreme the input", async () => {
    expect(await price("business", "month", 1000)).toBe(0);
    expect(await price("business", "month", -50)).toBe(BUSINESS);
  });

  it("still lets the pinned 100% case price at zero", async () => {
    // Deliberately preserved: this is an existing tested guarantee, and no setter
    // added by the admin discount feature can write above 99.
    expect(await price("business", "month", 100)).toBe(0);
    expect(await price("starter", "month", 100)).toBe(0);
  });

  // ========================================================================
  // C — global rules
  // ========================================================================

  it("an admin can set a global discount and the price follows", async () => {
    expect(await price("business", "month")).toBe(BUSINESS);

    const res = await adminSaveGlobal("business", 25, { reason: "Launch offer" });
    expect(res.ok).toBe(true);

    expect(await price("business", "month")).toBe(27_000);
  });

  it("touches ONLY the selected plan", async () => {
    await adminSaveGlobal("business", 25);

    expect(await price("business", "month")).toBe(27_000);
    // Untouched neighbours.
    expect(await price("starter", "month")).toBe(STARTER);
    expect(await price("waka_plus", "month")).toBe(WAKA_PLUS);
  });

  it("edits an existing rule rather than accumulating one", async () => {
    await adminSaveGlobal("business", 25);
    await adminSaveGlobal("business", 10);

    // One plan, one rule: 10%, not 25% and not 35%.
    expect(await price("business", "month")).toBe(32_400);
  });

  it("a percentage of 0 is inert, and deleting removes the rule", async () => {
    await adminSaveGlobal("business", 40);
    expect(await price("business", "month")).toBe(21_600);

    await adminSaveGlobal("business", 0);
    expect(await price("business", "month")).toBe(BUSINESS);

    await adminSaveGlobal("business", 40);
    const removed = await rpc(fx.internalAdminId, "admin_plan_discount_delete", ["business"]);
    expect(removed.ok).toBe(true);
    expect(await price("business", "month")).toBe(BUSINESS);
  });

  it("an inactive rule does not price", async () => {
    await adminSaveGlobal("business", 40, { active: false });

    expect(await price("business", "month")).toBe(BUSINESS);
  });

  // ========================================================================
  // D — windows
  // ========================================================================

  it("a future-dated rule does not price yet", async () => {
    await adminSaveGlobal("business", 40, { startsAt: "2999-01-01T00:00:00Z" });

    expect(await price("business", "month")).toBe(BUSINESS);
  });

  it("an expired rule does not price", async () => {
    await adminSaveGlobal("business", 40, { expiresAt: "2000-01-01T00:00:00Z" });

    expect(await price("business", "month")).toBe(BUSINESS);
  });

  it("a rule inside its window prices", async () => {
    await adminSaveGlobal("business", 40, {
      startsAt: "2000-01-01T00:00:00Z",
      expiresAt: "2999-01-01T00:00:00Z",
    });

    expect(await price("business", "month")).toBe(21_600);
  });

  it("rejects an inverted window", async () => {
    const res = await adminSaveGlobal("business", 40, {
      startsAt: "2999-01-01T00:00:00Z",
      expiresAt: "2000-01-01T00:00:00Z",
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_window");
    expect(await price("business", "month")).toBe(BUSINESS);
  });

  // ========================================================================
  // E — bounds and validation
  // ========================================================================

  it("rejects anything above 99%", async () => {
    for (const bad of [99.01, 100, 150]) {
      const res = await adminSaveGlobal("business", bad);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("discount_out_of_range");
    }
    // Nothing was written by any of them.
    expect(await price("business", "month")).toBe(BUSINESS);
  });

  it("rejects a negative percentage and an unknown plan", async () => {
    expect((await adminSaveGlobal("business", -1)).error).toBe("discount_out_of_range");
    expect((await adminSaveGlobal("free", 10)).error).toBe("invalid_plan");
    expect((await adminSaveGlobal("not_a_plan", 10)).error).toBe("invalid_plan");
  });

  it("the database itself refuses a value above 99, not only the RPC", async () => {
    await expect(
      exec.exec(
        `INSERT INTO public.admin_plan_discounts (plan_code, discount_percent) VALUES ('business', 100)`,
      ),
    ).rejects.toThrow(/admin_plan_discounts_discount_percent_check|check constraint/i);
  });

  // ========================================================================
  // F — individual discounts and cross-tenant isolation
  // ========================================================================

  it("an admin can set an individual discount and that account's price follows", async () => {
    const res = await adminSaveIndividual(fx.shopAId, 50, "Goodwill credit");
    expect(res.ok).toBe(true);
    expect(res.subscription_id).toBe(fx.subscriptionAId);

    expect(await individualStored(fx.subscriptionAId)).toBe(50);
    expect(await price("business", "month", 50)).toBe(18_000);
  });

  it("NEVER leaks into another shop on the same plan", async () => {
    await adminSaveIndividual(fx.shopAId, 50);

    // Shop B keeps its own row, and its own (zero) discount.
    expect(await individualStored(fx.subscriptionBId)).toBe(0);
  });

  it("clears back to no discount at 0, and drops the note with it", async () => {
    await adminSaveIndividual(fx.shopAId, 50, "Goodwill credit");
    const cleared = await adminSaveIndividual(fx.shopAId, 0, null);

    expect(cleared.ok).toBe(true);
    expect(await individualStored(fx.subscriptionAId)).toBe(0);

    const { rows } = await exec.query<{ note: string | null }>(
      `SELECT admin_discount_note AS note FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(rows[0]!.note).toBeNull();
  });

  it("rejects an individual discount above 99%", async () => {
    const res = await adminSaveIndividual(fx.shopAId, 100);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("discount_out_of_range");
    expect(await individualStored(fx.subscriptionAId)).toBe(0);
  });

  it("returns the real final price computed by the checkout function, per cycle", async () => {
    const res = await adminSaveIndividual(fx.shopAId, 25);

    expect(res.ok).toBe(true);
    expect(Number(res.monthly_ugx)).toBe(27_000); // 36,000 × 0.75
    // THE INTERVAL CONTRACT. A monthly 25% no longer moves the year: the annual
    // leg was not set by this call, so the year prices at the campaign layer
    // (345,600 = 36,000 × 12 × 0.8). It used to return 259,200 — 345,600 × 0.75
    // — which is the coupling this suite now pins shut.
    expect(Number(res.annual_discount_percent)).toBe(0);
    expect(Number(res.annual_ugx)).toBe(345_600);
  });

  it("prices each cycle from its own leg, and neither leg reaches the other", async () => {
    // Both legs set explicitly, as the screen now sends them.
    const saved = await rpc(fx.internalAdminId, "admin_subscription_discount_save", [
      fx.shopAId,
      25,
      "test",
      null,
      null,
      40,
    ]);
    expect(saved.ok).toBe(true);
    expect(Number(saved.monthly_ugx)).toBe(27_000); // 36,000 × 0.75
    expect(Number(saved.annual_ugx)).toBe(207_360); // 345,600 × 0.60 — 40%, not 25%

    // Moving the monthly leg alone leaves the annual price byte-identical.
    const annualBefore = await price("business", "year", 0);
    await rpc(fx.internalAdminId, "admin_subscription_discount_save", [fx.shopAId, 5, "test", null, null, 40]);
    expect(await price("business", "year", 0)).toBe(annualBefore);

    // ...and moving the annual leg alone leaves the monthly price byte-identical.
    const monthlyBefore = await price("business", "month", 0);
    await rpc(fx.internalAdminId, "admin_subscription_discount_save", [fx.shopAId, 5, "test", null, null, 10]);
    expect(await price("business", "month", 0)).toBe(monthlyBefore);
  });

  // ========================================================================
  // G — precedence: individual REPLACES global, it never stacks
  // ========================================================================

  it("an individual discount wins outright over a global one", async () => {
    await adminSaveGlobal("business", 10);
    await adminSaveIndividual(fx.shopAId, 50);

    // 50%, not 60% and not 55%.
    expect(await price("business", "month", await individualStored(fx.subscriptionAId))).toBe(18_000);
  });

  it("a LOWER individual discount still replaces a higher global one", async () => {
    await adminSaveGlobal("business", 40);
    await adminSaveIndividual(fx.shopAId, 5);

    // Precedence is "most specific wins", not "best discount wins".
    expect(await price("business", "month", 5)).toBe(34_200);
  });

  it("a global rule applies only where no individual discount exists", async () => {
    await adminSaveGlobal("business", 10);

    // Shop A has its own; shop B does not, so B gets the global rule.
    expect(await price("business", "month", 0)).toBe(32_400);
    expect(await price("business", "month", await individualStored(fx.subscriptionAId))).toBe(32_400);

    await adminSaveIndividual(fx.shopAId, 50);
    expect(await price("business", "month", await individualStored(fx.subscriptionAId))).toBe(18_000);
  });

  // ========================================================================
  // H — authorization
  // ========================================================================

  it("refuses a shop owner, a cashier and an unrelated user", async () => {
    // Each call is awaited individually: `asUser` opens a transaction per call, so
    // overlapping them on the single test connection would interleave BEGIN/COMMIT
    // and surface as "current transaction is aborted" rather than a real refusal.
    for (const actor of [fx.ownerAId, fx.cashierAId, fx.outsiderId, fx.ownerId]) {
      await expect(
        rpc(actor, "admin_plan_discount_save", ["business", 50, true, null, null, "x"]),
      ).rejects.toThrow(/forbidden/i);
      await expect(
        rpc(actor, "admin_subscription_discount_save", [fx.shopAId, 50, "x"]),
      ).rejects.toThrow(/forbidden/i);
    }

    expect(await price("business", "month")).toBe(BUSINESS);
    expect(await individualStored(fx.subscriptionAId)).toBe(0);
  });

  it("refuses non-admins on the read RPCs too", async () => {
    await expect(rpc(fx.ownerAId, "admin_discount_overview", [])).rejects.toThrow(/forbidden/i);
    await expect(
      rpc(fx.ownerAId, "admin_discount_preview", ["business", 50, true]),
    ).rejects.toThrow(/forbidden/i);
  });

  it("no client role can read or write the table directly", async () => {
    // RLS is on with NO policies, and the table privileges are revoked — so even
    // an internal admin going through PostgREST is refused.
    await expect(
      asUser(exec, fx.internalAdminId, () => exec.query(`SELECT * FROM public.admin_plan_discounts`)),
    ).rejects.toThrow(/permission denied|denied/i);

    await expect(
      asUser(exec, fx.ownerAId, () =>
        exec.query(`INSERT INTO public.admin_plan_discounts (plan_code, discount_percent) VALUES ('business', 99)`),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });

  // ========================================================================
  // I — the campaign mechanism is untouched
  // ========================================================================

  it("keeps the campaign 90% clamp and UGX 5,000 floor exactly as they were", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
       VALUES ('regression', true, now() - interval '1 day') RETURNING id`,
    );
    const campaignId = rows[0]!.id;
    await exec.exec(
      `INSERT INTO public.pricing_campaign_plan_discounts
         (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
       VALUES ('${campaignId}', 'business', 'percentage', 99, 20)`,
    );

    // Campaign pricing is clamped to 90% and floored at 5,000 — a 99% campaign
    // request must NOT become 99%.
    const campaignMonthly = Number(
      (
        await exec.query<{ v: string }>(
          `SELECT (public._pricing_compute_plan_row('business','percentage',99,20) ->> 'final_monthly_ugx') AS v`,
        )
      ).rows[0]!.v,
    );
    expect(campaignMonthly).toBe(5_000);
  });

  it("does not rewrite an existing subscription's plan or period when a discount changes", async () => {
    const before = await exec.query<{ plan_id: string; period_end: string | null }>(
      `SELECT plan_id, current_period_end::text AS period_end FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );

    await adminSaveGlobal("business", 60);
    await adminSaveIndividual(fx.shopAId, 60);

    const after = await exec.query<{ plan_id: string; period_end: string | null }>(
      `SELECT plan_id, current_period_end::text AS period_end FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );

    expect(after.rows[0]!.plan_id).toBe(before.rows[0]!.plan_id);
    expect(after.rows[0]!.period_end).toBe(before.rows[0]!.period_end);
  });

  // ========================================================================
  // J — reads for the admin UI
  // ========================================================================

  it("the overview lists global and individual rules separately, with real prices", async () => {
    await adminSaveGlobal("business", 25, { reason: "Launch" });
    await adminSaveIndividual(fx.shopAId, 50);

    const overview = await rpc(fx.internalAdminId, "admin_discount_overview", []);

    expect(overview.ok).toBe(true);

    const global = overview.global as Record<string, unknown>[];
    expect(global).toHaveLength(1);
    expect(global[0].plan_code).toBe("business");
    expect(Number(global[0].final_monthly_with_discount_ugx)).toBe(27_000);

    const individual = overview.individual as Record<string, unknown>[];
    expect(individual).toHaveLength(1);
    expect(Number(individual[0].discount_percent)).toBe(50);
    expect(Number(individual[0].final_monthly_ugx)).toBe(18_000);
  });

  it("the preview matches what checkout would charge", async () => {
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, true]);

    expect(preview.ok).toBe(true);
    expect(Number(preview.monthly_ugx)).toBe(360);
    expect(Number(preview.base_monthly_ugx)).toBe(BUSINESS);
    expect(Number(preview.monthly_discount_ugx)).toBe(BUSINESS - 360);

    // And it is the same number the money path produces.
    expect(Number(preview.monthly_ugx)).toBe(await price("business", "month", 99));
  });

  it("the preview refuses an out-of-range percentage", async () => {
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 150, true]);

    expect(preview.ok).toBe(false);
    expect(preview.error).toBe("discount_out_of_range");
  });

  // ========================================================================
  // L — the individual discount's window, enforced on every money path
  // ========================================================================
  //
  // The point of these is that expiry is NOT a client convention. Each test goes
  // through the same server functions the shop's terminal does — the pricing
  // primitive, `subscription_payment_quote` and
  // `subscription_payment_expected_amount` — and asserts the lapsed rate is gone
  // from all three.

  /** The same read the shop's checkout makes. */
  async function serverQuote(plan: string, cycle = "month"): Promise<Record<string, unknown>> {
    return rpc(fx.ownerAId, "subscription_payment_quote", [fx.shopAId, plan, cycle]);
  }

  /** The amount the payment path independently recomputes for validation. */
  async function expectedAmount(subscriptionId: string): Promise<number> {
    const { rows } = await exec.query<{ v: string }>(
      `SELECT public.subscription_payment_expected_amount($1) AS v`,
      [subscriptionId],
    );
    return Number(rows[0]!.v);
  }

  async function setWindow(subscriptionId: string, starts: string | null, expires: string | null) {
    await exec.exec(
      `UPDATE public.subscriptions
          SET admin_discount_starts_at = ${starts ? `'${starts}'::timestamptz` : "NULL"},
              admin_discount_expires_at = ${expires ? `'${expires}'::timestamptz` : "NULL"}
        WHERE id = '${subscriptionId}'`,
    );
  }

  it("an admin can save an individual discount with a window", async () => {
    const res = await rpc(fx.internalAdminId, "admin_subscription_discount_save", [
      fx.shopAId,
      40,
      "Q4 goodwill",
      "2000-01-01T00:00:00Z",
      "2999-01-01T00:00:00Z",
    ]);

    expect(res.ok).toBe(true);
    expect(res.applies_now).toBe(true);
    expect(await price("business", "month", await individualStored(fx.subscriptionAId))).toBe(21_600);
  });

  it("a NOT-YET-STARTED individual discount is not applied anywhere", async () => {
    await rpc(fx.internalAdminId, "admin_subscription_discount_save", [
      fx.shopAId,
      40,
      "future",
      "2999-01-01T00:00:00Z",
      null,
    ]);

    // The configured rate is stored...
    expect(await individualStored(fx.subscriptionAId)).toBe(40);

    // ...but is 0 the moment it reaches a money path.
    expect(await price("business", "month", await effectiveFor(fx.subscriptionAId))).toBe(BUSINESS);
    expect(Number((await serverQuote("business")).amount_ugx)).toBe(BUSINESS);
    expect(await expectedAmount(fx.subscriptionAId)).toBe(BUSINESS);
  });

  it("an EXPIRED individual discount is not applied anywhere", async () => {
    await adminSaveIndividual(fx.shopAId, 40);
    // Expire it after the fact, the way a lapse actually happens.
    await setWindow(fx.subscriptionAId, "2000-01-01T00:00:00Z", "2001-01-01T00:00:00Z");

    expect(await individualStored(fx.subscriptionAId)).toBe(40);
    expect(await price("business", "month", await effectiveFor(fx.subscriptionAId))).toBe(BUSINESS);
    expect(Number((await serverQuote("business")).amount_ugx)).toBe(BUSINESS);
    expect(await expectedAmount(fx.subscriptionAId)).toBe(BUSINESS);
  });

  it("an IN-WINDOW individual discount is applied on every money path", async () => {
    await adminSaveIndividual(fx.shopAId, 40);
    await setWindow(fx.subscriptionAId, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z");

    expect(await price("business", "month", await effectiveFor(fx.subscriptionAId))).toBe(21_600);
    expect(Number((await serverQuote("business")).amount_ugx)).toBe(21_600);
    expect(await expectedAmount(fx.subscriptionAId)).toBe(21_600);
  });

  it("a lapsed individual discount falls back to the GLOBAL rule, not to a stale personal rate", async () => {
    await adminSaveGlobal("business", 10);
    await adminSaveIndividual(fx.shopAId, 40);
    await setWindow(fx.subscriptionAId, "2000-01-01T00:00:00Z", "2001-01-01T00:00:00Z");

    // The 10% global rule, not 40% and not list.
    expect(Number((await serverQuote("business")).amount_ugx)).toBe(32_400);
  });

  it("a live individual discount still replaces a global rule inside the window", async () => {
    await adminSaveGlobal("business", 10);
    await adminSaveIndividual(fx.shopAId, 40);
    await setWindow(fx.subscriptionAId, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z");

    expect(Number((await serverQuote("business")).amount_ugx)).toBe(21_600);
  });

  it("refuses a window that has already closed", async () => {
    const res = await rpc(fx.internalAdminId, "admin_subscription_discount_save", [
      fx.shopAId,
      40,
      "stale",
      null,
      "2001-01-01T00:00:00Z",
    ]);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("window_already_expired");
    expect(await individualStored(fx.subscriptionAId)).toBe(0);
  });

  it("refuses an inverted individual window", async () => {
    const res = await rpc(fx.internalAdminId, "admin_subscription_discount_save", [
      fx.shopAId,
      40,
      "backwards",
      "2999-01-01T00:00:00Z",
      "2000-01-01T00:00:00Z",
    ]);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_window");
  });

  it("clearing the discount clears its window too", async () => {
    await adminSaveIndividual(fx.shopAId, 40);
    await setWindow(fx.subscriptionAId, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z");

    await rpc(fx.internalAdminId, "admin_subscription_discount_save", [fx.shopAId, 0, null]);

    const { rows } = await exec.query<{ s: string | null; e: string | null }>(
      `SELECT admin_discount_starts_at::text AS s, admin_discount_expires_at::text AS e
         FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(rows[0]!.s).toBeNull();
    expect(rows[0]!.e).toBeNull();
  });

  it("the three-argument setter no longer exists, so no path can set a discount without a window", async () => {
    // `create or replace` with new parameters would have left this behind as an
    // overload — a callable way to write a discount that ignores windows.
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
        WHERE n2.nspname = 'public' AND p.proname = 'admin_subscription_discount_save'`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  // ========================================================================
  // M — the boundary with the campaign mechanism
  // ========================================================================
  //
  // WHY THIS EXISTS. "I cannot discount below UGX 5,000" is what the CAMPAIGN
  // mechanism is FOR — it clamps percentages at 90% and floors every plan at
  // UGX 5,000 inside `_pricing_compute_plan_row`. An operator who reaches for
  // Pricing Campaigns therefore gets exactly that floor, however high a
  // percentage they type, because the floor is applied to the campaign price
  // BEFORE the admin discount is ever consulted.
  //
  // These tests pin the two mechanisms apart so the difference cannot be
  // mistaken for a bug in either. They are the evidence that the admin discount
  // path is NOT floored.

  /** What the campaign price book produces, with no admin discount involved. */
  async function campaignMonthly(plan: string, percent: number): Promise<number> {
    const { rows } = await exec.query<{ v: string }>(
      `SELECT (public._pricing_compute_plan_row($1, 'percentage', $2, 20) ->> 'final_monthly_ugx') AS v`,
      [plan, percent],
    );
    return Number(rows[0]!.v);
  }

  it("a campaign discount is clamped at 90% and floored at UGX 5,000 — by design, unchanged", async () => {
    // 36,000 − 90% = 3,600, which is under the floor → floored to 5,000.
    expect(await campaignMonthly("business", 90)).toBe(5_000);
    // Asking for 99% changes nothing: the clamp binds first.
    expect(await campaignMonthly("business", 99)).toBe(5_000);
    expect(await campaignMonthly("starter", 99)).toBe(5_000);
    // waka_plus 82,000 − 90% = 8,200, above the floor → the clamp is what binds.
    expect(await campaignMonthly("waka_plus", 99)).toBe(8_200);
  });

  it("an ADMIN discount at 99% is NOT floored — it reaches UGX 360", async () => {
    // The whole point: same plan, same percentage, different mechanism.
    expect(await price("business", "month", 99)).toBe(360);
    expect(await price("starter", "month", 99)).toBe(180);
    expect(await price("waka_plus", "month", 99)).toBe(820);
  });

  it("with a live campaign, the admin discount still applies AFTER the floored campaign price", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
       VALUES ('floor-trace', true, now() - interval '1 day') RETURNING id`,
    );
    await exec.exec(
      `INSERT INTO public.pricing_campaign_plan_discounts
         (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
       VALUES ('${rows[0]!.id}', 'business', 'percentage', 99, 20)`,
    );

    // The campaign price is floored at 5,000...
    expect(await price("business", "month", 0)).toBe(5_000);
    // ...and the admin discount is then applied to THAT, not to 36,000.
    // 5,000 × (100 − 99) / 100 = 50 — comfortably below the floor.
    expect(await price("business", "month", 99)).toBe(50);
  });

  it("a saved global admin discount reprices a plan that also has a campaign", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
       VALUES ('floor-trace-2', true, now() - interval '1 day') RETURNING id`,
    );
    await exec.exec(
      `INSERT INTO public.pricing_campaign_plan_discounts
         (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
       VALUES ('${rows[0]!.id}', 'business', 'percentage', 50, 20)`,
    );

    // 36,000 − 50% = 18,000 (above the floor, so the campaign price stands).
    expect(await price("business", "month", 0)).toBe(18_000);

    const saved = await adminSaveGlobal("business", 99);
    expect(saved.ok).toBe(true);


    // 18,000 × 0.01 = 180. The floor does not bind on the admin path even when
    // a campaign is live.
    expect(await price("business", "month", 0)).toBe(180);

    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false]);
    expect(Number(preview.monthly_ugx)).toBe(180);
  });

  // ========================================================================
  // N — the preview must agree with the amount actually charged
  // ========================================================================
  //
  // THE BUG THESE PIN. Both read RPCs used to ask for their "undiscounted base"
  // with `subscription_payment_plan_amount (plan, cycle, 0)`. Once a global rule
  // exists, 0 means "no INDIVIDUAL discount" and resolves to that global rule —
  // so the "base" came back already discounted and was then discounted again.
  // Measured before the fix, with a 50% campaign and a global 99% rule on
  // business: the amount was 180 and the preview said 2.

  /** The campaign-layer price, with no admin discount of any kind. */
  async function campaignBase(plan: string, cycle: string): Promise<number> {
    const { rows } = await exec.query<{ v: string }>(
      `SELECT public._admin_discount_campaign_amount($1, $2) AS v`,
      [plan, cycle],
    );
    return Number(rows[0]!.v);
  }

  it("the preview agrees with what the checkout would actually charge", async () => {
    await adminSaveGlobal("business", 99);

    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false]);
    const charged = await price("business", "month", 0);

    expect(Number(preview.monthly_ugx)).toBe(charged);
    // And it is the real number, not a doubly-discounted one.
    expect(Number(preview.monthly_ugx)).toBe(360);
    expect(Number(preview.base_monthly_ugx)).toBe(BUSINESS);
  });

  it("the preview stays correct with a campaign AND a global rule live", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
       VALUES ('preview-base', true, now() - interval '1 day') RETURNING id`,
    );
    await exec.exec(
      `INSERT INTO public.pricing_campaign_plan_discounts
         (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
       VALUES ('${rows[0]!.id}', 'business', 'percentage', 50, 20)`,
    );

    await adminSaveGlobal("business", 99);

    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false]);
    const charged = await price("business", "month", 0);

    // Base is the CAMPAIGN price (18,000), not the already-discounted one.
    expect(Number(preview.base_monthly_ugx)).toBe(18_000);
    expect(Number(preview.monthly_ugx)).toBe(180);
    expect(Number(preview.monthly_ugx)).toBe(charged);
  });

  it("the preview is unchanged from the raw percentage when no rule is saved yet", async () => {
    // The first thing an admin does: type a percentage before saving anything.
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false]);

    expect(Number(preview.base_monthly_ugx)).toBe(BUSINESS);
    expect(Number(preview.monthly_ugx)).toBe(360);
  });

  it("the individual preview also agrees with the charged amount", async () => {
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, true]);

    expect(Number(preview.monthly_ugx)).toBe(await price("business", "month", 99));
    expect(Number(preview.monthly_ugx)).toBe(360);
  });

  it("the campaign base helper cannot drift from the pricing primitive", async () => {
    // With no global rule configured, `_admin_discount_campaign_amount` and
    // `subscription_payment_plan_amount (plan, cycle, 0)` must be the same number
    // — that equality is what keeps the two definitions from diverging silently.
    for (const plan of ["starter", "business", "waka_plus"]) {
      expect(await campaignBase(plan, "monthly")).toBe(await price(plan, "month", 0));
      expect(await campaignBase(plan, "yearly")).toBe(await price(plan, "year", 0));
    }
  });

  it("the ANNUAL preview agrees with the amount the annual checkout would charge", async () => {
    // Both legs saved, as the screen sends them: 99% monthly AND 99% annual.
    await adminSaveGlobal("business", 99, { annual: 99 });

    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false, 99]);

    // Both cycles, against the authoritative calculation.
    expect(Number(preview.monthly_ugx)).toBe(await price("business", "month", 0));
    expect(Number(preview.annual_ugx)).toBe(await price("business", "year", 0));
    // And both are real numbers: 36,000 → 360 and 345,600 → 3,456.
    expect(Number(preview.base_annual_ugx)).toBe(BUSINESS_ANNUAL);
    expect(Number(preview.annual_ugx)).toBe(3_456);
  });

  it("previews the two legs independently — the annual one is NOT the monthly one", async () => {
    // The preview is a calculator: each leg is whatever it is handed. 99%
    // monthly with no annual leg prices the year at the campaign layer, not at
    // 1% of it.
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false]);

    expect(Number(preview.monthly_ugx)).toBe(360);
    expect(Number(preview.annual_discount_percent)).toBe(0);
    expect(Number(preview.annual_ugx)).toBe(BUSINESS_ANNUAL);
  });

  it("the ANNUAL preview stays correct for an individual discount too", async () => {
    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 25, true, 25]);

    expect(Number(preview.annual_ugx)).toBe(await price("business", "year", 25));
    expect(Number(preview.monthly_ugx)).toBe(await price("business", "month", 25));
  });

  it("a MONTHLY campaign discount leaves the annual base at the annual list price", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.pricing_campaigns (name, enabled, starts_at)
       VALUES ('annual-base', true, now() - interval '1 day') RETURNING id`,
    );
    await exec.exec(
      `INSERT INTO public.pricing_campaign_plan_discounts
         (campaign_id, plan_code, monthly_discount_type, monthly_discount_value, annual_discount_percent)
       VALUES ('${rows[0]!.id}', 'business', 'percentage', 50, 20)`,
    );
    await adminSaveGlobal("business", 99, { annual: 0 });

    const preview = await rpc(fx.internalAdminId, "admin_discount_preview", ["business", 99, false, 0]);

    // THE CAMPAIGN INTERVAL CONTRACT. The annual base is 36,000 × 12 × (1 − 20%)
    // = 345,600 — the 50% MONTHLY campaign discount must not touch it. Building
    // the year on the discounted month gave 172,800, and that is what this
    // assertion replaced.
    expect(Number(preview.base_annual_ugx)).toBe(BUSINESS_ANNUAL);
    expect(Number(preview.base_monthly_ugx)).toBe(18_000);
    expect(Number(preview.annual_ugx)).toBe(await price("business", "year", 0));
  });

  it("the overview reports the true base and the true discounted price", async () => {
    await adminSaveGlobal("business", 25);

    const overview = await rpc(fx.internalAdminId, "admin_discount_overview", []);
    const row = (overview.global as Record<string, unknown>[])[0]!;

    expect(Number(row.base_monthly_ugx)).toBe(BUSINESS);
    expect(Number(row.final_monthly_ugx)).toBe(27_000);
    expect(Number(row.final_monthly_ugx)).toBe(await price("business", "month", 0));
  });

  // ========================================================================
  // K — audit
  // ========================================================================

  it("writes an audit row for each administrative change", async () => {
    await adminSaveGlobal("business", 25, { reason: "Launch offer" });
    await adminSaveIndividual(fx.shopAId, 50, "Goodwill");
    await rpc(fx.internalAdminId, "admin_plan_discount_delete", ["business"]);

    const { rows } = await exec.query<{ action: string }>(
      `SELECT action FROM public.internal_ops_admin_audit
        WHERE action LIKE 'admin_plan_discount%' OR action LIKE 'admin_subscription_discount%'
        ORDER BY created_at`,
    );
    const actions = rows.map((r) => r.action);

    expect(actions).toContain("admin_plan_discount_saved");
    expect(actions).toContain("admin_subscription_discount_saved");
    expect(actions).toContain("admin_plan_discount_deleted");

    // And the subscription's own history, the same trail a plan change leaves.
    const { rows: history } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.subscription_history
        WHERE subscription_id = $1 AND action = 'admin_set_subscription_discount'`,
      [fx.subscriptionAId],
    );
    expect(Number(history[0]!.n)).toBeGreaterThan(0);
  });
});
