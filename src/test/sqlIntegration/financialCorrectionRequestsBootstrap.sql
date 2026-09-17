-- Additional catalog for 195_financial_correction_requests.sql, layered on top of
-- transferEngineBootstrap.sql + historicalFinancialCorrectionLookupBootstrap.sql (which
-- together already provide auth.users/auth.uid(), organizations, organization_members,
-- shops, shop_members, products, internal_admins, sales, sale_line_items,
-- _sale_kampala_day, _is_finite_numeric_text). Adds only what 195 itself needs:
-- audit_logs (all three of its functions write to it) and sale_line_item_corrections
-- (the link function reads it to verify correction<->line linkage).

-- Exact match of the live production function (public.is_waka_internal_role).
CREATE OR REPLACE FUNCTION public.is_waka_internal_role (p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1
    from public.internal_admins ia
    where coalesce(ia.auth_user_id, ia.user_id) = auth.uid()
      and coalesce(ia.is_active, ia.active, true) = true
      and ia.role = any(p_roles)
  );
$$;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  actor_user_id uuid,
  role text,
  action text NOT NULL,
  payload_summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  device_id text,
  client_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_line_item_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  sale_line_item_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  product_id uuid NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  correction_basis jsonb NOT NULL,
  reason text NOT NULL,
  corrected_by uuid NOT NULL,
  corrected_role text NOT NULL,
  resulting_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid
);
