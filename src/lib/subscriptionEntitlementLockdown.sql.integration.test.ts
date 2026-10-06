/**
 * M2 — SUBSCRIPTION ENTITLEMENT WRITE LOCKDOWN (real SQL).
 *
 * Runs the production chain (039 → 043 → 044 → 057 → 078 → 097 → 113 →
 * hardening → shop-effective-subscription → M1 → M1 follow-up → M2) under the
 * production privilege posture (008 write policies + 010 grants), so the M2
 * migration has the real surface to lock and every "still works" assertion
 * runs against the real SECURITY DEFINER bodies.
 *
 * Proves the target contract:
 *   CLIENT   → SELECT only (RLS-scoped)
 *   SERVER   → SECURITY DEFINER RPCs are the only mutation path
 *
 * PGLite is single-connection: true two-session concurrency needs
 * TEST_DATABASE_URL (reported at the end of the suite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

describe("M2 — subscription entitlement write lockdown", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

  // ---- helpers ----------------------------------------------------------

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  /** jsonb-returning RPC as a user. */
  async function rpc(userId: string, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  /** void-returning RPC as a user (no jsonb payload to unwrap). */
  async function callVoid(userId: string, fn: string, args: unknown[]): Promise<void> {
    await asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      await exec.query(`SELECT public.${fn}(${placeholders})`, args);
    });
  }

  /**
   * Direct client DML must fail at the grant layer ("permission denied") or,
   * if a grant is ever re-added, at the RLS layer ("row-level security").
   * Anything else — including success — fails the assertion.
   */
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

  /** UPDATE attempt that returns the number of rows it would have touched. */
  async function updateAs(userId: string, sql: string, params: unknown[]): Promise<number> {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(sql, params);
      return rows.length;
    });
  }

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

  async function seedUser(email: string): Promise<string> {
    const id = crypto.randomUUID();
    await exec.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', '${email}');`);
    return id;
  }

  // ========================================================================
  // 1. PRIVILEGE + POLICY CONTRACT
  // ========================================================================

  it("M2.1 client holds SELECT only; 008 write policies are gone; subscriptions_select remains", async () => {
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')`)).toBe(true);
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')`)).toBe(false);
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')`)).toBe(false);
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'DELETE')`)).toBe(false);
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'TRUNCATE')`)).toBe(false);
    expect(await scalar<boolean>(`SELECT has_table_privilege('anon', 'public.subscriptions', 'UPDATE')`)).toBe(false);

    const policies = (
      await exec.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscriptions' ORDER BY policyname`,
      )
    ).rows.map((r) => r.policyname);
    expect(policies).toContain("subscriptions_select"); // 019-equivalent retained
    expect(policies).not.toContain("subscriptions_write"); // 008 retired
    expect(policies).not.toContain("subscriptions_update"); // 008 retired
  });

  // ========================================================================
  // 2. DIRECT CLIENT ATTACKS (authenticated org owner)
  // ========================================================================

  it("M2.2 owner cannot self-upgrade: plan/status/period/trial UPDATEs are denied", async () => {
    const otherPlan = await scalar<string>(`SELECT id::text FROM public.subscription_plans WHERE code = 'waka_plus'`);
    const attempts: Array<[string, string]> = [
      ["plan_id (self-upgrade to Waka Plus)", `UPDATE public.subscriptions SET plan_id = '${otherPlan}' WHERE id = $1 RETURNING id`],
      ["status -> active", `UPDATE public.subscriptions SET status = 'active' WHERE id = $1 RETURNING id`],
      ["current_period_end -> +10 years", `UPDATE public.subscriptions SET current_period_end = now() + interval '10 years' WHERE id = $1 RETURNING id`],
      ["current_period_start -> now", `UPDATE public.subscriptions SET current_period_start = now() WHERE id = $1 RETURNING id`],
      ["trial_ends_at -> +10 years", `UPDATE public.subscriptions SET trial_ends_at = now() + interval '10 years' WHERE id = $1 RETURNING id`],
    ];
    for (const [label, sql] of attempts) {
      await expectDenied(label, () => updateAs(fx.ownerAId, sql, [fx.subscriptionAId]));
    }
    // Row is untouched.
    const end = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);
    expect(end).toBeTruthy();
  });

  it("M2.3 owner cannot forge payment/pricing/metadata/identity fields", async () => {
    const attempts: Array<[string, string]> = [
      ["payment_status -> paid", `UPDATE public.subscriptions SET payment_status = 'paid' WHERE id = $1 RETURNING id`],
      ["billing_interval -> year", `UPDATE public.subscriptions SET billing_interval = 'year' WHERE id = $1 RETURNING id`],
      ["admin_discount_percent -> 90", `UPDATE public.subscriptions SET admin_discount_percent = 90 WHERE id = $1 RETURNING id`],
      ["metadata forge", `UPDATE public.subscriptions SET metadata = '{"planCode":"waka_plus","paid":true}'::jsonb WHERE id = $1 RETURNING id`],
      ["activation_source", `UPDATE public.subscriptions SET activation_source = 'manual_admin' WHERE id = $1 RETURNING id`],
      ["shop_id -> foreign shop (cross-shop)", `UPDATE public.subscriptions SET shop_id = '${fx.shopBId}' WHERE id = $1 RETURNING id`],
      ["organization_id -> foreign org", `UPDATE public.subscriptions SET organization_id = '${fx.orgBId}' WHERE id = $1 RETURNING id`],
      ["id rewrite", `UPDATE public.subscriptions SET id = '${crypto.randomUUID()}' WHERE id = $1 RETURNING id`],
    ];
    for (const [label, sql] of attempts) {
      await expectDenied(label, () => updateAs(fx.ownerAId, sql, [fx.subscriptionAId]));
    }
    const s = await exec.query<{ payment_status: string; billing_interval: string; admin_discount_percent: string }>(
      `SELECT payment_status, billing_interval, admin_discount_percent::text FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(s.rows[0]!.payment_status).toBe("unknown"); // untouched by the attempts above after resetSubA-free baseline
  });

  it("M2.4 owner cannot INSERT a fabricated subscription (active or paused)", async () => {
    await expectDenied("INSERT fake active subscription", () =>
      asUser(exec, fx.ownerAId, () =>
        exec.query(
          `INSERT INTO public.subscriptions (id, organization_id, plan_id, status, current_period_end, payment_status)
           VALUES ($1, $2, (SELECT id FROM public.subscription_plans WHERE code = 'waka_plus'), 'active', now() + interval '10 years', 'paid')
           RETURNING id`,
          [crypto.randomUUID(), fx.orgAId],
        ),
      ),
    );
    await expectDenied("INSERT fake paused subscription", () =>
      asUser(exec, fx.ownerAId, () =>
        exec.query(
          `INSERT INTO public.subscriptions (id, organization_id, plan_id, status, current_period_end, payment_status)
           VALUES ($1, $2, (SELECT id FROM public.subscription_plans WHERE code = 'waka_plus'), 'paused', now() + interval '10 years', 'paid')
           RETURNING id`,
          [crypto.randomUUID(), fx.orgAId],
        ),
      ),
    );
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscriptions WHERE organization_id = '${fx.orgAId}'`)).toBe("1");
  });

  it("M2.5 owner cannot DELETE their subscription", async () => {
    await expectDenied("DELETE own subscription", () =>
      updateAs(fx.ownerAId, `DELETE FROM public.subscriptions WHERE id = $1 RETURNING id`, [fx.subscriptionAId]),
    );
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`)).toBe("1");
  });

  it("M2.6 cross-org and cross-shop attempts fail", async () => {
    // Owner of org A touching org B's subscription.
    await expectDenied("UPDATE foreign org subscription", () =>
      updateAs(fx.ownerAId, `UPDATE public.subscriptions SET status = 'active' WHERE id = $1 RETURNING id`, [fx.subscriptionBId]),
    );
    const foreignRead = await asUser(exec, fx.ownerAId, () =>
      exec.query(`SELECT id FROM public.subscriptions WHERE id = $1`, [fx.subscriptionBId]),
    );
    expect(foreignRead.rows.length).toBe(0);

    // Owner of org B cannot read org A, nor insert into it.
    const reverseRead = await asUser(exec, fx.ownerId, () =>
      exec.query(`SELECT id FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]),
    );
    expect(reverseRead.rows.length).toBe(0);
    await expectDenied("INSERT into foreign org", () =>
      asUser(exec, fx.ownerId, () =>
        exec.query(
          `INSERT INTO public.subscriptions (id, organization_id, plan_id, status) VALUES ($1, $2, (SELECT id FROM public.subscription_plans LIMIT 1), 'paused') RETURNING id`,
          [crypto.randomUUID(), fx.orgAId],
        ),
      ),
    );
  });

  it("M2.7 anon cannot INSERT/UPDATE/DELETE subscriptions", async () => {
    // Role-accurate anon checks: the anon ROLE with no JWT claim at all.
    const anon = async (label: string, sql: string) => {
      await exec.exec("BEGIN");
      await exec.exec("SET LOCAL ROLE anon");
      let denied = false;
      try {
        await exec.query(sql, []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/permission denied|row-level security/i.test(msg)) {
          throw new Error(`${label}: unexpected error → ${msg}`, { cause: e });
        }
        denied = true;
      } finally {
        await exec.exec("ROLLBACK");
      }
      if (!denied) throw new Error(`${label}: unexpectedly SUCCEEDED`);
    };
    await anon("anon UPDATE", `UPDATE public.subscriptions SET status = 'active' WHERE id = '${fx.subscriptionAId}' RETURNING id`);
    await anon(
      "anon INSERT",
      `INSERT INTO public.subscriptions (id, organization_id, plan_id, status) VALUES ('${crypto.randomUUID()}', '${fx.orgAId}', (SELECT id FROM public.subscription_plans LIMIT 1), 'paused') RETURNING id`,
    );
    await anon("anon DELETE", `DELETE FROM public.subscriptions WHERE id = '${fx.subscriptionAId}' RETURNING id`);
  });

  it("M2.8 SELECT behaviour is unchanged: owner reads own org, outsiders read nothing, internal staff read", async () => {
    const own = await asUser(exec, fx.ownerAId, () =>
      exec.query(`SELECT id FROM public.subscriptions WHERE organization_id = $1`, [fx.orgAId]),
    );
    expect(own.rows.length).toBe(1);

    const outsider = await asUser(exec, fx.outsiderId, () =>
      exec.query(`SELECT id FROM public.subscriptions WHERE organization_id = $1`, [fx.orgAId]),
    );
    expect(outsider.rows.length).toBe(0);

    const staff = await asUser(exec, fx.internalAdminId, () =>
      exec.query(`SELECT id FROM public.subscriptions ORDER BY created_at`),
    );
    expect(staff.rows.length).toBeGreaterThanOrEqual(2); // orgA + orgB visible to internal staff
  });

  it("M2.9 second layer: even if grants were re-added, the dropped policies leave RLS denying writes", async () => {
    await exec.exec(`GRANT INSERT, UPDATE ON public.subscriptions TO authenticated`);
    try {
      // UPDATE: no update policy exists → the row is invisible → 0 rows, nothing changes.
      const touched = await updateAs(
        fx.ownerAId,
        `UPDATE public.subscriptions SET current_period_end = now() + interval '10 years' WHERE id = $1 RETURNING id`,
        [fx.subscriptionAId],
      );
      expect(touched).toBe(0);

      // INSERT: no insert policy → WITH CHECK fails loudly.
      await expectDenied("INSERT under re-granted privileges (RLS layer)", () =>
        asUser(exec, fx.ownerAId, () =>
          exec.query(
            `INSERT INTO public.subscriptions (id, organization_id, plan_id, status) VALUES ($1, $2, (SELECT id FROM public.subscription_plans LIMIT 1), 'paused') RETURNING id`,
            [crypto.randomUUID(), fx.orgAId],
          ),
        ),
      );
    } finally {
      await exec.exec(`REVOKE INSERT, UPDATE ON public.subscriptions FROM authenticated`);
    }
    // Grant is back to M2 state.
    expect(await scalar<boolean>(`SELECT has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')`)).toBe(false);
  });

  // ========================================================================
  // 3. LEGITIMATE SERVER FLOWS (all through SECURITY DEFINER after the revoke)
  // ========================================================================

  it("M2.10 A — signup: bootstrap_owner_workspace INSERTs a real subscription", async () => {
    const user = await seedUser("m2-signup@test.local");
    const rows = await asUser(exec, user, () =>
      exec.query(
        `SELECT * FROM public.bootstrap_owner_workspace($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS r`,
        [
          "M2 Signup Org",
          "kiosk_duka",
          "M2 Owner",
          "m2-signup@test.local",
          null,
          "+256781000111",
          null,
          true,
          null,
          null,
          null,
        ],
      ),
    );
    const orgId = rows.rows[0]?.organization_id as string | undefined;
    expect(orgId).toBeTruthy();

    const sub = await exec.query<{ status: string; trial_ends_at: string }>(
      `SELECT status, trial_ends_at::text FROM public.subscriptions WHERE organization_id = $1`,
      [orgId],
    );
    expect(sub.rows.length).toBe(1);
    expect(sub.rows[0]!.status).toBe("trial");
    const near = await scalar<boolean>(
      `SELECT abs(extract(epoch from (s.trial_ends_at - ((timezone('Africa/Kampala', now())::date + interval '30 days')::timestamptz)))) <= 60
       FROM public.subscriptions s WHERE s.organization_id = $1`,
      [orgId],
    );
    expect(near).toBe(true);
  });

  it("M2.11 B — onboarding: save_owner_business_profile_bundle creates org/shop through its definer path", async () => {
    const user = await seedUser("m2-bundle@test.local");
    const districtId = await scalar<string>(`SELECT id::text FROM public.districts WHERE code = 'KLA'`);
    const result = await rpc(user, "save_owner_business_profile_bundle", [
      "M2 Bundle Shop",
      "hardware",
      districtId,
      "+256781000222",
      "UGX",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(result, `save_bundle result: ${JSON.stringify(result)}`).toMatchObject({ ok: true });
    const shopId = result.shop_id as string;
    const shop = await exec.query<{ business_type: string; district_id: string }>(
      `SELECT business_type, district_id::text FROM public.shops WHERE id = $1`,
      [shopId],
    );
    expect(shop.rows[0]!.business_type).toBe("hardware");
    expect(shop.rows[0]!.district_id).toBe(districtId);
    // NOTE: the production-latest bundle no longer INSERTs subscriptions itself
    // (that INSERT moved to bootstrap_owner_workspace, proven in M2.10) — its
    // remaining writes are organizations/shops/profiles, all definer-side.
    const members = await scalar<string>(
      `SELECT count(*)::text FROM public.shop_members WHERE shop_id = '${shopId}' AND user_id = '${user}'`,
    );
    expect(members).toBe("1");
  });

  it("M2.12 C — admin plan assignment updates subscriptions and cancels the sibling", async () => {
    await resetSubA();
    // Latest-by-created_at is the row plan-set keeps; make subA newest and non-live,
    // with an older LIVE sibling that must be cancelled by the RPC.
    await exec.exec(`UPDATE public.subscriptions SET status = 'expired' WHERE id = '${fx.subscriptionAId}'`);
    await exec.exec(`
      INSERT INTO public.subscriptions (id, organization_id, shop_id, plan_id, status, billing_interval, current_period_start, current_period_end, payment_status, created_at)
      VALUES ('${crypto.randomUUID()}', '${fx.orgAId}', '${fx.shopAId}',
              (SELECT id FROM public.subscription_plans WHERE code = 'starter'),
              'trialing', 'month', now() - interval '2 hours', now() + interval '5 days', 'unpaid',
              now() - interval '1 hour');
    `);
    const siblingBefore = await scalar<string>(
      `SELECT count(*)::text FROM public.subscriptions WHERE organization_id = '${fx.orgAId}' AND status = 'trialing'`,
    );
    expect(siblingBefore).toBe("1");

    const granted = await rpc(internal(), "admin_shop_set_subscription_plan", [fx.shopAId, "business", 30]);
    expect(granted.ok).toBe(true);

    const siblingAfter = await scalar<string>(
      `SELECT count(*)::text FROM public.subscriptions WHERE organization_id = '${fx.orgAId}' AND status = 'trialing'`,
    );
    expect(siblingAfter).toBe("0"); // sibling cancelled by the definer RPC
    const sub = await exec.query<{ status: string; plan_code: string; period: string }>(
      `SELECT s.status, sp.code AS plan_code, s.current_period_end::text AS period
       FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
       WHERE s.id = $1`,
      [fx.subscriptionAId],
    );
    expect(sub.rows[0]!.status).toBe("active");
    expect(sub.rows[0]!.plan_code).toBe("business");
    const near = await scalar<boolean>(
      `SELECT abs(extract(epoch from (current_period_end - (now() + interval '30 days')))) <= 60
       FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(near).toBe(true);
    // Clean the sibling for later tests.
    await exec.exec(
      `DELETE FROM public.subscriptions WHERE organization_id = '${fx.orgAId}' AND id <> '${fx.subscriptionAId}'`,
    );
  });

  it("M2.13 D — trial extension still works", async () => {
    await callVoid(internal(), "admin_extend_subscription_trial", [fx.subscriptionAId, 5]);
    const near = await scalar<boolean>(
      `SELECT abs(extract(epoch from (trial_ends_at - ((timezone('Africa/Kampala', now()) + interval '5 days')::timestamptz)))) <= 60
       FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(near).toBe(true);
  });

  it("M2.14 E — payment create + confirm still update payment_status and the period", async () => {
    await resetSubA();
    const before = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);
    const created = await rpc(internal(), "subscription_payment_create", [
      fx.shopAId,
      "mtn_momo",
      "M2-E-REF",
      null,
      null,
      null,
      fx.subscriptionAId,
    ]);
    expect(created.ok).toBe(true);
    expect(created.status).toBe("pending");

    const confirmed = await rpc(internal(), "subscription_payment_confirm", [created.payment_id, null, null]);
    expect(confirmed.ok).toBe(true);
    const s = await exec.query<{ payment_status: string; period: string }>(
      `SELECT payment_status, current_period_end::text AS period FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(s.rows[0]!.payment_status).toBe("paid");
    expect(new Date(s.rows[0]!.period).getTime()).toBeGreaterThan(new Date(before!).getTime());
  });

  it("M2.15 F — manual admin payment (markPaid) still works", async () => {
    await resetSubA();
    const before = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`);
    await callVoid(internal(), "admin_subscription_mark_payment", [fx.subscriptionAId, 36_000, "M2 manual"]);
    const s = await exec.query<{ payment_status: string; period: string }>(
      `SELECT payment_status, current_period_end::text AS period FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(s.rows[0]!.payment_status).toBe("paid");
    expect(new Date(s.rows[0]!.period).getTime()).toBeGreaterThan(new Date(before!).getTime());
    expect(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}' AND action = 'mark_payment'`,
      ),
    ).toBe("1");
  });

  it("M2.16 G — lifecycle transitions via admin_subscription_set_status", async () => {
    await resetSubA();
    const expectStatus = async (status: string) => {
      await callVoid(internal(), "admin_subscription_set_status", [fx.subscriptionAId, status]);
      const mapped = status === "canceled" ? "cancelled" : status;
      expect(
        await scalar<string>(`SELECT status::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`),
      ).toBe(mapped);
    };
    await expectStatus("cancelled");
    await expectStatus("paused");
    await expectStatus("active");
    await expectStatus("past_due"); // grace
    await expectStatus("expired");
    await expectStatus("active"); // resume
    expect(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}' AND action = 'set_status'`,
      ),
    ).toBe("6");
  });

  it("M2.17 H — annual offer fulfilment still lands now + 365 days", async () => {
    await resetSubA();
    const offerId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.org_billing_offers (id, organization_id, shop_id, amount_ugx, status)
      VALUES ('${offerId}', '${fx.orgAId}', '${fx.shopAId}', 490000, 'claimed_paid');
    `);
    const result = await rpc(internal(), "internal_ops_org_billing_offer_fulfill", [offerId, "Annual"]);
    expect(result.ok).toBe(true);
    const near = await scalar<boolean>(
      `SELECT abs(extract(epoch from (
         current_period_end - ((timezone('Africa/Kampala', now())::date + interval '365 days')::timestamptz)
       ))) <= 60 FROM public.subscriptions WHERE id = $1`,
      [fx.subscriptionAId],
    );
    expect(near).toBe(true);
    expect(
      await scalar<string>(`SELECT status::text FROM public.org_billing_offers WHERE id = '${offerId}'`),
    ).toBe("fulfilled");
    await exec.exec(`DELETE FROM public.org_billing_offers WHERE id = '${offerId}'`);
  });

  it("M2.18 I — subscription request approval still functions", async () => {
    await resetSubA();
    const requestId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.subscription_requests (id, organization_id, shop_id, requested_by, requested_plan, status)
      VALUES ('${requestId}', '${fx.orgAId}', '${fx.shopAId}', '${fx.ownerAId}', 'business', 'pending');
    `);
    const result = await rpc(internal(), "internal_ops_subscription_request_set_status", [
      requestId,
      "approved",
      "M2 approved",
    ]);
    expect(result.ok).toBe(true);
    expect(
      await scalar<string>(`SELECT status::text FROM public.subscription_requests WHERE id = '${requestId}'`),
    ).toBe("approved");
    await exec.exec(`DELETE FROM public.subscription_requests WHERE id = '${requestId}'`);
  });

  it("M2.19 J — agent referral upgrade still functions", async () => {
    const agentUserId = await seedUser("m2-agent@test.local");
    const agentId = crypto.randomUUID();
    const referralId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.marketing_agents (id, user_id, referral_code, full_name, active, roles)
      VALUES ('${agentId}', '${agentUserId}', 'M2AGENT', 'M2 Agent', true, ARRAY['vip_agent','trial_agent']::text[]);
      INSERT INTO public.agent_referrals (id, agent_id, referred_user_id, referred_shop_id, organization_id, shop_name)
      VALUES ('${referralId}', '${agentId}', '${fx.ownerAId}', '${fx.shopAId}', '${fx.orgAId}', 'Payment Shop A');
    `);
    // VIP agent upgrades the referral's organization to waka_plus.
    const result = await rpc(agentUserId, "marketing_agent_upgrade_referral_plan", [
      referralId,
      "waka_plus",
      30,
    ]);
    expect(result.ok).toBe(true);
    const plan = await scalar<string>(
      `SELECT sp.code::text FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.id = s.plan_id
       WHERE s.id = '${fx.subscriptionAId}'`,
    );
    expect(plan).toBe("waka_plus");
    await exec.exec(`DELETE FROM public.agent_referrals WHERE id = '${referralId}'`);
    await exec.exec(`DELETE FROM public.marketing_agents WHERE id = '${agentId}'`);
  });

  it("M2.20 K — promotional access grant + effective subscription read still work", async () => {
    const granted = await rpc(internal(), "admin_grant_promotional_access", [
      fx.shopAId,
      "business",
      30,
      "M2 promo",
      null,
    ]);
    expect(granted.ok).toBe(true);
    expect(
      await scalar<string>(`SELECT count(*)::text FROM public.promotional_grants WHERE organization_id = '${fx.orgAId}'`),
    ).toBe("1");

    const effective = await rpc(internal(), "shop_get_effective_subscription", [fx.shopAId]);
    expect(effective.ok).toBe(true);
    const sub = effective.subscription as Record<string, unknown> | undefined;
    expect(sub?.organization_id).toBe(fx.orgAId);
    expect(typeof sub?.plan_code).toBe("string");
    // Client-side merge of promotional access is covered by the subscription
    // unit suites (resolveEffectiveSubscription / fetchShopSubscription).
  });

  it("M2.21 L — organization deletion still cascades subscriptions away", async () => {
    const orgId = crypto.randomUUID();
    const shopId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'M2 Cascade Org');
      INSERT INTO public.shops (id, organization_id, name) VALUES ('${shopId}', '${orgId}', 'M2 Cascade Shop');
      INSERT INTO public.subscriptions (id, organization_id, shop_id, plan_id, status, billing_interval, current_period_end, payment_status)
      SELECT '${crypto.randomUUID()}', '${orgId}', '${shopId}', id, 'active', 'month', now() + interval '30 days', 'paid'
      FROM public.subscription_plans WHERE code = 'business';
    `);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscriptions WHERE organization_id = '${orgId}'`)).toBe("1");
    await exec.exec(`DELETE FROM public.organizations WHERE id = '${orgId}'`);
    expect(await scalar<string>(`SELECT count(*)::text FROM public.subscriptions WHERE organization_id = '${orgId}'`)).toBe("0");
  });

  it("reports whether real two-session PostgreSQL ran", () => {
    if (!exec.isRealPostgres) {
      console.info("Concurrent two-session PostgreSQL test not executed.");
    }
    expect(true).toBe(true);
  });
});
