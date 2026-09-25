-- Audit fix #2: stock/ledger drift in _apply_durable_stock_delta.
--
-- Previously stock was clamped to >=0 (greatest(prev+delta, 0)) while the
-- inventory_movements row still recorded the FULL delta, so stock_on_hand could
-- diverge from (initial + sum of movement deltas) — most visibly in the
-- oversold -> void/return edge (e.g. stock -3, void +2 clamped to 0 instead of -1).
-- Removing the clamp keeps stock_on_hand mathematically equal to prev + p_delta,
-- exactly matching the movement it records. FOR UPDATE lock, deterministic movement
-- id, idempotency (exists-check + on conflict + unique_violation), audit fields and
-- the auth/permission guard are all unchanged. Applies to the adjustment /
-- inventory_count / sale_void / purchase_void reversal paths this primitive serves.
CREATE OR REPLACE FUNCTION public._apply_durable_stock_delta(p_shop_id uuid, p_product_id uuid, p_reference_type text, p_reference_id uuid, p_delta numeric, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_server_stock numeric;
  v_server_updated_at timestamptz;
  v_new_stock numeric;
  v_movement_id uuid;
  v_already boolean := false;
  v_uid uuid := auth.uid();
begin
  -- Defence in depth: even if EXECUTE is re-granted, unauthenticated callers
  -- cannot mutate stock. Domain RPCs run with a JWT, so auth.uid() is set.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_reference_type not in ('adjustment', 'inventory_count', 'sale_void', 'purchase_void') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reference_type');
  end if;
  if p_product_id is null or p_reference_id is null or p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_delta');
  end if;

  select p.stock_on_hand, p.updated_at
  into v_server_stock, v_server_updated_at
  from public.products p
  where p.id = p_product_id and p.shop_id = p_shop_id and p.is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  select exists (
    select 1
    from public.inventory_movements im
    where im.shop_id = p_shop_id
      and im.reference_type = p_reference_type
      and im.reference_id = p_reference_id
      and im.product_id = p_product_id
  ) into v_already;

  if v_already then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stock_on_hand', v_server_stock,
      'updated_at', v_server_updated_at
    );
  end if;

  -- Ledger-consistent: apply the exact delta (no clamp). stock_on_hand therefore
  -- always equals prev + recorded movement quantity_delta.
  v_new_stock := coalesce(v_server_stock, 0) + p_delta;

  update public.products p
  set stock_on_hand = v_new_stock,
      updated_at = now()
  where p.id = p_product_id and p.shop_id = p_shop_id;

  v_movement_id := public.inventory_movement_uuid (
    p_shop_id,
    p_reference_type,
    p_reference_id,
    p_product_id
  );

  insert into public.inventory_movements (
    id,
    shop_id,
    product_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    note,
    created_by
  )
  values (
    v_movement_id,
    p_shop_id,
    p_product_id,
    p_delta,
    coalesce(nullif(p_reason, ''), 'adjustment'),
    p_reference_type,
    p_reference_id,
    p_note,
    v_uid
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'stock_on_hand', v_new_stock,
    'updated_at', (select updated_at from public.products where id = p_product_id)
  );
exception
  when unique_violation then
    select p.stock_on_hand, p.updated_at
    into v_server_stock, v_server_updated_at
    from public.products p
    where p.id = p_product_id and p.shop_id = p_shop_id;
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stock_on_hand', v_server_stock,
      'updated_at', v_server_updated_at
    );
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$function$;
