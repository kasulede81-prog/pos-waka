import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

/**
 * M1 — Payment Foundation SQL harness.
 *
 * Runs the production-shaped subscription/payment fixtures from
 * `loyaltyBootstrap.sql` under the production grant posture (010_grants.sql +
 * Supabase table defaults hand DML to `authenticated`), then replays the real
 * migration chain those functions live in — 039 (annual offers), 043 (admin
 * plan set), 113 (pricing campaigns), the M1 payment foundation, and the M1
 * follow-up — so tests exercise the same function bodies production runs, in
 * the same order, against the same privileges.
 */
export type { SqlExec };

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "loyaltyBootstrap.sql");
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Production chain, in production order (follow-up must land last). */
const MIGRATION_CHAIN = [
  join(MIGRATIONS_DIR, "039_subscription_approve_starter_plus_org_billing_offers.sql"),
  join(MIGRATIONS_DIR, "043_repair_admin_shop_plan_rpc.sql"),
  join(MIGRATIONS_DIR, "113_pricing_campaigns.sql"),
  join(MIGRATIONS_DIR, "20261006090000_subscription_payment_foundation.sql"),
  join(MIGRATIONS_DIR, "20261006140000_subscription_payment_followup.sql"),
];

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

/** Mirrors the privilege baseline the M1 migration has to defend against. */
const PRODUCTION_GRANTS = `
  GRANT USAGE ON SCHEMA public TO authenticated;
  GRANT USAGE ON SCHEMA public TO anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
`;

/**
 * The bootstrap's organizations trigger seeds a 'loyalty' entitlement, and the
 * narrow `feature_code` CHECK it is created with is widened by
 * `20260926090000_loyalty_membership_entitlements.sql` — which the loyalty
 * harness applies after the bootstrap. This harness runs only the M1 payment
 * migration, so it applies the widened (current production) shape itself
 * instead of dragging in the whole loyalty chain.
 */
const ENTITLEMENT_SHAPE = `
  ALTER TABLE public.organization_feature_entitlements
    DROP CONSTRAINT IF EXISTS organization_feature_entitlements_feature_code_check;
  ALTER TABLE public.organization_feature_entitlements
    ADD CONSTRAINT organization_feature_entitlements_feature_code_check
    CHECK (feature_code IN ('ai_stock_assistant', 'loyalty'));
`;

/**
 * Runtime dependencies of the production functions in the chain:
 *   - `internal_admins` + `subscriptions.activation_source` are read/written
 *     by 043's `admin_shop_set_subscription_plan` (and 039's fulfilment) at
 *     call time; the pre-M1 bootstrap predates both.
 *   - `admin_extend_subscription_trial` (028, verbatim) exists so H1's
 *     "explicit extension is unchanged" regression asserts against the real
 *     SQL instead of a re-worded copy of the semantics.
 */
const PRE_DEPS = `
  CREATE TABLE IF NOT EXISTS public.internal_admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'super_admin',
    active boolean NOT NULL DEFAULT true
  );

  -- 039's request RPC declares a subscription_requests %rowtype variable,
  -- which PostgreSQL resolves at CREATE time — without the table the whole
  -- file fails to apply. Production shape from 030; the RPC itself is never
  -- invoked by these suites.
  CREATE TABLE IF NOT EXISTS public.subscription_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
    shop_id uuid REFERENCES public.shops (id) ON DELETE SET NULL,
    requested_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    requested_plan text NOT NULL
      CHECK (requested_plan IN ('starter', 'business', 'waka_plus')),
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'extended')),
    approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    approved_at timestamptz,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now ()
  );

  ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS activation_source text;

  CREATE OR REPLACE FUNCTION public.admin_extend_subscription_trial (
    p_subscription_id uuid,
    p_extra_days int
  )
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  begin
    if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
      raise exception 'Forbidden';
    end if;

    if p_extra_days is null or p_extra_days < 1 or p_extra_days > 366 then
      raise exception 'Invalid trial extension';
    end if;

    update public.subscriptions s
    set
      trial_ends_at = coalesce (s.trial_ends_at, timezone ('Africa/Kampala', now ())) + (p_extra_days::text || ' days')::interval,
      updated_at = now (),
      activation_source = coalesce (s.activation_source, 'manual_admin'),
      metadata = coalesce (s.metadata, '{}'::jsonb)
        || jsonb_build_object (
          'trial_extended_days', p_extra_days,
          'trial_extended_at', to_jsonb (timezone ('Africa/Kampala', now ())::text),
          'trial_extended_by', auth.uid ()::text
        )
    where s.id = p_subscription_id;

    if not found then
      raise exception 'Subscription not found';
    end if;

    perform public._internal_subscription_history_write (
      p_subscription_id,
      'extend_trial',
      format ('+%s days', p_extra_days),
      jsonb_build_object ('extra_days', p_extra_days)
    );

    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    values (
      null,
      auth.uid (),
      'internal',
      'admin_extend_subscription_trial',
      'Extended trial on subscription ' || p_subscription_id::text,
      jsonb_build_object ('subscription_id', p_subscription_id, 'extra_days', p_extra_days)
    );
  end;
  $$;

  REVOKE ALL ON FUNCTION public.admin_extend_subscription_trial (uuid, int) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.admin_extend_subscription_trial (uuid, int) TO authenticated;
`;

