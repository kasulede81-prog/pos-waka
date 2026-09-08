/**
 * WAKA-05 — real SQL (migration 182): the debt-payment cursor column is stamped
 * by the server, and the client's clock is preserved separately.
 *
 * `customer_debt_payments.created_at` is the incremental pull cursor
 * (`.gt("created_at", lastDebtPaymentsSyncAt)`). Before migration 182 the RPC
 * wrote that column straight from the client payload, so a terminal with a slow
 * clock inserted rows that already sat behind other devices' cursors and were
 * never delivered — the input to the ledger-authoritative debt recompute, and
 * therefore to customer re-billing.
 *
 * These tests run the actual migration SQL under PGLite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, rpcJson, type SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";
import {
  createDebtPaymentSqlHarness,
  seedDebtPaymentFixture,
  type DebtPaymentFixture,
} from "../test/sqlIntegration/debtPaymentPgHarness";

describe("WAKA-05 — server-authoritative sync timestamps (migration 182)", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: DebtPaymentFixture;

  beforeAll(async () => {
    exec = await createDebtPaymentSqlHarness();
    fx = await seedDebtPaymentFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function push(paymentId: string, amount: number, clientCreatedAt: string) {
    return asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_push_debt_payment($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            payment_id: paymentId,
            customer_id: fx.customerAId,
            amount_ugx: amount,
            created_at: clientCreatedAt,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
  }

  async function timestampsOf(paymentId: string) {
    const { rows } = await exec.query<{
      created_at: string;
      client_created_at: string | null;
      server_drift_seconds: string;
    }>(
      `SELECT created_at,
              client_created_at,
              extract(epoch FROM (now() - created_at))::text AS server_drift_seconds
         FROM public.customer_debt_payments
        WHERE id = $1`,
      [paymentId],
    );
    return rows[0]!;
  }

  async function resetCustomerA(balance = 100_000) {
    await exec.exec(`
      DELETE FROM public.customer_debt_payments WHERE customer_id = '${fx.customerAId}';
      UPDATE public.customers
      SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{debtBalanceUgx}', '${balance}'::jsonb, true)
      WHERE id = '${fx.customerAId}';
    `);
  }

  it("the client_created_at column exists and is documented as non-cursor", async () => {
    const { rows } = await exec.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customer_debt_payments'
          AND column_name = 'client_created_at'`,
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * THE WAKA-05 WRITE-SIDE REGRESSION.
   *
   * A terminal whose clock is an hour slow. Before migration 182 the row landed
   * with created_at one hour in the past, behind every other device's cursor.
   */
  it("a slow client clock does NOT move the cursor column backwards", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    const oneHourSlow = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    expect((await push(payId, 25_000, oneHourSlow)).ok).toBe(true);

    const ts = await timestampsOf(payId);
    // created_at is server "now", not the client's hour-old timestamp.
    expect(Math.abs(Number(ts.server_drift_seconds))).toBeLessThan(120);
    expect(new Date(ts.created_at).getTime()).toBeGreaterThan(new Date(oneHourSlow).getTime() + 60_000);
    // …and the cashier's own clock is preserved for business-date reporting.
    expect(ts.client_created_at).not.toBeNull();
    expect(new Date(ts.client_created_at!).toISOString()).toBe(oneHourSlow);
  });

  /**
   * The mirror case: a fast clock must not push the cursor into the future
   * either, or every row written by other devices in the gap is skipped.
   */
  it("a fast client clock does NOT move the cursor column forwards", async () => {
    await resetCustomerA(100_000);
    const payId = crypto.randomUUID();
    const tenMinutesFast = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    expect((await push(payId, 10_000, tenMinutesFast)).ok).toBe(true);

    const ts = await timestampsOf(payId);
    expect(new Date(ts.created_at).getTime()).toBeLessThan(new Date(tenMinutesFast).getTime());
    expect(Math.abs(Number(ts.server_drift_seconds))).toBeLessThan(120);
    expect(new Date(ts.client_created_at!).toISOString()).toBe(tenMinutesFast);
  });

  /**
   * Cursor monotonicity: payments inserted in order get server timestamps in
   * that order, whatever the client clocks claimed. This is what makes
   * `.gt("created_at", cursor)` a safe keyset for debt payments.
   */
  it("server timestamps are monotonic across skewed clients", async () => {
    await resetCustomerA(100_000);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    // The second payment claims a much EARLIER client time than the first.
    await push(first, 10_000, new Date(Date.now() + 5 * 60 * 1000).toISOString());
    await push(second, 10_000, new Date(Date.now() - 5 * 60 * 1000).toISOString());

    const a = await timestampsOf(first);
    const b = await timestampsOf(second);
    expect(new Date(b.created_at).getTime()).toBeGreaterThanOrEqual(new Date(a.created_at).getTime());
  });

  /**
   * `customers.updated_at` is the customers pull cursor and reaches the table
   * through a client `.upsert()`. The trigger must stamp it on INSERT too.
   */
  it("customers.updated_at is server-stamped on INSERT, not taken from the client", async () => {
    const customerId = crypto.randomUUID();
    const clientClaim = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await exec.query(
      `INSERT INTO public.customers (id, shop_id, name, metadata, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'Skewed Clock Ltd', '{}'::jsonb, $3::timestamptz, $3::timestamptz)`,
      [customerId, fx.shopAId, clientClaim],
    );

    const { rows } = await exec.query<{ drift: string }>(
      `SELECT extract(epoch FROM (now() - updated_at))::text AS drift
         FROM public.customers WHERE id = $1`,
      [customerId],
    );
    expect(Math.abs(Number(rows[0]!.drift))).toBeLessThan(120);
  });

  it("shop_server_now is authenticated server time, not a client clock", async () => {
    const anon = await exec.query<{ n: string | null }>(`SELECT public.shop_server_now() AS n`);
    expect(anon.rows[0]!.n).toBeNull();

    const authed = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query<{ n: string; drift: string }>(
        `SELECT public.shop_server_now() AS n,
                extract(epoch FROM (now() - public.shop_server_now()))::text AS drift`,
      );
      return rows[0]!;
    });
    expect(authed.n).toBeTruthy();
    expect(Math.abs(Number(authed.drift))).toBeLessThan(2);
  });
});
