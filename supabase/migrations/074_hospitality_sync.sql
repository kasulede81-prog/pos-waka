-- Waka POS — Hospitality multi-device sync (Phase B)
-- Run after 071_pending_sales.sql and 072_hospitality_mode.sql

-- Named bar tabs: table_id optional
alter table public.table_sessions alter column table_id drop not null;

alter table public.table_sessions
  add column if not exists session_kind text not null default 'table'
    check (session_kind in ('table', 'named_tab'));

alter table public.table_sessions
  add column if not exists tab_label text;

drop index if exists public.table_sessions_one_open_per_table;
create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status in ('open', 'payment_pending') and table_id is not null;

create unique index if not exists table_sessions_one_open_named_tab
  on public.table_sessions (shop_id, lower(trim (tab_label)))
  where status in ('open', 'payment_pending')
    and session_kind = 'named_tab'
    and tab_label is not null
    and length(trim (tab_label)) > 0;

-- ── Push floor layout (areas, tables, stations) ─────────────────────────────

create or replace function public.shop_push_hospitality_floor (
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
  v_area jsonb;
  v_table jsonb;
  v_station jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  for v_area in select * from jsonb_array_elements (coalesce (p_payload -> 'areas', '[]'::jsonb))
  loop
    insert into public.dining_areas (id, shop_id, name, sort_order, is_active, metadata, created_at, updated_at)
    values (
      (v_area ->> 'id')::uuid,
      p_shop_id,
      trim (v_area ->> 'name'),
      coalesce ((v_area ->> 'sort_order')::int, 0),
      coalesce ((v_area ->> 'is_active')::boolean, true),
      coalesce (v_area -> 'metadata', '{}'::jsonb),
      coalesce ((v_area ->> 'created_at')::timestamptz, now ()),
      coalesce ((v_area ->> 'updated_at')::timestamptz, now ())
    )
    on conflict (id) do update set
      name = excluded.name,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;
  end loop;

  for v_table in select * from jsonb_array_elements (coalesce (p_payload -> 'tables', '[]'::jsonb))
  loop
    insert into public.dining_tables (
      id, shop_id, area_id, label, capacity, sort_order, display_status, is_active, grid_x, grid_y, metadata, created_at, updated_at
    )
    values (
      (v_table ->> 'id')::uuid,
      p_shop_id,
      (v_table ->> 'area_id')::uuid,
      trim (v_table ->> 'label'),
      nullif (v_table ->> 'capacity', '')::int,
      coalesce ((v_table ->> 'sort_order')::int, 0),
      coalesce (nullif (v_table ->> 'display_status', ''), 'available'),
      coalesce ((v_table ->> 'is_active')::boolean, true),
      nullif (v_table ->> 'grid_x', '')::int,
      nullif (v_table ->> 'grid_y', '')::int,
      coalesce (v_table -> 'metadata', '{}'::jsonb),
      coalesce ((v_table ->> 'created_at')::timestamptz, now ()),
      coalesce ((v_table ->> 'updated_at')::timestamptz, now ())
    )
    on conflict (id) do update set
      area_id = excluded.area_id,
      label = excluded.label,
      capacity = excluded.capacity,
      sort_order = excluded.sort_order,
      display_status = excluded.display_status,
      is_active = excluded.is_active,
      grid_x = excluded.grid_x,
      grid_y = excluded.grid_y,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;
  end loop;

  for v_station in select * from jsonb_array_elements (coalesce (p_payload -> 'stations', '[]'::jsonb))
  loop
    insert into public.kitchen_stations (
      id, shop_id, name, station_type, sort_order, is_active, print_config, created_at, updated_at
    )
    values (
      (v_station ->> 'id')::uuid,
      p_shop_id,
      trim (v_station ->> 'name'),
      coalesce (nullif (v_station ->> 'station_type', ''), 'kitchen'),
      coalesce ((v_station ->> 'sort_order')::int, 0),
      coalesce ((v_station ->> 'is_active')::boolean, true),
      coalesce (v_station -> 'print_config', '{}'::jsonb),
      coalesce ((v_station ->> 'created_at')::timestamptz, now ()),
      coalesce ((v_station ->> 'updated_at')::timestamptz, now ())
    )
    on conflict (id) do update set
      name = excluded.name,
      station_type = excluded.station_type,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active,
      print_config = excluded.print_config,
      updated_at = excluded.updated_at;
  end loop;

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ── Push table session ──────────────────────────────────────────────────────

create or replace function public.shop_push_table_session (
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
  v_existing_status text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_session_id');
  end if;

  select ts.status into v_existing_status
  from public.table_sessions ts
  where ts.id = v_id and ts.shop_id = p_shop_id;

  insert into public.table_sessions (
    id,
    shop_id,
    table_id,
    session_kind,
    tab_label,
    sale_id,
    guest_count,
    customer_name,
    customer_phone_e164,
    waiter_staff_id,
    waiter_label,
    status,
    opened_at,
    closed_at,
    opened_by,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_id,
    p_shop_id,
    nullif (p_payload ->> 'table_id', '')::uuid,
    coalesce (nullif (p_payload ->> 'session_kind', ''), 'table'),
    nullif (trim (p_payload ->> 'tab_label'), ''),
    (p_payload ->> 'sale_id')::uuid,
    greatest (1, coalesce ((p_payload ->> 'guest_count')::int, 1)),
    nullif (trim (p_payload ->> 'customer_name'), ''),
    nullif (trim (p_payload ->> 'customer_phone_e164'), ''),
    nullif (trim (p_payload ->> 'waiter_staff_id'), ''),
    nullif (trim (p_payload ->> 'waiter_label'), ''),
    coalesce (nullif (p_payload ->> 'status', ''), 'open'),
    coalesce ((p_payload ->> 'opened_at')::timestamptz, now ()),
    nullif (p_payload ->> 'closed_at', '')::timestamptz,
    coalesce (nullif (p_payload ->> 'opened_by', '')::uuid, v_uid),
    coalesce (p_payload -> 'metadata', '{}'::jsonb),
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce ((p_payload ->> 'updated_at')::timestamptz, now ())
  )
  on conflict (id) do update set
    table_id = excluded.table_id,
    session_kind = excluded.session_kind,
    tab_label = excluded.tab_label,
    sale_id = excluded.sale_id,
    guest_count = excluded.guest_count,
    customer_name = excluded.customer_name,
    customer_phone_e164 = excluded.customer_phone_e164,
    waiter_staff_id = excluded.waiter_staff_id,
    waiter_label = excluded.waiter_label,
    status = excluded.status,
    closed_at = excluded.closed_at,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at
  where public.table_sessions.updated_at <= excluded.updated_at
     or public.table_sessions.updated_at is null;

  return jsonb_build_object ('ok', true, 'session_id', v_id);
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'table_or_tab_occupied');
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ── Push kitchen ticket + items ─────────────────────────────────────────────

create or replace function public.shop_push_kitchen_ticket (
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
  v_item jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif (p_payload ->> 'id', '')::uuid;
  if v_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_ticket_id');
  end if;

  insert into public.kitchen_tickets (
    id,
    shop_id,
    table_session_id,
    sale_id,
    station_id,
    ticket_number,
    status,
    fired_at,
    prepared_at,
    served_at,
    waiter_label,
    table_label,
    area_name,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_id,
    p_shop_id,
    (p_payload ->> 'table_session_id')::uuid,
    (p_payload ->> 'sale_id')::uuid,
    (p_payload ->> 'station_id')::uuid,
    coalesce ((p_payload ->> 'ticket_number')::int, 1),
    coalesce (nullif (p_payload ->> 'status', ''), 'queued'),
    coalesce ((p_payload ->> 'fired_at')::timestamptz, now ()),
    nullif (p_payload ->> 'prepared_at', '')::timestamptz,
    nullif (p_payload ->> 'served_at', '')::timestamptz,
    nullif (trim (p_payload ->> 'waiter_label'), ''),
    nullif (trim (p_payload ->> 'table_label'), ''),
    nullif (trim (p_payload ->> 'area_name'), ''),
    coalesce (p_payload -> 'metadata', '{}'::jsonb),
    coalesce ((p_payload ->> 'created_at')::timestamptz, now ()),
    coalesce ((p_payload ->> 'updated_at')::timestamptz, now ())
  )
  on conflict (id) do update set
    status = excluded.status,
    prepared_at = excluded.prepared_at,
    served_at = excluded.served_at,
    waiter_label = excluded.waiter_label,
    table_label = excluded.table_label,
    area_name = excluded.area_name,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at
  where public.kitchen_tickets.updated_at <= excluded.updated_at
     or public.kitchen_tickets.updated_at is null;

  delete from public.kitchen_ticket_items where ticket_id = v_id;

  for v_item in select * from jsonb_array_elements (coalesce (p_payload -> 'items', '[]'::jsonb))
  loop
    insert into public.kitchen_ticket_items (
      id,
      ticket_id,
      product_id,
      product_name,
      quantity,
      notes,
      metadata
    )
    values (
      coalesce (nullif (v_item ->> 'id', '')::uuid, gen_random_uuid ()),
      v_id,
      nullif (v_item ->> 'product_id', '')::uuid,
      coalesce (nullif (trim (v_item ->> 'product_name'), ''), 'Item'),
      coalesce ((v_item ->> 'quantity')::numeric, 1),
      nullif (trim (v_item ->> 'notes'), ''),
      coalesce (v_item -> 'metadata', '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object ('ok', true, 'ticket_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- ── Pull hospitality state since cursor ─────────────────────────────────────

create or replace function public.shop_pull_hospitality_state (
  p_shop_id uuid,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_since timestamptz := coalesce (p_since, '1970-01-01'::timestamptz);
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object (
    'ok', true,
    'since', v_since,
    'server_at', now (),
    'areas', coalesce ((
      select jsonb_agg(to_jsonb (da) order by da.sort_order, da.name)
      from public.dining_areas da
      where da.shop_id = p_shop_id and da.updated_at > v_since
    ), '[]'::jsonb),
    'tables', coalesce ((
      select jsonb_agg(to_jsonb (dt) order by dt.sort_order, dt.label)
      from public.dining_tables dt
      where dt.shop_id = p_shop_id and dt.updated_at > v_since
    ), '[]'::jsonb),
    'stations', coalesce ((
      select jsonb_agg(to_jsonb (ks) order by ks.sort_order, ks.name)
      from public.kitchen_stations ks
      where ks.shop_id = p_shop_id and ks.updated_at > v_since
    ), '[]'::jsonb),
    'sessions', coalesce ((
      select jsonb_agg(to_jsonb (ts) order by ts.opened_at desc)
      from public.table_sessions ts
      where ts.shop_id = p_shop_id and ts.updated_at > v_since
    ), '[]'::jsonb),
    'tickets', coalesce ((
      select jsonb_agg(
        to_jsonb (kt) || jsonb_build_object (
          'items', coalesce ((
            select jsonb_agg(to_jsonb (ki) order by ki.product_name)
            from public.kitchen_ticket_items ki
            where ki.ticket_id = kt.id
          ), '[]'::jsonb)
        )
        order by kt.fired_at desc
      )
      from public.kitchen_tickets kt
      where kt.shop_id = p_shop_id and kt.updated_at > v_since
    ), '[]'::jsonb)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_hospitality_floor (uuid, jsonb) from public;
grant execute on function public.shop_push_hospitality_floor (uuid, jsonb) to authenticated;

revoke all on function public.shop_push_table_session (uuid, jsonb) from public;
grant execute on function public.shop_push_table_session (uuid, jsonb) to authenticated;

revoke all on function public.shop_push_kitchen_ticket (uuid, jsonb) from public;
grant execute on function public.shop_push_kitchen_ticket (uuid, jsonb) to authenticated;

revoke all on function public.shop_pull_hospitality_state (uuid, timestamptz) from public;
grant execute on function public.shop_pull_hospitality_state (uuid, timestamptz) to authenticated;
