-- Sale completion applies idempotent inventory movements; cloud stock is authoritative.

create extension if not exists "uuid-ossp" with schema extensions;

-- Stable movement id: same sale + product always yields the same UUID (v5).
create or replace function public.inventory_movement_uuid (
  p_shop_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_product_id uuid
)
returns uuid
language sql
immutable
parallel safe
as $$
  select extensions.uuid_generate_v5 (
    '6ba7b810-9dad-11d1-80b4-00c04fdcb4fe'::uuid,
    p_shop_id::text || '|' || coalesce (p_reference_type, '') || '|' || p_reference_id::text || '|' || p_product_id::text
  );
$$;

-- Unique index is created in 084_remediate_sale_inventory_movement_duplicates.sql
-- after historical duplicate sale rows are removed.

create or replace function public.apply_sale_stock_movements (p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_shop uuid;
  v_new numeric;
  v_updated_at timestamptz;
  v_movement_id uuid;
  v_stocks jsonb := '[]'::jsonb;
begin
  select shop_id into strict v_shop from public.sales where id = p_sale_id;

  for r in
    select sli.product_id, sum(sli.quantity) as quantity
    from public.sale_line_items sli
    where sli.sale_id = p_sale_id
      and sli.product_id is not null
    group by sli.product_id
  loop
    if r.quantity <= 0 then
      continue;
    end if;

    if exists (
      select 1
      from public.inventory_movements im
      where im.shop_id = v_shop
        and im.reference_type = 'sale'
        and im.reference_id = p_sale_id
        and im.product_id = r.product_id
    ) then
      select p.stock_on_hand, p.updated_at
      into v_new, v_updated_at
      from public.products p
      where p.id = r.product_id and p.shop_id = v_shop;

      v_stocks := v_stocks || jsonb_build_array (
        jsonb_build_object (
          'product_id', r.product_id,
          'stock_on_hand', v_new,
          'updated_at', v_updated_at
        )
      );
      continue;
    end if;

    v_movement_id := public.inventory_movement_uuid (v_shop, 'sale', p_sale_id, r.product_id);

    update public.products p
    set stock_on_hand = p.stock_on_hand - r.quantity,
        updated_at = now ()
    where p.id = r.product_id
      and p.shop_id = v_shop
    returning p.stock_on_hand, p.updated_at into v_new, v_updated_at;

    if not found then
      raise exception 'Product % not in this shop', r.product_id;
    end if;

    insert into public.inventory_movements (
      id,
      shop_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      created_by
    )
    values (
      v_movement_id,
      v_shop,
      r.product_id,
      -r.quantity,
      'sale',
      'sale',
      p_sale_id,
      auth.uid ()
    )
    on conflict (id) do nothing;

    v_stocks := v_stocks || jsonb_build_array (
      jsonb_build_object (
        'product_id', r.product_id,
        'stock_on_hand', v_new,
        'updated_at', v_updated_at
      )
    );
  end loop;

  return v_stocks;
end;
$$;

create or replace function public.shop_push_sale_complete (
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
  v_payments jsonb;
  v_line jsonb;
  v_pay jsonb;
  v_was_completed boolean := false;
  v_line_id uuid;
  v_idx int := 0;
  v_stock_result jsonb;
  v_status text;
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
  v_payments := coalesce (p_payload -> 'payments', '[]'::jsonb);

  if v_sale is null or jsonb_typeof (v_sale) <> 'object' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale');
  end if;

  v_sale_id := nullif (v_sale ->> 'id', '')::uuid;
  if v_sale_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale_id');
  end if;

  select (s.status = 'completed')
  into v_was_completed
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  v_was_completed := coalesce (v_was_completed, false);

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
    metadata,
    created_at,
    updated_at
  )
  values (
    v_sale_id,
    p_shop_id,
    nullif (v_sale ->> 'customer_id', '')::uuid,
    'draft',
    coalesce (v_sale ->> 'payment_status', case when coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0) > 0 then 'partial' else 'paid' end),
    coalesce ((v_sale ->> 'subtotal_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'tax_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'discount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'total_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'cash_amount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0),
    coalesce ((v_sale ->> 'issue_receipt')::boolean, false),
    coalesce (nullif (v_sale ->> 'created_by', '')::uuid, v_uid),
    null,
    coalesce (v_sale -> 'metadata', '{}'::jsonb),
    coalesce ((v_sale ->> 'created_at')::timestamptz, now ()),
    coalesce ((v_sale ->> 'updated_at')::timestamptz, now ())
  )
  on conflict (id) do update set
    customer_id = excluded.customer_id,
    subtotal_ugx = excluded.subtotal_ugx,
    tax_ugx = excluded.tax_ugx,
    discount_ugx = excluded.discount_ugx,
    total_ugx = excluded.total_ugx,
    cash_amount_ugx = excluded.cash_amount_ugx,
    debt_amount_ugx = excluded.debt_amount_ugx,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  delete from public.sale_line_items where sale_id = v_sale_id;
  delete from public.sale_payments where sale_id = v_sale_id;

  for v_line in select * from jsonb_array_elements (v_lines)
  loop
    v_idx := v_idx + 1;
    v_line_id := coalesce (
      nullif (v_line ->> 'id', '')::uuid,
      gen_random_uuid ()
    );
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
    );
  end loop;

  for v_pay in select * from jsonb_array_elements (v_payments)
  loop
    insert into public.sale_payments (
      id,
      sale_id,
      method,
      amount_ugx,
      recorded_by
    )
    values (
      coalesce (nullif (v_pay ->> 'id', '')::uuid, gen_random_uuid ()),
      v_sale_id,
      coalesce (nullif (v_pay ->> 'method', ''), 'cash'),
      coalesce ((v_pay ->> 'amount_ugx')::bigint, 0),
      coalesce (nullif (v_pay ->> 'recorded_by', '')::uuid, v_uid)
    );
  end loop;

  if not v_was_completed then
    update public.sales
    set
      status = 'completed',
      completed_at = coalesce ((v_sale ->> 'completed_at')::timestamptz, (v_sale ->> 'created_at')::timestamptz, now ()),
      payment_status = coalesce (v_sale ->> 'payment_status', case when coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, 0) > 0 then 'partial' else 'paid' end),
      updated_at = now ()
    where id = v_sale_id
      and shop_id = p_shop_id
      and status is distinct from 'completed';
  else
    update public.sales
    set
      payment_status = coalesce (v_sale ->> 'payment_status', payment_status),
      cash_amount_ugx = coalesce ((v_sale ->> 'cash_amount_ugx')::bigint, cash_amount_ugx),
      debt_amount_ugx = coalesce ((v_sale ->> 'debt_amount_ugx')::bigint, debt_amount_ugx),
      total_ugx = coalesce ((v_sale ->> 'total_ugx')::bigint, total_ugx),
      subtotal_ugx = coalesce ((v_sale ->> 'subtotal_ugx')::bigint, subtotal_ugx),
      metadata = coalesce (v_sale -> 'metadata', metadata),
      updated_at = now ()
    where id = v_sale_id
      and shop_id = p_shop_id;
  end if;

  select status into v_status
  from public.sales
  where id = v_sale_id and shop_id = p_shop_id;

  if v_status = 'completed' then
    v_stock_result := public.apply_sale_stock_movements (v_sale_id);
  else
    v_stock_result := '[]'::jsonb;
  end if;

  return jsonb_build_object (
    'ok', true,
    'sale_id', v_sale_id,
    'already_completed', v_was_completed,
    'stock_applied', v_status = 'completed',
    'product_stocks', coalesce (v_stock_result, '[]'::jsonb)
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.inventory_movement_uuid (uuid, text, uuid, uuid) from public;
grant execute on function public.inventory_movement_uuid (uuid, text, uuid, uuid) to authenticated;

revoke all on function public.apply_sale_stock_movements (uuid) from public;
grant execute on function public.apply_sale_stock_movements (uuid) to authenticated;

revoke all on function public.shop_push_sale_complete (uuid, jsonb) from public;
grant execute on function public.shop_push_sale_complete (uuid, jsonb) to authenticated;
