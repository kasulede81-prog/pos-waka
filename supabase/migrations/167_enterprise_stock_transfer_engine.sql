-- MB-4B — Durable inter-branch stock transfer engine
-- Depends on: 130 (enterprise_stock_transfers), 083 (inventory_movement_uuid), 166 (movement patterns)

-- ---------- Schema: destination product mapping ----------
alter table public.enterprise_stock_transfer_lines
  add column if not exists destination_product_id uuid references public.products (id) on delete restrict;

comment on column public.enterprise_stock_transfer_lines.product_id is
  'Source-shop product (from_shop_id).';
comment on column public.enterprise_stock_transfer_lines.destination_product_id is
  'Destination-shop product (to_shop_id). Required for MB-4B dispatch/receive.';

create index if not exists enterprise_stock_transfer_lines_dest_product_idx
  on public.enterprise_stock_transfer_lines (destination_product_id)
  where destination_product_id is not null;

-- One source / one destination product per transfer (nullable-safe for legacy rows).
create unique index if not exists enterprise_transfer_lines_unique_source_per_transfer
  on public.enterprise_stock_transfer_lines (transfer_id, product_id)
  where product_id is not null;

create unique index if not exists enterprise_transfer_lines_unique_dest_per_transfer
  on public.enterprise_stock_transfer_lines (transfer_id, destination_product_id)
  where destination_product_id is not null;

-- ---------- Receive event audit (immutable receive_event_id) ----------
create table if not exists public.enterprise_stock_transfer_receive_events (
  id uuid primary key,
  transfer_id uuid not null references public.enterprise_stock_transfers (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint enterprise_transfer_receive_event_shop_matches
    check (shop_id is not null)
);

create index if not exists enterprise_transfer_receive_events_transfer_idx
  on public.enterprise_stock_transfer_receive_events (transfer_id, created_at desc);

alter table public.enterprise_stock_transfer_receive_events enable row level security;

drop policy if exists enterprise_transfer_receive_events_select on public.enterprise_stock_transfer_receive_events;
create policy enterprise_transfer_receive_events_select on public.enterprise_stock_transfer_receive_events
  for select using (
    exists (
      select 1 from public.enterprise_stock_transfers t
      where t.id = transfer_id
        and (
          public.user_has_org_role (t.organization_id, array['owner', 'admin'])
          or public.user_can_manage_shop (t.from_shop_id)
          or public.user_can_manage_shop (t.to_shop_id)
        )
    )
  );

-- ---------- Durable movement identities for transfer legs ----------
create unique index if not exists inventory_movements_transfer_dispatch_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'transfer_dispatch' and reference_id is not null;

create unique index if not exists inventory_movements_transfer_receive_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'transfer_receive' and reference_id is not null;

-- ---------- Helpers ----------
create or replace function public.product_exact_unit_cost_ugx (p_product public.products)
returns numeric
language sql
immutable
parallel safe
as $$
  select coalesce(
    nullif((coalesce(p_product.metadata, '{}'::jsonb) ->> 'exactCostPricePerUnitUgx')::numeric, null),
    p_product.cost_price_per_unit_ugx::numeric,
    0::numeric
  );
$$;

create or replace function public.weighted_cost_after_stock_in_sql (
  p_prev_stock numeric,
  p_prev_cost numeric,
  p_incoming_qty numeric,
  p_incoming_cost numeric
)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_prev_stock, 0) + coalesce(p_incoming_qty, 0) <= 0 then greatest(coalesce(p_incoming_cost, 0), 0)
    else (
      greatest(coalesce(p_prev_stock, 0), 0) * greatest(coalesce(p_prev_cost, 0), 0)
      + greatest(coalesce(p_incoming_qty, 0), 0) * greatest(coalesce(p_incoming_cost, 0), 0)
    ) / (greatest(coalesce(p_prev_stock, 0), 0) + greatest(coalesce(p_incoming_qty, 0), 0))
  end;
$$;

revoke all on function public.product_exact_unit_cost_ugx (public.products) from public;
grant execute on function public.product_exact_unit_cost_ugx (public.products) to authenticated;
revoke all on function public.weighted_cost_after_stock_in_sql (numeric, numeric, numeric, numeric) from public;
grant execute on function public.weighted_cost_after_stock_in_sql (numeric, numeric, numeric, numeric) to authenticated;

