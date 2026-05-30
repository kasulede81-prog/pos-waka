-- sale_returns: cloud sync for product returns (stock restore, reporting, RLS).

create table if not exists public.sale_returns (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_id uuid references public.sales (id) on delete set null,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(18, 4) not null check (quantity > 0),
  refund_amount_ugx bigint not null check (refund_amount_ugx > 0),
  reason text not null default 'other',
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  metadata jsonb not null default '{}'::jsonb,
  stock_applied_at timestamptz
);

create index if not exists sale_returns_shop_created_idx
  on public.sale_returns (shop_id, created_at desc);

create index if not exists sale_returns_shop_updated_idx
  on public.sale_returns (shop_id, updated_at desc);

create index if not exists sale_returns_sale_idx
  on public.sale_returns (sale_id)
  where sale_id is not null;

drop trigger if exists trg_sale_returns_updated on public.sale_returns;
create trigger trg_sale_returns_updated
  before update on public.sale_returns
  for each row execute function public.set_updated_at ();

-- ---------- RLS ----------
alter table public.sale_returns enable row level security;

drop policy if exists sale_returns_select on public.sale_returns;
create policy sale_returns_select
  on public.sale_returns for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists sale_returns_insert on public.sale_returns;
create policy sale_returns_insert
  on public.sale_returns for insert
  with check (public.user_is_cashier_or_above (shop_id));

drop policy if exists sale_returns_update on public.sale_returns;
create policy sale_returns_update
  on public.sale_returns for update
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists sale_returns_delete on public.sale_returns;
create policy sale_returns_delete
  on public.sale_returns for delete
  using (public.user_can_manage_shop (shop_id));

-- ---------- Stock restore (idempotent) ----------
create or replace function public.apply_sale_return_stock (p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sale_returns%rowtype;
  v_new numeric;
begin
  select * into strict r from public.sale_returns where id = p_return_id for update;

  if r.stock_applied_at is not null then
    return;
  end if;

  if exists (
    select 1 from public.inventory_movements im
    where im.reference_type = 'sale_return'
      and im.reference_id = p_return_id
  ) then
    update public.sale_returns
    set stock_applied_at = coalesce (stock_applied_at, now ())
    where id = p_return_id;
    return;
  end if;

  update public.products p
  set stock_on_hand = p.stock_on_hand + r.quantity,
      updated_at = now ()
  where p.id = r.product_id
    and p.shop_id = r.shop_id
  returning p.stock_on_hand into v_new;

  if not found then
    raise exception 'Product % not in shop', r.product_id;
  end if;

  insert into public.inventory_movements (
    shop_id, product_id, quantity_delta, reason, reference_type, reference_id, created_by
  )
  values (
    r.shop_id,
    r.product_id,
    r.quantity,
    'return',
    'sale_return',
    p_return_id,
    auth.uid ()
  );

  update public.sale_returns
  set stock_applied_at = now (),
      updated_at = now ()
  where id = p_return_id;
end;
$$;

-- ---------- Transactional return upsert RPC ----------
create or replace function public.shop_push_sale_return (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_id uuid;
  v_sale_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_refund bigint;
  v_reason text;
  v_row public.sale_returns%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_product_id := nullif (p_payload ->> 'product_id', '')::uuid;
  v_qty := coalesce ((p_payload ->> 'quantity')::numeric, 0);
  v_refund := coalesce ((p_payload ->> 'refund_amount_ugx')::bigint, 0);
  v_reason := coalesce (nullif (trim (p_payload ->> 'reason'), ''), 'other');
  v_sale_id := nullif (p_payload ->> 'sale_id', '')::uuid;

  if v_id is null or v_product_id is null or v_qty <= 0 or v_refund <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  if v_sale_id is not null then
    if not exists (
      select 1 from public.sales s
      where s.id = v_sale_id and s.shop_id = p_shop_id
    ) then
      return jsonb_build_object ('ok', false, 'error', 'sale_not_found');
    end if;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = v_product_id and p.shop_id = p_shop_id
  ) then
    return jsonb_build_object ('ok', false, 'error', 'product_not_found');
  end if;

  insert into public.sale_returns (
    id,
    shop_id,
    sale_id,
    product_id,
    quantity,
    refund_amount_ugx,
    reason,
    note,
    created_by,
    created_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    v_sale_id,
    v_product_id,
    v_qty,
    v_refund,
    v_reason,
    nullif (p_payload ->> 'note', ''),
    coalesce (nullif (p_payload ->> 'created_by', '')::uuid, v_uid),
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce (p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    sale_id = excluded.sale_id,
    product_id = excluded.product_id,
    quantity = excluded.quantity,
    refund_amount_ugx = excluded.refund_amount_ugx,
    reason = excluded.reason,
    note = excluded.note,
    metadata = excluded.metadata,
    updated_at = now ()
  returning * into v_row;

  perform public.apply_sale_return_stock (v_row.id);

  return jsonb_build_object ('ok', true, 'return_id', v_row.id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.apply_sale_return_stock (uuid) from public;
revoke all on function public.shop_push_sale_return (uuid, jsonb) from public;
grant execute on function public.shop_push_sale_return (uuid, jsonb) to authenticated;
