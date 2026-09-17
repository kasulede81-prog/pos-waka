-- Bespoke catalog for 194_historical_financial_correction_lookup.sql, layered on top of
-- transferEngineBootstrap.sql (auth.users/auth.uid(), organizations, organization_members,
-- shops, shop_members, products already defined there). Adds only what the lookup RPC
-- itself needs: internal_admins, sales, sale_line_items, and the two small helper
-- functions it calls (_sale_kampala_day, _is_finite_numeric_text) — both reproduced
-- here exactly as they read live in production, not a stand-in approximation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS conversion_rate numeric;

CREATE TABLE IF NOT EXISTS public.internal_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES auth.users (id),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'support_admin',
  active boolean NOT NULL DEFAULT true,
  is_active boolean,
  can_view_sensitive_data boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.sale_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  quantity numeric NOT NULL,
  line_total_ugx bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial_revision bigint NOT NULL DEFAULT 0
);

-- Exact match of the live production function (public._sale_kampala_day).
CREATE OR REPLACE FUNCTION public._sale_kampala_day (p_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
AS $$
  select (coalesce(p_ts, now()) at time zone 'Africa/Kampala')::date;
$$;

-- Exact match of the live production function (public._is_finite_numeric_text).
CREATE OR REPLACE FUNCTION public._is_finite_numeric_text (p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  select p_text is not null and p_text ~ '^-?[0-9]+(\.[0-9]+)?$';
$$;