-- ---------- Cancel draft (no stock effect) ----------
create or replace function public.enterprise_transfer_cancel (p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.enterprise_stock_transfers%rowtype;
begin
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_t from public.enterprise_stock_transfers where id = p_transfer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_found');
  end if;

  if not public.user_can_manage_shop (v_t.from_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_t.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'status', v_t.status);
  end if;

  if v_t.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_t.status);
  end if;

  update public.enterprise_stock_transfers
  set status = 'cancelled', updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.enterprise_transfer_cancel (uuid) from public;
grant execute on function public.enterprise_transfer_cancel (uuid) to authenticated;

-- ---------- Dispatch (all-or-nothing) ----------
create or replace function public.enterprise_transfer_dispatch (p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.enterprise_stock_transfers%rowtype;
  v_line record;
  v_prod public.products%rowtype;
  v_stock numeric;
  v_cost numeric;
  v_movement_id uuid;
  v_already boolean;
  v_all_dispatched boolean := true;
begin
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_t from public.enterprise_stock_transfers where id = p_transfer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_found');
  end if;

  if not public.user_can_manage_shop (v_t.from_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_t.from_shop_id = v_t.to_shop_id then
    return jsonb_build_object('ok', false, 'error', 'same_shop');
  end if;

  if v_t.status = 'in_transit' then
    for v_line in
      select l.*
      from public.enterprise_stock_transfer_lines l
      where l.transfer_id = p_transfer_id
    loop
      if v_line.product_id is null or v_line.destination_product_id is null then
        v_all_dispatched := false;
        exit;
      end if;
      select exists (
        select 1 from public.inventory_movements im
        where im.shop_id = v_t.from_shop_id
          and im.reference_type = 'transfer_dispatch'
          and im.reference_id = p_transfer_id
          and im.product_id = v_line.product_id
      ) into v_already;
      if not v_already then
        v_all_dispatched := false;
        exit;
      end if;
    end loop;
    if v_all_dispatched then
      return jsonb_build_object('ok', true, 'idempotent', true, 'status', v_t.status);
    end if;
    return jsonb_build_object('ok', false, 'error', 'partial_dispatch_state');
  end if;

  if v_t.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_t.status);
  end if;

  -- Validate all lines before any mutation
  for v_line in
    select l.*
    from public.enterprise_stock_transfer_lines l
    where l.transfer_id = p_transfer_id
  loop
    if v_line.product_id is null or v_line.destination_product_id is null then
      return jsonb_build_object('ok', false, 'error', 'missing_product_mapping');
    end if;
    if v_line.quantity <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;

    select p.* into v_prod
    from public.products p
    where p.id = v_line.product_id and p.shop_id = v_t.from_shop_id and p.is_active = true
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'source_product_not_found');
    end if;

    if not exists (
      select 1 from public.products dp
      where dp.id = v_line.destination_product_id
        and dp.shop_id = v_t.to_shop_id
        and dp.is_active = true
    ) then
      return jsonb_build_object('ok', false, 'error', 'destination_product_not_found');
    end if;

    if coalesce(v_prod.stock_on_hand, 0) < v_line.quantity then
      return jsonb_build_object(
        'ok', false,
        'error', 'insufficient_stock',
        'product_id', v_line.product_id,
        'available', coalesce(v_prod.stock_on_hand, 0),
        'requested', v_line.quantity
      );
    end if;
  end loop;

  if not exists (select 1 from public.enterprise_stock_transfer_lines where transfer_id = p_transfer_id) then
    return jsonb_build_object('ok', false, 'error', 'no_lines');
  end if;

  -- Apply dispatch (all lines)
  for v_line in
    select l.*
    from public.enterprise_stock_transfer_lines l
    where l.transfer_id = p_transfer_id
  loop
    select exists (
      select 1 from public.inventory_movements im
      where im.shop_id = v_t.from_shop_id
        and im.reference_type = 'transfer_dispatch'
        and im.reference_id = p_transfer_id
        and im.product_id = v_line.product_id
    ) into v_already;

    if v_already then
      continue;
    end if;

    select p.* into v_prod
    from public.products p
    where p.id = v_line.product_id and p.shop_id = v_t.from_shop_id
    for update;

    v_cost := public.product_exact_unit_cost_ugx (v_prod);
    v_stock := greatest(coalesce(v_prod.stock_on_hand, 0) - v_line.quantity, 0);

    update public.products
    set stock_on_hand = v_stock, updated_at = now()
    where id = v_prod.id and shop_id = v_t.from_shop_id;

    update public.enterprise_stock_transfer_lines
    set unit_cost_ugx = greatest(0, round(v_cost))::bigint
    where id = v_line.id;

    v_movement_id := public.inventory_movement_uuid (
      v_t.from_shop_id,
      'transfer_dispatch',
      p_transfer_id,
      v_line.product_id
    );

    insert into public.inventory_movements (
      id, shop_id, product_id, quantity_delta, reason,
      reference_type, reference_id, note, created_by
    )
    values (
      v_movement_id,
      v_t.from_shop_id,
      v_line.product_id,
      -v_line.quantity,
      'transfer',
      'transfer_dispatch',
      p_transfer_id,
      'transfer_dispatch:' || p_transfer_id::text,
      auth.uid ()
    )
    on conflict (id) do nothing;
  end loop;

  update public.enterprise_stock_transfers
  set
    status = 'in_transit',
    shipped_at = coalesce(shipped_at, now()),
    updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('ok', true, 'status', 'in_transit', 'transfer_id', p_transfer_id);
