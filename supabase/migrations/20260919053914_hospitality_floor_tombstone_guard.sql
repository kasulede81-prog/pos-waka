-- Round 3 / P8 — server-side tombstone protection for the hospitality floor layout.
--
-- Deleted areas / tables / stations are tombstones: is_active = false plus metadata.deletedAt
-- (print_config.deletedAt for stations). Deletion is terminal (re-creating something makes a new id).
--
-- shop_push_hospitality_floor is an upsert with an unconditional "on conflict do update", so a device
-- that was offline during the delete and later pushes its older ACTIVE copy silently revived the row
-- for every device (the client-side merge cannot help once the server itself has been overwritten).
--
-- This migration is additive (create or replace of the same function, no table changes):
--   1. An existing tombstoned row is never updated again - not by an active copy, not by a re-sent
--      tombstone (idempotent).
--   2. A tombstone frees its unique name/label: the (shop, area, label) / (shop, name) unique indexes
--      would otherwise keep a deleted "Table 1" blocking a new "Table 1" forever, and the resulting
--      unique violation rolls back the WHOLE floor push. The tombstone is renamed "<label> [deleted
--      <id8>]" (it is hidden everywhere, and the suffix keeps it unique).
--   3. One-time backfill of the same rename for tombstones already in the database.
--   4. Reservations and waitlist entries only move FORWARD (pending -> confirmed -> cancelled/no_show ->
--      seated -> completed). The old guard was timestamp-only, so a clock-skewed or stale device could
--      still write "confirmed" over "cancelled" or "waiting" over "seated". A higher status now wins
--      whatever the timestamps say; the same status keeps last-write-wins by updated_at.
-- Sessions / tickets are untouched (they already carry their own guards).

create or replace function public.hospitality_status_rank (p_status text)
returns int
language sql
immutable
as $$
  select case p_status
    when 'confirmed' then 1
    when 'cancelled' then 2
    when 'no_show' then 2
    when 'seated' then 3
    when 'completed' then 4
    else 0 -- pending / waiting / unknown
  end
$$;

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
  v_tomb boolean;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  for v_area in select * from jsonb_array_elements (coalesce (p_payload -> 'areas', '[]'::jsonb))
  loop
    v_tomb := coalesce (v_area -> 'metadata' ->> 'deletedAt', '') <> '';
    insert into public.dining_areas (id, shop_id, name, sort_order, is_active, metadata, created_at, updated_at)
    values (
      (v_area ->> 'id')::uuid,
      p_shop_id,
      case when v_tomb
        then trim (v_area ->> 'name') || ' [deleted ' || left (v_area ->> 'id', 8) || ']'
        else trim (v_area ->> 'name')
      end,
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
      updated_at = excluded.updated_at
    -- A deleted area is terminal: nothing (least of all a stale device's older copy) may revive it.
    where coalesce (public.dining_areas.metadata ->> 'deletedAt', '') = '';
  end loop;

  for v_table in select * from jsonb_array_elements (coalesce (p_payload -> 'tables', '[]'::jsonb))
  loop
    v_tomb := coalesce (v_table -> 'metadata' ->> 'deletedAt', '') <> '';
    insert into public.dining_tables (
      id, shop_id, area_id, label, capacity, sort_order, display_status, is_active, grid_x, grid_y, metadata, created_at, updated_at
    )
    values (
      (v_table ->> 'id')::uuid,
      p_shop_id,
      (v_table ->> 'area_id')::uuid,
      case when v_tomb
        then trim (v_table ->> 'label') || ' [deleted ' || left (v_table ->> 'id', 8) || ']'
        else trim (v_table ->> 'label')
      end,
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
      updated_at = excluded.updated_at
    where coalesce (public.dining_tables.metadata ->> 'deletedAt', '') = '';
  end loop;

  for v_station in select * from jsonb_array_elements (coalesce (p_payload -> 'stations', '[]'::jsonb))
  loop
    v_tomb := coalesce (coalesce (v_station -> 'print_config', v_station -> 'future_hooks', '{}'::jsonb) ->> 'deletedAt', '') <> '';
    insert into public.kitchen_stations (
      id, shop_id, name, station_type, sort_order, is_active, print_config, created_at, updated_at
    )
    values (
      (v_station ->> 'id')::uuid,
      p_shop_id,
      case when v_tomb
        then trim (v_station ->> 'name') || ' [deleted ' || left (v_station ->> 'id', 8) || ']'
        else trim (v_station ->> 'name')
      end,
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
      updated_at = excluded.updated_at
    where coalesce (public.kitchen_stations.print_config ->> 'deletedAt', '') = '';
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
    where public.table_reservations.updated_at is null
       or public.hospitality_status_rank (excluded.status) > public.hospitality_status_rank (public.table_reservations.status)
       or (
         public.hospitality_status_rank (excluded.status) = public.hospitality_status_rank (public.table_reservations.status)
         and public.table_reservations.updated_at <= excluded.updated_at
       );
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
    where public.waitlist_entries.updated_at is null
       or public.hospitality_status_rank (excluded.status) > public.hospitality_status_rank (public.waitlist_entries.status)
       or (
         public.hospitality_status_rank (excluded.status) = public.hospitality_status_rank (public.waitlist_entries.status)
         and public.waitlist_entries.updated_at <= excluded.updated_at
       );
  end loop;

  return jsonb_build_object ('ok', true);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;


-- One-time, idempotent: free the names of tombstones written before this migration.
update public.dining_tables
set label = label || ' [deleted ' || left (id::text, 8) || ']'
where coalesce (metadata ->> 'deletedAt', '') <> ''
  and label not like '% [deleted %]';

update public.dining_areas
set name = name || ' [deleted ' || left (id::text, 8) || ']'
where coalesce (metadata ->> 'deletedAt', '') <> ''
  and name not like '% [deleted %]';

update public.kitchen_stations
set name = name || ' [deleted ' || left (id::text, 8) || ']'
where coalesce (print_config ->> 'deletedAt', '') <> ''
  and name not like '% [deleted %]';
