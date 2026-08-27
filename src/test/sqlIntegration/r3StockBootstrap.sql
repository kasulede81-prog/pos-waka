-- Extra schema for Sync R3 SQL integration tests (applied after transferEngineBootstrap.sql).

CREATE OR REPLACE FUNCTION public.user_is_cashier_or_above (p_shop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_members sm
    WHERE sm.shop_id = p_shop
      AND sm.user_id = auth.uid()
      AND sm.role IN ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer')
  )
  OR public.user_can_manage_shop(p_shop);
$$;

CREATE TABLE IF NOT EXISTS public.shop_inventory_count_sessions (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops (id) ON DELETE CASCADE,
  session_number int NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_purchase_product_unique
  ON public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  WHERE reference_type = 'purchase' AND reference_id IS NOT NULL;
