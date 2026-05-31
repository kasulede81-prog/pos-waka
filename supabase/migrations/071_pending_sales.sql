-- Waka POS — Pending sales (held carts / open table bills)
-- UI label: Pending Sale · DB status: draft

alter table public.sales
  add column if not exists reference_label text,
  add column if not exists expires_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists table_session_id uuid;

alter table public.sales drop constraint if exists sales_status_check;

alter table public.sales
  add constraint sales_status_check check (
    status in ('draft', 'completed', 'void', 'refunded', 'cancelled')
  );

create index if not exists sales_shop_draft_updated_idx
  on public.sales (shop_id, updated_at desc)
  where status = 'draft';

comment on column public.sales.reference_label is 'Cashier label: Table 5, customer name, etc.';
comment on column public.sales.table_session_id is 'Linked hospitality table session when applicable.';

-- Upsert draft sale without completing or touching stock.
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

  select s.status into v_existing_status
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  if v_existing_status = 'completed' then
    return jsonb_build_object ('ok', false, 'error', 'already_completed');
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
    subtotal_ugx = excluded.subtotal_ugx,
    tax_ugx = excluded.tax_ugx,
    discount_ugx = excluded.discount_ugx,
    total_ugx = excluded.total_ugx,
    reference_label = excluded.reference_label,
    expires_at = excluded.expires_at,
    table_session_id = excluded.table_session_id,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at,
    status = 'draft',
    payment_status = 'pending';

  delete from public.sale_line_items where sale_id = v_sale_id;

  for v_line in select * from jsonb_array_elements (v_lines)
  loop
    v_line_id := coalesce (nullif (v_line ->> 'id', '')::uuid, gen_random_uuid ());
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

  return jsonb_build_object ('ok', true, 'sale_id', v_sale_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

create or replace function public.shop_cancel_pending_sale (
  p_shop_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.sales
  set
    status = 'cancelled',
    cancelled_at = now (),
    updated_at = now ()
  where id = p_sale_id
    and shop_id = p_shop_id
    and status = 'draft';

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found_or_not_draft');
  end if;

  return jsonb_build_object ('ok', true, 'sale_id', p_sale_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_pending_sale (uuid, jsonb) from public;
grant execute on function public.shop_push_pending_sale (uuid, jsonb) to authenticated;

revoke all on function public.shop_cancel_pending_sale (uuid, uuid) from public;
grant execute on function public.shop_cancel_pending_sale (uuid, uuid) to authenticated;
