-- ADMIN-2 Phase 1: shop-scoped read-only operational ledgers for internal staff.
-- Returns, sale voids, and cash-drawer expenses. Bounded (limit 1..50, offset 0..500).
-- Returns one extra row so the client can set has_more.
-- No new index — sale_returns_shop_created_idx (062), sale_voids_shop_updated_idx (179),
-- and expenses_shop_paid_active_idx (069) already cover the shop-scoped lookups.
-- Does not widen table RLS. Does not grant anon.

-- ---------- Returns ----------
create or replace function public.internal_ops_shop_sale_returns (
  p_shop_id uuid,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  shop_id uuid,
  sale_id uuid,
  product_id uuid,
  product_name text,
  quantity numeric,
  refund_amount_ugx bigint,
  reason text,
  stock_applied_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least (greatest (coalesce (p_limit, 25), 1), 50);
  v_offset int := least (greatest (coalesce (p_offset, 0), 0), 500);
  v_fetch int := v_limit + 1;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    r.id,
    r.shop_id,
    r.sale_id,
    r.product_id,
    p.name as product_name,
    r.quantity,
    r.refund_amount_ugx,
    r.reason,
    r.stock_applied_at,
    r.created_at
  from public.sale_returns r
  left join public.products p
    on p.id = r.product_id
    and p.shop_id = p_shop_id
  where r.shop_id = p_shop_id
  order by r.created_at desc, r.id desc
  limit v_fetch
  offset v_offset;
end;
$$;

comment on function public.internal_ops_shop_sale_returns (uuid, int, int) is
  'Internal staff read-only sale returns for one shop. Unauthorized callers fail.';

revoke all on function public.internal_ops_shop_sale_returns (uuid, int, int) from public;
revoke all on function public.internal_ops_shop_sale_returns (uuid, int, int) from anon;
grant execute on function public.internal_ops_shop_sale_returns (uuid, int, int) to authenticated;

-- ---------- Sale voids ----------
create or replace function public.internal_ops_shop_sale_voids (
  p_shop_id uuid,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  shop_id uuid,
  sale_id uuid,
  product_id uuid,
  product_name text,
  quantity numeric,
  amount_ugx bigint,
  line_index int,
  sale_voided_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least (greatest (coalesce (p_limit, 25), 1), 50);
  v_offset int := least (greatest (coalesce (p_offset, 0), 0), 500);
  v_fetch int := v_limit + 1;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    sv.id,
    sv.shop_id,
    sv.sale_id,
    sv.product_id,
    p.name as product_name,
    sv.quantity,
    sv.amount_ugx,
    sv.line_index,
    sv.sale_voided_at,
    sv.created_at
  from public.sale_voids sv
  left join public.products p
    on p.id = sv.product_id
    and p.shop_id = p_shop_id
  where sv.shop_id = p_shop_id
  order by sv.created_at desc, sv.id desc
  limit v_fetch
  offset v_offset;
end;
$$;

comment on function public.internal_ops_shop_sale_voids (uuid, int, int) is
  'Internal staff read-only sale voids for one shop. Unauthorized callers fail.';

revoke all on function public.internal_ops_shop_sale_voids (uuid, int, int) from public;
revoke all on function public.internal_ops_shop_sale_voids (uuid, int, int) from anon;
grant execute on function public.internal_ops_shop_sale_voids (uuid, int, int) to authenticated;

-- ---------- Cash expenses ----------
create or replace function public.internal_ops_shop_cash_expenses (
  p_shop_id uuid,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  shop_id uuid,
  category text,
  amount_ugx bigint,
  description text,
  paid_on date,
  recorded_by_label text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least (greatest (coalesce (p_limit, 25), 1), 50);
  v_offset int := least (greatest (coalesce (p_offset, 0), 0), 500);
  v_fetch int := v_limit + 1;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    e.id,
    e.shop_id,
    e.category,
    e.amount_ugx,
    e.description,
    e.paid_on,
    e.recorded_by_label,
    e.created_at
  from public.expenses e
  where e.shop_id = p_shop_id
    and e.expense_type = 'cash_drawer'
    and e.deleted_at is null
  order by e.paid_on desc, e.id desc
  limit v_fetch
  offset v_offset;
end;
$$;

comment on function public.internal_ops_shop_cash_expenses (uuid, int, int) is
  'Internal staff read-only cash-drawer expenses for one shop. Unauthorized callers fail.';

revoke all on function public.internal_ops_shop_cash_expenses (uuid, int, int) from public;
revoke all on function public.internal_ops_shop_cash_expenses (uuid, int, int) from anon;
grant execute on function public.internal_ops_shop_cash_expenses (uuid, int, int) to authenticated;