end;
$$;

revoke all on function public.enterprise_transfer_dispatch (uuid) from public;
grant execute on function public.enterprise_transfer_dispatch (uuid) to authenticated;

-- ---------- Receive (event-granular, validate-all-then-mutate) ----------
create or replace function public.enterprise_transfer_receive (
  p_transfer_id uuid,
  p_receive_event_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.enterprise_stock_transfers%rowtype;
  v_item jsonb;
  v_line_id uuid;
  v_qty numeric;
  v_line public.enterprise_stock_transfer_lines%rowtype;
  v_dest public.products%rowtype;
  v_snap_cost numeric;
  v_new_stock numeric;
  v_new_wac numeric;
  v_prev_cost numeric;
  v_movement_id uuid;
  v_already boolean;
  v_all_received boolean;
  v_remaining numeric;
  v_seen_line_ids uuid[] := '{}';
  v_seen_dest_products uuid[] := '{}';
  v_dest_product_id uuid;
begin
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_receive_event_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_receive_event_id');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_lines');
  end if;

  select * into v_t from public.enterprise_stock_transfers where id = p_transfer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transfer_not_found');
  end if;

  if not public.user_can_manage_shop (v_t.to_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_t.status not in ('in_transit', 'received') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_t.status);
  end if;

  -- Idempotent replay: every requested line already has receive movement for this event.
  v_all_received := true;
  for v_item in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_item ->> 'line_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    if v_line_id is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_line_payload');
    end if;
    select l.* into v_line
    from public.enterprise_stock_transfer_lines l
    where l.id = v_line_id and l.transfer_id = p_transfer_id;
    if not found or v_line.destination_product_id is null then
      return jsonb_build_object('ok', false, 'error', 'line_not_found');
    end if;
    select exists (
      select 1 from public.inventory_movements im
      where im.shop_id = v_t.to_shop_id
        and im.reference_type = 'transfer_receive'
        and im.reference_id = p_receive_event_id
        and im.product_id = v_line.destination_product_id
    ) into v_already;
    if not v_already then
      v_all_received := false;
    end if;
  end loop;

  if v_all_received then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'receive_event_id', p_receive_event_id,
      'status', v_t.status
    );
  end if;

  -- Validate entire event before any stock / WAC / movement mutation.
  for v_item in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_item ->> 'line_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);

    if v_line_id is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_line_payload');
    end if;

    if v_line_id = any (v_seen_line_ids) then
      return jsonb_build_object('ok', false, 'error', 'duplicate_line_id');
    end if;
    v_seen_line_ids := array_append(v_seen_line_ids, v_line_id);

    select l.* into v_line
    from public.enterprise_stock_transfer_lines l
    where l.id = v_line_id and l.transfer_id = p_transfer_id
    for update;

    if not found or v_line.destination_product_id is null then
      return jsonb_build_object('ok', false, 'error', 'line_not_found');
    end if;

    v_dest_product_id := v_line.destination_product_id;
    if v_dest_product_id = any (v_seen_dest_products) then
      return jsonb_build_object('ok', false, 'error', 'duplicate_destination_product', 'product_id', v_dest_product_id);
    end if;
    v_seen_dest_products := array_append(v_seen_dest_products, v_dest_product_id);

    v_remaining := v_line.quantity - coalesce(v_line.received_quantity, 0);
    if v_qty > v_remaining then
      return jsonb_build_object(
        'ok', false,
        'error', 'over_receive',
        'line_id', v_line_id,
        'remaining', v_remaining,
        'requested', v_qty
      );
    end if;

    if not exists (
      select 1
      from public.products dp
      where dp.id = v_line.destination_product_id
        and dp.shop_id = v_t.to_shop_id
        and dp.is_active = true
    ) then
      return jsonb_build_object('ok', false, 'error', 'destination_product_not_found');
    end if;
  end loop;

  insert into public.enterprise_stock_transfer_receive_events (id, transfer_id, shop_id, created_by)
  values (p_receive_event_id, p_transfer_id, v_t.to_shop_id, auth.uid ())
  on conflict (id) do nothing;

  for v_item in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_item ->> 'line_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);

    select l.* into v_line
    from public.enterprise_stock_transfer_lines l
    where l.id = v_line_id and l.transfer_id = p_transfer_id
    for update;

    select exists (
      select 1 from public.inventory_movements im
      where im.shop_id = v_t.to_shop_id
        and im.reference_type = 'transfer_receive'
        and im.reference_id = p_receive_event_id
        and im.product_id = v_line.destination_product_id
    ) into v_already;

    if v_already then
      continue;
    end if;

    select p.* into v_dest
    from public.products p
    where p.id = v_line.destination_product_id and p.shop_id = v_t.to_shop_id
    for update;

    v_snap_cost := coalesce(v_line.unit_cost_ugx, 0)::numeric;
    v_prev_cost := public.product_exact_unit_cost_ugx (v_dest);
    v_new_wac := public.weighted_cost_after_stock_in_sql (
      coalesce(v_dest.stock_on_hand, 0),
      v_prev_cost,
      v_qty,
      v_snap_cost
    );
    v_new_stock := coalesce(v_dest.stock_on_hand, 0) + v_qty;

    update public.products
    set
      stock_on_hand = v_new_stock,
      cost_price_per_unit_ugx = greatest(0, round(v_new_wac))::bigint,
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{exactCostPricePerUnitUgx}',
        to_jsonb(v_new_wac),
        true
      ),
      updated_at = now()
    where id = v_dest.id and shop_id = v_t.to_shop_id;

    update public.enterprise_stock_transfer_lines
    set received_quantity = coalesce(received_quantity, 0) + v_qty
    where id = v_line.id;

    v_movement_id := public.inventory_movement_uuid (
      v_t.to_shop_id,
      'transfer_receive',
      p_receive_event_id,
      v_line.destination_product_id
    );

    insert into public.inventory_movements (
      id, shop_id, product_id, quantity_delta, reason,
      reference_type, reference_id, note, created_by
    )
    values (
      v_movement_id,
      v_t.to_shop_id,
      v_line.destination_product_id,
      v_qty,
      'transfer',
      'transfer_receive',
      p_receive_event_id,
      'transfer_receive:' || p_transfer_id::text || ':' || p_receive_event_id::text,
      auth.uid ()
    )
    on conflict (id) do nothing;
  end loop;

  select not exists (
    select 1 from public.enterprise_stock_transfer_lines l
    where l.transfer_id = p_transfer_id
      and coalesce(l.received_quantity, 0) < l.quantity
  ) into v_all_received;

  if v_all_received then
    update public.enterprise_stock_transfers
    set status = 'received', received_at = coalesce(received_at, now()), updated_at = now()
    where id = p_transfer_id;
  else
    update public.enterprise_stock_transfers
    set updated_at = now()
    where id = p_transfer_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'receive_event_id', p_receive_event_id,
    'status', (select status from public.enterprise_stock_transfers where id = p_transfer_id)
  );
