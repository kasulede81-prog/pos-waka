-- SALE-VOID-STOCK-1.0: durable exactly-once stock restoration for sale voids.
-- Depends on: 083 (inventory_movement_uuid), 168 (_apply_durable_stock_delta pattern).
-- Additive only — does NOT mutate historical stock or backfill guessed void movements.
-- Does NOT change WAC, prices, payables, debt, or cash.

-- Allow void reason on the append-only ledger (mirrors 166 adding 'purchase').
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;

alter table public.inventory_movements
  add constraint inventory_movements_reason_check check (
    reason in (
      'sale',
      'return',
      'adjustment',
      'initial',
      'transfer',
      'waste',
      'other',
      'damaged',
      'personal',
      'debt',
      'purchase',
      'void'
    )
  );

-- One cloud void restock per void_record × product.
create unique index if not exists inventory_movements_sale_void_product_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'sale_void' and reference_id is not null;

-- Extend the internal durable primitive to accept sale_void (still not granted to clients).
create or replace function public._apply_durable_stock_delta (
  p_shop_id uuid,
  p_product_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_stock numeric;
  v_server_updated_at timestamptz;
  v_new_stock numeric;
  v_movement_id uuid;
  v_already boolean := false;
  v_uid uuid := auth.uid();
begin
  if p_reference_type not in ('adjustment', 'inventory_count', 'sale_void') then
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

  v_new_stock := greatest(coalesce(v_server_stock, 0) + p_delta, 0);

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
$$;

revoke all on function public._apply_durable_stock_delta (uuid, uuid, text, uuid, numeric, text, text) from public;
revoke all on function public._apply_durable_stock_delta (uuid, uuid, text, uuid, numeric, text, text) from authenticated;

-- Public sale-void stock RPC. Shop authority is the product row, not client trust alone.
-- Identity: (shop_id, 'sale_void', void_record_id, product_id) — never free-text notes.
create or replace function public.shop_apply_sale_void_stock (
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
  v_product_id uuid;
  v_void_record_id uuid;
  v_delta numeric;
  v_note text;
  v_product_shop uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_void_record_id := nullif(
    coalesce(p_payload ->> 'void_record_id', p_payload ->> 'reference_id'),
    ''
  )::uuid;
  v_delta := coalesce((p_payload ->> 'delta')::numeric, 0);
  v_note := nullif(p_payload ->> 'note', '');

  if v_product_id is null or v_void_record_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  -- Void restock must restore quantity (positive). Reject zero/negative.
  if v_delta <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_delta');
  end if;

  select p.shop_id into v_product_shop
  from public.products p
  where p.id = v_product_id and p.is_active = true;

  if v_product_shop is null then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  if p_shop_id is not null and p_shop_id is distinct from v_product_shop then
    return jsonb_build_object('ok', false, 'error', 'shop_mismatch');
  end if;

  if not public.user_is_cashier_or_above(v_product_shop) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return public._apply_durable_stock_delta (
    v_product_shop,
    v_product_id,
    'sale_void',
    v_void_record_id,
    v_delta,
    'void',
    coalesce(v_note, 'sale_void')
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_apply_sale_void_stock (uuid, jsonb) from public;
grant execute on function public.shop_apply_sale_void_stock (uuid, jsonb) to authenticated;
