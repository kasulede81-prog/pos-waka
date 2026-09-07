/**
 * SALES-MULTI-01 P2-01 — shop summary RPCs subtract sale_voids.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asUser,
  createClosedBusinessDateSqlHarness,
  rpcJson,
  seedClosedDateFixture,
  type ClosedDateFixture,
} from "../test/sqlIntegration/closedBusinessDatePgHarness";
import type { SqlExec } from "../test/sqlIntegration/transferEnginePgHarness";

const SQL_064_RETURNS = `
create or replace function public._report_returns_summary (
  p_shop uuid, p_start date, p_end date
) returns table (return_count int, refunds_ugx bigint, profit_reduction_ugx bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*)::int,
    coalesce(sum(sr.refund_amount_ugx), 0)::bigint,
    coalesce(sum(sr.refund_amount_ugx - round(sr.quantity * coalesce(p.cost_price_per_unit_ugx, 0))::bigint), 0)::bigint
  from public.sale_returns sr
  left join public.products p on p.id = sr.product_id and p.shop_id = sr.shop_id
  where sr.shop_id = p_shop
    and public._sale_kampala_day(sr.created_at) between p_start and p_end;
$$;
`;

const SQL_180 = readFileSync(
  join(process.cwd(), "supabase/migrations/180_shop_summary_sale_voids.sql"),
  "utf8",
);

const DAY = "2026-09-05";
const DAY_TS = "2026-09-05T12:00:00+03:00";
const OTHER_DAY_TS = "2026-09-04T12:00:00+03:00";

describe("SALES-MULTI-01 P2-01 shop summary voids — real SQL", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let fx: ClosedDateFixture;
  let productId: string;

  beforeAll(async () => {
    exec = await createClosedBusinessDateSqlHarness();
    fx = await seedClosedDateFixture(exec);
    productId = crypto.randomUUID();
    await exec.exec(`
      ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount_ugx bigint NOT NULL DEFAULT 0;
      ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax_ugx bigint NOT NULL DEFAULT 0;
      ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id uuid;
      CREATE TABLE IF NOT EXISTS public.sale_line_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid,
        product_id uuid,
        quantity numeric NOT NULL DEFAULT 1,
        line_total_ugx bigint NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS public.sale_voids (
        id uuid PRIMARY KEY,
        shop_id uuid NOT NULL,
        sale_id uuid NOT NULL,
        product_id uuid NOT NULL,
        quantity numeric(18, 4) NOT NULL DEFAULT 1,
        amount_ugx bigint NOT NULL,
        line_index int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      INSERT INTO public.products (id, shop_id, name, stock_on_hand, cost_price_per_unit_ugx, metadata)
      VALUES ('${productId}', '${fx.shopAId}', 'Summary Item', 10, 2000, '{}');
      CREATE OR REPLACE FUNCTION public._report_assert_shop()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT sm.shop_id FROM public.shop_members sm WHERE sm.user_id = auth.uid() LIMIT 1;
      $$;
      CREATE OR REPLACE FUNCTION public.shop_plan_allows_feature(p_shop_id uuid, p_feature text)
      RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true; $$;
    `);
    await exec.exec(SQL_064_RETURNS);
    await exec.exec(SQL_180);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function insertSale(input: {
    id?: string;
    shopId?: string;
    total: number;
    cash: number;
    debt: number;
    at?: string;
  }): Promise<string> {
    const id = input.id ?? crypto.randomUUID();
    const shopId = input.shopId ?? fx.shopAId;
    await exec.exec(`
      INSERT INTO public.sales (id, shop_id, status, total_ugx, cash_amount_ugx, debt_amount_ugx, created_at, completed_at)
      VALUES ('${id}', '${shopId}', 'completed', ${input.total}, ${input.cash}, ${input.debt}, '${input.at ?? DAY_TS}', '${input.at ?? DAY_TS}');
    `);
    return id;
  }

  async function insertReturn(saleId: string, amount: number, qty = 1, at = DAY_TS): Promise<void> {
    await exec.exec(`
      INSERT INTO public.sale_returns (id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, created_at)
      VALUES ('${crypto.randomUUID()}', '${fx.shopAId}', '${saleId}', '${productId}', ${qty}, ${amount}, '${at}');
    `);
  }

  async function insertVoid(saleId: string, amount: number, qty = 1, at = DAY_TS): Promise<void> {
    await exec.exec(`
      INSERT INTO public.sale_voids (id, shop_id, sale_id, product_id, quantity, amount_ugx, created_at)
      VALUES ('${crypto.randomUUID()}', '${fx.shopAId}', '${saleId}', '${productId}', ${qty}, ${amount}, '${at}');
    `);
  }

  async function daily(): Promise<Record<string, unknown>> {
    return asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_get_daily_sales_summary($1::date) AS result`, [DAY]);
      return rpcJson(rows[0]);
    });
  }

  async function monthly(): Promise<Record<string, unknown>> {
    return asUser(exec, fx.userAId, async () => {
      const { rows } = await exec.query(`SELECT public.shop_get_monthly_sales_summary($1::text) AS result`, ["2026-09"]);
      return rpcJson(rows[0]);
    });
  }

  it("1 — normal sale summary", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 100_000, debt: 0 });
    const row = await daily();
    expect(row.ok).toBe(true);
    expect(row.total_revenue_ugx).toBe(100_000);
    expect(row.cash_collected_ugx).toBe(100_000);
    expect(row.debt_issued_ugx).toBe(0);
    expect(row.voids_ugx).toBe(0);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("2 — sale + return", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 100_000, debt: 0 });
    await insertReturn(saleId, 20_000);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(80_000);
    expect(row.returns_refunds_ugx).toBe(20_000);
    expect(row.cash_collected_ugx).toBe(80_000);
    await exec.exec(`DELETE FROM public.sale_returns WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("3 — sale + void", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 100_000, debt: 0 });
    await insertVoid(saleId, 40_000, 4);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(60_000);
    expect(row.voids_ugx).toBe(40_000);
    expect(row.void_count).toBe(1);
    expect(row.cash_collected_ugx).toBe(60_000);
    expect(row.debt_issued_ugx).toBe(0);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("4 — sale + return + void", async () => {
    const saleId = await insertSale({ total: 50_000, cash: 50_000, debt: 0 });
    await insertReturn(saleId, 8_000, 1);
    await insertVoid(saleId, 42_000, 4);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(0);
    expect(row.cash_collected_ugx).toBe(0);
    expect(row.returns_refunds_ugx).toBe(8_000);
    expect(row.voids_ugx).toBe(42_000);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sale_returns WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("5 — mixed tender cash-first", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 50_000, debt: 50_000 });
    await insertReturn(saleId, 20_000);
    const afterReturn = await daily();
    expect(afterReturn.total_revenue_ugx).toBe(80_000);
    expect(afterReturn.cash_collected_ugx).toBe(30_000);
    expect(afterReturn.debt_issued_ugx).toBe(50_000);
    await insertVoid(saleId, 80_000, 8);
    const afterVoid = await daily();
    expect(afterVoid.total_revenue_ugx).toBe(0);
    expect(afterVoid.cash_collected_ugx).toBe(0);
    expect(afterVoid.debt_issued_ugx).toBe(0);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sale_returns WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("6 — credit sale void reduces debt not cash", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 0, debt: 100_000 });
    await insertVoid(saleId, 20_000, 2);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(80_000);
    expect(row.cash_collected_ugx).toBe(0);
    expect(row.debt_issued_ugx).toBe(80_000);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("7 — multiple voids", async () => {
    const saleId = await insertSale({ total: 100_000, cash: 100_000, debt: 0 });
    await insertVoid(saleId, 10_000, 1);
    await insertVoid(saleId, 15_000, 1);
    const row = await daily();
    expect(row.void_count).toBe(2);
    expect(row.voids_ugx).toBe(25_000);
    expect(row.total_revenue_ugx).toBe(75_000);
    expect(row.cash_collected_ugx).toBe(75_000);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("8 — multiple lines / two products share one sale header", async () => {
    const saleId = await insertSale({ total: 80_000, cash: 80_000, debt: 0 });
    await insertReturn(saleId, 20_000, 2);
    await insertVoid(saleId, 30_000, 3);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(30_000);
    expect(row.cash_collected_ugx).toBe(30_000);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sale_returns WHERE sale_id = '${saleId}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id = '${saleId}'`);
  });

  it("9 — different business dates stay isolated", async () => {
    const today = await insertSale({ total: 40_000, cash: 40_000, debt: 0, at: DAY_TS });
    const other = await insertSale({ total: 90_000, cash: 90_000, debt: 0, at: OTHER_DAY_TS });
    await insertVoid(other, 90_000, 9, OTHER_DAY_TS);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(40_000);
    expect(row.voids_ugx).toBe(0);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id = '${other}'`);
    await exec.exec(`DELETE FROM public.sales WHERE id IN ('${today}', '${other}')`);
  });

  it("10 — shop isolation", async () => {
    const mine = await insertSale({ total: 25_000, cash: 25_000, debt: 0 });
    const theirs = await insertSale({ shopId: fx.shopBId, total: 70_000, cash: 70_000, debt: 0 });
    await exec.exec(`
      INSERT INTO public.sale_voids (id, shop_id, sale_id, product_id, quantity, amount_ugx, created_at)
      VALUES ('${crypto.randomUUID()}', '${fx.shopBId}', '${theirs}', '${productId}', 7, 70000, '${DAY_TS}');
    `);
    const row = await daily();
    expect(row.total_revenue_ugx).toBe(25_000);
    expect(row.voids_ugx).toBe(0);
    const month = await monthly();
    expect(month.ok).toBe(true);
    expect(month.total_revenue_ugx).toBe(25_000);
    await exec.exec(`DELETE FROM public.sale_voids WHERE sale_id IN ('${mine}', '${theirs}')`);
    await exec.exec(`DELETE FROM public.sales WHERE id IN ('${mine}', '${theirs}')`);
  });
});
