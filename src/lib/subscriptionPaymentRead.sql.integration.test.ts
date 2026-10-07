/**
 * M3-B — CUSTOMER PAYMENT READ / QUOTE FOUNDATION (real SQL).
 *
 * Runs the full production chain through
 * 20261007120000_subscription_payment_read_rpcs.sql and proves the M3-B
 * audit contract:
 *   - quote parity: quote == public_subscription_pricing == create, for every
 *     plan/cycle, campaign (percentage/fixed/floor/expired), invalid inputs,
 *     anchor rule and no-subscription shops;
 *   - get: org-scoped, safe projection (no note/metadata/recorded_by), all
 *     five statuses, foreign payment indistinguishable from missing;
 *   - history: shop-scoped, DESC ordering, clamped limit (≤100), keyset
 *     pagination, empty results, org-level manual payments, no PII keys;
 *   - authorization matrix (owner/admin/billing ✓, staff/manager/viewer ✗,
 *     internal ✓, service-role logic ✓, anon ✗);
 *   - carry-forwards: M2 direct DML still blocked, customers still cannot
 *     confirm, M3-A suites remain green (run separately).
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

/** The exact safe projection allowed on any payment row returned to clients. */
const SAFE_PAYMENT_KEYS = [
  "amount_ugx",
  "checkout",
  "confirmed_at",
  "created_at",
  "currency",
  "payment_id",
  "provider",
  "provider_status",
  "reference",
  "shop_id",
  "status",
  "status_reason",
  "subscription_id",
];
const SAFE_CHECKOUT_KEYS = ["billing_interval", "campaign_id", "plan_code", "quoted_amount", "quoted_at"];

function safeKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).sort();
}

