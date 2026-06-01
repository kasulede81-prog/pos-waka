-- Waka POS — Pending sale line-level merge + optimistic concurrency (P0)

create or replace function public.shop_push_pending_sale (
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
  v_sale_id uuid;
  v_sale jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_line_id uuid;
  v_line_updated timestamptz;
  v_existing_line_updated timestamptz;
  v_existing_status text;
  v_existing_updated_at timestamptz;
  v_base_updated_at timestamptz;
  v_deleted_id uuid;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
  v_profit bigint;
  v_meta jsonb;
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

  v_sale := p_payload -> 'sale';
  v_lines := coalesce (p_payload -> 'lines', '[]'::jsonb);
  v_base_updated_at := nullif (p_payload ->> 'base_updated_at', '')::timestamptz;

  if v_sale is null or jsonb_typeof (v_sale) <> 'object' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale');
  end if;

  v_sale_id := nullif (v_sale ->> 'id', '')::uuid;
  if v_sale_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale_id');
  end if;

  select s.status, s.updated_at
  into v_existing_status, v_existing_updated_at
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  if v_existing_status = 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'already_completed');
  end if;

  if v_existing_updated_at is not null
     and v_base_updated_at is not null
     and v_existing_updated_at > v_base_updated_at then
    return jsonb_build_object (
      'ok', false,
      'error', 'stale_version',
      'server_updated_at', v_existing_updated_at,
      'lines', coalesce ((
        select jsonb_agg(
          jsonb_build_object (
            'id', sli.id,
            'product_id', sli.product_id,
            'quantity', sli.quantity,
            'unit_price_ugx', sli.unit_price_ugx,
            'line_discount_ugx', sli.line_discount_ugx,
            'line_total_ugx', sli.line_total_ugx,
            'line_input_mode', sli.line_input_mode,
            'money_amount_ugx', sli.money_amount_ugx,
            'metadata', sli.metadata
          )
          order by sli.id
        )
        from public.sale_line_items sli
        where sli.sale_id = v_sale_id
      ), '[]'::jsonb)
    );
  end if;

  insert into public.sales (
    id,
    shop_id,
    customer_id,
    status,
    payment_status,
    subtotal_ugx,
    tax_ugx,
    discount_ugx,
    total_ugx,
    cash_amount_ugx,
    debt_amount_ugx,
    issue_receipt,
    created_by,
    completed_at,
    reference_label,
    expires_at,
    table_session_id,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_sale_id,
    p_shop_id,
    nullif (v_sale ->> 'customer_id', '')::uuid,
    'draft',
    'pending',
    coalesce ((v_sale ->> 'subtotal_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'tax_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'discount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'total_ugx')::bigint, 0),
    0,
    0,
    false,
    coalesce (nullif (v_sale ->> 'created_by', '')::uuid, v_uid),
    null,
    nullif (trim (v_sale ->> 'reference_label'), ''),
    nullif (v_sale ->> 'expires_at', '')::timestamptz,
    nullif (v_sale ->> 'table_session_id', '')::uuid,
    coalesce (v_sale -> 'metadata', '{}'::jsonb),
    coalesce ((v_sale ->> 'created_at')::timestamptz, now ()),
    coalesce ((v_sale ->> 'updated_at')::timestamptz, now ())
  )
  on conflict (id) do update set
    customer_id = excluded.customer_id,
    reference_label = excluded.reference_label,
    expires_at = excluded.expires_at,
    table_session_id = excluded.table_session_id,
    metadata = excluded.metadata,
    status = 'draft',
    payment_status = 'pending';

  for v_deleted_id in
    select nullif (value, '')::uuid
    from jsonb_array_elements_text (coalesce (p_payload -> 'deleted_line_ids', '[]'::jsonb)) as t (value)
    where nullif (value, '')::uuid is not null
  loop
    delete from public.sale_line_items
    where sale_id = v_sale_id and id = v_deleted_id;
  end loop;

  for v_line in select * from jsonb_array_elements (v_lines)
  loop
    v_line_id := coalesce (nullif (v_line ->> 'id', '')::uuid, gen_random_uuid ());
    v_line_updated := coalesce (
      nullif (v_line -> 'metadata' ->> 'updatedAt', '')::timestamptz,
      nullif (v_line ->> 'updated_at', '')::timestamptz,
      now ()
    );

    select coalesce (
      nullif (sli.metadata ->> 'updatedAt', '')::timestamptz,
      now ()
    )
    into v_existing_line_updated
    from public.sale_line_items sli
    where sli.id = v_line_id and sli.sale_id = v_sale_id;

    if v_existing_line_updated is not null and v_existing_line_updated > v_line_updated then
      continue;
    end if;

    insert into public.sale_line_items (
      id,
      sale_id,
      product_id,
      quantity,
      unit_price_ugx,
      line_discount_ugx,
      line_total_ugx,
      line_input_mode,
      money_amount_ugx,
      metadata
    )
    values (
      v_line_id,
      v_sale_id,
      nullif (v_line ->> 'product_id', '')::uuid,
      coalesce ((v_line ->> 'quantity')::numeric, 0),
      coalesce ((v_line ->> 'unit_price_ugx')::bigint, 0),
      coalesce ((v_line ->> 'line_discount_ugx')::bigint, 0),
      coalesce ((v_line ->> 'line_total_ugx')::bigint, 0),
      coalesce (nullif (v_line ->> 'line_input_mode', ''), 'quantity'),
      nullif (v_line ->> 'money_amount_ugx', '')::bigint,
      coalesce (v_line -> 'metadata', '{}'::jsonb)
    )
    on conflict (id) do update set
      product_id = excluded.product_id,
      quantity = excluded.quantity,
      unit_price_ugx = excluded.unit_price_ugx,
      line_discount_ugx = excluded.line_discount_ugx,
      line_total_ugx = excluded.line_total_ugx,
      line_input_mode = excluded.line_input_mode,
      money_amount_ugx = excluded.money_amount_ugx,
      metadata = excluded.metadata
    where public.sale_line_items.sale_id = v_sale_id;
  end loop;

  select
    coalesce (sum (sli.line_total_ugx + sli.line_discount_ugx), 0),
    coalesce (sum (sli.line_discount_ugx), 0),
    coalesce (sum (sli.line_total_ugx), 0),
    coalesce (sum (coalesce ((sli.metadata ->> 'estimatedProfitUgx')::bigint, sli.line_total_ugx)), 0)
  into v_subtotal, v_discount, v_total, v_profit
  from public.sale_line_items sli
  where sli.sale_id = v_sale_id;

  select coalesce (metadata, '{}'::jsonb) into v_meta from public.sales where id = v_sale_id;

  update public.sales
  set
    subtotal_ugx = v_subtotal,
    discount_ugx = v_discount,
    total_ugx = v_total,
    metadata = v_meta || jsonb_build_object ('estimatedProfitUgx', v_profit),
    updated_at = now ()
  where id = v_sale_id and shop_id = p_shop_id;

  return jsonb_build_object (
    'ok', true,
    'sale_id', v_sale_id,
    'updated_at', (select updated_at from public.sales where id = v_sale_id)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

-- Always return active sessions/tickets on pull (not only incremental deltas).
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
          or kt.status in ('queued', 'preparing', 'ready')
        )
    ), '[]'::jsonb)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_pending_sale (uuid, jsonb) from public;
grant execute on function public.shop_push_pending_sale (uuid, jsonb) to authenticated;

revoke all on function public.shop_pull_hospitality_state (uuid, timestamptz) from public;
grant execute on function public.shop_pull_hospitality_state (uuid, timestamptz) to authenticated;
