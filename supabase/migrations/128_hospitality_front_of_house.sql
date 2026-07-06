-- Phase 6.4 / 7.2 — Reservations, waitlist, floor display statuses, hospitality sync RPCs

alter table public.dining_tables drop constraint if exists dining_tables_display_status_check;
alter table public.dining_tables
  add constraint dining_tables_display_status_check check (
    display_status in (
      'available',
      'occupied',
      'payment_pending',
      'reserved',
      'needs_cleaning',
      'cleaning',
      'needs_attention',
      'blocked',
      'disabled'
    )
  );

create table if not exists public.table_reservations (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  reservation_number int not null default 1,
  guest_name text not null,
  phone text not null,
  email text,
  guest_count int not null default 2 check (guest_count >= 1),
  reservation_date date not null,
  reservation_time time not null,
  area_id uuid references public.dining_areas (id) on delete set null,
  preferred_table_id uuid references public.dining_tables (id) on delete set null,
  notes text,
  is_vip boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'seated', 'no_show', 'cancelled', 'completed')),
  seated_session_id uuid references public.table_sessions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists table_reservations_shop_date_idx
  on public.table_reservations (shop_id, reservation_date, reservation_time);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  guest_count int not null default 2 check (guest_count >= 1),
  phone text,
  arrival_time timestamptz not null default now (),
  estimated_wait_minutes int,
  priority text not null default 'normal' check (priority in ('normal', 'high', 'vip')),
  notes text,
  source text not null default 'walk_in' check (source in ('walk_in', 'phone', 'online')),
  status text not null default 'waiting' check (status in ('waiting', 'seated', 'cancelled', 'no_show')),
  seated_session_id uuid references public.table_sessions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists waitlist_entries_shop_status_idx
  on public.waitlist_entries (shop_id, status, arrival_time desc);

alter table public.table_session_events drop constraint if exists table_session_events_event_type_check;
alter table public.table_session_events
  add constraint table_session_events_event_type_check check (
    event_type in (
      'opened', 'closed', 'transferred', 'merged', 'split',
      'waiter_assigned', 'payment_pending', 'cancelled',
      'cleaning_started', 'cleaning_finished', 'reservation_seated', 'manager_override'
    )
  );

drop trigger if exists trg_table_reservations_updated on public.table_reservations;
create trigger trg_table_reservations_updated
  before update on public.table_reservations
  for each row execute function public.set_updated_at ();

drop trigger if exists trg_waitlist_entries_updated on public.waitlist_entries;
create trigger trg_waitlist_entries_updated
  before update on public.waitlist_entries
  for each row execute function public.set_updated_at ();

alter table public.table_reservations enable row level security;
alter table public.waitlist_entries enable row level security;

drop policy if exists table_reservations_shop on public.table_reservations;
create policy table_reservations_shop on public.table_reservations
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_can_access_shop (shop_id));

drop policy if exists waitlist_entries_shop on public.waitlist_entries;
create policy waitlist_entries_shop on public.waitlist_entries
  for all using (public.user_can_access_shop (shop_id))
  with check (public.user_can_access_shop (shop_id));

