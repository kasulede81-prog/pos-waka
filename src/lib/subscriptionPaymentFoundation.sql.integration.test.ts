/**
 * M1 — PAYMENT FOUNDATION (real SQL).
 *
 * Exercises the subscription payment ledger against production-shaped fixtures
 * and the production grant posture: idempotent create/confirm, the payment
 * state machine, server-authoritative amount/shop/subscription, authorization
 * on both the initiate and settle sides, the manual admin path, and the
 * immutability of a recorded payment row.
 *
 * New RPCs answer with jsonb {ok, error}; only admin_subscription_mark_payment
 * raises (void, pre-M1 contract kept). PGLite is single-connection, so true
 * two-session concurrency needs TEST_DATABASE_URL — reported at the end of the
 * suite, as in the migration-174 suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

type RpcResult = Record<string, unknown>;

describe("M1 — payment foundation (real SQL)", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);
  }, 180_000);

  afterAll(async () => {
    await exec?.close();
  });

  // ---- helpers ----------------------------------------------------------

  async function scalar<T = string>(sql: string, params: unknown[] = []): Promise<T> {
    const { rows } = await exec.query<Record<string, unknown>>(sql, params);
    return Object.values(rows[0] ?? {})[0] as T;
  }

  async function periodEnd(subscriptionId: string): Promise<string | null> {
    return scalar<string | null>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
  }

  async function subRow(subscriptionId: string) {
    const { rows } = await exec.query<{
      status: string;
      payment_status: string;
      current_period_end: string;
      trial_ends_at: string | null;
    }>(
      `SELECT status, payment_status, current_period_end::text, trial_ends_at::text
       FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    return rows[0]!;
  }

  async function paymentRow(paymentId: string) {
    const { rows } = await exec.query<{
      status: string;
      amount_ugx: string;
      provider: string | null;
      reference: string | null;
      confirmed_at: string | null;
      shop_id: string | null;
    }>(
      `SELECT status, amount_ugx::text, provider, reference, confirmed_at::text, shop_id::text
       FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    return rows[0];
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

  /** Call an RPC as a user and unwrap its jsonb result. */
  async function rpc(userId: string, fn: string, args: unknown[]): Promise<RpcResult> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(
        `SELECT public.${fn}(${placeholders}) AS result`,
        args,
      );
      return rpcJson(rows[0]);
    });
  }

  /** Call a void RPC (admin_subscription_mark_payment) — success means no throw. */
  async function voidRpc(userId: string, fn: string, args: unknown[]): Promise<void> {
    await asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      await exec.query(`SELECT public.${fn}(${placeholders})`, args);
    });
  }

  async function expectRaise(fn: string, args: unknown[], userId: string): Promise<string> {
    try {
      await voidRpc(userId, fn, args);
      return "no-error";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  type CreateOpts = {
    shopId?: string;
    subscriptionId?: string | null;
    provider?: string;
    reference?: string | null;
    /** Omit (undefined) to let the server price it; a value is checked against it. */
    amount?: number | null;
    paymentId?: string | null;
    note?: string | null;
  };

  async function create(userId: string, opts: CreateOpts = {}): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_create", [
      opts.shopId ?? fx.shopAId,
      opts.provider ?? "mtn_momo",
      opts.reference ?? null,
      opts.amount === undefined ? null : opts.amount,
      opts.note ?? null,
      opts.paymentId ?? null,
      opts.subscriptionId === undefined ? fx.subscriptionAId : opts.subscriptionId,
    ]);
  }

  async function confirm(userId: string, paymentId: string, reference: string | null = null) {
    return rpc(userId, "subscription_payment_confirm", [paymentId, reference, null]);
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

  async function createPending(reference: string): Promise<string> {
    const r = await create(fx.internalAdminId, { reference });
    expect(r.ok).toBe(true);
    return r.payment_id as string;
  }

  // ---- tests ------------------------------------------------------------

  it("T1 first payment succeeds: pending -> confirmed records once and renews the period", async () => {
    await resetSubA();
    const before = await periodEnd(fx.subscriptionAId);

    const created = await create(fx.internalAdminId, { reference: "REF-T1", amount: fx.amountUgx });
    expect(created.ok).toBe(true);
    expect(created.idempotent).toBe(false);
    expect(created.status).toBe("pending");
    expect(Number(created.amount_ugx)).toBe(fx.amountUgx);

    const paymentId = created.payment_id as string;
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    expect((await paymentRow(paymentId))?.status).toBe("pending");
    expect((await subRow(fx.subscriptionAId)).payment_status).toBe("pending");

    const confirmed = await confirm(fx.internalAdminId, paymentId);
    expect(confirmed.ok).toBe(true);
    expect(confirmed.status).toBe("confirmed");

    const row = (await paymentRow(paymentId))!;
    expect(row.status).toBe("confirmed");
    expect(row.confirmed_at).not.toBeNull();
    expect(row.shop_id).toBe(fx.shopAId);

    const after = await periodEnd(fx.subscriptionAId);
    expect(new Date(after!).getTime()).toBeGreaterThan(new Date(before!).getTime());
    const s = await subRow(fx.subscriptionAId);
    expect(s.payment_status).toBe("paid");
    expect(s.trial_ends_at).toBeNull();
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    expect(await historyCount(fx.subscriptionAId, "payment_created")).toBe(1);
    expect(await historyCount(fx.subscriptionAId, "payment_confirmed")).toBe(1);
  });

  it("T2 same payment replay is idempotent (payment id AND provider reference)", async () => {
    await resetSubA();

    // Durable payment-id replay (migration-174 shape).
    const paymentId = crypto.randomUUID();
    const first = await create(fx.internalAdminId, { paymentId, reference: "REF-T2" });
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBe(false);
    const replay = await create(fx.internalAdminId, { paymentId, reference: "REF-T2" });
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(replay.payment_id).toBe(paymentId);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);

    // Confirm replay must not count or advance twice.
    expect((await confirm(fx.internalAdminId, paymentId)).ok).toBe(true);
    const after1 = await periodEnd(fx.subscriptionAId);
    const confirmReplay = await confirm(fx.internalAdminId, paymentId);
    expect(confirmReplay.ok).toBe(true);
    expect(confirmReplay.idempotent).toBe(true);
    expect(await periodEnd(fx.subscriptionAId)).toBe(after1);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    expect(await historyCount(fx.subscriptionAId, "payment_confirmed")).toBe(1);
    expect(
      Number(
        await scalar<string>(
          `SELECT coalesce(sum(amount_ugx), 0)::text FROM public.subscription_payments
           WHERE subscription_id = $1`,
          [fx.subscriptionAId],
        ),
      ),
    ).toBe(fx.amountUgx);
  });

  it("T3 duplicate provider reference cannot create a second payment", async () => {
    await resetSubA();
    const a = await create(fx.internalAdminId, { reference: "REF-DUP" });
    expect(a.ok).toBe(true);

    const b = await create(fx.internalAdminId, { reference: "REF-DUP" });
    expect(b.ok).toBe(true);
    expect(b.idempotent).toBe(true);
    expect(b.payment_id).toBe(a.payment_id);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);

    // The uniqueness is a database constraint, not only RPC bookkeeping.
    let dbErr = "no-error";
    try {
      await exec.query(
        `INSERT INTO public.subscription_payments
           (subscription_id, organization_id, shop_id, amount_ugx, provider, reference, status)
         VALUES ($1, $2, $3, $4, 'mtn_momo', 'REF-DUP', 'pending')`,
        [fx.subscriptionAId, fx.orgAId, fx.shopAId, fx.amountUgx],
      );
    } catch (e) {
      dbErr = e instanceof Error ? e.message : String(e);
    }
    expect(dbErr).toMatch(/duplicate key|unique/i);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);

    // And the same reference cannot be replayed against another subscription.
    const foreign = await create(fx.internalAdminId, {
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionBId,
      reference: "REF-DUP",
    });
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toMatch(/reference/i);
    expect(await paymentCount(fx.subscriptionBId)).toBe(0);
  });

  it("T4 pending -> failed leaves the subscription untouched", async () => {
    await resetSubA();
    const before = await periodEnd(fx.subscriptionAId);
    const paymentId = await createPending("REF-T4");

    const failed = await rpc(fx.internalAdminId, "subscription_payment_fail", [
      paymentId,
      "insufficient funds",
    ]);
    expect(failed.ok).toBe(true);
    expect(failed.status).toBe("failed");

    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    const s = await subRow(fx.subscriptionAId);
    expect(s.payment_status).toBe("failed");
    expect(s.status).toBe("trialing");

    // A failed payment can never be confirmed afterwards.
    const confirmAfterFail = await confirm(fx.internalAdminId, paymentId);
    expect(confirmAfterFail.ok).toBe(false);
    expect(String(confirmAfterFail.error)).toBe("payment_not_confirmable");
    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    expect(await historyCount(fx.subscriptionAId, "payment_failed")).toBe(1);
  });

  it("T5 cancelled payment is terminal and never confirms", async () => {
    await resetSubA();
    const before = await periodEnd(fx.subscriptionAId);
    const paymentId = await createPending("REF-T5");

    const cancelled = await rpc(fx.internalAdminId, "subscription_payment_cancel", [
      paymentId,
      "checkout abandoned",
    ]);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.status).toBe("cancelled");

    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    expect((await subRow(fx.subscriptionAId)).payment_status).not.toBe("paid");

    const confirmAfter = await confirm(fx.internalAdminId, paymentId);
    expect(confirmAfter.ok).toBe(false);
    expect(String(confirmAfter.error)).toBe("payment_not_confirmable");

    const failAfter = await rpc(fx.internalAdminId, "subscription_payment_fail", [paymentId, null]);
    expect(failAfter.ok).toBe(false);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
  });

  it("T6 failed payment cannot activate a subscription", async () => {
    await resetSubA();
    const before = await subRow(fx.subscriptionAId);
    const paymentId = await createPending("REF-T6");
    await rpc(fx.internalAdminId, "subscription_payment_fail", [paymentId, "declined"]);

    const after = await subRow(fx.subscriptionAId);
    expect(after.status).not.toBe("active");
    expect(after.payment_status).not.toBe("paid");
    expect(after.current_period_end).toBe(before.current_period_end);
    expect((await paymentRow(paymentId))!.status).toBe("failed");
  });

  it("T7 unauthorized mutation is rejected at every layer", async () => {
    await resetSubA();

    // Out-of-org caller cannot initiate.
    const foreignCreate = await create(fx.outsiderId, { reference: "REF-T7" });
    expect(foreignCreate.ok).toBe(false);
    expect(String(foreignCreate.error)).toBe("forbidden");

    // Out-of-org caller cannot settle.
    const paymentId = await createPending("REF-T7");
    const foreignConfirm = await confirm(fx.outsiderId, paymentId);
    expect(foreignConfirm.ok).toBe(false);
    expect(String(foreignConfirm.error)).toBe("forbidden");
    expect((await paymentRow(paymentId))!.status).toBe("pending");

    // Cashier in the org may neither initiate nor settle.
    const cashierCreate = await create(fx.cashierAId, { reference: "REF-T7b" });
    expect(cashierCreate.ok).toBe(false);
    expect(String(cashierCreate.error)).toBe("forbidden");
    const cashierConfirm = await confirm(fx.cashierAId, paymentId);
    expect(cashierConfirm.ok).toBe(false);
    expect(String(cashierConfirm.error)).toBe("forbidden");

    // Direct row writes are refused by the revoked grants.
    let insertErr = "no-error";
    try {
      await asUser(exec, fx.ownerAId, async () => {
        await exec.query(
          `INSERT INTO public.subscription_payments (subscription_id, organization_id, amount_ugx)
           VALUES ($1, $2, 1)`,
          [fx.subscriptionAId, fx.orgAId],
        );
      });
    } catch (e) {
      insertErr = e instanceof Error ? e.message : String(e);
    }
    expect(insertErr).toMatch(/permission denied/i);

    let updateErr = "no-error";
    try {
      await asUser(exec, fx.ownerAId, async () => {
        await exec.query(
          `UPDATE public.subscription_payments SET status = 'confirmed' WHERE id = $1`,
          [paymentId],
        );
      });
    } catch (e) {
      updateErr = e instanceof Error ? e.message : String(e);
    }
    expect(updateErr).toMatch(/permission denied/i);
    expect((await paymentRow(paymentId))!.status).toBe("pending");

    let deleteErr = "no-error";
    try {
      await asUser(exec, fx.ownerAId, async () => {
        await exec.query(`DELETE FROM public.subscription_payments WHERE id = $1`, [paymentId]);
      });
    } catch (e) {
      deleteErr = e instanceof Error ? e.message : String(e);
    }
    expect(deleteErr).toMatch(/permission denied/i);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
  });

  it("T8 manual admin payment keeps working exactly as before", async () => {
    await resetSubA();
    const before = await periodEnd(fx.subscriptionAId);

    await expectRaise(
      "admin_subscription_mark_payment",
      [fx.subscriptionAId, 36_000, "Recorded from console"],
      fx.internalAdminId,
    ).then((err) => expect(err).toBe("no-error"));

    const { rows } = await exec.query<{
      id: string;
      status: string;
      provider: string;
      amount_ugx: string;
      shop_id: string | null;
    }>(
      `SELECT id, status, provider, amount_ugx::text, shop_id::text
       FROM public.subscription_payments WHERE subscription_id = $1`,
      [fx.subscriptionAId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("confirmed");
    expect(rows[0]!.provider).toBe("manual_admin");
    expect(Number(rows[0]!.amount_ugx)).toBe(36_000);
    expect(rows[0]!.shop_id).toBe(fx.shopAId);

    const s = await subRow(fx.subscriptionAId);
    expect(s.payment_status).toBe("paid");
    expect(s.status).toBe("active");
    const after = await periodEnd(fx.subscriptionAId);
    expect(new Date(after!).getTime()).toBeGreaterThan(new Date(before!).getTime());
    expect(await historyCount(fx.subscriptionAId, "mark_payment")).toBe(1);

    const audit = Number(
      await scalar<string>(
        `SELECT count(*)::text FROM public.audit_logs
         WHERE action = 'admin_subscription_mark_payment'`,
      ),
    );
    expect(audit).toBeGreaterThanOrEqual(1);

    // Non-internal callers are still refused by the original guard.
    const ownerErr = await expectRaise(
      "admin_subscription_mark_payment",
      [fx.subscriptionAId, 36_000, "nope"],
      fx.ownerAId,
    );
    expect(ownerErr).toMatch(/Forbidden/i);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);

    const cashierErr = await expectRaise(
      "admin_subscription_mark_payment",
      [fx.subscriptionAId, 36_000, "nope"],
      fx.cashierAId,
    );
    expect(cashierErr).toMatch(/Forbidden/i);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
  });

  it("T9 wrong shop / foreign subscription cannot be paid", async () => {
    await resetSubA();

    // Subscription A paid from shop B (different organization).
    const wrongShop = await create(fx.internalAdminId, {
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionAId,
      reference: "REF-T9",
    });
    expect(wrongShop.ok).toBe(false);
    expect(String(wrongShop.error)).toBe("shop_subscription_mismatch");

    // Subscription B paid from shop A.
    const wrongSub = await create(fx.internalAdminId, {
      shopId: fx.shopAId,
      subscriptionId: fx.subscriptionBId,
      reference: "REF-T9",
    });
    expect(wrongSub.ok).toBe(false);
    expect(String(wrongSub.error)).toBe("shop_subscription_mismatch");

    // Unknown subscription id.
    const unknownSub = await create(fx.internalAdminId, {
      subscriptionId: crypto.randomUUID(),
      reference: "REF-T9",
    });
    expect(unknownSub.ok).toBe(false);
    expect(String(unknownSub.error)).toBe("subscription_not_found");

    // Unknown shop.
    const unknownShop = await create(fx.internalAdminId, {
      shopId: crypto.randomUUID(),
      subscriptionId: null,
      reference: "REF-T9",
    });
    expect(unknownShop.ok).toBe(false);
    expect(String(unknownShop.error)).toBe("shop_not_found");

    expect(await paymentCount(fx.subscriptionAId)).toBe(0);
    expect(await paymentCount(fx.subscriptionBId)).toBe(0);

    // Shop B's owner cannot pay shop A's subscription either (no org membership).
    const foreignOwner = await create(fx.ownerId, {
      shopId: fx.shopAId,
      subscriptionId: fx.subscriptionAId,
      reference: "REF-T9",
    });
    expect(foreignOwner.ok).toBe(false);
    expect(String(foreignOwner.error)).toBe("forbidden");
    expect(await paymentCount(fx.subscriptionAId)).toBe(0);
  });

  it("T10 payment amount is server-authoritative and immutable", async () => {
    await resetSubA();

    // Tampered client amount is rejected, nothing is stored.
    const tampered = await create(fx.internalAdminId, { amount: 1, reference: "REF-T10" });
    expect(tampered.ok).toBe(false);
    expect(String(tampered.error)).toBe("amount_mismatch");
    expect(Number(tampered.expected_amount_ugx)).toBe(fx.amountUgx);
    expect(await paymentCount(fx.subscriptionAId)).toBe(0);

    // The stored amount is the plan price, not a client value.
    const stored = await create(fx.internalAdminId, { amount: fx.amountUgx, reference: "REF-T10" });
    expect(stored.ok).toBe(true);
    expect(Number(stored.amount_ugx)).toBe(fx.amountUgx);

    // Omitting the amount yields the same server-computed value.
    await resetSubA();
    const omitted = await create(fx.internalAdminId, { reference: "REF-T10b" });
    expect(omitted.ok).toBe(true);
    expect(Number(omitted.amount_ugx)).toBe(fx.amountUgx);

    // A recorded row cannot be rewritten — not even by the table owner.
    const paymentId = omitted.payment_id as string;
    let immutableErr = "no-error";
    try {
      await exec.query(`UPDATE public.subscription_payments SET amount_ugx = 1 WHERE id = $1`, [
        paymentId,
      ]);
    } catch (e) {
      immutableErr = e instanceof Error ? e.message : String(e);
    }
    expect(immutableErr).toMatch(/immutable/i);
    expect(Number((await paymentRow(paymentId))!.amount_ugx)).toBe(fx.amountUgx);

    // Identity fields are immutable too.
    let refErr = "no-error";
    try {
      await exec.query(
        `UPDATE public.subscription_payments SET reference = 'HIJACKED' WHERE id = $1`,
        [paymentId],
      );
    } catch (e) {
      refErr = e instanceof Error ? e.message : String(e);
    }
    expect(refErr).toMatch(/immutable/i);
    expect((await paymentRow(paymentId))!.reference).toBe("REF-T10b");
  });

  it("T11 payment success activates and renews the correct subscription only", async () => {
    await resetSubA();
    const subBBefore = await subRow(fx.subscriptionBId);
    const before = await periodEnd(fx.subscriptionAId);

    const paymentId = await createPending("REF-T11");
    await confirm(fx.internalAdminId, paymentId);

    const s = await subRow(fx.subscriptionAId);
    expect(s.status).toBe("active");
    expect(s.payment_status).toBe("paid");
    // Period renews from max(now, current_period_end) — i.e. past the old end.
    expect(new Date(s.current_period_end).getTime()).toBeGreaterThan(new Date(before!).getTime());
    expect(new Date(s.current_period_end).getTime()).toBeGreaterThan(Date.now());

    // The other organization's subscription is untouched.
    const subBAfter = await subRow(fx.subscriptionBId);
    expect(subBAfter.status).toBe(subBBefore.status);
    expect(subBAfter.payment_status).toBe(subBBefore.payment_status);
    expect(subBAfter.current_period_end).toBe(subBBefore.current_period_end);
    expect(await paymentCount(fx.subscriptionBId)).toBe(0);
  });

  it("T12 an expired subscription is reactivated by a confirmed payment", async () => {
    await resetSubA();
    await exec.exec(`
      UPDATE public.subscriptions
      SET status = 'expired', payment_status = 'unpaid', current_period_end = now() - interval '3 days'
      WHERE id = '${fx.subscriptionAId}';
    `);

    const paymentId = await createPending("REF-T12");
    const confirmed = await confirm(fx.internalAdminId, paymentId);
    expect(confirmed.ok).toBe(true);

    const s = await subRow(fx.subscriptionAId);
    expect(s.status).toBe("active");
    expect(s.payment_status).toBe("paid");
    // Renewed from NOW (the old period is in the past), not from the stale end.
    expect(new Date(s.current_period_end).getTime()).toBeGreaterThan(Date.now());
  });

  it("T13 provider lookup contract resolves by (provider, reference)", async () => {
    await resetSubA();
    const paymentId = await createPending("REF-T13");

    const found = await rpc(fx.internalAdminId, "subscription_payment_lookup", [
      "mtn_momo",
      "REF-T13",
    ]);
    expect(found.ok).toBe(true);
    expect(found.payment_id).toBe(paymentId);
    expect(found.status).toBe("pending");
    expect(Number(found.amount_ugx)).toBe(fx.amountUgx);

    const missing = await rpc(fx.internalAdminId, "subscription_payment_lookup", [
      "mtn_momo",
      "REF-NOPE",
    ]);
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toBe("payment_not_found");

    const foreign = await rpc(fx.outsiderId, "subscription_payment_lookup", [
      "mtn_momo",
      "REF-T13",
    ]);
    expect(foreign.ok).toBe(false);
    expect(String(foreign.error)).toBe("forbidden");
  });

  it("T14 refund is terminal and preserved in history", async () => {
    await resetSubA();
    const paymentId = await createPending("REF-T14");
    await confirm(fx.internalAdminId, paymentId);

    const refunded = await rpc(fx.internalAdminId, "subscription_payment_refund", [
      paymentId,
      "customer request",
    ]);
    expect(refunded.ok).toBe(true);
    expect(refunded.status).toBe("refunded");

    const confirmAfter = await confirm(fx.internalAdminId, paymentId);
    expect(confirmAfter.ok).toBe(false);
    expect(String(confirmAfter.error)).toBe("payment_not_confirmable");

    // Refund replay is idempotent and does not add history.
    const replay = await rpc(fx.internalAdminId, "subscription_payment_refund", [
      paymentId,
      "customer request",
    ]);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await historyCount(fx.subscriptionAId, "payment_refunded")).toBe(1);
    expect(await paymentCount(fx.subscriptionAId)).toBe(1);
    expect((await subRow(fx.subscriptionAId)).payment_status).toBe("unpaid");
  });

  it("T15 anon cannot reach the payment RPCs at all", async () => {
    let err = "no-error";
    try {
      await asAnon(exec, async () => {
        await exec.query(
          `SELECT public.subscription_payment_create($1::uuid, $2::text, $3::text, $4::bigint, $5::text, $6::uuid, $7::uuid)`,
          [fx.shopAId, "mtn_momo", "REF-T15", 36000, null, null, fx.subscriptionAId],
        );
      });
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    expect(err).toMatch(/permission denied/i);

    let confirmErr = "no-error";
    try {
      await asAnon(exec, async () => {
        await exec.query(`SELECT public.subscription_payment_confirm($1::uuid, $2::text, $3::text)`, [
          crypto.randomUUID(),
          null,
          null,
        ]);
      });
    } catch (e) {
      confirmErr = e instanceof Error ? e.message : String(e);
    }
    expect(confirmErr).toMatch(/permission denied/i);
  });

  it("T16 shop owner may start a checkout but never settle it", async () => {
    await resetSubA();
    const created = await create(fx.ownerAId, { reference: "REF-T16" });
    expect(created.ok).toBe(true);

    const paymentId = created.payment_id as string;
    const selfConfirm = await confirm(fx.ownerAId, paymentId);
    expect(selfConfirm.ok).toBe(false);
    expect(String(selfConfirm.error)).toBe("forbidden");
    expect((await paymentRow(paymentId))!.status).toBe("pending");

    // Internal staff can settle the owner-initiated payment.
    expect((await confirm(fx.internalAdminId, paymentId)).ok).toBe(true);
    expect((await paymentRow(paymentId))!.status).toBe("confirmed");
  });

  it("reports whether real two-session PostgreSQL ran", () => {
    if (!exec.isRealPostgres) {
      console.info("Concurrent two-session PostgreSQL test not executed.");
    }
    expect(true).toBe(true);
  });
});