end;
$$;

revoke all on function public.enterprise_transfer_receive (uuid, uuid, jsonb) from public;
grant execute on function public.enterprise_transfer_receive (uuid, uuid, jsonb) to authenticated;

-- ---------- Upsert draft ----------
create or replace function public.enterprise_transfer_upsert_draft (p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_from uuid := nullif(p_payload ->> 'from_shop_id', '')::uuid;
  v_to uuid := nullif(p_payload ->> 'to_shop_id', '')::uuid;
  v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_client text := nullif(trim(p_payload ->> 'client_id'), '');
  v_reason text := coalesce(nullif(trim(p_payload ->> 'reason'), ''), '');
  v_lines jsonb := coalesce(p_payload -> 'lines', '[]'::jsonb);
  v_item jsonb;
  v_line_id uuid;
  v_src uuid;
  v_dst uuid;
  v_qty numeric;
  v_transfer_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_from is null or v_to is null or v_from = v_to then
    return jsonb_build_object('ok', false, 'error', 'invalid_shops');
  end if;
  if not public.user_can_manage_shop (v_from) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select sh.organization_id into v_org from public.shops sh where sh.id = v_from;
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'from_shop_not_found');
  end if;
  if not exists (select 1 from public.shops s where s.id = v_to and s.organization_id = v_org) then
    return jsonb_build_object('ok', false, 'error', 'shops_org_mismatch');
  end if;

  if jsonb_typeof(v_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_lines) elem
    group by nullif(elem ->> 'source_product_id', '')::uuid
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_source_product');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_lines) elem
    group by nullif(elem ->> 'destination_product_id', '')::uuid
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_destination_product');
  end if;

  if v_id is not null then
    select id into v_transfer_id
    from public.enterprise_stock_transfers
    where id = v_id and from_shop_id = v_from and organization_id = v_org and status = 'draft'
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'draft_not_found');
    end if;
    delete from public.enterprise_stock_transfer_lines where transfer_id = v_transfer_id;
  elsif v_client is not null then
    select id into v_transfer_id
    from public.enterprise_stock_transfers
    where organization_id = v_org and client_id = v_client
    for update;
    if found and (select status from public.enterprise_stock_transfers where id = v_transfer_id) <> 'draft' then
      return jsonb_build_object('ok', false, 'error', 'client_id_not_draft');
    end if;
    if not found then
      insert into public.enterprise_stock_transfers (
        organization_id, from_shop_id, to_shop_id, status, reason, client_id, created_by
      )
      values (v_org, v_from, v_to, 'draft', v_reason, v_client, v_uid)
      returning id into v_transfer_id;
    else
      update public.enterprise_stock_transfers
      set to_shop_id = v_to, reason = v_reason, updated_at = now()
      where id = v_transfer_id;
      delete from public.enterprise_stock_transfer_lines where transfer_id = v_transfer_id;
    end if;
  else
    insert into public.enterprise_stock_transfers (
      organization_id, from_shop_id, to_shop_id, status, reason, created_by
    )
    values (v_org, v_from, v_to, 'draft', v_reason, v_uid)
    returning id into v_transfer_id;
  end if;

  for v_item in select * from jsonb_array_elements(v_lines)
  loop
    v_src := nullif(v_item ->> 'source_product_id', '')::uuid;
    v_dst := nullif(v_item ->> 'destination_product_id', '')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    if v_src is null or v_dst is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_line');
    end if;
    if not exists (select 1 from public.products p where p.id = v_src and p.shop_id = v_from and p.is_active) then
      return jsonb_build_object('ok', false, 'error', 'source_product_invalid');
    end if;
    if not exists (select 1 from public.products p where p.id = v_dst and p.shop_id = v_to and p.is_active) then
      return jsonb_build_object('ok', false, 'error', 'destination_product_invalid');
    end if;
    insert into public.enterprise_stock_transfer_lines (
      transfer_id, product_id, destination_product_id, product_name, quantity, unit_cost_ugx
    )
    select
      v_transfer_id,
      v_src,
      v_dst,
      p.name,
      v_qty,
      greatest(0, round(public.product_exact_unit_cost_ugx(p)))::bigint
    from public.products p
    where p.id = v_src;
  end loop;

  return jsonb_build_object('ok', true, 'transfer_id', v_transfer_id, 'status', 'draft');
