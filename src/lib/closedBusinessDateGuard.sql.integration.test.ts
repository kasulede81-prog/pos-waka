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
const SQL_176 = readFileSync(
  join(process.cwd(), "supabase/migrations/176_closed_business_date_update_guard.sql"),
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

describe("NEW-04 server closed-date UPDATE guard", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: ClosedDateFixture;

  const UPD_DAY = "2026-09-07";
  const UPD_TS = "2026-09-07T12:00:00+03:00";
  const OTHER_OPEN = "2026-09-09";
  const OTHER_OPEN_TS = "2026-09-09T12:00:00+03:00";
  const REOPEN_DAY = "2026-09-08";
  const REOPEN_TS = "2026-09-08T12:00:00+03:00";

  beforeAll(async () => {
    exec = await createClosedBusinessDateSqlHarness();
    fx = await seedClosedDateFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  it("176 replaces the unconditional UPDATE bypass without a second trigger", () => {
    expect(SQL_175).toContain("return NEW;");
    expect(SQL_175).toContain("'sale_returns'");
    expect(SQL_176).toContain("create or replace function public.enforce_closed_business_date");
    expect(SQL_176).not.toContain("create trigger trg_sale_returns_closed_business_date");
    expect(SQL_176).toContain("NEW.refund_amount_ugx is not distinct from OLD.refund_amount_ugx");
    expect(SQL_176).toContain("v_old_date_key is distinct from v_date_key");
  });

  it("1 / 2 — sale_return UPDATE succeeds on open date and fails after close", async () => {
    const id = crypto.randomUUID();
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.sale_returns (id, shop_id, quantity, refund_amount_ugx, created_at)
         VALUES ($1::uuid, $2::uuid, 1, 3000, $3::timestamptz)`,
        [id, fx.shopAId, UPD_TS],
      ),
    ).toBeNull();
    expect(
      await insertOrError(
        exec,
        `UPDATE public.sale_returns SET refund_amount_ugx = 3500 WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();

    await insertActiveClose(exec, fx.shopAId, UPD_DAY);
    const err = await insertOrError(
      exec,
      `UPDATE public.sale_returns SET refund_amount_ugx = 4000 WHERE id = $1::uuid`,
      [id],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("3 / 4 — debt payment UPDATE succeeds on open date and fails after close", async () => {
    const id = crypto.randomUUID();
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.customer_debt_payments (id, shop_id, customer_id, amount_ugx, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 4000, $4::timestamptz)`,
        [id, fx.shopAId, fx.customerAId, OTHER_OPEN_TS],
      ),
    ).toBeNull();
    expect(
      await insertOrError(
        exec,
        `UPDATE public.customer_debt_payments SET amount_ugx = 4500 WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();

    await insertActiveClose(exec, fx.shopAId, OTHER_OPEN);
    const err = await insertOrError(
      exec,
      `UPDATE public.customer_debt_payments SET amount_ugx = 5000 WHERE id = $1::uuid`,
      [id],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("5 / 6 — supplier payment UPDATE succeeds on open date and fails after close", async () => {
    const id = crypto.randomUUID();
    const day = "2026-09-10";
    const ts = "2026-09-10T12:00:00+03:00";
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.shop_supplier_payments (id, shop_id, supplier_id, amount_ugx, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 8000, $4::timestamptz)`,
        [id, fx.shopAId, crypto.randomUUID(), ts],
      ),
    ).toBeNull();
    expect(
      await insertOrError(
        exec,
        `UPDATE public.shop_supplier_payments SET amount_ugx = 8500 WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();

    await insertActiveClose(exec, fx.shopAId, day);
    const err = await insertOrError(
      exec,
      `UPDATE public.shop_supplier_payments SET amount_ugx = 9000 WHERE id = $1::uuid`,
      [id],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("7 / 8 — cash drawer adjustment UPDATE succeeds on open date and fails after close", async () => {
    const id = crypto.randomUUID();
    const day = "2026-09-11";
    const ts = "2026-09-11T12:00:00+03:00";
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.shop_cash_drawer_adjustments
           (id, shop_id, adjustment_type, amount_ugx, occurred_at)
         VALUES ($1::uuid, $2::uuid, 'cash_added', 2000, $3::timestamptz)`,
        [id, fx.shopAId, ts],
      ),
    ).toBeNull();
    expect(
      await insertOrError(
        exec,
        `UPDATE public.shop_cash_drawer_adjustments SET amount_ugx = 2500 WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();

    await insertActiveClose(exec, fx.shopAId, day);
    const err = await insertOrError(
      exec,
      `UPDATE public.shop_cash_drawer_adjustments SET amount_ugx = 3000 WHERE id = $1::uuid`,
      [id],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("9 — moving a closed-date row onto an open date cannot bypass the guard", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id::text AS id FROM public.sale_returns
       WHERE shop_id = $1 AND created_at = $2::timestamptz
       LIMIT 1`,
      [fx.shopAId, UPD_TS],
    );
    const id = rows[0]?.id;
    expect(id).toBeTruthy();
    const err = await insertOrError(
      exec,
      `UPDATE public.sale_returns SET created_at = $2::timestamptz, refund_amount_ugx = 9999
       WHERE id = $1::uuid`,
      [id, "2026-09-13T12:00:00+03:00"],
    );
    expect(err).toMatch(/closed_business_date/);
    const after = await exec.query<{ refund: string }>(
      `SELECT refund_amount_ugx::text AS refund FROM public.sale_returns WHERE id = $1`,
      [id],
    );
    expect(Number(after.rows[0]?.refund)).toBe(3500);
  });

  it("10 — moving an open-date row into a closed date is rejected", async () => {
    const id = crypto.randomUUID();
    const openTs = "2026-09-12T12:00:00+03:00";
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.shop_cash_drawer_adjustments
           (id, shop_id, adjustment_type, amount_ugx, occurred_at)
         VALUES ($1::uuid, $2::uuid, 'cash_removed', 1000, $3::timestamptz)`,
        [id, fx.shopAId, openTs],
      ),
    ).toBeNull();
    const err = await insertOrError(
      exec,
      `UPDATE public.shop_cash_drawer_adjustments SET occurred_at = $2::timestamptz WHERE id = $1::uuid`,
      [id, UPD_TS],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("11 — existing INSERT closed-date rejection still holds", async () => {
    const err = await insertOrError(
      exec,
      `INSERT INTO public.sale_returns (id, shop_id, quantity, refund_amount_ugx, created_at)
       VALUES ($1::uuid, $2::uuid, 1, 3000, $3::timestamptz)`,
      [crypto.randomUUID(), fx.shopAId, UPD_TS],
    );
    expect(err).toMatch(/closed_business_date/);
  });

  it("12 — reopen still allows a legitimate financial UPDATE", async () => {
    const id = crypto.randomUUID();
    expect(
      await insertOrError(
        exec,
        `INSERT INTO public.customer_debt_payments (id, shop_id, customer_id, amount_ugx, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 2000, $4::timestamptz)`,
        [id, fx.shopAId, fx.customerAId, REOPEN_TS],
      ),
    ).toBeNull();
    const closeId = await insertActiveClose(exec, fx.shopAId, REOPEN_DAY);
    expect(
      await insertOrError(
        exec,
        `UPDATE public.customer_debt_payments SET amount_ugx = 2200 WHERE id = $1::uuid`,
        [id],
      ),
    ).toMatch(/closed_business_date/);

    await exec.exec(`
      UPDATE public.shop_day_closes
      SET superseded_at = now()
      WHERE id = '${closeId}';
    `);

    expect(
      await insertOrError(
        exec,
        `UPDATE public.customer_debt_payments SET amount_ugx = 2200 WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();
  });

  it("13 — same-id metadata ACK remains allowed after close", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id::text AS id FROM public.sale_returns
       WHERE shop_id = $1 AND created_at = $2::timestamptz
       LIMIT 1`,
      [fx.shopAId, UPD_TS],
    );
    const id = rows[0]?.id;
    expect(id).toBeTruthy();
    expect(
      await insertOrError(
        exec,
        `UPDATE public.sale_returns SET reason = 'other', updated_at = now() WHERE id = $1::uuid`,
        [id],
      ),
    ).toBeNull();
  });

  it("14 — expense RPC closed-date protection remains intact", async () => {
    const result = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_push_cash_expense($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            id: crypto.randomUUID(),
            category: "transport",
            amount_ugx: 5000,
            paid_on: UPD_DAY,
            created_at: UPD_TS,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("closed_business_date");
  });
});

describe("SALES-MULTI-01 closed business date on sale_voids", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: ClosedDateFixture;
  const SQL_179 = readFileSync(
    join(process.cwd(), "supabase/migrations/179_sale_void_financial_ledger.sql"),
    "utf8",
  );

  beforeAll(async () => {
    exec = await createClosedBusinessDateSqlHarness();
    fx = await seedClosedDateFixture(exec);
    await insertActiveClose(exec, fx.shopAId, CLOSED);
    await exec.exec(SQL_179);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  it("13 — new void financial row on a closed sale date is rejected", async () => {
    const productId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_price_per_unit_ugx, metadata)
      VALUES ('${productId}', '${fx.shopAId}', 'Close Item', 10, 1000, '{}');
      INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, created_at)
      VALUES ('${saleId}', '${fx.shopAId}', 'completed', 100000, 100000, '${OPEN_TS}');
      UPDATE public.sales SET created_at = '${CLOSED_TS}' WHERE id = '${saleId}';
    `);
    const result = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            product_id: productId,
            void_record_id: crypto.randomUUID(),
            delta: 1,
            sale_id: saleId,
            amount_ugx: 10000,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("closed_business_date");
    const { rows } = await exec.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.sale_voids`);
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("14 — replay of an existing sale_void after close is not a second insert", async () => {
    const productId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const voidId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_price_per_unit_ugx, metadata)
      VALUES ('${productId}', '${fx.shopAId}', 'Open Item', 10, 1000, '{}');
      INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, created_at)
      VALUES ('${saleId}', '${fx.shopAId}', 'completed', 40000, 40000, '${OPEN_TS}');
      INSERT INTO public.sale_voids (id, shop_id, sale_id, product_id, quantity, amount_ugx)
      VALUES ('${voidId}', '${fx.shopAId}', '${saleId}', '${productId}', 1, 10000);
    `);
    const result = await asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(
        `SELECT public.shop_apply_sale_void_stock($1::uuid, $2::jsonb) AS result`,
        [
          fx.shopAId,
          JSON.stringify({
            product_id: productId,
            void_record_id: voidId,
            delta: 1,
            sale_id: saleId,
            amount_ugx: 10000,
          }),
        ],
      );
      return rpcJson(rows[0]);
    });
    // Existing void row: closed-date assert is skipped. Stock apply may fail in this harness.
    expect(result.error === "closed_business_date").toBe(false);
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.sale_voids WHERE id = $1`,
      [voidId],
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });
});
