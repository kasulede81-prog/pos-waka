-- Audit fix #1: opt-in atomic oversell guard for ONLINE sales.
--
-- shop_push_sale_complete gains a pre-flight availability check that runs ONLY when
-- the client marks the push enforce_stock=true (a sale rung up online against fresh
-- stock). Offline / queued sales (flag absent or false) keep the existing permissive
-- behavior, so offline-first sync is preserved. On insufficiency it raises
-- 'insufficient_stock', which the function's own EXCEPTION handler converts into
-- {ok:false,error:'insufficient_stock'} AND rolls back the entire sale (all inserts
-- undone). Idempotency (was_completed ACK, PK on-conflict) and deterministic
-- inventory movement ids are unchanged. Finished-product lines only: recipe /
-- made-to-order ingredient lines are excluded via the same _wk_recipe_lines
-- classification the decrement uses, so hospitality/pharmacy behavior is unchanged.
CREATE OR REPLACE FUNCTION public.shop_push_sale_complete(p_shop_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_enforce_stock boolean := false;
  v_short record;
  v_avail numeric;
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

  -- Opt-in only: absent / false preserves offline-first (permissive) behavior.
  v_enforce_stock := coalesce (
    nullif (v_sale ->> 'enforce_stock', '')::boolean,
    nullif (p_payload ->> 'enforce_stock', '')::boolean,
    false
  );

  v_sold_by := public.staff_v2_validate_sold_by_user_id (p_shop_id, v_sale, v_uid);

  select (s.status = 'completed')
  into v_was_completed
  from public.sales s
  where s.id = v_sale_id and s.shop_id = p_shop_id;

  v_was_completed := coalesce (v_was_completed, false);

  -- SL-03: already-completed is a mutation-free ACK. Do not replace lines,
  -- payments, financials, or re-apply stock. Client may refresh stock from cloud
  -- when product_stocks is empty. (Enforcement never runs on an accepted replay.)
  if v_was_completed then
    return jsonb_build_object (
      'ok', true,
      'sale_id', v_sale_id,
      'already_completed', true,
      'stock_applied', false,
      'product_stocks', '[]'::jsonb
    );
  end if;

  v_validation := public.validate_sale_push_financials (p_shop_id, v_sale, v_lines);
  if coalesce ((v_validation ->> 'ok')::boolean, false) is not true then
    return v_validation;
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

  -- Fix #1: online-only atomic availability guard. Runs before the status flip
  -- (which triggers the stock decrement). Locks each finished-product row so two
  -- concurrent enforced sales serialize; the second re-reads the decremented
  -- stock and is rejected. Recipe/made-to-order ingredient lines are excluded
  -- (same classification the decrement uses), so hospitality/pharmacy behavior
  -- is unchanged. Deterministic, ordered locking avoids deadlocks.
  if v_enforce_stock then
    for v_short in
      select sli.product_id as pid, sum (sli.quantity) as qty
      from public.sale_line_items sli
      where sli.sale_id = v_sale_id
        and sli.product_id is not null
        and not exists (
          select 1 from public._wk_recipe_lines (v_sale_id, p_shop_id, false) rl
          where rl.line_id = sli.id
        )
      group by sli.product_id
      order by sli.product_id
    loop
      if v_short.qty is null or v_short.qty <= 0 then
        continue;
      end if;
      select p.stock_on_hand
        into v_avail
      from public.products p
      where p.id = v_short.pid and p.shop_id = p_shop_id
      for update;
      -- Only enforce for products the shop actually stocks here; unknown product
      -- ids fall through to the existing decrement which raises separately.
      if found and (v_avail + 0.0001) < v_short.qty then
        raise exception 'insufficient_stock'
          using detail = format ('product=%s available=%s requested=%s', v_short.pid, v_avail, v_short.qty);
      end if;
    end loop;
  end if;

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
$function$;