end;
$$;

revoke all on function public.enterprise_transfer_upsert_draft (jsonb) from public;
grant execute on function public.enterprise_transfer_upsert_draft (jsonb) to authenticated;

-- ---------- List in-transit for destination ----------
create or replace function public.enterprise_transfer_list_for_shop (
  p_shop_id uuid,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if auth.uid () is null then
    return '[]'::jsonb;
  end if;
  if not public.user_can_access_shop (p_shop_id) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into j
  from (
    select jsonb_build_object(
      'id', t.id,
      'organizationId', t.organization_id,
      'fromShopId', t.from_shop_id,
      'toShopId', t.to_shop_id,
      'status', t.status,
      'reason', t.reason,
      'shippedAt', t.shipped_at,
      'receivedAt', t.received_at,
      'createdAt', t.created_at,
      'lines', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', l.id,
          'productId', l.product_id,
          'destinationProductId', l.destination_product_id,
          'productName', l.product_name,
          'quantity', l.quantity,
          'receivedQuantity', l.received_quantity,
          'unitCostUgx', l.unit_cost_ugx
        ) order by l.created_at), '[]'::jsonb)
        from public.enterprise_stock_transfer_lines l where l.transfer_id = t.id
      )
    ) as row,
    t.created_at
    from public.enterprise_stock_transfers t
    where (t.from_shop_id = p_shop_id or t.to_shop_id = p_shop_id)
      and (p_status is null or t.status = p_status)
    order by t.created_at desc
    limit 100
  ) sub;

  return coalesce(j, '[]'::jsonb);
end;
$$;

revoke all on function public.enterprise_transfer_list_for_shop (uuid, text) from public;
grant execute on function public.enterprise_transfer_list_for_shop (uuid, text) to authenticated;