describe("M3-B — payment quote/get/history RPCs (real SQL)", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;

  // Authz seeds (created in beforeAll).
  let billingUser: string;
  let adminUser: string;
  let managerUser: string;
  let viewerUser: string;
  let orgC: string;
  let shopC: string;
  let ownerC: string;
  let shopA2: string;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);

    billingUser = crypto.randomUUID();
    adminUser = crypto.randomUUID();
    managerUser = crypto.randomUUID();
    viewerUser = crypto.randomUUID();
    orgC = crypto.randomUUID();
    shopC = crypto.randomUUID();
    ownerC = crypto.randomUUID();
    shopA2 = crypto.randomUUID();

    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${billingUser}', 'm3b-billing@test.local'),
        ('${adminUser}', 'm3b-admin@test.local'),
        ('${managerUser}', 'm3b-manager@test.local'),
        ('${viewerUser}', 'm3b-viewer@test.local'),
        ('${ownerC}', 'm3b-owner-c@test.local');
      INSERT INTO public.organizations (id, name) VALUES ('${orgC}', 'M3B Org C');
      INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
        ('${fx.orgAId}', '${billingUser}', 'billing'),
        ('${fx.orgAId}', '${adminUser}', 'admin'),
        ('${orgC}', '${ownerC}', 'owner');
      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${fx.shopAId}', '${managerUser}', 'manager'),
        ('${fx.shopAId}', '${viewerUser}', 'viewer');
      INSERT INTO public.shops (id, organization_id, name) VALUES
        ('${shopC}', '${orgC}', 'M3B Shop C'),
        ('${shopA2}', '${fx.orgAId}', 'M3B Shop A2');
    `);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

  beforeEach(async () => {
    // A leftover active campaign would change every price assertion.
    await exec.exec("DELETE FROM public.pricing_campaigns;");
  });

  // ---- helpers ----------------------------------------------------------

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<RpcResult> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  const internal = () => fx.internalAdminId;

  async function quote(userId: string, shopId: string, plan: string, cycle: string): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_quote", [shopId, plan, cycle]);
  }

  async function get(userId: string, paymentId: string): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_get", [paymentId]);
  }

  async function history(
    userId: string,
    shopId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<RpcResult> {
    const args: unknown[] = [shopId];
    if (opts.limit !== undefined || opts.before !== undefined) {
      args.push(opts.limit ?? 10);
    }
    if (opts.before !== undefined) {
      if (args.length === 1) args.push(10);
      args.push(opts.before);
    }
    return rpc(userId, "my_subscription_payments", args);
  }

  /** Create an intent (optionally as another authorized user). */
  async function intent(
    userId: string,
    opts: {
      shopId?: string;
      subscriptionId?: string | null;
      reference?: string | null;
      amount?: number | null;
      plan?: string | null;
      cycle?: string | null;
    } = {},
  ): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_create", [
      opts.shopId ?? fx.shopAId,
      "mtn_momo",
      opts.reference ?? null,
      opts.amount === undefined ? null : opts.amount,
      null,
      null,
      opts.subscriptionId === undefined ? fx.subscriptionAId : opts.subscriptionId,
      opts.plan ?? null,
      opts.cycle ?? null,
    ]);
  }

  async function confirm(paymentId: string): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_confirm", [paymentId, null, null]);
  }

  async function resetSubA(plan = "starter", cycle: "month" | "year" = "month") {
    await exec.exec(`
      DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}';
      DELETE FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions s
      SET plan_id = (SELECT id FROM public.subscription_plans WHERE code = '${plan}'),
          billing_interval = '${cycle}',
          status = 'trialing',
          payment_status = 'unknown',
          current_period_start = now() - interval '10 days',
          current_period_end = now() + interval '20 days',
          trial_ends_at = NULL,
          metadata = '{}'::jsonb,
          shop_id = '${fx.shopAId}',
          updated_at = now()
      WHERE s.id = '${fx.subscriptionAId}';
    `);
  }

  async function publicPricing(): Promise<{
    campaign_id: string | null;
    plans: Array<{ plan_code: string; final_monthly_ugx: number; final_annual_ugx: number }>;
  }> {
    const { rows } = await exec.query(`SELECT public.public_subscription_pricing() AS result`);
    const raw = rpcJson(rows[0]) as unknown as {
      campaign_id: string | null;
      plans: Array<{ plan_code: string; final_monthly_ugx: number; final_annual_ugx: number }>;
    };
    return {
      campaign_id: raw.campaign_id ?? null,
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

  async function setCampaignDiscount(campaignId: string, planCode: string, type: string, value: number) {
    await exec.exec(`
      INSERT INTO public.pricing_campaign_plan_discounts (campaign_id, plan_code, monthly_discount_type, monthly_discount_value)
      VALUES ('${campaignId}', '${planCode}', '${type}', ${value});
    `);
  }

  async function expectDenied(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission denied|row-level security/i.test(msg)) return;
      throw new Error(`${label}: unexpected error → ${msg}`, { cause: e });
    }
    throw new Error(`${label}: unexpectedly SUCCEEDED`);
  }

  // ========================================================================
  // 1. QUOTE
  // ========================================================================

  it("Q1 quote parity: all 3 plans × monthly/yearly equal public pricing, payload safe", async () => {
    await resetSubA("starter", "month");
    const pricing = await publicPricing();

    for (const plan of ["starter", "business", "waka_plus"]) {
      for (const cycle of ["monthly", "yearly"]) {
        const q = await quote(fx.ownerAId, fx.shopAId, plan, cycle);
        expect(q.ok, `${plan}/${cycle} → ${JSON.stringify(q)}`).toBe(true);
        const pub =
          cycle === "monthly"
            ? publicPlan(pricing, plan).final_monthly_ugx
            : publicPlan(pricing, plan).final_annual_ugx;
        expect(Number(q.amount_ugx)).toBe(pub);
        expect(q.currency).toBe("UGX");
        expect(q.plan_code).toBe(plan);
        expect(q.billing_interval).toBe(cycle === "monthly" ? "month" : "year");
        expect(q.quoted_at).toBeTruthy();
        expect(q.subscription_id).toBe(fx.subscriptionAId);
        expect(q.shop_id).toBe(fx.shopAId);
      }
    }

    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(q.current_plan_code).toBe("starter");
    expect(q.current_billing_interval).toBe("month");
    expect(q.is_current).toBe(false);
    const same = await quote(fx.ownerAId, fx.shopAId, "starter", "monthly");
    expect(same.is_current).toBe(true);
    // No campaign active → no campaign id.
    expect(q.campaign_id).toBeNull();
  });

  it("Q2 percentage campaign: quote == public pricing incl. campaign_id", async () => {
    const pricing0 = await publicPricing();
    expect(pricing0.campaign_id).toBeNull();
    const campaignId = await enableCampaign("M3B pct");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);

    const pricing = await publicPricing();
    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(Number(q.amount_ugx)).toBe(27_000);
    expect(Number(q.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
    expect(q.campaign_id).toBe(campaignId);
    expect(q.campaign_id).toBe(pricing.campaign_id);
  });

  it("Q3 fixed discount parity", async () => {
    const campaignId = await enableCampaign("M3B fixed");
    await setCampaignDiscount(campaignId, "business", "fixed_amount", 10_000);
    const pricing = await publicPricing();
    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(Number(q.amount_ugx)).toBe(26_000);
    expect(Number(q.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
  });

  it("Q4 minimum floor parity", async () => {
    const campaignId = await enableCampaign("M3B floor");
    await setCampaignDiscount(campaignId, "business", "fixed_amount", 50_000);
    const pricing = await publicPricing();
    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(Number(q.amount_ugx)).toBe(5_000);
    expect(Number(q.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
  });

  it("Q5 expired campaign is ignored by quote", async () => {
    const campaignId = await enableCampaign("M3B expired");
    await setCampaignDiscount(campaignId, "business", "percentage", 25);
    await exec.exec(
      `UPDATE public.pricing_campaigns SET ends_at = now() - interval '1 day' WHERE id = '${campaignId}'`,
    );
    const pricing = await publicPricing();
    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(Number(q.amount_ugx)).toBe(36_000);
    expect(Number(q.amount_ugx)).toBe(publicPlan(pricing, "business").final_monthly_ugx);
    expect(q.campaign_id).toBeNull();
  });

  it("Q6 quote → create parity: the quoted amount is accepted and stored unchanged", async () => {
    await resetSubA("starter", "month");
    const q = await quote(fx.ownerAId, fx.shopAId, "business", "monthly");
    expect(q.ok).toBe(true);

    const created = await intent(fx.ownerAId, {
      plan: "business",
      cycle: "monthly",
      amount: Number(q.amount_ugx),
      reference: "Q6",
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    expect(Number(created.amount_ugx)).toBe(Number(q.amount_ugx));
    expect(String(created.plan_code)).toBe("business");

    // A cheaper client amount than the quote is still rejected (quote is advisory only).
    await resetSubA("starter", "month");
    const cheap = await intent(fx.ownerAId, {
      plan: "business",
      cycle: "monthly",
      amount: Number(q.amount_ugx) - 1,
      reference: "Q6b",
    });
    expect(cheap.ok).toBe(false);
    expect(String(cheap.error)).toBe("amount_mismatch");
  });

  it("Q7 invalid plan, inactive plan and free plan behave exactly like create", async () => {
    await resetSubA("starter", "month");
    const missing = await quote(fx.ownerAId, fx.shopAId, "does_not_exist", "monthly");
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toBe("plan_not_available");

    const inactiveCode = "m3b_scratch_inactive";
    await exec.exec(`
      INSERT INTO public.subscription_plans (code, name, monthly_price_ugx, annual_price_ugx, is_active)
      VALUES ('${inactiveCode}', 'Inactive', 1000, 12000, false);
    `);
    const inactive = await quote(fx.ownerAId, fx.shopAId, inactiveCode, "monthly");
    expect(inactive.ok).toBe(false);
    expect(String(inactive.error)).toBe("plan_not_available");

    const free = await quote(fx.ownerAId, fx.shopAId, "free", "monthly");
    expect(free.ok).toBe(true);
    expect(Number(free.amount_ugx)).toBe(0);
  });

  it("Q8 invalid billing cycle is rejected", async () => {
    const bad = await quote(fx.ownerAId, fx.shopAId, "business", "weekly");
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toBe("invalid_billing_interval");
  });

  it("Q9 foreign shop/org fails closed; a shop's own org still works", async () => {
    // ownerA (orgA) quoting shopB (orgB): exists, but resolves to orgB → forbidden.
    const foreign = await quote(fx.ownerAId, fx.shopBId, "business", "monthly");
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toBe("forbidden");

    // Unknown shop collapses to shop_not_found.
    const unknown = await quote(fx.ownerAId, crypto.randomUUID(), "business", "monthly");
    expect(unknown.ok).toBe(false);
    expect(String(unknown.error)).toBe("shop_not_found");

    // Positive control: orgB's own owner can quote shopB.
    const own = await quote(fx.ownerId, fx.shopBId, "business", "monthly");
    expect(own.ok).toBe(true);
    expect(own.shop_id).toBe(fx.shopBId);
  });

  it("Q10 anchor rule and no-subscription shops fail closed", async () => {
    // shopA2 belongs to orgA but the subscription is anchored to shopA.
    const anchored = await quote(fx.ownerAId, shopA2, "business", "monthly");
    expect(anchored.ok).toBe(false);
    expect(String(anchored.error)).toBe("shop_subscription_mismatch");

    // orgC owns shopC but has no subscription at all.
    const noSub = await quote(ownerC, shopC, "business", "monthly");
    expect(noSub.ok).toBe(false);
    expect(String(noSub.error)).toBe("subscription_not_found");
  });

  it("Q11 quote authorization matrix (owner/admin/billing/staff/manager/viewer/internal/service/anon)", async () => {
    await resetSubA("starter", "month");
    const okCases: Array<[string, string]> = [
      ["owner", fx.ownerAId],
      ["org admin", adminUser],
      ["org billing", billingUser],
      ["internal staff", fx.internalAdminId],
    ];
    for (const [label, userId] of okCases) {
      const q = await quote(userId, fx.shopAId, "business", "monthly");
      expect(q.ok, label).toBe(true);
    }

    const denied: Array<[string, string]> = [
      ["org staff", fx.cashierAId],
      ["shop manager", managerUser],
      ["shop viewer", viewerUser],
    ];
    for (const [label, userId] of denied) {
      const q = await quote(userId, fx.shopAId, "business", "monthly");
      expect(q.ok, label).toBe(false);
      expect(String(q.error), label).toBe("forbidden");
    }

    // service_role logic branch (claims role) — EXECUTE granted in production;
    // the harness proves the authorization branch via request.jwt.claims.
    await exec.exec("BEGIN");
    await exec.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await exec.exec("SET LOCAL ROLE authenticated");
    let serviceResult: RpcResult;
    try {
      const { rows } = await exec.query(
        `SELECT public.subscription_payment_quote($1, $2, $3) AS result`,
        [fx.shopAId, "business", "monthly"],
      );
      serviceResult = rpcJson(rows[0]);
    } finally {
      await exec.exec("ROLLBACK");
    }
    expect(serviceResult.ok).toBe(true);

    // anon fails at the grant layer.
    await expectDenied("anon quote", async () => {
      await exec.exec("BEGIN");
      await exec.exec("SET LOCAL ROLE anon");
      try {
        await exec.query(`SELECT public.subscription_payment_quote($1, $2, $3)`, [
          fx.shopAId,
          "business",
          "monthly",
        ]);
      } finally {
        await exec.exec("ROLLBACK");
      }
    });
  });

  // ========================================================================
  // 2. GET
  // ========================================================================

  it("G1 get returns exactly the safe projection (no note / metadata / recorded_by)", async () => {
    await resetSubA("starter", "month");
    const created = await intent(internal(), { reference: "G1", plan: "business", cycle: "monthly" });
    expect(created.ok).toBe(true);

    const row = (await get(fx.ownerAId, created.payment_id as string)) as RpcResult & Record<string, unknown>;
    expect(row.ok).toBe(true);
    // Envelope carries `ok`; the payment payload is exactly the whitelist.
    expect(safeKeys(row)).toEqual([...SAFE_PAYMENT_KEYS, "ok"].sort());
    expect(row).not.toHaveProperty("note");
    expect(row).not.toHaveProperty("metadata");
    expect(row).not.toHaveProperty("recorded_by");
    expect(row).not.toHaveProperty("organization_id");
    expect(row.status).toBe("pending");
    expect(row.provider_status).toBeNull();

    const checkout = row.checkout as Record<string, unknown>;
    expect(Object.keys(checkout).sort()).toEqual([...SAFE_CHECKOUT_KEYS].sort());
    expect(checkout.plan_code).toBe("business");
    expect(checkout.billing_interval).toBe("month");
    expect(Number(checkout.quoted_amount)).toBe(36_000);
    expect(checkout.quoted_at).toBeTruthy();
  });

  it("G2 all five payment statuses are retrievable verbatim", async () => {
    const phases: Array<[string, (id: string) => Promise<RpcResult> | Promise<void>]> = [
      ["pending", async () => {}],
      ["confirmed", (id) => confirm(id)],
      ["failed", (id) => rpc(internal(), "subscription_payment_fail", [id, "declined"])],
      ["cancelled", (id) => rpc(internal(), "subscription_payment_cancel", [id, "abandoned"])],
      ["refunded", async (id) => {
        await confirm(id);
        await rpc(internal(), "subscription_payment_refund", [id, "requested"]);
      }],
    ];

    for (const [status, act] of phases) {
      await resetSubA("starter", "month");
      const created = await intent(internal(), { reference: `G2-${status}`, plan: "starter", cycle: "monthly" });
      expect(created.ok).toBe(true);
      await act(created.payment_id as string);
      const row = await get(fx.ownerAId, created.payment_id as string);
      expect(row.ok, status).toBe(true);
      expect(row.status, status).toBe(status);
      const expectedReason: Record<string, string | null> = {
        pending: null,
        confirmed: null,
        failed: "declined",
        cancelled: "abandoned",
        refunded: "requested",
      };
      expect(row.status_reason ?? null, status).toBe(expectedReason[status] ?? null);
    }
  });

  it("G3 + G4 foreign payment is byte-identical to a missing payment (no UUID oracle)", async () => {
    const foreignIntent = await intent(internal(), {
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionBId,
      reference: "G3",
      plan: "starter",
      cycle: "monthly",
    });
    expect(foreignIntent.ok).toBe(true);

    const foreign = await get(fx.ownerAId, foreignIntent.payment_id as string);
    const missing = await get(fx.ownerAId, crypto.randomUUID());
    expect(foreign.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing));
    expect(String(foreign.error)).toBe("payment_not_found");
    expect(String(missing.error)).toBe("payment_not_found");
  });

  it("G5/G6 anon is denied at the grant layer; staff/manager/viewer get payment_not_found", async () => {
    await resetSubA("starter", "month");
    const created = await intent(internal(), { reference: "G5", plan: "starter", cycle: "monthly" });
    const paymentId = created.payment_id as string;

    await expectDenied("anon get", async () => {
      await exec.exec("BEGIN");
      await exec.exec("SET LOCAL ROLE anon");
      try {
        await exec.query(`SELECT public.subscription_payment_get($1)`, [paymentId]);
      } finally {
        await exec.exec("ROLLBACK");
      }
    });

    for (const [label, userId] of [
      ["org staff", fx.cashierAId],
      ["shop manager", managerUser],
      ["shop viewer", viewerUser],
    ] as const) {
      const r = await get(userId, paymentId);
      expect(r.ok, label).toBe(false);
      expect(String(r.error), label).toBe("payment_not_found"); // never 'forbidden' for own-org
    }
  });

  it("G7 internal staff, org admin and org billing can get their org's payment", async () => {
    await resetSubA("starter", "month");
    const created = await intent(internal(), { reference: "G7", plan: "starter", cycle: "monthly" });
    const paymentId = created.payment_id as string;

    for (const [label, userId] of [
      ["internal", fx.internalAdminId],
      ["org admin", adminUser],
      ["org billing", billingUser],
    ] as const) {
      const r = await get(userId, paymentId);
      expect(r.ok, label).toBe(true);
      expect(r.payment_id).toBe(paymentId);
    }
  });

  // ========================================================================
  // 3. HISTORY
  // ========================================================================

  it("H1 history is shop-scoped and ordered newest first", async () => {
    await resetSubA("starter", "month");
    const r1 = await intent(internal(), { reference: "H1a", plan: "starter", cycle: "monthly" });
    const r2 = await intent(internal(), { reference: "H1b", plan: "business", cycle: "monthly" });
    const r3 = await intent(internal(), { reference: "H1c", plan: "waka_plus", cycle: "monthly" });
    const foreign = await intent(internal(), {
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionBId,
      reference: "H1f",
      plan: "starter",
      cycle: "monthly",
    });
    expect(r1.ok && r2.ok && r3.ok && foreign.ok).toBe(true);

    const h = await history(fx.ownerAId, fx.shopAId);
    expect(h.ok).toBe(true);
    const payments = h.payments as Array<Record<string, unknown>>;
    expect(payments.length).toBe(3); // foreign org's payment never appears
    expect(payments.map((p) => p.payment_id)).toEqual([
      r3.payment_id,
      r2.payment_id,
      r1.payment_id,
    ]);
    expect(h.next_cursor).toBeNull();

    // Redaction on every returned row.
    for (const row of payments) {
      expect(safeKeys(row)).toEqual([...SAFE_PAYMENT_KEYS].sort());
      expect(row).not.toHaveProperty("note");
      expect(row).not.toHaveProperty("metadata");
      expect(row).not.toHaveProperty("recorded_by");
    }
  });

  it("H2 limit is honored and clamped to 1..100", async () => {
    // H1's three payments are still present for shopA.
    const page = await history(fx.ownerAId, fx.shopAId, { limit: 2 });
    expect((page.payments as unknown[]).length).toBe(2);
    expect(page.next_cursor).toBeTruthy();

    const clampedLow = await history(fx.ownerAId, fx.shopAId, { limit: 0 });
    expect((clampedLow.payments as unknown[]).length).toBe(1); // floor at 1
    expect(clampedLow.next_cursor).toBeTruthy();

    const clampedHigh = await history(fx.ownerAId, fx.shopAId, { limit: 999 });
    expect((clampedHigh.payments as unknown[]).length).toBe(3); // ceil at 100, only 3 exist
    expect(clampedHigh.next_cursor).toBeNull();

    const byDefault = await history(fx.ownerAId, fx.shopAId); // server default 10
    expect((byDefault.payments as unknown[]).length).toBe(3);
  });

  it("H3 keyset pagination walks the list without overlap", async () => {
    const page1 = await history(fx.ownerAId, fx.shopAId, { limit: 2 });
    const ids1 = (page1.payments as Array<Record<string, unknown>>).map((p) => p.payment_id);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await history(fx.ownerAId, fx.shopAId, {
      limit: 2,
      before: page1.next_cursor as string,
    });
    const ids2 = (page2.payments as Array<Record<string, unknown>>).map((p) => p.payment_id);
    expect(ids2.length).toBe(1);
    expect(page2.next_cursor).toBeNull();
    expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
  });

  it("H4 history of a shop with no payments is a safe empty result", async () => {
    const h = await history(ownerC, shopC);
    expect(h.ok).toBe(true);
    expect(h.payments).toEqual([]);
    expect(h.next_cursor).toBeNull();
  });

  it("H5 org-level manual payment (shop_id null) appears under the shop history", async () => {
    await resetSubA("starter", "month");
    await exec.exec(`UPDATE public.subscriptions SET shop_id = NULL WHERE id = '${fx.subscriptionAId}'`);
    try {
      await asUser(exec, internal(), async () => {
        await exec.query(`SELECT public.admin_subscription_mark_payment($1::uuid, $2::bigint, $3::text)`, [
          fx.subscriptionAId,
          18_000,
          "manual org-level",
        ]);
      });
      const h = await history(fx.ownerAId, fx.shopAId);
      const payments = h.payments as Array<Record<string, unknown>>;
      expect(payments.length).toBe(1);
      expect(payments[0]!.shop_id).toBeNull();
      expect(safeKeys(payments[0]!)).toEqual([...SAFE_PAYMENT_KEYS].sort());
    } finally {
      await exec.exec(
        `UPDATE public.subscriptions SET shop_id = '${fx.shopAId}' WHERE id = '${fx.subscriptionAId}'`,
      );
    }
  });

  it("H6 foreign shop is forbidden, unknown shop is not_found", async () => {
    const foreign = await history(fx.ownerAId, fx.shopBId);
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toBe("forbidden");

    const unknown = await history(fx.ownerAId, crypto.randomUUID());
    expect(unknown.ok).toBe(false);
    expect(String(unknown.error)).toBe("shop_not_found");
  });

  // ========================================================================
  // 4. AUTHORIZATION (history) + CARRY-FORWARDS
  // ========================================================================

  it("A-History authorization matrix mirrors the quote matrix", async () => {
    await resetSubA("starter", "month");
    await intent(internal(), { reference: "AH", plan: "starter", cycle: "monthly" });

    for (const [label, userId] of [
      ["owner", fx.ownerAId],
      ["org admin", adminUser],
      ["org billing", billingUser],
      ["internal", fx.internalAdminId],
    ] as const) {
      const h = await history(userId, fx.shopAId);
      expect(h.ok, label).toBe(true);
      expect((h.payments as unknown[]).length, label).toBe(1);
    }

    for (const [label, userId] of [
      ["org staff", fx.cashierAId],
      ["shop manager", managerUser],
      ["shop viewer", viewerUser],
    ] as const) {
      const h = await history(userId, fx.shopAId);
      expect(h.ok, label).toBe(false);
      expect(String(h.error), label).toBe("forbidden");
    }
  });

  it("CF1 M2 direct subscription DML is still blocked", async () => {
    await resetSubA("starter", "month");
    await expectDenied("owner UPDATE subscriptions", () =>
      asUser(exec, fx.ownerAId, () =>
        exec.query(`UPDATE public.subscriptions SET payment_status = 'paid' WHERE id = $1`, [
          fx.subscriptionAId,
        ]),
      ),
    );
  });

  it("CF2 a customer still cannot confirm a payment", async () => {
    await resetSubA("starter", "month");
    const created = await intent(fx.ownerAId, { reference: "CF2", plan: "starter", cycle: "monthly" });
    expect(created.ok).toBe(true);
    const r = await get(fx.ownerAId, created.payment_id as string);
    expect(r.status).toBe("pending");

    const confirmAttempt = await rpc(fx.ownerAId, "subscription_payment_confirm", [
      created.payment_id,
      null,
      null,
    ]);
    expect(confirmAttempt.ok).toBe(false);
    expect(String(confirmAttempt.error)).toBe("forbidden");
    const after = await get(fx.ownerAId, created.payment_id as string);
    expect(after.status).toBe("pending"); // untouched
  });

  // Two-session concurrency is NOT claimed here (PGlite/single session).
  // The genuine suite is subscriptionPaymentConcurrency.sql.integration.test.ts,
  // which FAILS LOUDLY without TEST_DATABASE_URL instead of passing as a no-op.
});
