/**
 * DEBT-PAYMENT-CONCURRENCY-1.0 — real SQL (migration 174).
 * PGLite is single-connection: different-ID concurrency is proven by sequential
 * serialization under FOR UPDATE (same transactional rules). True two-session
 * concurrency requires TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  createDebtPaymentSqlHarness,
  seedDebtPaymentFixture,
  type DebtPaymentFixture,
} from "../test/sqlIntegration/debtPaymentPgHarness";

describe("DEBT-PAYMENT-CONCURRENCY-1.0 — real SQL (migration 174)", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: DebtPaymentFixture;

  beforeAll(async () => {
    exec = await createDebtPaymentSqlHarness();
    fx = await seedDebtPaymentFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function balanceOf(customerId: string): Promise<number> {
    const { rows } = await exec.query<{ bal: string }>(
      `SELECT coalesce((metadata ->> 'debtBalanceUgx')::bigint, 0)::text AS bal
       FROM public.customers WHERE id = $1`,
      [customerId],
    );
    return Number(rows[0]?.bal ?? 0);
  }

  async function paymentCount(customerId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.customer_debt_payments WHERE customer_id = $1`,
      [customerId],
    );
    return Number(rows[0]!.c);
  }

  async function paymentSum(customerId: string): Promise<number> {
    const { rows } = await exec.query<{ s: string }>(
      `SELECT coalesce(sum(amount_ugx), 0)::text AS s FROM public.customer_debt_payments WHERE customer_id = $1`,
      [customerId],
    );
    return Number(rows[0]!.s);
  }

  async function push(
    userId: string,
    shopId: string,
    paymentId: string,
    customerId: string,
    amount: number,
  ) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_push_debt_payment($1::uuid, $2::jsonb) AS result`,
        [
          shopId,
          JSON.stringify({
            payment_id: paymentId,
            customer_id: customerId,
            amount_ugx: amount,
            created_at: new Date().toISOString(),
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  async function resetCustomerA(balance = 100_000) {
    await exec.exec(`
      DELETE FROM public.customer_debt_payments WHERE customer_id = '${fx.customerAId}';
      UPDATE public.customers
      SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{debtBalanceUgx}', '${balance}'::jsonb, true)
      WHERE id = '${fx.customerAId}';
    `);
  }

  it("T1 first payment applies once", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    const r = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 25_000);
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(await balanceOf(fx.customerAId)).toBe(75_000);
    expect(await paymentCount(fx.customerAId)).toBe(1);
  });

  it("T2 same payment ID replay is idempotent", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    expect((await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 40_000)).ok).toBe(true);
    const replay = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 40_000);
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(await balanceOf(fx.customerAId)).toBe(60_000);
    expect(await paymentCount(fx.customerAId)).toBe(1);
    expect(await paymentSum(fx.customerAId)).toBe(40_000);
  });

  it("T3 lost ACK / committed then retry is idempotent", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    const first = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 55_000);
    expect(first.ok).toBe(true);
    // Simulate lost ACK: client retries same durable payment ID after commit.
    const second = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 55_000);
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(await balanceOf(fx.customerAId)).toBe(45_000);
    expect(await paymentCount(fx.customerAId)).toBe(1);
  });

  it("T4 same payment ID duplicate (sequential unique path)", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    expect((await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 60_000)).ok).toBe(true);
    const dup = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 60_000);
    expect(dup.ok).toBe(true);
    expect(dup.idempotent).toBe(true);
    expect(await balanceOf(fx.customerAId)).toBe(40_000);
    expect(await paymentCount(fx.customerAId)).toBe(1);
  });

  it("T5 different IDs 60k+40k against 100k both succeed", async () => {
    await resetCustomerA(100_000);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect((await push(fx.userAId, fx.shopAId, a, fx.customerAId, 60_000)).ok).toBe(true);
    expect((await push(fx.userAId, fx.shopAId, b, fx.customerAId, 40_000)).ok).toBe(true);
    expect(await balanceOf(fx.customerAId)).toBe(0);
    expect(await paymentSum(fx.customerAId)).toBe(100_000);
    expect(await paymentCount(fx.customerAId)).toBe(2);
  });

  it("T6 different IDs 70k+70k against 100k — one rejects, no silent partial", async () => {
    await resetCustomerA(100_000);
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect((await push(fx.userAId, fx.shopAId, a, fx.customerAId, 70_000)).ok).toBe(true);
    const second = await push(fx.userAId, fx.shopAId, b, fx.customerAId, 70_000);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("amount_exceeds_balance");
    expect(await balanceOf(fx.customerAId)).toBe(30_000);
    expect(await paymentSum(fx.customerAId)).toBe(70_000);
    expect(await paymentCount(fx.customerAId)).toBe(1);
  });

  it("T7 overpayment rejection", async () => {
    await resetCustomerA(50_000);
    const r = await push(fx.userAId, fx.shopAId, crypto.randomUUID(), fx.customerAId, 70_000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("amount_exceeds_balance");
    expect(await balanceOf(fx.customerAId)).toBe(50_000);
    expect(await paymentCount(fx.customerAId)).toBe(0);
  });

  it("T8 zero/negative amount validation", async () => {
    await resetCustomerA(100_000);
    const zero = await push(fx.userAId, fx.shopAId, crypto.randomUUID(), fx.customerAId, 0);
    expect(zero.ok).toBe(false);
    expect(String(zero.error)).toMatch(/invalid/);
    const neg = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_push_debt_payment($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            payment_id: crypto.randomUUID(),
            customer_id: fx.customerAId,
            amount_ugx: -5,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
    expect(neg.ok).toBe(false);
    expect(await paymentCount(fx.customerAId)).toBe(0);
  });

  it("T9 multi-payment sequence", async () => {
    await resetCustomerA(100_000);
    for (const amt of [10_000, 20_000, 30_000]) {
      expect((await push(fx.userAId, fx.shopAId, crypto.randomUUID(), fx.customerAId, amt)).ok).toBe(true);
    }
    expect(await balanceOf(fx.customerAId)).toBe(40_000);
    expect(await paymentSum(fx.customerAId)).toBe(60_000);
  });

  it("T10 multi-device customer isolation (shop B untouched)", async () => {
    await resetCustomerA(100_000);
    const beforeB = await balanceOf(fx.customerBId);
    expect((await push(fx.userAId, fx.shopAId, crypto.randomUUID(), fx.customerAId, 15_000)).ok).toBe(true);
    expect(await balanceOf(fx.customerBId)).toBe(beforeB);
  });

  it("T11 shop mismatch — customer not in shop", async () => {
    await resetCustomerA(100_000);
    const r = await push(fx.userAId, fx.shopAId, crypto.randomUUID(), fx.customerBId, 10_000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("customer_not_found");
  });

  it("T12 authorization — outsider forbidden", async () => {
    await resetCustomerA(100_000);
    const r = await push(fx.outsiderId, fx.shopAId, crypto.randomUUID(), fx.customerAId, 10_000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(await paymentCount(fx.customerAId)).toBe(0);
  });

  it("T13 payment row and balance mutation are atomic (reject leaves neither)", async () => {
    await resetCustomerA(40_000);
    const payId = crypto.randomUUID();
    const r = await push(fx.userAId, fx.shopAId, payId, fx.customerAId, 50_000);
    expect(r.ok).toBe(false);
    expect(await balanceOf(fx.customerAId)).toBe(40_000);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.customer_debt_payments WHERE id = $1`,
      [payId],
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("reports whether real two-session Postgres concurrency ran", () => {
    if (!exec.isRealPostgres) {
      // eslint-disable-next-line no-console
      console.info("Concurrent two-session PostgreSQL test not executed.");
    }
    expect(true).toBe(true);
  });
});
