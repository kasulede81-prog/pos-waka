import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asUser,
  createClosedBusinessDateSqlHarness,
  insertActiveClose,
  rpcJson,
  seedClosedDateFixture,
  type ClosedDateFixture,
} from "../test/sqlIntegration/closedBusinessDatePgHarness";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

const CLOSED = "2026-09-04";
const OPEN = "2026-09-05";
const CLOSED_TS = "2026-09-04T12:00:00+03:00";
const OPEN_TS = "2026-09-05T12:00:00+03:00";

const SQL_150 = readFileSync(
  join(process.cwd(), "supabase/migrations/150_one_active_day_close_per_shop_date.sql"),
  "utf8",
);
const SQL_175 = readFileSync(
  join(process.cwd(), "supabase/migrations/175_closed_business_date_guard.sql"),
  "utf8",
);

async function insertOrError(exec: SqlExec, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await exec.query(sql, params);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("CASH-CONTROL-01 server closed business-date guard", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: ClosedDateFixture;

  beforeAll(async () => {
    exec = await createClosedBusinessDateSqlHarness();
    fx = await seedClosedDateFixture(exec);
    await insertActiveClose(exec, fx.shopAId, CLOSED);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  it("uses the same advisory lock as shop_push_day_close", () => {
    expect(SQL_150).toContain("pg_advisory_xact_lock (hashtext (p_shop_id::text), hashtext (v_date_key))");
    expect(SQL_175).toContain("pg_advisory_xact_lock (hashtext (p_shop_id::text), hashtext (v_date_key))");
  });

  it("A — open date sale insert succeeds", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 30000, 30000, $3::timestamptz)`,
      [id, fx.shopAId, OPEN_TS],
    );
    expect(err).toBeNull();
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.sales WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });

  it("B — closed date sale insert is rejected", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 30000, 30000, $3::timestamptz)`,
      [id, fx.shopAId, CLOSED_TS],
    );
    expect(err).toMatch(/closed_business_date/);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.sales WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("C — closed date expense is rejected", async () => {
    const result = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_push_cash_expense($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            id: crypto.randomUUID(),
            category: "transport",
            amount_ugx: 5000,
            paid_on: CLOSED,
            created_at: CLOSED_TS,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("closed_business_date");
  });

  it("D — closed date supplier payment is rejected", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.shop_supplier_payments (id, shop_id, supplier_id, amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 8000, $4::timestamptz)`,
      [id, fx.shopAId, crypto.randomUUID(), CLOSED_TS],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("E — closed date debt payment is rejected", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.customer_debt_payments (id, shop_id, customer_id, amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 4000, $4::timestamptz)`,
      [id, fx.shopAId, fx.customerAId, CLOSED_TS],
    );
    expect(err).toMatch(/closed_business_date/);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.customer_debt_payments WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("F — closed date cash adjustment is rejected", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.shop_cash_drawer_adjustments
         (id, shop_id, adjustment_type, amount_ugx, occurred_at)
       VALUES ($1::uuid, $2::uuid, 'cash_added', 2000, $3::timestamptz)`,
      [id, fx.shopAId, CLOSED_TS],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("G — closed date return is rejected", async () => {
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.sale_returns (id, shop_id, quantity, refund_amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 1, 3000, $3::timestamptz)`,
      [id, fx.shopAId, CLOSED_TS],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("H — different open date succeeds", async () => {
    const guard = await exec.query<{ result: unknown }>(
      `SELECT public.assert_shop_business_date_open($1::uuid, $2::text) AS result`,
      [fx.shopAId, OPEN],
    );
    expect(rpcJson(guard.rows[0]).ok).toBe(true);
    const id = crypto.randomUUID();
    const err = await insertOrError(
      exec,
      `INSERT INTO public.shop_cash_drawer_adjustments
         (id, shop_id, adjustment_type, amount_ugx, occurred_at)
       VALUES ($1::uuid, $2::uuid, 'cash_removed', 1000, $3::timestamptz)`,
      [id, fx.shopAId, OPEN_TS],
    );
    expect(err).toBeNull();
  });

  it("I — another shop's closed date cannot block this shop", async () => {
    const shopBOnAClosedDate = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 10000, $3::timestamptz)`,
      [crypto.randomUUID(), fx.shopBId, CLOSED_TS],
    );
    expect(shopBOnAClosedDate).toBeNull();
    const blockedOnA = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 10000, $3::timestamptz)`,
      [crypto.randomUUID(), fx.shopAId, CLOSED_TS],
    );
    expect(blockedOnA).toMatch(/closed_business_date/);
    const otherShopSameDate = await exec.query<{ result: unknown }>(
      `SELECT public.assert_shop_business_date_open($1::uuid, $2::text) AS result`,
      [fx.shopBId, CLOSED],
    );
    expect(rpcJson(otherShopSameDate.rows[0]).ok).toBe(true);
  });

  it("J — superseded / reopened date allows mutations again", async () => {
    const reopenDay = "2026-09-03";
    const reopenTs = "2026-09-03T12:00:00+03:00";
    const closeId = await insertActiveClose(exec, fx.shopAId, reopenDay);
    const before = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 1000, $3::timestamptz)`,
      [crypto.randomUUID(), fx.shopAId, reopenTs],
    );
    expect(before).toMatch(/closed_business_date/);

    await exec.exec(`
      UPDATE public.shop_day_closes
      SET superseded_at = now()
      WHERE id = '${closeId}';
    `);

    const afterId = crypto.randomUUID();
    const after = await insertOrError(
      exec,
      `INSERT INTO public.sales (id, shop_id, status, total_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 1000, $3::timestamptz)`,
      [afterId, fx.shopAId, reopenTs],
    );
    expect(after).toBeNull();
  });

  it("K — replayed rejected mutation does not create a row", async () => {
    const id = crypto.randomUUID();
    const sql = `INSERT INTO public.sales (id, shop_id, status, total_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 'completed', 9000, $3::timestamptz)`;
    expect(await insertOrError(exec, sql, [id, fx.shopAId, CLOSED_TS])).toMatch(/closed_business_date/);
    expect(await insertOrError(exec, sql, [id, fx.shopAId, CLOSED_TS])).toMatch(/closed_business_date/);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.sales WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("L — after the close invariant is established, mutations cannot commit", async () => {
    const guardClosed = await exec.query<{ result: unknown }>(
      `SELECT public.assert_shop_business_date_open($1::uuid, $2::text) AS result`,
      [fx.shopAId, CLOSED],
    );
    expect(rpcJson(guardClosed.rows[0]).ok).toBe(false);
    expect(rpcJson(guardClosed.rows[0]).error).toBe("closed_business_date");
    const err = await insertOrError(
      exec,
      `INSERT INTO public.expenses (id, shop_id, category, amount_ugx, paid_on)
       VALUES ($1::uuid, $2::uuid, 'rent', 15000, $3::date)`,
      [crypto.randomUUID(), fx.shopAId, CLOSED],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("day close itself is not blocked by the mutation guard", async () => {
    const day = "2026-09-06";
    await insertActiveClose(exec, fx.shopAId, day);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.shop_day_closes
       WHERE shop_id = $1 AND date_key = $2 AND superseded_at IS NULL`,
      [fx.shopAId, day],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });
});
