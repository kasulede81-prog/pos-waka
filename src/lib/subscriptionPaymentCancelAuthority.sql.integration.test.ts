/**
 * CUSTOMER PAYMENT CANCELLATION — real SQL (20261008090000).
 *
 * A paying customer could not abandon their own pending checkout: the cancel
 * RPC was gated by `_subscription_payment_can_settle`, whose contract is
 * "webhooks and internal billing roles only — a shop owner must not be able to
 * confirm their own payment into existence". That contract is right for
 * confirm/fail/refund (they GRANT entitlement) and wrong for cancelling a
 * pending intent, which grants nothing.
 *
 * This suite pins both halves of the fix, against production-shaped fixtures
 * and the production grant posture:
 *
 *   * the customer side — owner/admin may abandon their OWN pending payment;
 *   * the settlement side — confirm / fail / refund remain settlement-only, so
 *     a shop owner still cannot confirm their own payment into existence.
 *
 * The second half is the load-bearing one: loosening cancel must not have
 * loosened settlement, and only a test that tries it as an owner proves that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, type SqlExec } from "../test/sqlIntegration/loyaltyPgHarness";
import {
  createSubscriptionPaymentSqlHarness,
  rpcJson,
  seedSubscriptionPaymentFixture,
  type SubscriptionPaymentFixture,
} from "../test/sqlIntegration/subscriptionPaymentPgHarness";

type RpcResult = Record<string, unknown>;

describe("customer payment cancellation authority (real SQL)", () => {
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

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<RpcResult> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  const cancel = (userId: string, paymentId: string, reason = "customer_abandoned_checkout") =>
    rpc(userId, "subscription_payment_cancel", [paymentId, reason]);

  const confirm = (userId: string, paymentId: string) =>
    rpc(userId, "subscription_payment_confirm", [paymentId, null, null]);

  const fail = (userId: string, paymentId: string) =>
    rpc(userId, "subscription_payment_fail", [paymentId, "provider_reported_failure"]);

  const refund = (userId: string, paymentId: string) =>
    rpc(userId, "subscription_payment_refund", [paymentId, "requested"]);

  const create = (userId: string, reference: string, shopId = fx.shopAId, subscriptionId = fx.subscriptionAId) =>
    rpc(userId, "subscription_payment_create", [
      shopId,
      "mtn_momo",
      reference,
      null,
      null,
      null,
      subscriptionId,
    ]);

  const paymentStatus = (paymentId: string) =>
    scalar<string | null>(`SELECT status FROM public.subscription_payments WHERE id = $1`, [paymentId]);

  const periodEnd = (subscriptionId: string) =>
    scalar<string | null>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = $1`,
      [subscriptionId],
    );

  const paymentStatusOfSub = (subscriptionId: string) =>
    scalar<string | null>(`SELECT payment_status FROM public.subscriptions WHERE id = $1`, [
      subscriptionId,
    ]);

  async function resetSubA() {
    await exec.exec(`
      DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}';
      DELETE FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions
         SET payment_status = 'unpaid'
       WHERE id = '${fx.subscriptionAId}';
    `);
  }

  /** A fresh pending payment created BY THE OWNER — the production shape. */
  async function pendingOwnedByCustomer(reference: string): Promise<string> {
    const created = await create(fx.ownerAId, reference);
    expect(created.ok).toBe(true);
    expect(created.status).toBe("pending");
    return created.payment_id as string;
  }

  // ---- the fix: the customer can abandon their own pending payment -------

  it("T1 org owner cancels their OWN pending payment", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-1");
    const before = await periodEnd(fx.subscriptionAId);

    const result = await cancel(fx.ownerAId, paymentId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(await paymentStatus(paymentId)).toBe("cancelled");

    // Abandonment grants nothing: the period is untouched and the subscription
    // is not marked paid.
    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    expect(await paymentStatusOfSub(fx.subscriptionAId)).not.toBe("paid");
  });

  it("T2 internal billing admin can still cancel (unchanged path)", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-2");

    const result = await cancel(fx.internalAdminId, paymentId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("cancelled");
  });

  it("T3 a different organization's owner CANNOT cancel this payment", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-3");

    const result = await cancel(fx.ownerId, paymentId); // owner of org B

    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("forbidden");
    expect(await paymentStatus(paymentId)).toBe("pending");
  });

  it("T4 cashier and outsider cannot cancel", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-4");

    for (const actor of [fx.cashierAId, fx.outsiderId]) {
      const result = await cancel(actor, paymentId);
      expect(result.ok).toBe(false);
      expect(String(result.error)).toBe("forbidden");
    }
    expect(await paymentStatus(paymentId)).toBe("pending");
  });

  // ---- state machine preserved ------------------------------------------

  it("T5 already-cancelled stays idempotent", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-5");

    expect((await cancel(fx.ownerAId, paymentId)).ok).toBe(true);
    const again = await cancel(fx.ownerAId, paymentId);

    expect(again.ok).toBe(true);
    expect(again.idempotent).toBe(true);
    expect(again.status).toBe("cancelled");
  });

  it("T6 a confirmed payment cannot be cancelled", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-6");
    // Settled by settlement authority, exactly as a provider callback would.
    expect((await confirm(fx.internalAdminId, paymentId)).ok).toBe(true);

    const result = await cancel(fx.ownerAId, paymentId);

    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("payment_not_cancelable");
    expect(await paymentStatus(paymentId)).toBe("confirmed");
  });

  it("T7 a failed payment cannot be cancelled", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-7");
    expect((await fail(fx.internalAdminId, paymentId)).ok).toBe(true);

    const result = await cancel(fx.ownerAId, paymentId);

    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("payment_not_cancelable");
    expect(await paymentStatus(paymentId)).toBe("failed");
  });

  it("T8 a nonexistent payment stays masked", async () => {
    await resetSubA();
    const result = await cancel(fx.ownerAId, crypto.randomUUID());
    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("payment_not_found");
  });

  // ---- settlement authority must NOT have moved -------------------------

  it("T9 an owner still CANNOT confirm their own payment into existence", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-9");
    const before = await periodEnd(fx.subscriptionAId);

    const result = await confirm(fx.ownerAId, paymentId);

    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("forbidden");
    // The whole point of the settlement gate: no entitlement from the customer.
    expect(await paymentStatus(paymentId)).toBe("pending");
    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    expect(await paymentStatusOfSub(fx.subscriptionAId)).not.toBe("paid");
  });

  it("T10 an owner cannot fail or refund either", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-10");

    for (const [name, call] of [
      ["fail", fail],
      ["refund", refund],
    ] as const) {
      const result = await call(fx.ownerAId, paymentId);
      expect(result.ok, `${name} must stay settlement-only`).toBe(false);
      expect(String(result.error), `${name} must stay settlement-only`).toBe("forbidden");
    }
    expect(await paymentStatus(paymentId)).toBe("pending");
  });

  it("T11 late provider success against a cancelled payment cannot resurrect it", async () => {
    await resetSubA();
    const paymentId = await pendingOwnedByCustomer("REF-CAN-11");
    const before = await periodEnd(fx.subscriptionAId);
    expect((await cancel(fx.ownerAId, paymentId)).ok).toBe(true);

    // The provider settles late; the callback's confirm is refused, which is
    // what callbackSettle maps to `stale_success` + reconciliation.
    const late = await confirm(fx.internalAdminId, paymentId);

    expect(late.ok).toBe(false);
    expect(String(late.error)).toBe("payment_not_confirmable");
    expect(await paymentStatus(paymentId)).toBe("cancelled");
    expect(await periodEnd(fx.subscriptionAId)).toBe(before);
    expect(await paymentStatusOfSub(fx.subscriptionAId)).not.toBe("paid");
  });

  // ---- no provider, no schema change ------------------------------------

  it("T12 cancellation remains a pure ledger transition (no provider call)", async () => {
    // The RPC must not reach the provider: provider-side reversal is not
    // implemented, and cancelling is explicitly "the payer abandoned this
    // checkout", never a claim that MTN reversed anything.
    const { rows } = await exec.query<{ body: string }>(
      `SELECT pg_get_functiondef(p.oid) AS body
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'subscription_payment_cancel'`,
    );
    const body = String(rows[0]?.body ?? "").toLowerCase();
    expect(body).not.toContain("net.http");
    expect(body).not.toContain("pg_net");
    // …and it cannot grant entitlement: it never advances a period or marks a
    // subscription paid.
    expect(body).not.toContain("_subscription_payment_advance_period");
    expect(body).not.toContain("payment_status = 'paid'");
  });

  it("T13 the live function uses the customer-facing gate, not the settlement gate", async () => {
    const { rows } = await exec.query<{ body: string }>(
      `SELECT pg_get_functiondef(p.oid) AS body
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'subscription_payment_cancel'`,
    );
    const body = String(rows[0]?.body ?? "");
    expect(body).toContain("_subscription_payment_can_initiate");

    // The settlement gate must remain in force for confirm / fail / refund.
    for (const fn of ["subscription_payment_confirm", "subscription_payment_fail", "subscription_payment_refund"]) {
      const { rows: r } = await exec.query<{ body: string }>(
        `SELECT pg_get_functiondef(p.oid) AS body
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1`,
        [fn],
      );
      expect(String(r[0]?.body ?? ""), `${fn} must keep the settlement gate`).toContain(
        "_subscription_payment_can_settle",
      );
    }
  });
});