-- ── Push floor layout + reservations + waitlist ─────────────────────────────

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
  v_reservation jsonb;
  v_waitlist jsonb;
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
      coalesce (v_station -> 'print_config', v_station -> 'future_hooks', '{}'::jsonb),
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

  for v_reservation in select * from jsonb_array_elements (coalesce (p_payload -> 'reservations', '[]'::jsonb))
  loop
    insert into public.table_reservations (
      id,
      shop_id,
      reservation_number,
      guest_name,
      phone,
      email,
      guest_count,
      reservation_date,
      reservation_time,
      area_id,
      preferred_table_id,
      notes,
      is_vip,
      status,
      metadata,
      created_at,
      updated_at
    )
    values (
      (v_reservation ->> 'id')::uuid,
      p_shop_id,
      coalesce ((v_reservation ->> 'reservation_number')::int, 1),
      trim (v_reservation ->> 'guest_name'),
      trim (v_reservation ->> 'phone'),
      nullif (trim (v_reservation ->> 'email'), ''),
      greatest (1, coalesce ((v_reservation ->> 'guest_count')::int, 2)),
      (v_reservation ->> 'reservation_date')::date,
      (v_reservation ->> 'reservation_time')::time,
      nullif (v_reservation ->> 'area_id', '')::uuid,
      nullif (v_reservation ->> 'preferred_table_id', '')::uuid,
      nullif (trim (v_reservation ->> 'notes'), ''),
      coalesce ((v_reservation ->> 'is_vip')::boolean, false),
      coalesce (nullif (v_reservation ->> 'status', ''), 'pending'),
      coalesce (v_reservation -> 'metadata', '{}'::jsonb),
      coalesce ((v_reservation ->> 'created_at')::timestamptz, now ()),
      coalesce ((v_reservation ->> 'updated_at')::timestamptz, now ())
    )
    on conflict (id) do update set
      reservation_number = excluded.reservation_number,
      guest_name = excluded.guest_name,
      phone = excluded.phone,
      email = excluded.email,
      guest_count = excluded.guest_count,
      reservation_date = excluded.reservation_date,
      reservation_time = excluded.reservation_time,
      area_id = excluded.area_id,
      preferred_table_id = excluded.preferred_table_id,
      notes = excluded.notes,
      is_vip = excluded.is_vip,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
    where public.table_reservations.updated_at <= excluded.updated_at
       or public.table_reservations.updated_at is null;
  end loop;

  for v_waitlist in select * from jsonb_array_elements (coalesce (p_payload -> 'waitlist', '[]'::jsonb))
  loop
    insert into public.waitlist_entries (
      id,
      shop_id,
      name,
      guest_count,
      phone,
      arrival_time,
      estimated_wait_minutes,
      priority,
      notes,
      source,
      status,
      metadata,
      created_at,
      updated_at
    )
    values (
      (v_waitlist ->> 'id')::uuid,
      p_shop_id,
      trim (v_waitlist ->> 'name'),
      greatest (1, coalesce ((v_waitlist ->> 'guest_count')::int, 2)),
      nullif (trim (v_waitlist ->> 'phone'), ''),
      coalesce ((v_waitlist ->> 'arrival_time')::timestamptz, now ()),
      nullif (v_waitlist ->> 'estimated_wait_minutes', '')::int,
      coalesce (nullif (v_waitlist ->> 'priority', ''), 'normal'),
      nullif (trim (v_waitlist ->> 'notes'), ''),
      coalesce (nullif (v_waitlist ->> 'source', ''), 'walk_in'),
      coalesce (nullif (v_waitlist ->> 'status', ''), 'waiting'),
      coalesce (v_waitlist -> 'metadata', '{}'::jsonb),
      coalesce ((v_waitlist ->> 'created_at')::timestamptz, now ()),
      coalesce ((v_waitlist ->> 'updated_at')::timestamptz, now ())
    )
    on conflict (id) do update set
      name = excluded.name,
      guest_count = excluded.guest_count,
      phone = excluded.phone,
      arrival_time = excluded.arrival_time,
      estimated_wait_minutes = excluded.estimated_wait_minutes,
      priority = excluded.priority,
      notes = excluded.notes,
      source = excluded.source,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
    where public.waitlist_entries.updated_at <= excluded.updated_at
       or public.waitlist_entries.updated_at is null;
  end loop;

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- Always return active sessions/tickets; include reservations and waitlist deltas.
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
      where ts.shop_id = p_shop_id
        and (ts.updated_at > v_since or ts.status in ('open', 'payment_pending'))
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
      where kt.shop_id = p_shop_id
        and (
          kt.updated_at > v_since
          or kt.status in (
            'queued', 'accepted', 'preparing', 'cooking', 'ready', 'picked_up'
          )
        )
    ), '[]'::jsonb),
    'reservations', coalesce ((
      select jsonb_agg(to_jsonb (tr) order by tr.reservation_date, tr.reservation_time)
      from public.table_reservations tr
      where tr.shop_id = p_shop_id
        and (
          tr.updated_at > v_since
          or tr.status in ('pending', 'confirmed', 'seated')
        )
    ), '[]'::jsonb),
    'waitlist', coalesce ((
      select jsonb_agg(to_jsonb (we) order by we.arrival_time)
      from public.waitlist_entries we
      where we.shop_id = p_shop_id
        and (
          we.updated_at > v_since
          or we.status = 'waiting'
        )
    ), '[]'::jsonb)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_hospitality_floor (uuid, jsonb) from public;
grant execute on function public.shop_push_hospitality_floor (uuid, jsonb) to authenticated;

revoke all on function public.shop_pull_hospitality_state (uuid, timestamptz) from public;
grant execute on function public.shop_pull_hospitality_state (uuid, timestamptz) to authenticated;
