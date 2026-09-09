import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

const ROOT = join(process.cwd(), "supabase", "migrations");
const TRANSFER_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const R3_BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "r3StockBootstrap.sql");
const MIGRATION_166 = join(ROOT, "166_purchase_stock_durable_idempotency.sql");
const MIGRATION_168 = join(ROOT, "168_adjustment_count_stock_durable_idempotency.sql");
const MIGRATION_172 = join(ROOT, "172_sale_void_stock_durable_idempotency.sql");
const MIGRATION_173 = join(ROOT, "173_purchase_void_stock_durable_idempotency.sql");
const MIGRATION_183 = join(ROOT, "183_waka0203_security_hotfix.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function applyThrough173(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(TRANSFER_BOOTSTRAP));
  await exec.exec(readSql(R3_BOOTSTRAP));
  await exec.exec(readSql(MIGRATION_166));
  await exec.exec(readSql(MIGRATION_168));
  await exec.exec(readSql(MIGRATION_172));
  await exec.exec(readSql(MIGRATION_173));
}

function makePgExec(client: pg.Client): SqlExec {
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
    async close() {
      await client.end();
    },
  };
}

export async function createWakaSecuritySqlHarness(): Promise<SqlExec> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec = makePgExec(client);
    await applyThrough173(exec);
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await applyThrough173(exec);
  return exec;
}

export async function applyWakaSecurityHotfix(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_183));
}

/** Tables + helpers the hotfix migration hardens when they exist. */
export async function seedWakaSecurityCatalog(exec: SqlExec): Promise<void> {
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.shop_pos_staff_revisions (
      id bigserial PRIMARY KEY,
      shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
      staff_client_id uuid,
      shop_version bigint NOT NULL,
      action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.waka_shop_number_counter (
      id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      next_seq int NOT NULL DEFAULT 1
    );
    INSERT INTO public.waka_shop_number_counter (id, next_seq) VALUES (1, 1)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS public.waka_shop_number_released (
      shop_number text PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS public.sales (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'completed',
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      cash_amount_ugx bigint NOT NULL DEFAULT 0,
      debt_amount_ugx bigint NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS public.expenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
      expense_type text NOT NULL DEFAULT 'cash_drawer',
      deleted_at timestamptz,
      paid_on date NOT NULL DEFAULT current_date,
      amount_ugx bigint NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS public.sale_returns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL,
      sale_id uuid,
      refund_amount_ugx bigint NOT NULL DEFAULT 0,
      quantity numeric NOT NULL DEFAULT 0,
      product_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.sale_voids (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL,
      sale_id uuid NOT NULL,
      amount_ugx bigint NOT NULL DEFAULT 0,
      quantity numeric NOT NULL DEFAULT 0,
      product_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public._sale_kampala_day (p_at timestamptz)
    RETURNS date
    LANGUAGE sql
    STABLE
    AS $$
      SELECT (p_at AT TIME ZONE 'Africa/Kampala')::date;
    $$;

    CREATE OR REPLACE FUNCTION public._report_cash_drawer_expenses_ugx (p_shop uuid, p_start date, p_end date)
    RETURNS bigint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT coalesce(sum(e.amount_ugx), 0)::bigint
      FROM public.expenses e
      WHERE e.shop_id = p_shop
        AND e.expense_type = 'cash_drawer'
        AND e.deleted_at IS NULL
        AND e.paid_on BETWEEN p_start AND p_end;
    $$;

    CREATE OR REPLACE FUNCTION public._shop_completed_sales_count_for_day (p_shop_id uuid, p_date_key text)
    RETURNS bigint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT count(*)::bigint FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.status = 'completed';
    $$;

    CREATE OR REPLACE FUNCTION public._report_period_remaining_cash_debt (
      p_shop uuid, p_start date, p_end date, p_created_only boolean DEFAULT false
    )
    RETURNS TABLE (cash_ugx bigint, debt_ugx bigint)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT coalesce(sum(s.cash_amount_ugx), 0)::bigint, coalesce(sum(s.debt_amount_ugx), 0)::bigint
      FROM public.sales s
      WHERE s.shop_id = p_shop AND s.status = 'completed';
    $$;

    CREATE OR REPLACE FUNCTION public.waka_r8_mutable_search_path_probe ()
    RETURNS integer
    LANGUAGE sql
    SECURITY DEFINER
    AS $$
      SELECT 1;
    $$;

    GRANT EXECUTE ON FUNCTION public._apply_durable_stock_delta(uuid, uuid, text, uuid, numeric, text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public._report_cash_drawer_expenses_ugx(uuid, date, date) TO anon;
    GRANT EXECUTE ON FUNCTION public._shop_completed_sales_count_for_day(uuid, text) TO anon;
    GRANT EXECUTE ON FUNCTION public._report_period_remaining_cash_debt(uuid, date, date, boolean) TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_pos_staff_revisions TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waka_shop_number_counter TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.waka_shop_number_released TO anon;
  `);
}

export { seedR3StockFixture, type R3StockFixture } from "./r3StockPgHarness";
export { asUser, rpcJson } from "./transferEnginePgHarness";
