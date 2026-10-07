/**
 * M3-C — provider attach RPC (real SQL) + stale-replacement finding.
 *
 * Runs the full production chain through
 * 20261007150000_subscription_payment_provider_attach.sql and proves:
 *   - only service_role/internal (settlement authority) can attach — a
 *     customer, even owner/admin/billing, always gets forbidden;
 *   - only a PENDING payment can be attached;
 *   - provider reference / phone / initiated_at are recorded idempotently
 *     with a tightly bounded metadata projection (no arbitrary injection);
 *   - amount, currency, plan, subscription and provider are never touched;
 *   - cross-org attachment is denied (the gate runs per payment);
 *   - M1 conventions: history + audit rows, no phone in history payloads;
 *   - §9 stale-replacement: an initiated payment that gets superseded ends up
 *     cancelled and M1's confirm CORRECTLY refuses to settle it (finding
 *     recorded for M3-E — no reconciliation invented here).
 *
 * MTN/Airtel are not implemented; phone/reference shapes are our own bounded
 * validation, not provider API specs.
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

describe("M3-C — subscription_payment_provider_attach (real SQL)", () => {
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

  async function rpc(userId: string, fn: string, args: unknown[]): Promise<RpcResult> {
    return asUser(exec, userId, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await exec.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      return rpcJson(rows[0]);
    });
  }

  const internal = () => fx.internalAdminId;

  async function createIntent(
    userId: string,
    opts: { shopId?: string; subscriptionId?: string; reference: string },
  ): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_create", [
      opts.shopId ?? fx.shopAId,
      "mtn_momo",
      opts.reference,
      null,
      null,
      null,
      opts.subscriptionId ?? fx.subscriptionAId,
      null,
      null,
    ]);
  }

  async function attach(
    userId: string,
    paymentId: string,
    providerReference: string | null,
    phone: string = PHONE,
  ): Promise<RpcResult> {
    return rpc(userId, "subscription_payment_provider_attach", [
      paymentId,
      providerReference,
      phone,
      null,
    ]);
  }

  async function paymentMeta(paymentId: string): Promise<Record<string, unknown>> {
    return scalar<Record<string, unknown>>(
      `SELECT metadata FROM public.subscription_payments WHERE id = $1`,
      [paymentId],
    ) as unknown as Record<string, unknown>;
  }

  async function paymentSnapshot(paymentId: string) {
    const { rows } = await exec.query<{
      status: string;
      amount_ugx: string;
      currency: string;
      provider: string;
      subscription_id: string;
      plan_id: string;
    }>(
      `SELECT sp.status, sp.amount_ugx::text, sp.currency, sp.provider, sp.subscription_id::text, s.plan_id::text
       FROM public.subscription_payments sp
       JOIN public.subscriptions s ON s.id = sp.subscription_id
       WHERE sp.id = $1`,
      [paymentId],
    );
    return rows[0]!;
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

  // ---- attach behaviour -------------------------------------------------

  it("T1 internal staff can attach: bounded metadata, ledger facts untouched, history+audit written", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T1" });
    expect(created.ok).toBe(true);
    const paymentId = created.payment_id as string;
    const before = await paymentSnapshot(paymentId);

    const result = await attach(internal(), paymentId, "prov-tx-1");
    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.provider_reference).toBe("prov-tx-1");

    const meta = await paymentMeta(paymentId);
    expect(meta.provider_reference).toBe("prov-tx-1");
    expect(meta.phone).toBe(PHONE);
    expect(typeof meta.initiated_at).toBe("string");
    expect(meta.initiated_via).toBe("payment_initiate");
    // Tightly bounded projection — nothing beyond these keys (and create's own).
    expect(Object.keys(meta).sort()).toEqual(
      ["checkout", "created_via", "initiated_at", "initiated_via", "phone", "provider_reference"].sort(),
    );

    const after = await paymentSnapshot(paymentId);
    expect(after.amount_ugx).toBe(before.amount_ugx);
    expect(after.currency).toBe(before.currency);
    expect(after.provider).toBe(before.provider);
    expect(after.subscription_id).toBe(before.subscription_id);
    expect(after.plan_id).toBe(before.plan_id);
    expect(after.status).toBe("pending");

    expect(await historyCount(fx.subscriptionAId, "payment_initiated")).toBe(1);
    expect(
      await scalar<string>(
        `SELECT count(*)::text FROM public.audit_logs WHERE action = 'subscription_payment_provider_attach'`,
      ),
    ).toBe("1");
    // M1 convention: no phone in history payloads (PII stays in metadata only).
    expect(
      await scalar<string>(
        `SELECT count(*)::text FROM public.subscription_history
         WHERE action = 'payment_initiated' AND payload::text LIKE '%${PHONE}%'`,
      ),
    ).toBe("0");
  });

  it("T2 duplicate attach is idempotent: one write, one history row, first values win", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T2" });
    const paymentId = created.payment_id as string;

    const first = await attach(internal(), paymentId, "prov-tx-2", PHONE);
    expect(first.ok).toBe(true);

    // Replay with the SAME provider reference but a different phone: no second
    // write, original values preserved.
    const replay = await attach(internal(), paymentId, "prov-tx-2", "+256780000001");
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);

    const meta = await paymentMeta(paymentId);
    expect(meta.phone).toBe(PHONE); // first phone wins
    expect(meta.provider_reference).toBe("prov-tx-2");
    expect(await historyCount(fx.subscriptionAId, "payment_initiated")).toBe(1);
  });

  it("T3 a different provider reference on an initiated payment is rejected", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T3" });
    const paymentId = created.payment_id as string;
    await attach(internal(), paymentId, "prov-original");

    const conflict = await attach(internal(), paymentId, "prov-different");
    expect(conflict.ok).toBe(false);
    expect(String(conflict.error)).toBe("provider_reference_conflict");
    expect((await paymentMeta(paymentId)).provider_reference).toBe("prov-original");
  });

  it("T4 a provider that issues no reference still records the initiated marker", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T4" });
    const paymentId = created.payment_id as string;

    const first = await attach(internal(), paymentId, null);
    expect(first.ok).toBe(true);
    let meta = await paymentMeta(paymentId);
    expect(typeof meta.initiated_at).toBe("string");
    expect(meta.provider_reference).toBeUndefined();

    // Any further attach is idempotent once initiated — never a second write.
    const second = await attach(internal(), paymentId, "late-ref");
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    meta = await paymentMeta(paymentId);
    expect(meta.provider_reference).toBeUndefined();
    expect(await historyCount(fx.subscriptionAId, "payment_initiated")).toBe(1);
  });

  it("T5 a terminal payment cannot be attached", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T5" });
    const paymentId = created.payment_id as string;
    await rpc(internal(), "subscription_payment_confirm", [paymentId, null, null]);

    const result = await attach(internal(), paymentId, "prov-late");
    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("payment_not_pending");
    expect(result.status).toBe("confirmed");
    expect((await paymentMeta(paymentId)).initiated_at).toBeUndefined();
  });

  it("T6 invalid phone and invalid provider reference shapes are rejected", async () => {
    await resetSubA();
    const badPhone = await createIntent(internal(), { reference: "M3C-T6a" });
    const r1 = await attach(internal(), badPhone.payment_id as string, "prov-1", "0771234567");
    expect(r1.ok).toBe(false);
    expect(String(r1.error)).toBe("invalid_phone");
    expect((await paymentMeta(badPhone.payment_id as string)).initiated_at).toBeUndefined();

    const badRef = await createIntent(internal(), { reference: "M3C-T6b" });
    const r2 = await attach(internal(), badRef.payment_id as string, "<script>alert(1)</script>");
    expect(r2.ok).toBe(false);
    expect(String(r2.error)).toBe("invalid_provider_reference");
    expect((await paymentMeta(badRef.payment_id as string)).initiated_at).toBeUndefined();
  });

  it("T7 customers are always denied — settlement authority only", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T7" });
    const paymentId = created.payment_id as string;

    // Owner and staff of the OWNING organization cannot attach.
    for (const [label, userId] of [
      ["owner", fx.ownerAId],
      ["org staff", fx.cashierAId],
    ] as const) {
      const result = await attach(userId, paymentId, "prov-x");
      expect(result.ok, label).toBe(false);
      expect(String(result.error), label).toBe("forbidden");
    }
    expect((await paymentMeta(paymentId)).initiated_at).toBeUndefined();

    // Internal staff may (settlement posture).
    const ok = await attach(internal(), paymentId, "prov-x");
    expect(ok.ok).toBe(true);
  });

  it("T8 service-role posture can attach (claims-verified)", async () => {
    await resetSubA();
    const created = await createIntent(internal(), { reference: "M3C-T8" });
    const paymentId = created.payment_id as string;

    await exec.exec("BEGIN");
    await exec.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await exec.exec("SET LOCAL ROLE authenticated");
    let result: RpcResult;
    try {
      const { rows } = await exec.query(
        `SELECT public.subscription_payment_provider_attach($1, $2, $3, $4) AS result`,
        [paymentId, "prov-edge", PHONE, null],
      );
      result = rpcJson(rows[0]);
    } finally {
      await exec.exec("ROLLBACK");
    }
    expect(result.ok).toBe(true);
    expect(result.provider_reference).toBe("prov-edge");
  });

  it("T9 cross-org attachment is denied (gate runs per payment)", async () => {
    const foreign = await createIntent(internal(), {
      shopId: fx.shopBId,
      subscriptionId: fx.subscriptionBId,
      reference: "M3C-T9",
    });
    expect(foreign.ok).toBe(true);

    // ownerA belongs to orgA; the payment belongs to orgB.
    const result = await attach(fx.ownerAId, foreign.payment_id as string, "prov-y");
    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("forbidden");
    expect((await paymentMeta(foreign.payment_id as string)).initiated_at).toBeUndefined();
  });

  // ---- §9 stale-replacement finding -------------------------------------

  it("T10 (post M3-E Option C): an initiated payment survives stale replacement, and a cancelled payment can never be settled", async () => {
    await resetSubA();

    // Payment A exists and was handed to the provider.
    const a = await createIntent(internal(), { reference: "M3C-T10-A" });
    expect(a.ok).toBe(true);
    const attached = await attach(internal(), a.payment_id as string, "prov-inflight");
    expect(attached.ok).toBe(true);

    // M3-E Option C: a newer intent no longer stale-replaces an initiated
    // payment — it stays pending until the provider/status flow resolves it.
    const b = await createIntent(internal(), { reference: "M3C-T10-B" });
    expect(b.ok).toBe(true);
    const rowA = await exec.query<{ status: string; provider_reference: string | null }>(
      `SELECT status, metadata ->> 'provider_reference' AS provider_reference
       FROM public.subscription_payments WHERE id = $1`,
      [a.payment_id],
    );
    expect(rowA.rows[0]!.status).toBe("pending");
    expect(rowA.rows[0]!.provider_reference).toBe("prov-inflight");
    const rowB = await exec.query<{ status: string }>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`,
      [b.payment_id],
    );
    expect(rowB.rows[0]!.status).toBe("pending");

    // Terminal-state guarantee (M1, unchanged): once A IS cancelled — by any
    // path — settlement is permanently refused.
    const cancelled = await rpc(internal(), "subscription_payment_cancel", [a.payment_id, "operator_cancel"]);
    expect(cancelled.ok).toBe(true);
    const confirmA = await rpc(internal(), "subscription_payment_confirm", [a.payment_id, null, null]);
    expect(confirmA.ok).toBe(false);
    expect(String(confirmA.error)).toBe("payment_not_confirmable");
    expect(confirmA.status).toBe("cancelled");

    expect((await exec.query<{ status: string }>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`, [a.payment_id],
    )).rows[0]!.status).toBe("cancelled");
    expect((await exec.query<{ status: string }>(
      `SELECT status FROM public.subscription_payments WHERE id = $1`, [b.payment_id],
    )).rows[0]!.status).toBe("pending");
    expect(await historyCount(fx.subscriptionAId, "payment_confirmed")).toBe(0);
    // Option A reconciliation for provider-success-on-cancel lives in the M3-E
    // callback core (stale_success) — covered there.
  });

  // Two-session concurrency is NOT claimed here (PGlite/single session).
  // The genuine suite is subscriptionPaymentConcurrency.sql.integration.test.ts,
  // which FAILS LOUDLY without TEST_DATABASE_URL instead of passing as a no-op.
});
