-- STAFF-V2-PHASE-7: shop-scoped sold_by_user_id validation.
-- Replaces observe-only Auth existence check at push RPC call sites.
-- Does not rewrite 158–161. Does not change created_by, fill-once, stock, or client.
-- Invalid candidate → NULL; sale always continues. Linked PIN attribution waits for Phase 8.

create or replace function public.staff_v2_validate_sold_by_user_id (
  p_shop_id uuid,
  p_sale jsonb,
  p_writer_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_candidate uuid;
  v_verified uuid;
begin
  -- p_writer_id is accepted for RPC call-site symmetry and Phase 8 linked-PIN
  -- attribution (writer ≠ candidate). Phase 7 validates membership only.
  if p_shop_id is null then
    return null;
  end if;
  if p_sale is null or jsonb_typeof (p_sale) <> 'object' then
    return null;
  end if;
  if jsonb_typeof (p_sale -> 'sold_by_user_id') is distinct from 'string' then
    return null;
  end if;

  begin
    v_candidate := nullif (trim (p_sale ->> 'sold_by_user_id'), '')::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;

  if v_candidate is null then
    return null;
  end if;

  -- Auth user must exist AND be a member of this shop.
  select u.id
  into v_verified
  from auth.users u
  inner join public.shop_members sm
    on sm.user_id = u.id
   and sm.shop_id = p_shop_id
  where u.id = v_candidate;

  return v_verified;
end;
$$;

revoke all on function public.staff_v2_validate_sold_by_user_id (uuid, jsonb, uuid) from public;
revoke all on function public.staff_v2_validate_sold_by_user_id (uuid, jsonb, uuid) from anon, authenticated;

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
  v_validation jsonb;
  v_sold_by uuid;
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

  v_sold_by := public.staff_v2_validate_sold_by_user_id (p_shop_id, v_sale, v_uid);

  select (s.status = 'completed')
  into v_was_completed
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  v_was_completed := coalesce (v_was_completed, false);

  if not v_was_completed then
    v_validation := public.validate_sale_push_financials (p_shop_id, v_sale, v_lines);
    if coalesce ((v_validation ->> 'ok')::boolean, false) is not true then
      return v_validation;
    end if;
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
    sold_by_user_id,
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
    v_sold_by,
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
    sold_by_user_id = coalesce (public.sales.sold_by_user_id, excluded.sold_by_user_id),
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
      sold_by_user_id = coalesce (sold_by_user_id, v_sold_by),
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
      sold_by_user_id = coalesce (sold_by_user_id, v_sold_by),
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
  v_existing_status text;
  v_existing_updated timestamptz;
  v_line_updated timestamptz;
  v_existing_line_updated timestamptz;
  v_deleted_id uuid;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
  v_profit bigint;
  v_sold_by uuid;
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

  if v_sale is null or jsonb_typeof (v_sale) <> 'object' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale');
  end if;

  v_sale_id := nullif (v_sale ->> 'id', '')::uuid;
  if v_sale_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_sale_id');
  end if;

  v_sold_by := public.staff_v2_validate_sold_by_user_id (p_shop_id, v_sale, v_uid);

  select s.status, s.updated_at
  into v_existing_status, v_existing_updated
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  if v_existing_status = 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'already_completed');
  end if;

  if nullif (p_payload ->> 'base_updated_at', '') is not null
     and v_existing_updated is not null
     and v_existing_updated > nullif (p_payload ->> 'base_updated_at', '')::timestamptz then
    return jsonb_build_object (
      'ok', false,
      'error', 'stale_version',
      'server_updated_at', v_existing_updated,
      'lines', coalesce ((
        select jsonb_agg(to_jsonb (sli))
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
    sold_by_user_id,
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
    v_sold_by,
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
    subtotal_ugx = excluded.subtotal_ugx,
    tax_ugx = excluded.tax_ugx,
    discount_ugx = excluded.discount_ugx,
    total_ugx = excluded.total_ugx,
    metadata = coalesce (public.sales.metadata, '{}'::jsonb) || excluded.metadata,
    status = 'draft',
    payment_status = 'pending',
    sold_by_user_id = coalesce (public.sales.sold_by_user_id, excluded.sold_by_user_id),
    updated_at = excluded.updated_at;

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
      metadata = coalesce (public.sale_line_items.metadata, '{}'::jsonb) || excluded.metadata
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

  update public.sales
  set
    subtotal_ugx = v_subtotal,
    discount_ugx = v_discount,
    total_ugx = v_total,
    metadata = coalesce (metadata, '{}'::jsonb)
      || jsonb_build_object ('estimatedProfitUgx', v_profit, 'wakaClient', true, 'hospitality', true),
    sold_by_user_id = coalesce (sold_by_user_id, v_sold_by),
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

revoke all on function public.shop_push_sale_complete (uuid, jsonb) from public;
grant execute on function public.shop_push_sale_complete (uuid, jsonb) to authenticated;

revoke all on function public.shop_push_pending_sale (uuid, jsonb) from public;
grant execute on function public.shop_push_pending_sale (uuid, jsonb) to authenticated;
