-- Minimal schema bootstrap for MB-4B transfer engine SQL integration tests.
-- Applies before the real migration 167 file contents.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
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

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_transfer_shops_distinct_placeholder CHECK (true)
);

CREATE TABLE IF NOT EXISTS public.shop_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'manager',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  name text NOT NULL,
  cost_price_per_unit_ugx bigint NOT NULL DEFAULT 0,
  stock_on_hand numeric(18, 4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  quantity_delta numeric(18, 4) NOT NULL,
  reason text NOT NULL CHECK (
    reason IN ('sale', 'return', 'adjustment', 'initial', 'transfer', 'waste', 'other', 'purchase')
  ),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enterprise_stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  from_shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE RESTRICT,
  to_shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft', 'pending_approval', 'approved', 'shipped', 'in_transit',
        'received', 'completed', 'cancelled', 'rejected'
      )
    ),
  reason text,
  shipped_at timestamptz,
  received_at timestamptz,
  client_id text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_transfer_shops_distinct CHECK (from_shop_id <> to_shop_id)
);

CREATE TABLE IF NOT EXISTS public.enterprise_stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.enterprise_stock_transfers (id) ON DELETE CASCADE,
  product_id uuid,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost_ugx bigint NOT NULL DEFAULT 0,
  received_quantity numeric NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
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

CREATE OR REPLACE FUNCTION public.user_has_org_role (p_org uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org
      AND om.user_id = auth.uid()
      AND om.role = ANY (p_roles)
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
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    '4' || substr(h, 14, 3) || '-' ||
    substr('89ab', ((get_byte(decode(substr(h, 17, 2), 'hex'), 0) % 4) + 1), 1) || substr(h, 18, 3) || '-' ||
    substr(h, 21, 12)
  )::uuid
  FROM (
    SELECT md5(
      p_shop_id::text || '|' || coalesce(p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text
    ) AS h
  ) s;
$$;
