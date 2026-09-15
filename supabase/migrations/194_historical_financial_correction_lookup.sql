-- Dedicated read-only lookup RPC for the historical financial correction UI.
--
-- Fixes a real integration bug: the correction panel's "Look up" step was previously
-- implemented as a plain `sale_line_items` SELECT, which depends on standard RLS
-- (sale_lines_select / sales_select). That RLS requires either real shop membership
-- (user_can_access_shop — not applicable to internal admins) or the SEPARATE
-- can_view_sensitive_data flag on internal_admins (distinct from role, defaults to
-- false, unrelated to whether an admin is authorized to correct financials). A
-- super_admin/finance_admin who has never had that flag set gets zero rows back from
-- RLS with no error — indistinguishable from the line not existing.
--
-- This RPC uses the SAME internal-admin role gate as shop_correct_sale_line_financials
-- and admin_regenerate_day_close_for_correction (192_historical_financial_correction_
-- platform_functions.sql): super_admin/finance_admin only, checked directly against
-- internal_admins, bypassing RLS entirely via SECURITY DEFINER. can_view_sensitive_data
-- is never referenced. Read-only — no INSERT/UPDATE/DELETE anywhere in this function.

create or replace function public.shop_lookup_sale_line_for_correction(
  p_shop_id uuid,
  p_sale_line_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_line record;
  v_sale record;
  v_product record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select ia.role into v_role
  from public.internal_admins ia
  where coalesce(ia.auth_user_id, ia.user_id) = v_uid
    and coalesce(ia.is_active, ia.active, true) = true
    and ia.role = any(array['super_admin', 'finance_admin'])
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_shop_id is null or p_sale_line_item_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select id, sale_id, product_id, quantity, line_total_ugx, financial_revision, metadata
  into v_line
  from public.sale_line_items
  where id = p_sale_line_item_id;

  if v_line.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select id, shop_id, status, created_at
  into v_sale
  from public.sales
  where id = v_line.sale_id;

  -- A line whose sale doesn't belong to the requested shop is reported identically to
  -- "not found" — never confirm cross-tenant existence to the caller, even an
  -- authorized internal admin who simply passed the wrong shop_id.
  if v_sale.id is null or v_sale.shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_sale.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'sale_not_completed');
  end if;

  if not (
    public._is_finite_numeric_text(v_line.metadata ->> 'unitCostUgx')
    and public._is_finite_numeric_text(v_line.metadata ->> 'cogsUgx')
    and public._is_finite_numeric_text(v_line.metadata ->> 'grossProfitUgx')
    and public._is_finite_numeric_text(v_line.metadata ->> 'estimatedProfitUgx')
  ) then
    return jsonb_build_object('ok', false, 'error', 'malformed_or_missing_financial_snapshot');
  end if;

  select id, name, conversion_rate into v_product from public.products where id = v_line.product_id;

  return jsonb_build_object(
    'ok', true,
    'saleLineItemId', v_line.id,
    'saleId', v_line.sale_id,
    'shopId', v_sale.shop_id,
    'productId', v_line.product_id,
    'productName', coalesce(v_product.name, ''),
    'saleStatus', v_sale.status,
    'businessDateKey', to_char(public._sale_kampala_day(v_sale.created_at), 'YYYY-MM-DD'),
    'quantity', v_line.quantity,
    'lineTotalUgx', v_line.line_total_ugx,
    'financialRevision', v_line.financial_revision,
    'currentUnitCostUgx', (v_line.metadata ->> 'unitCostUgx')::numeric,
    'currentCogsUgx', (v_line.metadata ->> 'cogsUgx')::bigint,
    'currentGrossProfitUgx', (v_line.metadata ->> 'grossProfitUgx')::bigint,
    'currentEstimatedProfitUgx', (v_line.metadata ->> 'estimatedProfitUgx')::bigint,
    'conversionRate', v_product.conversion_rate
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'internal_error');
end;
$$;

revoke all on function public.shop_lookup_sale_line_for_correction(uuid, uuid) from public;
revoke all on function public.shop_lookup_sale_line_for_correction(uuid, uuid) from anon;
grant execute on function public.shop_lookup_sale_line_for_correction(uuid, uuid) to authenticated;
