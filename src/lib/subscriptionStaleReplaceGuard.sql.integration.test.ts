/**
 * M3-E — stale-replace guard for provider-initiated payments (real SQL).
 *
 * Runs the full production chain through
 * 20261007180000_subscription_payment_stale_replace_guard.sql and proves the
 * approved Option C behaviour against the real M3-A create function:
 *
 *   A. pending WITHOUT metadata.initiated_at is still stale-replaced
 *      (M3-A behaviour unchanged for ordinary checkouts);
 *   B. pending WITH metadata.initiated_at is NEVER stale-replaced —
 *      provider-initiated payments stay pending until the provider/status
 *      flow resolves them (closes the proven charged-but-unsettled path);
 *   C. a surviving initiated payment settles normally through confirm;
 *   D. replay ×100 on the real confirm RPC settles exactly once (one history
 *      row, one period advance) — the ledger half of M3-E test requirement 17.
 *
 * PGLite is single-connection: real two-session concurrency still requires
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

type RpcResult = Record<string, unknown>;

const PHONE = "+256781234567";

describe("M3-E — stale-replace guard (real SQL)", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: SubscriptionPaymentFixture;

  beforeAll(async () => {
    exec = await createSubscriptionPaymentSqlHarness();
    fx = await seedSubscriptionPaymentFixture(exec);
  }, 300_000);

  afterAll(async () => {
    await exec?.close();
  });

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

  const internal = () => fx.internalAdminId;

  async function createIntent(reference: string): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_create", [
      fx.shopAId,
      "mtn_momo",
      reference,
      null,
      null,
      null,
      fx.subscriptionAId,
      null,
      null,
    ]);
  }

  async function attach(paymentId: string, providerReference: string): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_provider_attach", [
      paymentId,
      providerReference,
      PHONE,
      null,
    ]);
  }

  async function confirm(paymentId: string): Promise<RpcResult> {
    return rpc(internal(), "subscription_payment_confirm", [paymentId, null, null]);
  }

  async function row(paymentId: string) {
    const { rows } = await exec.query<{
      status: string;
      status_reason: string | null;
      provider_reference: string | null;
      initiated_at: string | null;
    }>(
      `SELECT status, status_reason,
              metadata ->> 'provider_reference' AS provider_reference,
              metadata ->> 'initiated_at' AS initiated_at
       FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    );
    return rows[0]!;
  }

  async function resetSubA() {
    await exec.exec(`
      DELETE FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}';
      DELETE FROM public.subscription_history WHERE subscription_id = '${fx.subscriptionAId}';
      UPDATE public.subscriptions
      SET status = 'trialing', payment_status = 'unknown',
          current_period_start = now() - interval '10 days',
          current_period_end = now() + interval '20 days',
          trial_ends_at = NULL, metadata = '{}'::jsonb,
          shop_id = '${fx.shopAId}', updated_at = now()
      WHERE id = '${fx.subscriptionAId}';
    `);
  }

  async function historyCount(action: string, statusReason?: string): Promise<number> {
    return Number(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history
         WHERE subscription_id = $1 AND action = $2
           AND ($3::text IS NULL OR payload ->> 'status_reason' = $3)`,
        [fx.subscriptionAId, action, statusReason ?? null],
      ),
    );
  }

  it("A: an ordinary pending payment (no initiated_at) is still stale-replaced", async () => {
    await resetSubA();
    const first = await createIntent("M3E-A1");
    expect(first.ok).toBe(true);
    const second = await createIntent("M3E-A2");
    expect(second.ok).toBe(true);

    const firstRow = await row(first.payment_id as string);
    expect(firstRow.status).toBe("cancelled");
    expect(firstRow.status_reason).toBe("stale_replaced");
    expect(firstRow.initiated_at).toBeNull();
    expect((await row(second.payment_id as string)).status).toBe("pending");
    expect(await historyCount("payment_cancelled", "stale_replaced")).toBe(1);
  });

  it("B: a provider-initiated payment is NEVER stale-replaced", async () => {
    await resetSubA();
    const a = await createIntent("M3E-B1");
    expect(a.ok).toBe(true);
    const attached = await attach(a.payment_id as string, "prov-b1");
    expect(attached.ok).toBe(true);

    // New intents arrive — A must survive (provider may still pay it).
    const b = await createIntent("M3E-B2");
    expect(b.ok).toBe(true);
    const c = await createIntent("M3E-B3");
    expect(c.ok).toBe(true);

    const aRow = await row(a.payment_id as string);
    expect(aRow.status).toBe("pending"); // NOT cancelled despite two supersessions
    expect(aRow.provider_reference).toBe("prov-b1"); // linkage intact
    expect(aRow.initiated_at).toBeTruthy();

    // The ordinary pendings were still replaced as before.
    expect((await row(b.payment_id as string)).status).toBe("cancelled");
    expect((await row(c.payment_id as string)).status).toBe("pending");
    expect(await historyCount("payment_cancelled", "stale_replaced")).toBe(1); // only B
  });

  it("C: the surviving initiated payment settles normally; superseded ordinary payments never do", async () => {
    await resetSubA();
    const a = await createIntent("M3E-C1");
    await attach(a.payment_id as string, "prov-c1");
    const b = await createIntent("M3E-C2"); // B ordinary → will be replaced later
    const before = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`,
    );

    const confirmed = await confirm(a.payment_id as string);
    expect(confirmed.ok).toBe(true);
    const after = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`,
    );
    expect(after).not.toBe(before); // the initiated payment's money moved the period

    // A new intent now replaces only the still-pending ordinary payment.
    const c = await createIntent("M3E-C3");
    expect(c.ok).toBe(true);
    expect((await row(a.payment_id as string)).status).toBe("confirmed"); // untouched
    expect((await row(b.payment_id as string)).status).toBe("cancelled");
    expect((await row(c.payment_id as string)).status).toBe("pending");

    // Replaying the provider success is idempotent (no second advance).
    const replay = await confirm(a.payment_id as string);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    const afterReplay = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`,
    );
    expect(afterReplay).toBe(after);
  });

  it("D: replay ×100 on the real confirm RPC settles exactly once", async () => {
    await resetSubA();
    const intent = await createIntent("M3E-REPLAY");
    expect(intent.ok).toBe(true);
    const paymentId = intent.payment_id as string;

    const first = await confirm(paymentId);
    expect(first.ok).toBe(true);
    expect(first.idempotent).toBe(false);
    const periodAfterFirst = await scalar<string>(
      `SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`,
    );
    const planAfterFirst = await scalar<string>(
      `SELECT plan_id::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`,
    );

    for (let i = 0; i < 99; i += 1) {
      const replay = await confirm(paymentId);
      expect(replay.ok).toBe(true);
      expect(replay.idempotent).toBe(true);
    }

    expect(await historyCount("payment_confirmed")).toBe(1); // exactly one history row
    expect(
      await scalar<string>(`SELECT current_period_end::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`),
    ).toBe(periodAfterFirst); // exactly one period advancement
    expect(
      await scalar<string>(`SELECT plan_id::text FROM public.subscriptions WHERE id = '${fx.subscriptionAId}'`),
    ).toBe(planAfterFirst); // plan applied exactly once
    expect(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_payments WHERE subscription_id = '${fx.subscriptionAId}'`,
      ),
    ).toBe("1");
  });

  it("reports whether real two-session PostgreSQL ran", () => {
    if (!exec.isRealPostgres) {
      console.info("Concurrent two-session PostgreSQL test not executed.");
    }
    expect(true).toBe(true);
  });
});
