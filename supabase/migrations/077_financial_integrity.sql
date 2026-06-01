-- Financial integrity: prevent stock realignment when sale is already completed (retry-safe).

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
  v_pre_stock jsonb;
  v_line jsonb;
  v_pay jsonb;
  v_stock jsonb;
  v_product_id uuid;
  v_pre numeric;
  v_was_completed boolean := false;
  v_line_id uuid;
  v_idx int := 0;
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
  v_pre_stock := coalesce (p_payload -> 'product_pre_stock', '[]'::jsonb);

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

  -- Pre-stock alignment only on first completion — retries must not reset inventory.
  if not v_was_completed then
    for v_stock in select * from jsonb_array_elements (v_pre_stock)
    loop
      v_product_id := nullif (v_stock ->> 'product_id', '')::uuid;
      v_pre := coalesce ((v_stock ->> 'stock_on_hand')::numeric, 0);
      if v_product_id is null then
        continue;
      end if;
      update public.products p
      set stock_on_hand = v_pre,
          updated_at = now ()
      where p.id = v_product_id
        and p.shop_id = p_shop_id;
      if not found then
        return jsonb_build_object ('ok', false, 'error', 'product_not_found', 'product_id', v_product_id);
      end if;
    end loop;
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

  return jsonb_build_object ('ok', true, 'sale_id', v_sale_id, 'already_completed', v_was_completed);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_sale_complete (uuid, jsonb) from public;
grant execute on function public.shop_push_sale_complete (uuid, jsonb) to authenticated;
