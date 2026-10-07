import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { SqlExec } from "./transferEnginePgHarness";

/**
 * M1/M2/M3-A — Subscription payment + entitlement SQL harness.
 *
 * Runs the production-shaped subscription/payment fixtures from
 * `loyaltyBootstrap.sql` under the production grant posture (010_grants.sql +
 * Supabase table defaults hand DML to `authenticated`) plus the pre-M2 write
 * policies, then replays the real migration chain those functions live in —
 * 039 (annual offers), 043 (admin plan set), 044/057/078/097 (signup bundle,
 * agent upgrades, growth/promo), 113 (pricing campaigns), the M1 payment
 * foundation, the M1 follow-up, M2's entitlement lockdown, and M3-A's payment
 * intent — so tests exercise the same function bodies production runs, in the
 * same order, against the same privileges.
 */
export type { SqlExec };

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "loyaltyBootstrap.sql");
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Production chain, in production order (M2 lockdown lands last). */
const MIGRATION_CHAIN = [
  join(MIGRATIONS_DIR, "039_subscription_approve_starter_plus_org_billing_offers.sql"),
  join(MIGRATIONS_DIR, "043_repair_admin_shop_plan_rpc.sql"),
  join(MIGRATIONS_DIR, "044_free_onboarding_referral_agents.sql"),
  join(MIGRATIONS_DIR, "057_marketing_agent_roles_and_referrals.sql"),
  join(MIGRATIONS_DIR, "078_business_type_persistence.sql"),
  join(MIGRATIONS_DIR, "097_growth_campaigns.sql"),
  join(MIGRATIONS_DIR, "113_pricing_campaigns.sql"),
  join(MIGRATIONS_DIR, "20260930320000_merchant_registration_hardening.sql"),
  join(MIGRATIONS_DIR, "20261005120000_shop_effective_subscription.sql"),
  join(MIGRATIONS_DIR, "20261006090000_subscription_payment_foundation.sql"),
  join(MIGRATIONS_DIR, "20261006140000_subscription_payment_followup.sql"),
  join(MIGRATIONS_DIR, "20261006160000_subscriptions_client_dml_lockdown.sql"),
  join(MIGRATIONS_DIR, "20261007100000_subscription_payment_intent.sql"),
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
 * The pre-M2 production WRITE posture, recreated so the M2 migration has the
 * real policies to remove and the tests can prove the before/after contract:
 * `user_has_org_role` (007) plus 008's `subscriptions_write` / `subscriptions_update`.
 * `subscriptions_select` already exists on the bootstrap fixture (same meaning
 * as 019's) and is deliberately left untouched. DML grants come from
 * PRODUCTION_GRANTS (the 010 shape), exactly as in the M2 forensic audit.
 */
const PRE_M2_POSTURE = `
  CREATE OR REPLACE FUNCTION public.user_has_org_role (p_org uuid, p_roles text[])
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    select exists (
      select 1 from public.organization_members m
      where m.organization_id = p_org
        and m.user_id = auth.uid ()
        and m.role = any (p_roles)
    );
  $$;

  DROP POLICY IF EXISTS subscriptions_write ON public.subscriptions;
  CREATE POLICY subscriptions_write ON public.subscriptions FOR INSERT
    WITH CHECK (public.user_has_org_role (organization_id, ARRAY['owner','admin','billing']));

  DROP POLICY IF EXISTS subscriptions_update ON public.subscriptions;
  CREATE POLICY subscriptions_update ON public.subscriptions FOR UPDATE
    USING (public.user_has_org_role (organization_id, ARRAY['owner','admin','billing']));
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

  -- Signup / onboarding fixtures (production shapes from 002 / 003 / 018) so
  -- the REAL bootstrap_owner_workspace (20260930320000) and
  -- save_owner_business_profile_bundle bodies can run in this harness after
  -- the M2 revoke — proving definer INSERTs survive the client lockdown.
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'UGX';
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id);
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_type text;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;
  -- 095: profiles.primary_shop_id — written by the signup RPC.
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS primary_shop_id uuid REFERENCES public.shops (id) ON DELETE SET NULL;
  -- 014: organization_members.profile_id — written by both signup RPCs.
  ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES auth.users (id);
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS code text;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS address_line text;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS city text;
  -- 037: shops.area — written by the save-bundle RPC.
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS area text;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS phone_e164 text;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS district_id uuid;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS latitude double precision;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS longitude double precision;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS gps_missing boolean;
  ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS owner_user_id uuid;

  CREATE TABLE IF NOT EXISTS public.districts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    region text,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now ()
  );
  INSERT INTO public.districts (code, name) VALUES ('KLA', 'Kampala')
  ON CONFLICT (code) DO NOTHING;

  -- owner_onboarding_status() (049, verbatim) — called at the top of the
  -- save-bundle RPC; the pre-M1 bootstrap has no such function.
  CREATE OR REPLACE FUNCTION public.owner_onboarding_status ()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  declare
    v_uid uuid := auth.uid ();
    v_shop record;
    v_profile_email text;
    v_complete boolean := false;
    v_missing text[] := array[]::text[];
  begin
    if v_uid is null then
      return jsonb_build_object ('complete', true, 'missing', '[]'::jsonb);
    end if;

    select lower (trim (coalesce (pr.email, '')))
    into v_profile_email
    from public.profiles pr
    where pr.id = v_uid;

    select sh.id, sh.name, sh.district_id, sh.phone_e164, sh.business_type, o.name as org_name, o.default_currency
    into v_shop
    from public.shop_members sm
    join public.shops sh on sh.id = sm.shop_id
    join public.organizations o on o.id = sh.organization_id
    where sm.user_id = v_uid
    order by sm.created_at asc
    limit 1;

    if not found then
      return jsonb_build_object ('complete', false, 'missing', to_jsonb (array['shop']::text[]));
    end if;

    if coalesce (trim (v_shop.org_name), '') = '' then v_missing := array_append (v_missing, 'organization_name'); end if;
    if coalesce (trim (v_shop.name), '') = '' then v_missing := array_append (v_missing, 'shop_name'); end if;
    if v_shop.business_type is null or trim (v_shop.business_type) = '' then v_missing := array_append (v_missing, 'business_type'); end if;
    if v_shop.district_id is null then v_missing := array_append (v_missing, 'district'); end if;
    if v_shop.phone_e164 is null or trim (v_shop.phone_e164) !~ '^\\+256[0-9]{9}$' then
      v_missing := array_append (v_missing, 'phone');
    end if;
    if v_profile_email is null or v_profile_email = '' or v_profile_email like '%@login.waka.ug' then
      v_missing := array_append (v_missing, 'email');
    end if;
    if v_shop.default_currency is null or length (trim (v_shop.default_currency)) <> 3 then
      v_missing := array_append (v_missing, 'currency');
    end if;

    v_complete := coalesce (array_length (v_missing, 1), 0) = 0;
    return jsonb_build_object ('complete', v_complete, 'missing', to_jsonb (v_missing));
  end;
  $$;

  -- admin_subscription_set_status (028, verbatim) — the engine's
  -- cancel/pause/resume/expire/grace writer; 028 itself is not applied to
  -- this harness, so the real body is provided here for the M2 regression.
  CREATE OR REPLACE FUNCTION public.admin_subscription_set_status (
    p_subscription_id uuid,
    p_status text
  )
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  declare
    v_st text := lower (trim (p_status));
  begin
    if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
      raise exception 'Forbidden';
    end if;

    if v_st not in (
      'trial',
      'trialing',
      'active',
      'expired',
      'past_due',
      'cancelled',
      'canceled',
      'paused'
    ) then
      raise exception 'Invalid status';
    end if;

    update public.subscriptions s
    set
      status = case
        when v_st = 'canceled' then 'cancelled'
        else v_st
      end,
      updated_at = now (),
      metadata = coalesce (s.metadata, '{}'::jsonb)
        || jsonb_build_object ('status_set_by', auth.uid ()::text, 'status_set_at', timezone ('Africa/Kampala', now ())::text)
    where s.id = p_subscription_id;

    if not found then
      raise exception 'Subscription not found';
    end if;

    perform public._internal_subscription_history_write (
      p_subscription_id,
      'set_status',
      v_st,
      jsonb_build_object ('status', v_st)
    );

    insert into public.audit_logs (
      shop_id,
      actor_user_id,
      role,
      action,
      payload_summary,
      payload
    )
    select
      s.shop_id,
      auth.uid (),
      'internal',
      'admin_subscription_set_status',
      'Subscription status ' || v_st,
      jsonb_build_object ('subscription_id', p_subscription_id, 'status', v_st)
    from public.subscriptions s
    where s.id = p_subscription_id;
  end;
  $$;

  REVOKE ALL ON FUNCTION public.admin_subscription_set_status (uuid, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.admin_subscription_set_status (uuid, text) TO authenticated;
`;

/** Bootstrap → fixtures → production grants → real migration chain. */
async function applyChain(exec: SqlExec): Promise<void> {
  await exec.exec(readSql(BOOTSTRAP));
  await exec.exec(ENTITLEMENT_SHAPE);
  await exec.exec(PRE_DEPS);
  await exec.exec(PRODUCTION_GRANTS);
  await exec.exec(PRE_M2_POSTURE);
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