/** Bootstrap → fixtures → production grants → real migration chain. */
async function applyChain(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(BOOTSTRAP));
  await exec.exec(ENTITLEMENT_SHAPE);
  await exec.exec(PRE_DEPS);
  await exec.exec(PRODUCTION_GRANTS);
  for (const migration of MIGRATION_CHAIN) {
    await exec.exec(readSql(migration));
  }
}

export async function createSubscriptionPaymentSqlHarness(): Promise<
  SqlExec & { isRealPostgres: boolean }
> {
  const url = process.env.TEST_DATABASE_URL?.trim();

  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec & { isRealPostgres: boolean } = {
      isRealPostgres: true,
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) {
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
    await applyChain(exec);
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec & { isRealPostgres: boolean } = {
    isRealPostgres: false,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
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
  await applyChain(exec);
  return exec;
}

/** Unwrap a single-column jsonb RPC result regardless of the function name. */
export function rpcJson(row: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = row?.result ?? (row ? Object.values(row)[0] : undefined);
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return (row ?? {}) as Record<string, unknown>;
}

export type SubscriptionPaymentFixture = {
  orgAId: string;
  shopAId: string;
  ownerAId: string;
  cashierAId: string;
  internalAdminId: string;
  orgBId: string;
  shopBId: string;
  ownerId: string;
  outsiderId: string;
  subscriptionAId: string;
  subscriptionBId: string;
  /** Business plan (36,000 UGX / month in the fixture price book). */
  planBusinessId: string;
  /** Period end that a confirmed payment must extend past. */
  periodAEnd: string;
  amountUgx: number;
};

export async function seedSubscriptionPaymentFixture(
  exec: SqlExec,
): Promise<SubscriptionPaymentFixture> {
  const ids = {
    orgAId: crypto.randomUUID(),
    shopAId: crypto.randomUUID(),
    ownerAId: crypto.randomUUID(),
    cashierAId: crypto.randomUUID(),
    internalAdminId: crypto.randomUUID(),
    orgBId: crypto.randomUUID(),
    shopBId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    outsiderId: crypto.randomUUID(),
    subscriptionAId: crypto.randomUUID(),
    subscriptionBId: crypto.randomUUID(),
    planBusinessId: crypto.randomUUID(),
    periodAEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    amountUgx: 36_000,
  };

  await exec.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ids.ownerAId}', 'pay-owner-a@test.local'),
      ('${ids.cashierAId}', 'pay-cashier-a@test.local'),
      ('${ids.internalAdminId}', 'pay-internal@test.local'),
      ('${ids.ownerId}', 'pay-owner-b@test.local'),
      ('${ids.outsiderId}', 'pay-outsider@test.local');

    INSERT INTO public.organizations (id, name) VALUES
      ('${ids.orgAId}', 'Payment Org A'),
      ('${ids.orgBId}', 'Payment Org B');

    INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES
      ('${ids.shopAId}', '${ids.orgAId}', 'Payment Shop A', 'PAY-A'),
      ('${ids.shopBId}', '${ids.orgBId}', 'Payment Shop B', 'PAY-B');

    INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
      ('${ids.shopAId}', '${ids.ownerAId}', 'owner'),
      ('${ids.shopAId}', '${ids.cashierAId}', 'cashier'),
      ('${ids.shopAId}', '${ids.internalAdminId}', 'super_admin'),
      ('${ids.shopBId}', '${ids.ownerId}', 'owner'),
      ('${ids.shopBId}', '${ids.outsiderId}', 'owner');

    INSERT INTO public.internal_admins (user_id, role, active) VALUES
      ('${ids.internalAdminId}', 'super_admin', true);

    INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
      ('${ids.orgAId}', '${ids.ownerAId}', 'owner'),
      ('${ids.orgAId}', '${ids.cashierAId}', 'staff'),
      ('${ids.orgBId}', '${ids.ownerId}', 'owner');

    INSERT INTO public.subscription_plans (id, code, name, monthly_price_ugx, annual_price_ugx)
    VALUES ('${ids.planBusinessId}', 'business_m1', 'M1 Business', 36000, 432000);

    INSERT INTO public.subscriptions (
      id, organization_id, shop_id, plan_id, status, billing_interval,
      current_period_start, current_period_end, payment_status
    ) VALUES
      ('${ids.subscriptionAId}', '${ids.orgAId}', '${ids.shopAId}', '${ids.planBusinessId}',
       'trialing', 'month', now() - interval '10 days', now() + interval '20 days', 'unknown'),
      ('${ids.subscriptionBId}', '${ids.orgBId}', '${ids.shopBId}', '${ids.planBusinessId}',
       'trialing', 'month', now() - interval '5 days', now() + interval '25 days', 'unknown');
  `);

  return ids;
}
