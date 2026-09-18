-- Waka POS — Hospitality kitchen ticket push: stale-write guards.
--
-- Problem (found in the Hospitality sync audit, present in production since 127):
--   shop_push_kitchen_ticket guarded the ticket HEADER with "updated_at is not older", but then
--   deleted and re-inserted the ticket ITEMS unconditionally. A stale device pushing an old copy
--   therefore kept the newer header but replaced the newer items (un-cancelling items, restoring
--   old quantities). It also let a stale "live" copy change a cancelled ticket's status when its
--   clock made the push look newer.
--
-- Fix (function body identical to 127 except for the marked guards; no table / data changes):
--   * a cancelled ticket can only stay cancelled,
--   * items are replaced only when the header write was actually applied.
-- Purely operational kitchen data — never touches sales, payments, stock or COGS.

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
  v_item_meta jsonb;
  v_ticket_meta jsonb;
  v_rows integer;
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

  v_ticket_meta := coalesce (p_payload -> 'metadata', '{}'::jsonb)
    || jsonb_strip_nulls (
      jsonb_build_object (
        'accepted_at', nullif (p_payload ->> 'accepted_at', ''),
        'station_type', nullif (p_payload -> 'metadata' ->> 'station_type', '')
      )
    );

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
    v_ticket_meta,
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
    metadata = coalesce (public.kitchen_tickets.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = excluded.updated_at
  where (
      public.kitchen_tickets.updated_at <= excluded.updated_at
      or public.kitchen_tickets.updated_at is null
    )
    -- Cancellation is terminal: a stale device that still shows the ticket as live must never
    -- reopen it, even if its clock makes the push look newer.
    and (public.kitchen_tickets.status <> 'cancelled' or excluded.status = 'cancelled');

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- The header was rejected as stale: keep the newer items too (they used to be replaced
    -- unconditionally, so a stale push silently un-cancelled items and restored old quantities).
    return jsonb_build_object ('ok', true, 'ticket_id', v_id, 'stale', true);
  end if;

  delete from public.kitchen_ticket_items where ticket_id = v_id;

  for v_item in select * from jsonb_array_elements (coalesce (p_payload -> 'items', '[]'::jsonb))
  loop
    v_item_meta := coalesce (v_item -> 'metadata', '{}'::jsonb)
      || jsonb_strip_nulls (
        jsonb_build_object (
          'course', nullif (v_item ->> 'course', ''),
          'prep_time_minutes', v_item -> 'prep_time_minutes',
          'item_status', nullif (v_item ->> 'item_status', ''),
          'cancelled_at', nullif (v_item ->> 'cancelled_at', ''),
          'cancelled_by', nullif (v_item ->> 'cancelled_by', ''),
          'cancel_reason', nullif (v_item ->> 'cancel_reason', ''),
          'variant_label', nullif (v_item ->> 'variant_label', ''),
          'modifier_labels', v_item -> 'modifier_labels'
        )
      );

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
      v_item_meta
    );
  end loop;

  return jsonb_build_object ('ok', true, 'ticket_id', v_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;
