-- Bespoke catalog for 20260916015249_product_pack_slot_state_sync.sql,
-- layered on top of transferEngineBootstrap.sql (auth.users/auth.uid(),
-- organizations, organization_members, shops, shop_members, products
-- already defined there). Adds only the two small role-check helpers the
-- new RPC calls, reproduced exactly as they read live in production.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

-- Exact match of the live production function (public.user_can_manage_shop).
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

-- Exact match of the live production function (public.user_is_cashier_or_above).
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
