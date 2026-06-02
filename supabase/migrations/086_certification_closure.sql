-- Certification closure: return refund ceilings, unlinked return policy, migration health RPC.

-- ---------- Return validation helper ----------
create or replace function public.validate_sale_return_ceilings (
  p_shop_id uuid,
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_refund_ugx bigint,
  p_exclude_return_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_total bigint;
  v_gross_ugx bigint;
  v_refunded bigint;
  v_sold_qty numeric;
  v_returned_qty numeric;
  v_line_total bigint;
  v_line_refund bigint;
begin
  if p_sale_id is null then
    return jsonb_build_object('ok', true);
  end if;

  select greatest(coalesce(s.total_ugx, 0), 0)
  into v_sale_total
  from public.sales s
  where s.id = p_sale_id and s.shop_id = p_shop_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  select coalesce(sum(sli.line_total_ugx), 0)
  into v_gross_ugx
  from public.sale_line_items sli
  where sli.sale_id = p_sale_id;

  select coalesce(sum(sr.refund_amount_ugx), 0)
  into v_refunded
  from public.sale_returns sr
  where sr.shop_id = p_shop_id
    and sr.sale_id = p_sale_id
    and (p_exclude_return_id is null or sr.id <> p_exclude_return_id);

  if p_refund_ugx > v_sale_total then
    return jsonb_build_object(
      'ok', false,
      'error', 'refund_exceeds_remaining',
      'remaining_ugx', greatest(v_sale_total, 0)
    );
  end if;

  if v_gross_ugx > 0 and v_refunded + p_refund_ugx > v_gross_ugx then
    return jsonb_build_object(
      'ok', false,
      'error', 'refund_exceeds_sale',
      'remaining_ugx', greatest(v_gross_ugx - v_refunded, 0)
    );
  end if;

  select coalesce(sum(sli.quantity), 0)
  into v_sold_qty
  from public.sale_line_items sli
  where sli.sale_id = p_sale_id
    and sli.product_id = p_product_id;

  if v_sold_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'product_not_on_sale');
  end if;

  select coalesce(sum(sr.quantity), 0)
  into v_returned_qty
  from public.sale_returns sr
  where sr.shop_id = p_shop_id
    and sr.sale_id = p_sale_id
    and sr.product_id = p_product_id
    and (p_exclude_return_id is null or sr.id <> p_exclude_return_id);

  if v_returned_qty + p_quantity > v_sold_qty + 0.0001 then
    return jsonb_build_object(
      'ok', false,
      'error', 'return_qty_exceeds_sold',
      'remaining_qty', greatest(v_sold_qty - v_returned_qty, 0)
    );
  end if;

  select coalesce(sum(sli.line_total_ugx), 0)
  into v_line_total
  from public.sale_line_items sli
  where sli.sale_id = p_sale_id
    and sli.product_id = p_product_id;

  select coalesce(sum(sr.refund_amount_ugx), 0)
  into v_line_refund
  from public.sale_returns sr
  where sr.shop_id = p_shop_id
    and sr.sale_id = p_sale_id
    and sr.product_id = p_product_id
    and (p_exclude_return_id is null or sr.id <> p_exclude_return_id);

  if v_line_refund + p_refund_ugx > v_line_total then
    return jsonb_build_object(
      'ok', false,
      'error', 'refund_exceeds_line',
      'remaining_line_ugx', greatest(v_line_total - v_line_refund, 0)
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- shop_push_sale_return with ceilings + unlinked policy ----------
create or replace function public.shop_push_sale_return (
  p_shop_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_sale_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_refund bigint;
  v_reason text;
  v_note text;
  v_row public.sale_returns%rowtype;
  v_role text;
  v_ceil jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_required');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_id := nullif(p_payload ->> 'id', '')::uuid;
  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_qty := coalesce((p_payload ->> 'quantity')::numeric, 0);
  v_refund := coalesce((p_payload ->> 'refund_amount_ugx')::bigint, 0);
  v_reason := coalesce(nullif(trim(p_payload ->> 'reason'), ''), 'other');
  v_note := coalesce(trim(p_payload ->> 'note'), '');
  v_sale_id := nullif(p_payload ->> 'sale_id', '')::uuid;

  if v_id is null or v_product_id is null or v_qty <= 0 or v_refund <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  if v_sale_id is null then
    select sm.role into v_role
    from public.shop_members sm
    where sm.shop_id = p_shop_id and sm.user_id = v_uid;

    if coalesce(v_role, '') not in ('owner', 'manager') then
      return jsonb_build_object('ok', false, 'error', 'unlinked_return_forbidden');
    end if;

    if length(v_note) < 3 then
      return jsonb_build_object('ok', false, 'error', 'unlinked_note_required');
    end if;
  else
    if not exists (
      select 1 from public.sales s
      where s.id = v_sale_id and s.shop_id = p_shop_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'sale_not_found');
    end if;

    v_ceil := public.validate_sale_return_ceilings(
      p_shop_id, v_sale_id, v_product_id, v_qty, v_refund, v_id
    );
    if coalesce((v_ceil ->> 'ok')::boolean, false) is not true then
      return v_ceil;
    end if;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = v_product_id and p.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  insert into public.sale_returns (
    id,
    shop_id,
    sale_id,
    product_id,
    quantity,
    refund_amount_ugx,
    reason,
    note,
    created_by,
    created_at,
    metadata
  )
  values (
    v_id,
    p_shop_id,
    v_sale_id,
    v_product_id,
    v_qty,
    v_refund,
    v_reason,
    nullif(v_note, ''),
    coalesce(nullif(p_payload ->> 'created_by', '')::uuid, v_uid),
    coalesce((p_payload ->> 'created_at')::timestamptz, now()),
    coalesce(p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    sale_id = excluded.sale_id,
    product_id = excluded.product_id,
    quantity = excluded.quantity,
    refund_amount_ugx = excluded.refund_amount_ugx,
    reason = excluded.reason,
    note = excluded.note,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into v_row;

  perform public.apply_sale_return_stock(v_row.id);

  return jsonb_build_object('ok', true, 'return_id', v_row.id);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------- Migration verification (Settings → System Health) ----------
create or replace function public.waka_verify_production_migrations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_pass boolean;
  v_src text;
begin
  v_pass := to_regprocedure('public.apply_sale_stock_movements(uuid)') is not null;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '082_inventory_integrity',
    'pass', v_pass,
    'detail', case when v_pass then 'apply_sale_stock_movements present' else 'missing function' end
  ));

  v_pass := false;
  if to_regprocedure('public.shop_push_sale_complete(uuid,jsonb)') is not null then
    select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'shop_push_sale_complete'
    limit 1;
    v_pass := coalesce(v_src, '') like '%apply_sale_stock_movements%';
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '083_sale_stock_sync',
    'pass', v_pass,
    'detail', case when v_pass then 'sale complete calls stock sync' else 'stock sync hook missing' end
  ));

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'inventory_movements_sale_product_unique'
  ) into v_pass;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '084_remediate_sale_inventory_movement_duplicates',
    'pass', v_pass,
    'detail', case when v_pass then 'unique sale movement index present' else 'index missing — run 084' end
  ));

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'audit_logs_shop_client_entry_unique'
  ) into v_pass;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '085_audit_log_client_entry_idempotent',
    'pass', v_pass,
    'detail', case when v_pass then 'audit client_entry_id unique index present' else 'index missing — run 085' end
  ));

  return jsonb_build_object(
    'ok', not exists (
      select 1
      from jsonb_array_elements(v_checks) c
      where coalesce((c ->> 'pass')::boolean, false) is not true
    ),
    'checks', v_checks
  );
end;
$$;

revoke all on function public.validate_sale_return_ceilings (uuid, uuid, uuid, numeric, bigint, uuid) from public;
revoke all on function public.waka_verify_production_migrations () from public;
grant execute on function public.waka_verify_production_migrations () to authenticated;
