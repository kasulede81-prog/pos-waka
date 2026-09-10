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
const MIGRATION_184 = join(ROOT, "184_ungated_definer_primitive_revoke.sql");
const MIGRATION_185 = join(ROOT, "185_account_deletion_wrapper_anon_revoke.sql");
const MIGRATION_186 = join(ROOT, "186_sales_status_stock_drop_legacy_reverse.sql");
const MIGRATION_187 = join(ROOT, "187_internal_ops_search_shops.sql");
const MIGRATION_188 = join(ROOT, "188_internal_ops_shop_sale_returns_voids_expenses.sql");

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

export async function applyWakaUngatedPrimitiveHotfix(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_184));
}

export async function applyWakaAccountDeletionWrapperHotfix(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_185));
}

export async function applyWakaSalesStatusStockTriggerFix(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_186));
}

/**
 * 011-era trg_sales_status_stock plus no-op stock/receipt stubs.
 * Probe table drives the trigger without touching real sales stock.
 */
export async function seedSalesStatusStockTriggerCatalog(exec: SqlExec): Promise<void> {
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.waka186_trigger_probe (
      fn text NOT NULL,
      sale_id uuid NOT NULL
    );

    CREATE OR REPLACE FUNCTION public.apply_sale_stock_movements (p_sale_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ INSERT INTO public.waka186_trigger_probe (fn, sale_id) VALUES ('apply', p_sale_id); $$;

    CREATE OR REPLACE FUNCTION public.reverse_sale_stock_movements (p_sale_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ INSERT INTO public.waka186_trigger_probe (fn, sale_id) VALUES ('reverse', p_sale_id); $$;

    CREATE OR REPLACE FUNCTION public.create_receipt_for_sale (p_sale_id uuid)
    RETURNS uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
      INSERT INTO public.waka186_trigger_probe (fn, sale_id) VALUES ('receipt', p_sale_id);
      SELECT p_sale_id;
    $$;

    CREATE OR REPLACE FUNCTION public.trg_sales_status_stock ()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    begin
      if tg_op = 'UPDATE' then
        if new.status = 'completed' and old.status is distinct from 'completed' then
          perform public.apply_sale_stock_movements (new.id);
          if coalesce (new.issue_receipt, false) then
            perform public.create_receipt_for_sale (new.id);
          end if;
        elsif old.status = 'completed' and new.status in ('void', 'refunded') then
          perform public.reverse_sale_stock_movements (old.id);
        end if;
      end if;
      return new;
    end;
    $$;

    CREATE TABLE IF NOT EXISTS public.waka186_sales_probe (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      issue_receipt boolean NOT NULL DEFAULT false
    );

    DROP TRIGGER IF EXISTS trg_waka186_sales_status_stock ON public.waka186_sales_probe;
    CREATE TRIGGER trg_waka186_sales_status_stock
      AFTER UPDATE ON public.waka186_sales_probe
      FOR EACH ROW EXECUTE FUNCTION public.trg_sales_status_stock ();

    REVOKE ALL ON FUNCTION public.reverse_sale_stock_movements (uuid) FROM public;
    REVOKE ALL ON FUNCTION public.reverse_sale_stock_movements (uuid) FROM anon;
    REVOKE ALL ON FUNCTION public.reverse_sale_stock_movements (uuid) FROM authenticated;
  `);
}

/**
 * Four live deletion-wrapper overloads with production-like ACLs:
 * PUBLIC revoked (112/148), leftover named EXECUTE for anon + authenticated
 * (Supabase default privileges at CREATE). Bodies are no-ops.
 */
export async function seedAccountDeletionWrapperCatalog(exec: SqlExec): Promise<void> {
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION public.owner_permanently_delete_own_account (p_confirmation text)
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.owner_permanently_delete_own_account (
      p_confirmation text,
      p_phase text DEFAULT 'execute'
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.admin_permanently_delete_shop_account (
      p_shop_id uuid,
      p_confirmation text
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.admin_permanently_delete_shop_account (
      p_shop_id uuid,
      p_confirmation text,
      p_phase text DEFAULT 'execute'
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    REVOKE ALL ON FUNCTION public.owner_permanently_delete_own_account(text) FROM public;
    REVOKE ALL ON FUNCTION public.owner_permanently_delete_own_account(text, text) FROM public;
    REVOKE ALL ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text) FROM public;
    REVOKE ALL ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text, text) FROM public;

    GRANT EXECUTE ON FUNCTION public.owner_permanently_delete_own_account(text) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.owner_permanently_delete_own_account(text, text) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text, text) TO anon, authenticated;
  `);
}

/** Stub the 184-targeted DEFINER primitives plus gated wrappers. Bodies are no-ops. */
export async function seedUngatedDefinerPrimitiveCatalog(exec: SqlExec): Promise<void> {
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION public.certified_hard_delete_organization_execute (
      p_org_id uuid,
      p_primary_shop_id uuid,
      p_owner_user_id uuid,
      p_actor_user_id uuid,
      p_actor_role text,
      p_audit_action text DEFAULT 'certified_hard_delete_executed'
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.hard_delete_collect_org_user_ids (p_org_id uuid)
    RETURNS uuid[]
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT '{}'::uuid[]; $$;

    CREATE OR REPLACE FUNCTION public.hard_delete_collect_org_shop_ids (p_org_id uuid)
    RETURNS uuid[]
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT '{}'::uuid[]; $$;

    CREATE OR REPLACE FUNCTION public.hard_delete_verification_report (
      p_org_id uuid,
      p_shop_ids uuid[],
      p_owner_user_id uuid DEFAULT NULL,
      p_staff_user_ids uuid[] DEFAULT '{}'::uuid[]
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.reverse_sale_stock_movements (p_sale_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$ BEGIN END; $$;

    CREATE OR REPLACE FUNCTION public.apply_sale_stock_movements (p_sale_id uuid)
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT '[]'::jsonb; $$;

    CREATE OR REPLACE FUNCTION public.apply_sale_return_stock (p_return_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$ BEGIN END; $$;

    CREATE OR REPLACE FUNCTION public.create_receipt_for_sale (p_sale_id uuid)
    RETURNS uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid; $$;

    CREATE OR REPLACE FUNCTION public.next_shop_counter (p_shop uuid, p_key text)
    RETURNS bigint
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT 1::bigint; $$;

    CREATE OR REPLACE FUNCTION public.shop_org_id (p_shop_id uuid)
    RETURNS uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT NULL::uuid; $$;

    CREATE OR REPLACE FUNCTION public.owner_permanently_delete_own_account (
      p_confirmation text,
      p_phase text DEFAULT 'execute'
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    CREATE OR REPLACE FUNCTION public.admin_permanently_delete_shop_account (
      p_shop_id uuid,
      p_confirmation text,
      p_phase text DEFAULT 'execute'
    )
    RETURNS jsonb
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$ SELECT jsonb_build_object('ok', true); $$;

    GRANT EXECUTE ON FUNCTION public.certified_hard_delete_organization_execute(uuid, uuid, uuid, uuid, text, text) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.hard_delete_collect_org_user_ids(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.hard_delete_collect_org_shop_ids(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.hard_delete_verification_report(uuid, uuid[], uuid, uuid[]) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.reverse_sale_stock_movements(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.apply_sale_stock_movements(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.apply_sale_return_stock(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.create_receipt_for_sale(uuid) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.next_shop_counter(uuid, text) TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.shop_org_id(uuid) TO anon, authenticated;

    REVOKE ALL ON FUNCTION public.owner_permanently_delete_own_account(text, text) FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.owner_permanently_delete_own_account(text, text) TO authenticated;
    REVOKE ALL ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text, text) FROM public, anon;
    GRANT EXECUTE ON FUNCTION public.admin_permanently_delete_shop_account(uuid, text, text) TO authenticated;
  `);
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

export async function applyWakaInternalOpsSearchShops(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_187));
}

export async function applyWakaInternalOpsShopLedgers(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(MIGRATION_188));
}

export const INTERNAL_OPS_SEARCH_FIXTURE = {
  staffId: "a1870000-0000-4000-8000-000000000010",
  outsiderId: "a1870000-0000-4000-8000-000000000011",
  ownerId: "a1870000-0000-4000-8000-000000000012",
  extraMemberId: "a1870000-0000-4000-8000-000000000013",
  orgId: "a1870000-0000-4000-8000-000000000020",
  oldShopId: "a1870000-0000-4000-8000-000000000001",
  oldShopNumber: "A9001",
  oldShopName: "Zebra Hidden Mart",
  ownerEmail: "hidden.owner@example.com",
  ownerFullName: "Nakato Hidden",
  shopCount: 110,
} as const;

/** Minimal catalog so migration 187 can run on the 173-era security harness. */
export async function seedInternalOpsSearchShopsCatalog(exec: SqlExec): Promise<void> {
  const f = INTERNAL_OPS_SEARCH_FIXTURE;
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated;

    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS shop_number text;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS district text;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS city text;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS phone_e164 text;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS business_type text;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS gps_missing boolean DEFAULT true;
    ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
      full_name text,
      email text,
      business_name text,
      phone_e164 text
    );

    CREATE TABLE IF NOT EXISTS public.internal_admins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
      auth_user_id uuid REFERENCES auth.users (id),
      email text NOT NULL,
      role text NOT NULL DEFAULT 'support_admin',
      assigned_district_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
      max_shops int,
      active boolean NOT NULL DEFAULT true,
      is_active boolean,
      full_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.shop_activity (
      shop_id uuid PRIMARY KEY REFERENCES public.shops (id) ON DELETE CASCADE,
      last_sale_at timestamptz,
      sale_count_30d int NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subscription_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE,
      plan_id uuid REFERENCES public.subscription_plans (id),
      status text,
      trial_ends_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.is_waka_internal_staff ()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.internal_admins ia
        WHERE coalesce(ia.auth_user_id, ia.user_id) = auth.uid()
          AND coalesce(ia.is_active, ia.active, true) = true
      );
    $$;

    CREATE OR REPLACE FUNCTION public.internal_can_view_owner_contact ()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT public.is_waka_internal_staff ();
    $$;

    INSERT INTO auth.users (id, email) VALUES
      ('${f.staffId}'::uuid, 'staff@waka.ug'),
      ('${f.outsiderId}'::uuid, 'outsider@shop.ug'),
      ('${f.ownerId}'::uuid, '${f.ownerEmail}'),
      ('${f.extraMemberId}'::uuid, 'manager@shop.ug')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.internal_admins (user_id, auth_user_id, email, role, active, is_active, full_name)
    VALUES (
      '${f.staffId}'::uuid,
      '${f.staffId}'::uuid,
      'staff@waka.ug',
      'support_admin',
      true,
      true,
      'Waka Staff'
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.organizations (id, name)
    VALUES ('${f.orgId}'::uuid, 'ADMIN-1 Search Org')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.shops (id, organization_id, name, shop_number, is_active, created_at, district, city, gps_missing)
    SELECT
      CASE WHEN i = 1 THEN '${f.oldShopId}'::uuid ELSE gen_random_uuid() END,
      '${f.orgId}'::uuid,
      CASE WHEN i = 1 THEN '${f.oldShopName}' ELSE 'Newest Window Shop ' || i::text END,
      CASE WHEN i = 1 THEN '${f.oldShopNumber}' ELSE 'A' || lpad((2000 + i)::text, 4, '0') END,
      true,
      now() - ((110 - i) * interval '1 hour'),
      CASE WHEN i = 1 THEN 'Gulu' ELSE 'Kampala' END,
      'Center',
      true
    FROM generate_series(1, ${f.shopCount}) AS i;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES ('${f.ownerId}'::uuid, '${f.ownerFullName}', '${f.ownerEmail}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.shop_members (shop_id, user_id, role)
    VALUES
      ('${f.oldShopId}'::uuid, '${f.ownerId}'::uuid, 'owner'),
      ('${f.oldShopId}'::uuid, '${f.extraMemberId}'::uuid, 'manager')
    ON CONFLICT (shop_id, user_id) DO NOTHING;
  `);
}

export const INTERNAL_OPS_SHOP_LEDGER_FIXTURE = {
  staffId: "a1880000-0000-4000-8000-000000000010",
  outsiderId: "a1880000-0000-4000-8000-000000000011",
  ownerId: "a1880000-0000-4000-8000-000000000012",
  orgId: "a1880000-0000-4000-8000-000000000020",
  shopAId: "a1880000-0000-4000-8000-000000000001",
  shopBId: "a1880000-0000-4000-8000-000000000002",
  emptyShopId: "a1880000-0000-4000-8000-000000000003",
  productAId: "a1880000-0000-4000-8000-000000000031",
  productBId: "a1880000-0000-4000-8000-000000000032",
  returnCountA: 60,
} as const;

/** Catalog for migration 188 shop-ledger RPCs (two shops + empty shop). */
export async function seedInternalOpsShopLedgersCatalog(exec: SqlExec): Promise<void> {
  const f = INTERNAL_OPS_SHOP_LEDGER_FIXTURE;
  await exec.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated;

    CREATE TABLE IF NOT EXISTS public.internal_admins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
      auth_user_id uuid REFERENCES auth.users (id),
      email text NOT NULL,
      role text NOT NULL DEFAULT 'support_admin',
      assigned_district_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
      max_shops int,
      active boolean NOT NULL DEFAULT true,
      is_active boolean,
      full_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.is_waka_internal_staff ()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.internal_admins ia
        WHERE coalesce(ia.auth_user_id, ia.user_id) = auth.uid()
          AND coalesce(ia.is_active, ia.active, true) = true
      );
    $$;

    CREATE TABLE IF NOT EXISTS public.sale_returns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL,
      sale_id uuid,
      product_id uuid,
      quantity numeric NOT NULL DEFAULT 0,
      refund_amount_ugx bigint NOT NULL DEFAULT 0,
      reason text NOT NULL DEFAULT 'other',
      note text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      stock_applied_at timestamptz
    );
    ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'other';
    ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS note text;
    ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;

    CREATE TABLE IF NOT EXISTS public.sale_voids (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL,
      sale_id uuid NOT NULL,
      product_id uuid NOT NULL,
      quantity numeric NOT NULL DEFAULT 0,
      amount_ugx bigint NOT NULL DEFAULT 0,
      line_index int NOT NULL DEFAULT 0,
      note text,
      sale_voided_at timestamptz,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS line_index int NOT NULL DEFAULT 0;
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS note text;
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS sale_voided_at timestamptz;
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS created_by uuid;
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.sale_voids ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    CREATE TABLE IF NOT EXISTS public.expenses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id uuid NOT NULL,
      category text NOT NULL DEFAULT 'other',
      amount_ugx bigint NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'UGX',
      description text,
      paid_on date NOT NULL DEFAULT current_date,
      attachment_path text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      expense_type text NOT NULL DEFAULT 'cash_drawer',
      updated_at timestamptz NOT NULL DEFAULT now(),
      recorded_by_staff_id text,
      recorded_by_label text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      deleted_at timestamptz
    );
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS attachment_path text;
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_type text NOT NULL DEFAULT 'cash_drawer';
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recorded_by_label text;
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

    INSERT INTO auth.users (id, email) VALUES
      ('${f.staffId}'::uuid, 'staff188@waka.ug'),
      ('${f.outsiderId}'::uuid, 'outsider188@shop.ug'),
      ('${f.ownerId}'::uuid, 'owner188@shop.ug')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.internal_admins (user_id, auth_user_id, email, role, active, is_active, full_name)
    VALUES (
      '${f.staffId}'::uuid,
      '${f.staffId}'::uuid,
      'staff188@waka.ug',
      'support_admin',
      true,
      true,
      'Waka Staff 188'
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.organizations (id, name)
    VALUES ('${f.orgId}'::uuid, 'ADMIN-2 Ledger Org')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.shops (id, organization_id, name, is_active)
    VALUES
      ('${f.shopAId}'::uuid, '${f.orgId}'::uuid, 'Ledger Shop A', true),
      ('${f.shopBId}'::uuid, '${f.orgId}'::uuid, 'Ledger Shop B', true),
      ('${f.emptyShopId}'::uuid, '${f.orgId}'::uuid, 'Ledger Shop Empty', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.shop_members (shop_id, user_id, role)
    VALUES ('${f.shopAId}'::uuid, '${f.ownerId}'::uuid, 'owner')
    ON CONFLICT (shop_id, user_id) DO NOTHING;

    INSERT INTO public.products (id, shop_id, name)
    VALUES
      ('${f.productAId}'::uuid, '${f.shopAId}'::uuid, 'Soda 500ml'),
      ('${f.productBId}'::uuid, '${f.shopBId}'::uuid, 'Shop B Bread')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sale_returns (
      id, shop_id, sale_id, product_id, quantity, refund_amount_ugx, reason,
      stock_applied_at, created_at, metadata, note
    )
    SELECT
      ('a1881000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${f.shopAId}'::uuid,
      ('a1881100-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${f.productAId}'::uuid,
      1,
      1000 * i,
      'damaged',
      timestamptz '2026-01-01 00:00:00+00' + (i * interval '1 hour'),
      timestamptz '2026-01-01 00:00:00+00' + (i * interval '1 hour'),
      '{"secret":"return-meta"}'::jsonb,
      'return note must not leak'
    FROM generate_series(1, ${f.returnCountA}) AS i
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sale_returns (
      id, shop_id, product_id, quantity, refund_amount_ugx, reason, created_at, metadata
    ) VALUES
      (
        'a1881000-0000-4000-8000-000000000101'::uuid,
        '${f.shopBId}'::uuid,
        '${f.productBId}'::uuid,
        9,
        999999,
        'wrong_shop',
        timestamptz '2026-12-01 00:00:00+00',
        '{"secret":"shop-b"}'::jsonb
      ),
      (
        'a1881000-0000-4000-8000-000000000102'::uuid,
        '${f.shopBId}'::uuid,
        '${f.productBId}'::uuid,
        8,
        888888,
        'wrong_shop',
        timestamptz '2026-12-02 00:00:00+00',
        '{"secret":"shop-b"}'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sale_voids (
      id, shop_id, sale_id, product_id, quantity, amount_ugx, line_index,
      note, sale_voided_at, created_at, metadata
    )
    SELECT
      ('a1882000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${f.shopAId}'::uuid,
      ('a1882100-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${f.productAId}'::uuid,
      1,
      2000 * i,
      0,
      'void note must not leak',
      timestamptz '2026-02-01 00:00:00+00' + (i * interval '1 hour'),
      timestamptz '2026-02-01 00:00:00+00' + (i * interval '1 hour'),
      '{"secret":"void-meta"}'::jsonb
    FROM generate_series(1, 8) AS i
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sale_voids (
      id, shop_id, sale_id, product_id, quantity, amount_ugx, line_index, created_at, metadata
    ) VALUES (
      'a1882000-0000-4000-8000-000000000101'::uuid,
      '${f.shopBId}'::uuid,
      'a1882100-0000-4000-8000-000000000101'::uuid,
      '${f.productBId}'::uuid,
      3,
      777777,
      1,
      timestamptz '2026-12-01 00:00:00+00',
      '{"secret":"shop-b-void"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.expenses (
      id, shop_id, category, amount_ugx, description, paid_on, recorded_by_label,
      expense_type, deleted_at, attachment_path, metadata, created_at
    )
    SELECT
      ('a1883000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '${f.shopAId}'::uuid,
      'transport',
      5000 * i,
      'boda to market',
      DATE '2026-03-01' + (i - 1),
      'Cashier Ann',
      'cash_drawer',
      NULL,
      'secret/receipt.jpg',
      '{"secret":"expense-meta"}'::jsonb,
      timestamptz '2026-03-01 00:00:00+00' + (i * interval '1 hour')
    FROM generate_series(1, 8) AS i
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.expenses (
      id, shop_id, category, amount_ugx, description, paid_on, expense_type,
      deleted_at, attachment_path, metadata
    ) VALUES
      (
        'a1883000-0000-4000-8000-000000000090'::uuid,
        '${f.shopAId}'::uuid,
        'deleted',
        1,
        'should be excluded',
        DATE '2026-06-01',
        'cash_drawer',
        timestamptz '2026-06-02 00:00:00+00',
        'secret/deleted.jpg',
        '{"secret":"deleted"}'::jsonb
      ),
      (
        'a1883000-0000-4000-8000-000000000091'::uuid,
        '${f.shopAId}'::uuid,
        'legacy',
        2,
        'legacy type excluded',
        DATE '2026-06-02',
        'legacy',
        NULL,
        'secret/legacy.jpg',
        '{"secret":"legacy"}'::jsonb
      ),
      (
        'a1883000-0000-4000-8000-000000000101'::uuid,
        '${f.shopBId}'::uuid,
        'rent',
        888888,
        'shop B expense',
        DATE '2026-12-01',
        'cash_drawer',
        NULL,
        'secret/b.jpg',
        '{"secret":"shop-b-exp"}'::jsonb
      )
    ON CONFLICT (id) DO NOTHING;
  `);
}

export { seedR3StockFixture, type R3StockFixture } from "./r3StockPgHarness";
export { asUser, rpcJson } from "./transferEnginePgHarness";

