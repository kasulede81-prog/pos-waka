import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SqlExec,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

/**
 * M3-G hardening — provider allowlist, initiation claim, pricing fail-closed,
 * reconciliation tick, lifecycle tick, mark-paid guard.
 *
 * SEQUENTIAL (PGlite): these assert function SEMANTICS, one call at a time.
 * Genuine races live in subscriptionPaymentConcurrency.sql.integration.test.ts
 * (real PostgreSQL only). Nothing here claims concurrency coverage.
 */

let exec: SqlExec;
let fx: SubscriptionPaymentFixture;

async function rpc(userId: string | null, fn: string, args: unknown[]): Promise<Record<string, unknown>> {
  await exec.exec("BEGIN");
  if (userId) await exec.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  try {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
    await exec.exec("COMMIT");
    // Void RPCs return NULL/'' — not JSON, not a result object.
    const raw = rows[0] ? Object.values(rows[0])[0] : undefined;
    if (raw === null || raw === undefined || raw === "") return {};
    return rpcJson(rows[0]);
  } catch (e) {
    await exec.exec("ROLLBACK");
    throw e;
  }
}

async function raises(fn: string, args: unknown[], userId: string | null = null): Promise<string> {
  try {
    await rpc(userId, fn, args);
    return "no-error";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await exec.query<Record<string, unknown>>(sql, params);
  return Object.values(rows[0]!)[0] as T;
}

const OWNER = () => fx.ownerAId;
const INTERNAL = () => fx.internalAdminId;

async function makePending(reference: string): Promise<string> {
  const r = await rpc(OWNER(), "subscription_payment_create", [
    fx.shopAId, "mtn_momo", reference, fx.amountUgx, null, null, fx.subscriptionAId, null, null,
  ]);
  expect(r.ok).toBe(true);
  return String(r.payment_id);
}

async function resetA(): Promise<void> {
  await exec.exec(`DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`);
  await exec.exec(`UPDATE public.subscriptions SET current_period_end = now() + interval '20 days', status = 'trialing' WHERE id = '${fx.subscriptionAId}'`);
}

beforeAll(async () => {
  exec = await createSubscriptionPaymentSqlHarness();
  fx = await seedSubscriptionPaymentFixture(exec);
}, 300_000);

afterAll(async () => {
  await exec?.close();
});

describe("M3-G provider allowlist", () => {
  it("1. rejects a client-invented provider label", async () => {
    await resetA();
    const r = await rpc(OWNER(), "subscription_payment_create", [
      fx.shopAId, "evil_pay", "ALLOW-1", fx.amountUgx, null, null, fx.subscriptionAId, null, null,
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("provider_not_allowed");
    expect(await scalar<number>(`SELECT count(*)::int FROM public.subscription_payments WHERE reference = 'ALLOW-1'`)).toBe(0);
  });

  it("2. accepts server-registered labels (pesapal is a future label — no adapter exists)", async () => {
    await resetA();
    const r = await rpc(OWNER(), "subscription_payment_create", [
      fx.shopAId, "pesapal", "ALLOW-2", fx.amountUgx, null, null, fx.subscriptionAId, null, null,
    ]);
    expect(r.ok).toBe(true);
    // provider_not_configured remains the Edge-layer behaviour (empty registry);
    // the row exists with the allowed label only.
    const provider = await scalar<string>(`SELECT provider FROM public.subscription_payments WHERE reference = 'ALLOW-2'`);
    expect(provider).toBe("pesapal");
  });

  it("3. attach refuses a row whose provider is not allowlisted", async () => {
    await resetA();
    const pid = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.subscription_payments
        (id, subscription_id, organization_id, shop_id, amount_ugx, currency, provider, status)
      VALUES ('${pid}', '${fx.subscriptionAId}', '${fx.orgAId}', '${fx.shopAId}', 36000, 'UGX', 'evil_pay', 'pending')
    `);
    const r = await rpc(INTERNAL(), "subscription_payment_provider_attach", [pid, "ref-x", "+256781234567", null]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("provider_not_allowed");
  });
});

describe("M3-G initiation claim (sequential semantics; races are in the concurrency suite)", () => {
  it("4. first claim wins; second observes in_progress; attach makes later claims idempotent", async () => {
    await resetA();
    const pid = await makePending("CLAIM-1");

    const first = await rpc(INTERNAL(), "subscription_payment_provider_claim", [pid, 300]);
    expect(first).toMatchObject({ ok: true, claimed: true });

    const second = await rpc(INTERNAL(), "subscription_payment_provider_claim", [pid, 300]);
    expect(second).toMatchObject({ ok: true, claimed: false, in_progress: true });

    const attach = await rpc(INTERNAL(), "subscription_payment_provider_attach", [pid, "prov-1", "+256781234567", null]);
    expect(attach.ok).toBe(true);

    const third = await rpc(INTERNAL(), "subscription_payment_provider_claim", [pid, 300]);
    expect(third).toMatchObject({ ok: true, claimed: false, already_initiated: true });
  });

  it("5. an expired claim can be re-claimed (crashed request cannot brick the payment)", async () => {
    await resetA();
    const pid = await makePending("CLAIM-2");
    await exec.exec(`BEGIN`);
    await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [INTERNAL()]);
    await exec.query(
      `UPDATE public.subscription_payments
          SET metadata = coalesce(metadata,'{}') || jsonb_build_object('initiate_claimed_at', (now() - interval '400 seconds')::text)
        WHERE id = $1`,
      [pid],
    );
    await exec.exec(`COMMIT`);
    const r = await rpc(INTERNAL(), "subscription_payment_provider_claim", [pid, 300]);
    expect(r).toMatchObject({ ok: true, claimed: true });
  });

  it("6. claim refuses terminal payments and unknown ids", async () => {
    await resetA();
    const pid = await makePending("CLAIM-3");
    await rpc(INTERNAL(), "subscription_payment_fail", [pid, "nope"]);
    const terminal = await rpc(INTERNAL(), "subscription_payment_provider_claim", [pid, 300]);
    expect(terminal.ok).toBe(false);
    expect(terminal.error).toBe("payment_not_pending");

    const missing = await rpc(INTERNAL(), "subscription_payment_provider_claim", [crypto.randomUUID(), 300]);
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("payment_not_found");
  });
});

describe("M3-G claim-aware stale-replace (pre-attach window)", () => {
  it("7. a FRESH-claimed (not yet initiated) payment is NOT stale-replaced; an expired claim is", async () => {
    await resetA();
    // Payment A: claimed, in flight.
    const a = await makePending("WINDOW-A");
    await rpc(INTERNAL(), "subscription_payment_provider_claim", [a, 300]);
    // Payment B: crashed claim 10 minutes ago.
    const b = await makePending("WINDOW-B");
    await exec.query(
      `UPDATE public.subscription_payments
          SET metadata = coalesce(metadata,'{}') || jsonb_build_object('initiate_claimed_at', (now() - interval '600 seconds')::text)
        WHERE id = $1`,
      [b],
    );

    // A third intent supersedes ordinary pendings.
    const c = await rpc(OWNER(), "subscription_payment_create", [
      fx.shopAId, "mtn_momo", "WINDOW-C", fx.amountUgx, null, null, fx.subscriptionAId, null, null,
    ]);
    expect(c.ok).toBe(true);

    const statusA = await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [a]);
    const statusB = await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [b]);
    expect(statusA, "fresh claim = provider call in flight = untouchable").toBe("pending");
    expect(statusB, "expired claim = crashed request = replaceable").toBe("cancelled");
    const reasonB = await scalar<string>(`SELECT status_reason FROM public.subscription_payments WHERE id = $1`, [b]);
    expect(reasonB).toBe("stale_replaced");
  });
});

describe("M3-G pricing fail-closed (never the legacy 066 book)", () => {
  it("8. catalog plan without canonical pricing → quote/create fail; display fallback untouched", async () => {
    await resetA();
    // Baseline: catalog price comes from the canonical book (36,000 for business).
    const before = await scalar<number>(`SELECT public.subscription_payment_plan_amount('business', 'month', 0)`);
    expect(before).toBe(36_000);

    const snap = await exec.query<{ row: unknown }>(
      `SELECT to_jsonb(c) AS row FROM public.subscription_canonical_prices c WHERE plan_code = 'business'`,
    );
    expect(snap.rows.length).toBe(1);

    await exec.exec(`DELETE FROM public.subscription_canonical_prices WHERE plan_code = 'business'`);
    try {
      const err = await raises("subscription_payment_plan_amount", ["business", "month", 0]);
      expect(err).toContain("pricing_unavailable");

      const quoteErr = await raises("subscription_payment_quote", [fx.shopAId, "business", "month"], OWNER());
      expect(quoteErr).toContain("pricing_unavailable");

      // create must fail BEFORE writing a row (no stale price ever lands).
      const createErr = await raises(
        "subscription_payment_create",
        [fx.shopAId, "mtn_momo", "STALE-PRICE", 25_000, null, null, fx.subscriptionAId, "business", "month"],
        OWNER(),
      );
      expect(createErr).toContain("pricing_unavailable");
      expect(
        await scalar<number>(`SELECT count(*)::int FROM public.subscription_payments WHERE reference = 'STALE-PRICE'`),
      ).toBe(0);

      // Non-catalog plan rows keep their plan-row price (unchanged behaviour).
      const legacy = await scalar<number>(`SELECT public.subscription_payment_plan_amount('business_m1', 'month', 0)`);
      expect(legacy).toBe(36_000);
    } finally {
      await exec.query(
        `INSERT INTO public.subscription_canonical_prices SELECT * FROM jsonb_populate_record(NULL::public.subscription_canonical_prices, $1::jsonb)`,
        [JSON.stringify(snap.rows[0]!.row)],
      );
    }
    const restored = await scalar<number>(`SELECT public.subscription_payment_plan_amount('business', 'month', 0)`);
    expect(restored).toBe(36_000);
  });
});

describe("M3-G reconciliation tick", () => {
  it("9. TTL-cancels stale ordinary pendings; never initiated ones; flags initiated unsettled once", async () => {
    await resetA();
    // ORDER MATTERS: creating a second ordinary pending would stale-replace
    // the first (M3-A semantics), so the initiated payment is created FIRST
    // (it is supersede-proof) and the ordinary one LAST.
    const initiated = await makePending("RECON-INIT");
    await rpc(INTERNAL(), "subscription_payment_provider_attach", [initiated, "prov-r", "+256781234567", null]);
    const stale = await makePending("RECON-STALE");
    expect(await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [stale])).toBe("pending");

    // Age both beyond their windows. `created_at` is an IMMUTABLE ledger
    // field (M1 state guard) — age the TICK instead via p_now.
    await exec.exec(`
      UPDATE public.subscription_payments
         SET metadata = metadata || jsonb_build_object('initiated_at', (now() - interval '3 days')::text)
       WHERE id = '${initiated}';
    `);
    const futureNow = new Date(Date.now() + 3 * 86_400_000).toISOString();

    const first = await rpc(INTERNAL(), "subscription_payment_reconcile_tick", [86400, 172800, futureNow]);
    expect(first.ok).toBe(true);
    expect(Number(first.cancelled)).toBe(1);
    expect(Number(first.flagged_initiated)).toBe(1);

    const staleStatus = await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [stale]);
    const staleReason = await scalar<string>(`SELECT status_reason FROM public.subscription_payments WHERE id = $1`, [stale]);
    expect(staleStatus).toBe("cancelled");
    expect(staleReason).toBe("timed_out");

    // Initiated payment stays pending (provider may still settle) — only flagged.
    const initStatus = await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [initiated]);
    expect(initStatus).toBe("pending");
    const flags = await scalar<number>(
      `SELECT count(*)::int FROM public.subscription_history
        WHERE subscription_id = $1 AND action = 'payment_reconciliation_required'
          AND payload ->> 'reason' = 'initiated_unsettled'`,
      [fx.subscriptionAId],
    );
    expect(flags).toBe(1);

    // Second run: deduped (no duplicate flags, no re-cancel).
    const second = await rpc(INTERNAL(), "subscription_payment_reconcile_tick", [86400, 172800, futureNow]);
    expect(Number(second.flagged_initiated)).toBe(0);
    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_history
          WHERE subscription_id = $1 AND action = 'payment_reconciliation_required'
            AND payload ->> 'reason' = 'initiated_unsettled'`,
        [fx.subscriptionAId],
      ),
    ).toBe(1);
  });

  it("10. flags a pending payment whose checkout plan was deactivated (no silent stuck state)", async () => {
    await resetA();
    const pid = await makePending("RECON-PLAN");
    await exec.exec(`UPDATE public.subscription_plans SET is_active = false WHERE id = '${fx.planBusinessId}'`);
    try {
      const r = await rpc(INTERNAL(), "subscription_payment_reconcile_tick", [86400, 172800, null]);
      expect(Number(r.flagged_plan)).toBe(1);
      const status = await scalar<string>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [pid]);
      expect(status, "flagged, never auto-failed or refunded").toBe("pending");
      const flag = await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_history
          WHERE subscription_id = $1 AND action = 'payment_reconciliation_required'
            AND payload ->> 'reason' = 'plan_unavailable'`,
        [fx.subscriptionAId],
      );
      expect(flag).toBe(1);
    } finally {
      await exec.exec(`UPDATE public.subscription_plans SET is_active = true WHERE id = '${fx.planBusinessId}'`);
    }
  });

  it("11. flag_reconciliation RPC writes an auditable marker and is settle-gated", async () => {
    await resetA();
    const pid = await makePending("RECON-FLAG");
    const denied = await rpc(OWNER(), "subscription_payment_flag_reconciliation", [pid, "stale_success"]);
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("forbidden");

    const ok = await rpc(INTERNAL(), "subscription_payment_flag_reconciliation", [pid, "stale_success"]);
    expect(ok.ok).toBe(true);
    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_history
          WHERE action = 'payment_reconciliation_required' AND payload ->> 'reason' = 'stale_success'`,
      ),
    ).toBe(1);
  });
});

