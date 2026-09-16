-- Bespoke catalog for 20260916025318_sale_line_void_state_sync.sql, layered
-- on top of transferEngineBootstrap.sql (auth.users/auth.uid(),
-- organizations, organization_members, shops, shop_members, products
-- already defined there). Adds only what this RPC needs: the two role-check
-- helpers (exact match of the live production functions) plus sales/
-- sale_line_items.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.user_can_manage_shop (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager')
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_cashier_or_above (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer')
  )
  or public.user_can_manage_shop (p_shop);
$$;

CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now (),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.sale_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id),
  quantity numeric NOT NULL,
  line_total_ugx bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial_revision bigint NOT NULL DEFAULT 0
);
