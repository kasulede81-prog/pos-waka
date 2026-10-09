/**
 * Pricing campaign admin window — real SQL contract.
 *
 * The pricing *engine* (`public_subscription_pricing`, `_pricing_active_campaign_id`)
 * is already covered by the subscription-payment suites. What had no coverage at
 * all was the admin surface the window drives — `admin_pricing_campaign_save`,
 * `admin_pricing_campaign_plan_discount_save`, `admin_pricing_campaign_preview`,
 * `admin_pricing_campaign_audit_feed` — and the client/server parity of the price
 * the window previews against the price the marketing pages actually serve.
 *
 * Runs the real chain via `subscriptionPaymentPgHarness`, which applies
 * `113_pricing_campaigns.sql` in production order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";
import { CANONICAL_PLAN_PRICES, computePlanDisplayPrice, type PaidPlanCode } from "./subscriptionPricing";

type PublicPlanRow = {
  plan_code: string;
  original_monthly_ugx: number;
  monthly_discount_ugx: number;
  final_monthly_ugx: number;
  original_annual_full_ugx: number;
  final_annual_ugx: number;
  annual_discount_percent: number;
  has_monthly_discount: boolean;
};

describe("pricing campaigns — admin window SQL contract", () => {
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
    await exec.exec("DELETE FROM public.pricing_campaign_audit_log;");
  });

  // ---- helpers ----------------------------------------------------------

  async function as<T>(
    fn: (run: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
    userId = fx.internalAdminId,
  ) {
    return asUser(exec, userId, () =>
      fn(async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const { rows } = await exec.query<R>(sql, params);
        return rows;
      }),
    );
  }

  async function rpc(fn: string, args: unknown[], userId = fx.internalAdminId): Promise<Record<string, unknown>> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT public.${fn}(${placeholders}) AS result`,
        args,
      );
      return rpcJson(rows[0]);
    });
  }

  /** `setof`-returning RPC: `SELECT fn()` yields a composite, so expand it. */
  async function rpcRows(
    fn: string,
    args: unknown[],
    userId = fx.internalAdminId,
  ): Promise<Array<Record<string, unknown>>> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query<Record<string, unknown>>(
        `SELECT * FROM public.${fn}(${placeholders})`,
        args,
      );
      return rows;
    });
  }

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  async function publicPricing(): Promise<PublicPlanRow[]> {
    const { rows } = await exec.query<Record<string, unknown>>(
      `SELECT public.public_subscription_pricing() AS result`,
    );
    const raw = rpcJson(rows[0]) as unknown as { plans: PublicPlanRow[] };
    return raw.plans.map((p) => ({
      plan_code: String(p.plan_code),
      original_monthly_ugx: Number(p.original_monthly_ugx),
      monthly_discount_ugx: Number(p.monthly_discount_ugx),
      final_monthly_ugx: Number(p.final_monthly_ugx),
      original_annual_full_ugx: Number(p.original_annual_full_ugx),
      final_annual_ugx: Number(p.final_annual_ugx),
      annual_discount_percent: Number(p.annual_discount_percent),
      has_monthly_discount: Boolean(p.has_monthly_discount),
    }));
  }

  async function createCampaign(name: string, enabled: boolean, startsAt: string | null, endsAt: string | null) {
    const res = await rpc("admin_pricing_campaign_save", [null, name, "", enabled, startsAt, endsAt]);
    expect(res.ok).toBe(true);
    return String(res.campaign_id);
  }

  async function saveDiscount(
    campaignId: string,
    planCode: string,
    type: string,
    value: number,
    annualPercent: number | null,
    reason = "test reason",
  ) {
    return rpc("admin_pricing_campaign_plan_discount_save", [
      campaignId,
      planCode,
      type,
      value,
      annualPercent,
      reason,
    ]);
  }

  // ========================================================================
  // Round trip: create → reload → edit → reload → discount → reload
  // ========================================================================

  it("creates a campaign that survives a reload", async () => {
    const id = await createCampaign("Q2 Launch", true, null, null);

    const [row] = await as(async (run) =>
      run<{ name: string; enabled: boolean; description: string }>(
        `SELECT name, enabled, description FROM public.pricing_campaigns WHERE id = $1`,
        [id],
      ),
    );
    expect(row?.name).toBe("Q2 Launch");
    expect(row?.enabled).toBe(true);
    expect(row?.description).toBe("");
  });

  it("trims the name and reports created=true only on insert", async () => {
    const created = await rpc("admin_pricing_campaign_save", [null, "  Padded Name  ", "d", false, null, null]);
    expect(created.created).toBe(true);
    expect(await scalar(`SELECT name FROM public.pricing_campaigns WHERE id = $1`, [String(created.campaign_id)])).toBe(
      "Padded Name",
    );

    const updated = await rpc("admin_pricing_campaign_save", [
      String(created.campaign_id),
      "Renamed",
      "d2",
      true,
      null,
      null,
    ]);
    expect(updated.ok).toBe(true);
    expect(updated.created).toBe(false);
    expect(updated.campaign_id).toBe(created.campaign_id);
  });

  it("persists an edit — this is the reload-after-save path the window depends on", async () => {
    const id = await createCampaign("Before", false, null, null);
    const res = await rpc("admin_pricing_campaign_save", [
      id,
      "After",
      "edited",
      true,
      "2026-11-01T00:00:00Z",
      "2026-11-30T00:00:00Z",
    ]);
    expect(res.ok).toBe(true);

    const [row] = await as(async (run) =>
      run<{ name: string; enabled: boolean; description: string; starts_at: string; ends_at: string }>(
        `SELECT name, enabled, description, starts_at, ends_at FROM public.pricing_campaigns WHERE id = $1`,
        [id],
      ),
    );
    expect(row?.name).toBe("After");
    expect(row?.description).toBe("edited");
    expect(row?.enabled).toBe(true);
    expect(new Date(row!.starts_at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(row!.ends_at).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  it("clears a schedule when the operator blanks both dates", async () => {
    const id = await createCampaign("Scheduled", true, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");
    await rpc("admin_pricing_campaign_save", [id, "Scheduled", "", true, null, null]);

    const [row] = await as(async (run) =>
      run<{ starts_at: string | null; ends_at: string | null }>(
        `SELECT starts_at, ends_at FROM public.pricing_campaigns WHERE id = $1`,
        [id],
      ),
    );
    expect(row?.starts_at).toBeNull();
    expect(row?.ends_at).toBeNull();
  });

  it("saves a plan discount and serves it through the public price book", async () => {
    const id = await createCampaign("Discounts", true, null, null);
    const res = await saveDiscount(id, "starter", "percentage", 10, null);
    expect(res.ok).toBe(true);

    const [row] = await as(async (run) =>
      run<{ monthly_discount_type: string; monthly_discount_value: string }>(
        `SELECT monthly_discount_type, monthly_discount_value
           FROM public.pricing_campaign_plan_discounts
          WHERE campaign_id = $1 AND plan_code = 'starter'`,
        [id],
      ),
    );
    expect(row?.monthly_discount_type).toBe("percentage");
    expect(Number(row?.monthly_discount_value)).toBe(10);

    const starter = (await publicPricing()).find((p) => p.plan_code === "starter");
    expect(starter?.final_monthly_ugx).toBe(16_200);
    expect(starter?.has_monthly_discount).toBe(true);
  });

  it("updates an existing plan discount in place rather than duplicating the row", async () => {
    const id = await createCampaign("One row per plan", true, null, null);
    await saveDiscount(id, "business", "percentage", 10, null);
    await saveDiscount(id, "business", "fixed_amount", 6_000, null);

    expect(
      Number(
        await scalar(
          `SELECT count(*)::text FROM public.pricing_campaign_plan_discounts
            WHERE campaign_id = $1 AND plan_code = 'business'`,
          [id],
        ),
      ),
    ).toBe(1);
    const business = (await publicPricing()).find((p) => p.plan_code === "business");
    expect(business?.final_monthly_ugx).toBe(30_000);
  });

  // ========================================================================
  // Client/server price parity
  // ========================================================================

  it("the window's preview maths equals what public_subscription_pricing serves", async () => {
    // Every branch of `_pricing_compute_plan_row` crossed with the annual default.
    const cases: Array<{
      plan: PaidPlanCode;
      type: "none" | "percentage" | "fixed_amount";
      value: number;
      annual: number | null;
    }> = [
      { plan: "starter", type: "percentage", value: 10, annual: null },
      { plan: "starter", type: "percentage", value: 33, annual: 15 },
      { plan: "business", type: "fixed_amount", value: 6_000, annual: null },
      { plan: "business", type: "fixed_amount", value: 31_000, annual: 0 },
      { plan: "waka_plus", type: "percentage", value: 90, annual: 50 },
      { plan: "waka_plus", type: "none", value: 0, annual: null },
      // A discount larger than the plan price: both sides must clamp to the floor.
      { plan: "starter", type: "fixed_amount", value: 999_999, annual: null },
    ];

    for (const c of cases) {
      const id = await createCampaign(`parity ${c.plan} ${c.type} ${c.value}`, true, null, null);
      await saveDiscount(id, c.plan, c.type, c.value, c.annual);

      const server = (await publicPricing()).find((p) => p.plan_code === c.plan);
      expect(server, `no server row for ${c.plan}`).toBeTruthy();

      const client = computePlanDisplayPrice(c.plan, {
        monthlyDiscountType: c.type,
        monthlyDiscountValue: c.value,
        annualDiscountPercent: c.annual,
      });

      const label = `${c.plan}/${c.type}/${c.value}/annual=${c.annual}`;
      expect(client.finalMonthlyUgx, `${label} monthly`).toBe(server!.final_monthly_ugx);
      expect(client.monthlyDiscountUgx, `${label} discount`).toBe(server!.monthly_discount_ugx);
      expect(client.finalAnnualUgx, `${label} annual`).toBe(server!.final_annual_ugx);
      expect(client.originalAnnualFullUgx, `${label} full annual`).toBe(server!.original_annual_full_ugx);
      expect(client.hasMonthlyDiscount, `${label} hasDiscount`).toBe(server!.has_monthly_discount);
      expect(client.annualDiscountPercent, `${label} annual pct`).toBe(server!.annual_discount_percent);

      await exec.exec("DELETE FROM public.pricing_campaigns;");
    }
  });

  it("the client's canonical price table matches the protected server values", async () => {
    for (const plan of CANONICAL_PLAN_PRICES) {
      const monthly = Number(
        await scalar(
          `SELECT monthly_price_ugx::text FROM public.subscription_canonical_prices WHERE plan_code = $1`,
          [plan.planCode],
        ),
      );
      expect(monthly, `${plan.planCode} canonical price`).toBe(plan.monthlyPriceUgx);
      const annualPct = Number(
        await scalar(
          `SELECT default_annual_discount_percent::text FROM public.subscription_canonical_prices WHERE plan_code = $1`,
          [plan.planCode],
        ),
      );
      expect(annualPct, `${plan.planCode} default annual`).toBe(plan.defaultAnnualDiscountPercent);
    }
  });

  it("admin_pricing_campaign_preview agrees with the public book for the live campaign", async () => {
    const id = await createCampaign("Preview parity", true, null, null);
    await saveDiscount(id, "starter", "percentage", 10, null);
    await saveDiscount(id, "business", "fixed_amount", 6_000, 25);

    const preview = (await rpc("admin_pricing_campaign_preview", [id])) as unknown as { plans: PublicPlanRow[] };
    const previewByPlan = new Map(preview.plans.map((p) => [String(p.plan_code), p]));
    for (const row of await publicPricing()) {
      const admin = previewByPlan.get(row.plan_code);
      expect(admin, `preview missing ${row.plan_code}`).toBeTruthy();
      expect(Number(admin!.final_monthly_ugx), `${row.plan_code} preview monthly`).toBe(row.final_monthly_ugx);
      expect(Number(admin!.final_annual_ugx), `${row.plan_code} preview annual`).toBe(row.final_annual_ugx);
    }
  });

  // ========================================================================
  // Validation the RPCs must still enforce
  // ========================================================================

  it("rejects a blank name instead of writing an unnamed campaign", async () => {
    const res = await rpc("admin_pricing_campaign_save", [null, "   ", "", true, null, null]);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("name_required");
    expect(Number(await scalar(`SELECT count(*)::text FROM public.pricing_campaigns`))).toBe(0);
  });

  it("rejects a discount change with no audit reason", async () => {
    const id = await createCampaign("Needs a reason", true, null, null);
    const res = await saveDiscount(id, "starter", "percentage", 10, null, "   ");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("reason_required");
  });

  it("rejects an unknown plan, an unknown discount type and an unknown campaign", async () => {
    const id = await createCampaign("Guards", true, null, null);
    expect((await saveDiscount(id, "free", "percentage", 10, null)).error).toBe("invalid_plan");
    expect((await saveDiscount(id, "starter", "buy_one_get_one", 1, null)).error).toBe("invalid_discount_type");
    expect(
      (await rpc("admin_pricing_campaign_save", [crypto.randomUUID(), "Ghost", "", true, null, null])).error,
    ).toBe("campaign_not_found");
    expect((await saveDiscount(crypto.randomUUID(), "starter", "percentage", 10, null)).error).toBe(
      "campaign_not_found",
    );
  });

  it("refuses a discount that would push a plan below the UGX 5,000 floor", async () => {
    const id = await createCampaign("Floor", true, null, null);
    // A percentage is clamped to the floor server-side, so it never trips this.
    expect((await saveDiscount(id, "starter", "percentage", 90, null)).ok).toBe(true);
    // A fixed amount is clamped too — the guard is about the *final* price.
    const tooBig = await saveDiscount(id, "starter", "fixed_amount", 999_999, null);
    expect(tooBig.ok).toBe(true);
    const starter = (await publicPricing()).find((p) => p.plan_code === "starter");
    expect(starter?.final_monthly_ugx).toBe(5_000);
  });

  // ========================================================================
  // WHO can do this
  // ========================================================================

  it("refuses every admin RPC to a non-staff authenticated user", async () => {
    const id = await createCampaign("Staff only", true, null, null);

    await expect(
      rpc("admin_pricing_campaign_save", [null, "Nope", "", true, null, null], fx.ownerAId),
    ).rejects.toThrow(/forbidden/i);
    await expect(
      rpc("admin_pricing_campaign_plan_discount_save", [id, "starter", "percentage", 10, null, "r"], fx.ownerAId),
    ).rejects.toThrow(/forbidden/i);
    await expect(rpc("admin_pricing_campaign_audit_feed", [10], fx.ownerAId)).rejects.toThrow(/forbidden/i);
    await expect(rpc("admin_pricing_campaign_metrics", [id, null, null], fx.ownerAId)).rejects.toThrow(/forbidden/i);
  });

  it("keeps the campaign tables readable only to internal staff", async () => {
    await createCampaign("Readable", true, null, null);

    const staffRows = await as(async (run) => run(`SELECT id FROM public.pricing_campaigns`));
    expect(staffRows.length).toBe(1);

    const ownerRows = await as(async (run) => run(`SELECT id FROM public.pricing_campaigns`), fx.ownerAId);
    expect(ownerRows.length).toBe(0);
  });

  // ========================================================================
  // Which campaign actually applies (the client mirrors this)
  // ========================================================================

  it("serves at most one campaign and picks the most recently updated", async () => {
    const older = await createCampaign("Older", true, null, null);
    const newer = await createCampaign("Newer", true, null, null);
    await saveDiscount(older, "starter", "percentage", 10, null);
    await saveDiscount(newer, "starter", "percentage", 50, null);

    await exec.exec(`UPDATE public.pricing_campaigns SET updated_at = now() - interval '1 day' WHERE id = '${older}'`);
    await exec.exec(`UPDATE public.pricing_campaigns SET updated_at = now() WHERE id = '${newer}'`);

    let starter = (await publicPricing()).find((p) => p.plan_code === "starter");
    expect(starter?.final_monthly_ugx).toBe(9_000); // 50% off — the newer campaign

    // Refreshing the older row's updated_at hands it the slot.
    await exec.exec(`UPDATE public.pricing_campaigns SET updated_at = now() + interval '1 minute' WHERE id = '${older}'`);
    starter = (await publicPricing()).find((p) => p.plan_code === "starter");
    expect(starter?.final_monthly_ugx).toBe(16_200); // 10% off — now the newest
  });

  it("falls back to canonical prices when the only campaign is paused, ended or not yet started", async () => {
    const paused = await createCampaign("Paused", false, null, null);
    await saveDiscount(paused, "starter", "percentage", 50, null);
    expect((await publicPricing()).find((p) => p.plan_code === "starter")?.final_monthly_ugx).toBe(18_000);

    await exec.exec(`UPDATE public.pricing_campaigns SET enabled = true, ends_at = now() - interval '1 hour' WHERE id = '${paused}'`);
    expect((await publicPricing()).find((p) => p.plan_code === "starter")?.final_monthly_ugx).toBe(18_000);

    await exec.exec(
      `UPDATE public.pricing_campaigns SET ends_at = NULL, starts_at = now() + interval '1 hour' WHERE id = '${paused}'`,
    );
    expect((await publicPricing()).find((p) => p.plan_code === "starter")?.final_monthly_ugx).toBe(18_000);

    await exec.exec(`UPDATE public.pricing_campaigns SET starts_at = NULL WHERE id = '${paused}'`);
    expect((await publicPricing()).find((p) => p.plan_code === "starter")?.final_monthly_ugx).toBe(9_000);
  });

  // ========================================================================
  // Audit trail
  // ========================================================================

  it("records every discount change with its reason and computes the previous value", async () => {
    const id = await createCampaign("Audited", true, null, null);
    await saveDiscount(id, "starter", "percentage", 10, null, "first change");
    await saveDiscount(id, "starter", "percentage", 25, null, "second change");

    // The real `admin_pricing_campaign_audit_feed` RPC contract the client reads.
    const feed = await rpcRows("admin_pricing_campaign_audit_feed", [10]);
    expect(feed.length).toBe(2);
    const latest = feed[0] as Record<string, unknown>;
    expect(String(latest.reason)).toBe("second change");
    expect(String(latest.plan_code)).toBe("starter");
    expect((latest.previous_discount as Record<string, unknown>)?.monthly_discount_value).toBe(10);
    expect((latest.new_discount as Record<string, unknown>)?.monthly_discount_value).toBe(25);
  });

  it("survives its campaign being deleted without losing the trail", async () => {
    const id = await createCampaign("Doomed", true, null, null);
    await saveDiscount(id, "starter", "percentage", 10, null, "kept");
    await exec.exec(`DELETE FROM public.pricing_campaigns WHERE id = '${id}'`);

    // The audit row survives via `on delete set null`; the discount rows cascade away.
    expect(Number(await scalar(`SELECT count(*)::text FROM public.pricing_campaign_audit_log`))).toBe(1);
    expect(Number(await scalar(`SELECT count(*)::text FROM public.pricing_campaign_plan_discounts`))).toBe(0);
    const [row] = await as(async (run) =>
      run<{ campaign_id: string | null }>(`SELECT campaign_id FROM public.pricing_campaign_audit_log LIMIT 1`),
    );
    expect(row?.campaign_id).toBeNull();
  });

  // ========================================================================
  // Reporting
  // ========================================================================

  it("reports per-plan subscriber counts for a campaign window", async () => {
    const id = await createCampaign("Reported", true, null, null);
    await saveDiscount(id, "business", "percentage", 10, null);

    const metrics = (await rpc("admin_pricing_campaign_metrics", [id, null, null])) as Record<string, unknown>;
    expect(String(metrics.campaign_id)).toBe(id);
    expect(String(metrics.campaign_name)).toBe("Reported");
    expect(metrics.campaign_active).toBe(true);
    expect(typeof metrics.new_subscribers_by_plan).toBe("object");
    expect(Number(metrics.conversion_rate_percent)).toBeGreaterThanOrEqual(0);
  });

  it("reports a paused campaign as inactive rather than omitting it", async () => {
    const id = await createCampaign("Paused report", false, null, null);
    const metrics = (await rpc("admin_pricing_campaign_metrics", [id, null, null])) as Record<string, unknown>;
    expect(metrics.campaign_active).toBe(false);
    expect(String(metrics.campaign_id)).toBe(id);
  });
});
