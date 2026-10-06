-- Minimal schema bootstrap for the loyalty engine SQL integration tests.
-- Mirrors transferEngineBootstrap.sql conventions; the real migration
-- 20260918024500_loyalty_data_foundation.sql is applied on top by the harness.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  -- Supabase-platform role. Some loyalty migrations grant to it unguarded
  -- (e.g. the wallet sync outbox), so the harness must provide it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  -- Production auth.users carries this; waka_account_identity() derives merchant_intent and
  -- member_intent from it, so the harness must model it or those branches are untestable.
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION auth.uid ()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  shop_number text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'manager',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, user_id)
);

-- ---------- business tables referenced by the loyalty migration ----------
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  cost_ugx bigint NOT NULL DEFAULT 0,
  cost_price_per_unit_ugx bigint NOT NULL DEFAULT 0,
  selling_price_per_unit_ugx bigint NOT NULL DEFAULT 0,
  stock_on_hand numeric(18, 4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  name text NOT NULL,
  phone_e164 text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'void', 'refunded')),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'partial', 'paid', 'refunded')),
  subtotal_ugx bigint NOT NULL DEFAULT 0,
  tax_ugx bigint NOT NULL DEFAULT 0,
  discount_ugx bigint NOT NULL DEFAULT 0,
  total_ugx bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'UGX',
  cash_amount_ugx bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users (id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.sale_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  unit_price_ugx bigint NOT NULL DEFAULT 0,
  line_discount_ugx bigint NOT NULL DEFAULT 0,
  line_total_ugx bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  method text NOT NULL,
  amount_ugx bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  refund_amount_ugx bigint NOT NULL,
  reason text NOT NULL DEFAULT 'other',
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  stock_applied_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.sale_voids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  quantity numeric(18, 4) NOT NULL,
  amount_ugx bigint NOT NULL,
  line_index int NOT NULL DEFAULT 0,
  note text,
  sale_voided_at timestamptz,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------- inventory (minimal stub of production sale-stock path) ----------
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  quantity_delta numeric(18, 4) NOT NULL,
  reason text NOT NULL DEFAULT 'sale',
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.inventory_movement_uuid (
  p_shop_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_product_id uuid
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
    substr(md5(p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text), 1, 8) || '-' ||
    substr(md5(p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text), 9, 4) || '-' ||
    '4' || substr(md5(p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text), 13, 3) || '-' ||
    'a' || substr(md5(p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text), 17, 3) || '-' ||
    substr(md5(p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text), 21, 12)
  )::uuid;
$$;

-- Test double for the canonical inventory engine used by D030 product claims.
CREATE OR REPLACE FUNCTION public.apply_sale_stock_movements (p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_shop uuid;
  v_new numeric;
  v_updated_at timestamptz;
  v_movement_id uuid;
  v_stocks jsonb := '[]'::jsonb;
BEGIN
  SELECT shop_id INTO STRICT v_shop FROM public.sales WHERE id = p_sale_id;

  FOR r IN
    SELECT sli.product_id, sum(sli.quantity) AS quantity
    FROM public.sale_line_items sli
    WHERE sli.sale_id = p_sale_id
      AND sli.product_id IS NOT NULL
    GROUP BY sli.product_id
  LOOP
    IF r.quantity <= 0 THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements im
      WHERE im.shop_id = v_shop
        AND im.reference_type = 'sale'
        AND im.reference_id = p_sale_id
        AND im.product_id = r.product_id
    ) THEN
      SELECT p.stock_on_hand, p.updated_at
      INTO v_new, v_updated_at
      FROM public.products p
      WHERE p.id = r.product_id AND p.shop_id = v_shop;

      v_stocks := v_stocks || jsonb_build_array(
        jsonb_build_object('product_id', r.product_id, 'stock_on_hand', v_new, 'updated_at', v_updated_at)
      );
      CONTINUE;
    END IF;

    v_movement_id := public.inventory_movement_uuid(v_shop, 'sale', p_sale_id, r.product_id);

    UPDATE public.products p
    SET stock_on_hand = p.stock_on_hand - r.quantity,
        updated_at = now()
    WHERE p.id = r.product_id
      AND p.shop_id = v_shop
    RETURNING p.stock_on_hand, p.updated_at INTO v_new, v_updated_at;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not in this shop', r.product_id;
    END IF;

    INSERT INTO public.inventory_movements (
      id, shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
    )
    VALUES (
      v_movement_id, v_shop, r.product_id, -r.quantity, 'sale', 'sale', p_sale_id, auth.uid()
    )
    ON CONFLICT (id) DO NOTHING;

    v_stocks := v_stocks || jsonb_build_array(
      jsonb_build_object('product_id', r.product_id, 'stock_on_hand', v_new, 'updated_at', v_updated_at)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'stocks', v_stocks);
END;
$$;
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.customer_debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.ai_generation_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_day_drawer_opens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_cash_drawer_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_inventory_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.shop_cloud_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.financial_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.sale_line_item_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.sync_health (
  shop_id uuid PRIMARY KEY REFERENCES public.shops (id) ON DELETE CASCADE,
  pending_outbound int NOT NULL DEFAULT 0,
  last_error text,
  last_pull_at timestamptz,
  last_push_ok_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.shop_recovery_signals (
  shop_id uuid PRIMARY KEY REFERENCES public.shops (id) ON DELETE CASCADE,
  force_full_resync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.internal_ops_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  action text NOT NULL,
  target_shop_id uuid,
  -- Production shape (030_onboarding_bootstrap_subscription_requests.sql:73-81) includes
  -- target_org_id; the Phase 6A loyalty admin RPCs audit against an ORGANIZATION, so the
  -- harness must carry it too.
  target_org_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- platform settings (production shape from 092) ----------
-- Phase 4 reads enrollment thresholds from here (key 'loyalty_enrollment_settings') and
-- falls back to its own defaults when the row is absent, which is the normal case.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- ---------- shop -> org resolver (production definition from 076) ----------
CREATE OR REPLACE FUNCTION public.shop_org_id (p_shop_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sh.organization_id FROM public.shops sh WHERE sh.id = p_shop_id;
$$;

-- ---------- add-on entitlements (production shape from 038) ----------
-- WAKA Loyalty monetisation reuses this table rather than adding a second billing
-- system, so the harness needs it in its production shape (including the original
-- feature_code CHECK, which the Phase 1 migration deliberately widens).
CREATE TABLE IF NOT EXISTS public.organization_feature_entitlements (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  feature_code text NOT NULL CHECK (feature_code IN ('ai_stock_assistant')),
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'pending', 'trial', 'active', 'rejected')),
  trial_ends_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, feature_code)
);

-- Test-only: mirror the production backfill in
-- 20260926090000_loyalty_membership_entitlements.sql, which grants every existing
-- organization the 'loyalty' entitlement on the default tier so merchants already
-- running Loyalty are not cut off. The harness creates organizations in fixtures
-- (after migrations), so it needs the same grant applied on creation.
-- Tests that exercise the gate simply downgrade or delete this row.
CREATE OR REPLACE FUNCTION public.test_seed_loyalty_entitlement ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_feature_entitlements (organization_id, feature_code, status, metadata)
  VALUES (NEW.id, 'loyalty', 'active', '{"seed": "test_bootstrap"}'::jsonb)
  ON CONFLICT (organization_id, feature_code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_seed_loyalty_entitlement ON public.organizations;
CREATE TRIGGER trg_test_seed_loyalty_entitlement
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.test_seed_loyalty_entitlement ();

-- ---------- permission helpers (production definitions from 007) ----------
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE OR REPLACE FUNCTION public.user_can_manage_shop (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_members sm
    WHERE sm.shop_id = p_shop
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'manager')
  )
  OR EXISTS (
    SELECT 1
    FROM public.shops sh
    JOIN public.organization_members om ON om.organization_id = sh.organization_id
    WHERE sh.id = p_shop
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_shop (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_manage_shop(p_shop)
  OR EXISTS (
    SELECT 1 FROM public.shop_members sm
    WHERE sm.shop_id = p_shop AND sm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_cashier_or_above (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_members sm
    WHERE sm.shop_id = p_shop
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'manager', 'cashier', 'supervisor')
  )
  OR public.user_can_manage_shop(p_shop);
$$;

-- Test double for the canonical internal-staff predicate (053_internal_admin_auth_user_lookup):
-- any internal role present stands in for an internal_admins row.
CREATE OR REPLACE FUNCTION public.is_waka_internal_staff ()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_members sm
    WHERE sm.user_id = auth.uid ()
      AND sm.role IN (
        'super_admin', 'operations_admin', 'support_admin',
        'subscriptions_admin', 'finance_admin', 'field_agent'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_waka_internal_role (p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Test double: membership in shop_members with role 'super_admin' stands in
  -- for the WAKA internal admin claim used in production.
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_members sm
    WHERE sm.user_id = auth.uid() AND sm.role = ANY (p_roles)
  );
$$;

-- Test double for the canonical pending-staff-invite predicate (161_staff_invitation_system):
-- waka_account_identity() reports it as one of its classification flags. The harness has no
-- staff_invitations table, so this stands in as "never pending" — which is the correct answer for
-- every fixture here and keeps the flag meaningful (always false) rather than absent.
CREATE OR REPLACE FUNCTION public.shop_has_pending_staff_invite_for_me ()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT false;
$$;

-- ---------- Phase 1 member identity: harness fidelity for the classifier ----------
-- waka_account_identity() reports profile_exists and loyalty_member_dashboard() reads shops for
-- display. Neither table existed in the harness at the granularity those functions need, so they
-- are modelled here rather than the functions being weakened to suit the tests.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text,
  email text,
  business_name text,
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS district text;

-- ============================================================================
-- M1 — PAYMENT FOUNDATION FIXTURES (production shapes; test-only)
-- ============================================================================
-- The M1 migration and its tests operate on the subscription/payment tables.
-- Production already has all of these (006 plans/subscriptions, 018
-- payment_status, 027 history, 028 payments + history writer, 019/008 RLS);
-- they are modelled here with the same shapes rather than weakening the code.

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  monthly_price_ugx bigint NOT NULL CHECK (monthly_price_ugx >= 0),
  annual_price_ugx bigint NOT NULL CHECK (annual_price_ugx >= 0),
  annual_savings_note text,
  annual_discount_percent numeric(6, 2),
  trial_days int NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  max_shops int,
  max_pos_users int,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Current repackaged catalog (066 / CANONICAL_PLAN_PRICES): free, starter, business, waka_plus.
INSERT INTO public.subscription_plans (code, name, monthly_price_ugx, annual_price_ugx, annual_discount_percent, features, is_active)
VALUES
  ('free', 'Free', 0, 0, 0, '{"pos": true}'::jsonb, true),
  ('starter', 'Starter', 18000, 216000, 20, '{"devices": 1}'::jsonb, true),
  ('business', 'Business', 36000, 432000, 20, '{"devices": 4}'::jsonb, true),
  ('waka_plus', 'Waka Plus', 82000, 984000, 20, '{"devices": 10}'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans (id),
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  admin_discount_percent numeric(6, 2) NOT NULL DEFAULT 0
    CHECK (admin_discount_percent >= 0 AND admin_discount_percent <= 100),
  admin_discount_note text,
  external_provider text DEFAULT 'manual',
  external_subscription_id text,
  payment_status text NOT NULL DEFAULT 'unknown'
    CHECK (payment_status IN ('unknown', 'unpaid', 'pending', 'paid', 'waived', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 006: at most one live subscription row per org for trialing/active states.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_org
  ON public.subscriptions (organization_id)
  WHERE status IN ('trialing', 'active', 'past_due');

-- 017: shop anchor + wider lifecycle statuses. M1 resolves a payment's
-- (shop, subscription) pair and reactivates an expired subscription on
-- confirmation, so both have to exist here with the production shape.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS shop_id uuid
  REFERENCES public.shops (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS subscriptions_shop_idx ON public.subscriptions (shop_id);

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (
  status IN ('trial', 'trialing', 'active', 'expired', 'past_due', 'cancelled', 'canceled', 'paused')
);

-- 013: audit_logs rows written by markPaid and the M1 payment RPCs.
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS payload_summary text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_subscriptions_updated ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 019: org members and internal staff may read the subscription.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select
  ON public.subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = subscriptions.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'billing', 'staff')
    )
    OR public.is_waka_internal_staff ()
  );
GRANT SELECT ON public.subscriptions TO authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.subscriptions (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  shop_id uuid REFERENCES public.shops (id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_history_org_created_idx ON public.subscription_history (organization_id, created_at desc);
CREATE INDEX IF NOT EXISTS subscription_history_sub_idx ON public.subscription_history (subscription_id, created_at desc);
GRANT SELECT ON public.subscription_history TO authenticated;

-- 028: the SECURITY DEFINER history writer used by markPaid and the M1 payment RPCs.
CREATE OR REPLACE FUNCTION public._internal_subscription_history_write (
  p_subscription_id uuid,
  p_action text,
  p_note text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_shop uuid;
BEGIN
  SELECT s.organization_id, s.shop_id
  INTO v_org, v_shop
  FROM public.subscriptions s
  WHERE s.id = p_subscription_id;

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.subscription_history (
    subscription_id, organization_id, shop_id, actor_user_id, action, note, payload
  ) VALUES (
    p_subscription_id, v_org, v_shop, auth.uid(), p_action, p_note,
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._internal_subscription_history_write (uuid, text, text, jsonb) FROM public;

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  amount_ugx bigint NOT NULL DEFAULT 0 CHECK (amount_ugx >= 0),
  currency text NOT NULL DEFAULT 'UGX',
  provider text,
  reference text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed', 'failed')),
  recorded_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_sub_idx ON public.subscription_payments (subscription_id, created_at desc);
CREATE INDEX IF NOT EXISTS subscription_payments_org_idx ON public.subscription_payments (organization_id, created_at desc);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_internal_select ON public.subscription_payments;
CREATE POLICY subscription_payments_internal_select
  ON public.subscription_payments FOR SELECT
  USING (public.is_waka_internal_staff ());
GRANT SELECT ON public.subscription_payments TO authenticated;