describe("M3-G subscription lifecycle tick", () => {
  async function scratchSub(id: string, status: string, endSql: string): Promise<void> {
    // Fresh org + shop per scratch row: `subscriptions_one_active_per_org`
    // allows only one active subscription per organization, and renewal
    // reminders require a non-null shop_id.
    const orgId = crypto.randomUUID();
    const shopId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Lifecycle Scratch');
      INSERT INTO public.shops (id, organization_id, name, shop_number)
        VALUES ('${shopId}', '${orgId}', 'Lifecycle Shop', 'LC-${shopId.slice(0, 8)}');
      INSERT INTO public.subscriptions
        (id, organization_id, shop_id, plan_id, status, billing_interval, current_period_start, current_period_end, payment_status)
      VALUES (
        '${id}',
        '${orgId}',
        '${shopId}',
        '${fx.planBusinessId}',
        '${status}',
        'month',
        now() - interval '40 days',
        ${endSql},
        'paid'
      );
    `);
  }

  it("12. active past period end (no grace) → expired; within grace → past_due; grace over → expired", async () => {
    const s1 = crypto.randomUUID();
    const s2 = crypto.randomUUID();
    await scratchSub(s1, "active", `now() - interval '2 days'`);
    await scratchSub(s2, "active", `now() - interval '2 days'`);

    // Grace 0 → immediate expiry of s1.
    const r1 = await rpc(INTERNAL(), "subscription_lifecycle_tick", [0, [], null]);
    expect(r1.ok).toBe(true);
    expect(Number(r1.expired)).toBeGreaterThanOrEqual(1);
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [s1])).toBe("expired");
    // s2 also expired (same condition) — reset it into grace instead.
    await exec.exec(`UPDATE public.subscriptions SET status = 'active', current_period_end = now() - interval '2 days' WHERE id = '${s2}'`);
    await rpc(INTERNAL(), "subscription_lifecycle_tick", [5, [], null]);
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [s2])).toBe("past_due");

    // Past the grace window → expired (past_due is no longer a dead-end).
    await exec.exec(`UPDATE public.subscriptions SET current_period_end = now() - interval '10 days' WHERE id = '${s2}'`);
    await rpc(INTERNAL(), "subscription_lifecycle_tick", [5, [], null]);
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [s2])).toBe("expired");
  });

  it("13. cancelled and paused rows lapse at period end (no indefinite entitlement rows)", async () => {
    const cancelled = crypto.randomUUID();
    const paused = crypto.randomUUID();
    await scratchSub(cancelled, "cancelled", `now() - interval '3 days'`);
    await scratchSub(paused, "paused", `now() - interval '3 days'`);

    const r = await rpc(INTERNAL(), "subscription_lifecycle_tick", [0, [], null]);
    expect(r.ok).toBe(true);
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [cancelled])).toBe("expired");
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [paused])).toBe("expired");
    const fromStatus = await scalar<string>(
      `SELECT metadata ->> 'lapsed_from_status' FROM public.subscriptions WHERE id = $1`,
      [cancelled],
    );
    expect(fromStatus).toBe("cancelled");
  });

  it("14. ended trial → expired; renewal reminder emitted once per period+day", async () => {
    const trial = crypto.randomUUID();
    const reminder = crypto.randomUUID();
    await scratchSub(trial, "trial", `now() + interval '10 days'`);
    await exec.exec(`UPDATE public.subscriptions SET trial_ends_at = now() - interval '1 hour' WHERE id = '${trial}'`);
    await scratchSub(reminder, "active", `now() + interval '7 days'`);

    const r = await rpc(INTERNAL(), "subscription_lifecycle_tick", [0, [7], null]);
    expect(r.ok).toBe(true);
    expect(await scalar<string>(`SELECT status FROM public.subscriptions WHERE id = $1`, [trial])).toBe("expired");
    expect(Number(r.reminders)).toBe(1);

    const again = await rpc(INTERNAL(), "subscription_lifecycle_tick", [0, [7], null]);
    expect(Number(again.reminders), "deduped for the same period_end + day").toBe(0);
    expect(
      await scalar<number>(
        `SELECT count(*)::int FROM public.subscription_history
          WHERE subscription_id = $1 AND action = 'renewal_reminder'`,
        [reminder],
      ),
    ).toBe(1);
  });
});

describe("M3-G admin mark-paid guard", () => {
  it("15. refuses while a provider-initiated payment is in flight", async () => {
    await resetA();
    const pid = await makePending("MARK-INIT");
    await rpc(INTERNAL(), "subscription_payment_provider_attach", [pid, "prov-m", "+256781234567", null]);

    const err = await raises("admin_subscription_mark_payment", [fx.subscriptionAId, 36000, "manual"], INTERNAL());
    expect(err).toContain("payment_reconciliation_required");
    expect(
      await scalar<number>(`SELECT count(*)::int FROM public.subscription_payments WHERE subscription_id = $1 AND provider = 'manual_admin'`, [fx.subscriptionAId]),
    ).toBe(0);
  });

  it("16. with only an ordinary pending checkout: supersedes it, advances ONCE; later confirm cannot double-extend", async () => {
    await resetA();
    const pid = await makePending("MARK-ORDINARY");
    const baseEnd = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]);

    await rpc(INTERNAL(), "admin_subscription_mark_payment", [fx.subscriptionAId, 36000, "manual cash"]);
    const manualCount = await scalar<number>(
      `SELECT count(*)::int FROM public.subscription_payments WHERE subscription_id = $1 AND provider = 'manual_admin'`,
      [fx.subscriptionAId],
    );
    expect(manualCount).toBe(1);

    // The superseded checkout can never settle.
    const confirm = await rpc(INTERNAL(), "subscription_payment_confirm", [pid, null, null]);
    expect(confirm.ok).toBe(false);
    expect(confirm.error).toBe("payment_not_confirmable");

    // Exactly ONE advance (manual), none from the dead checkout.
    const adv = await scalar<number>(
      `SELECT (current_period_end = $1::timestamptz + interval '1 month')::int FROM public.subscriptions WHERE id = $2`,
      [baseEnd, fx.subscriptionAId],
    );
    expect(adv).toBe(1);
  });

  it("17. legitimate independent payments still work: mark-paid with no pending intent succeeds", async () => {
    await resetA();
    const baseEnd = await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`, [fx.subscriptionAId]);
    await rpc(INTERNAL(), "admin_subscription_mark_payment", [fx.subscriptionAId, 36000, null]);
    const adv = await scalar<number>(
      `SELECT (current_period_end = $1::timestamptz + interval '1 month')::int FROM public.subscriptions WHERE id = $2`,
      [baseEnd, fx.subscriptionAId],
    );
    expect(adv).toBe(1);
  });
});
