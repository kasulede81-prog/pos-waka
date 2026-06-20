-- Cloud-authoritative local stock movement ledger (POS StockMovement payloads).

create table if not exists public.shop_stock_movements (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  movement_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_stock_movements_shop_updated_idx
  on public.shop_stock_movements (shop_id, updated_at);

create index if not exists shop_stock_movements_shop_at_idx
  on public.shop_stock_movements (shop_id, movement_at desc);

alter table public.shop_stock_movements enable row level security;

drop policy if exists shop_stock_movements_select on public.shop_stock_movements;
create policy shop_stock_movements_select
  on public.shop_stock_movements for select
  using (public.user_is_cashier_or_above (shop_id));

drop policy if exists shop_stock_movements_insert on public.shop_stock_movements;
create policy shop_stock_movements_insert
  on public.shop_stock_movements for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_stock_movements_update on public.shop_stock_movements;
create policy shop_stock_movements_update
  on public.shop_stock_movements for update
  using (public.user_can_manage_shop (shop_id));

-- ---------- Push stock movement ----------
create or replace function public.shop_push_stock_movement (
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
  v_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  v_at := coalesce (
    nullif (p_payload ->> 'movement_at', '')::timestamptz,
    nullif (p_payload ->> 'at', '')::timestamptz,
    now ()
  );

  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.shop_stock_movements (
    id, shop_id, movement_at, payload, created_at, updated_at
  )
  values (
    v_id,
    p_shop_id,
    v_at,
    coalesce (p_payload -> 'movement', p_payload),
    coalesce (nullif (p_payload ->> 'created_at', '')::timestamptz, now ()),
    coalesce (nullif (p_payload ->> 'updated_at', '')::timestamptz, now ())
  )
  on conflict (id) do update
  set
    movement_at = excluded.movement_at,
    payload = excluded.payload,
    updated_at = greatest (public.shop_stock_movements.updated_at, excluded.updated_at);

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.shop_push_stock_movement (uuid, jsonb) from public;
grant execute on function public.shop_push_stock_movement (uuid, jsonb) to authenticated;

-- ---------- Pull stock movements (paginated via p_since cursor) ----------
create or replace function public.shop_pull_stock_movements (
  p_shop_id uuid,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_max timestamptz;
begin
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg (to_jsonb (r) order by r.updated_at), '[]'::jsonb),
         coalesce (max (r.updated_at), p_since, now ())
  into v_rows, v_max
  from (
    select
      m.id,
      m.shop_id,
      m.movement_at,
      m.payload,
      m.created_at,
      m.updated_at
    from public.shop_stock_movements m
    where m.shop_id = p_shop_id
      and (p_since is null or m.updated_at > p_since)
    order by m.updated_at
    limit 500
  ) r;

  return jsonb_build_object ('ok', true, 'rows', v_rows, 'checkpoint_at', v_max);
end;
$$;

revoke all on function public.shop_pull_stock_movements (uuid, timestamptz) from public;
grant execute on function public.shop_pull_stock_movements (uuid, timestamptz) to authenticated;
