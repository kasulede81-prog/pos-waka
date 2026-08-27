-- Purchase stock idempotency R2: durable at-most-once via inventory_movements
-- (same pattern as sale stock in 082/083/084).
--
-- Migration 165's lastStockNote check remains as a fast path but is NOT the
-- durable authority — a later stock op can overwrite lastStockNote.
-- Durable identity: (shop_id, reference_type='purchase', reference_id=purchase_id, product_id).
-- Product row is locked FOR UPDATE so check + apply + insert are serialized.

-- Allow purchase reason on the append-only ledger.
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
      'purchase'
    )
  );

-- One cloud purchase stock effect per purchase × product (mirrors sale unique index).
create unique index if not exists inventory_movements_purchase_product_unique
  on public.inventory_movements (shop_id, reference_type, reference_id, product_id)
  where reference_type = 'purchase' and reference_id is not null;

create or replace function public.shop_push_product_stock (
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
  v_delta numeric;
  v_base_updated_at timestamptz;
  v_base_stock numeric;
  v_server_updated_at timestamptz;
  v_server_stock numeric;
  v_new_stock numeric;
  v_note text;
  v_metadata jsonb;
  v_last_note text;
  v_purchase_id uuid;
  v_is_purchase_note boolean := false;
  v_movement_id uuid;
  v_already boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_product_id := nullif(p_payload ->> 'product_id', '')::uuid;
  v_delta := coalesce((p_payload ->> 'delta')::numeric, 0);
  v_base_updated_at := nullif(p_payload ->> 'base_updated_at', '')::timestamptz;
  v_base_stock := nullif(p_payload ->> 'base_stock_on_hand', '')::numeric;
  v_note := nullif(p_payload ->> 'note', '');

  if v_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_product');
  end if;

  -- purchase:<uuid>… notes (not purchase_void:…)
  if v_note is not null
     and v_note like 'purchase:%'
     and v_note not like 'purchase_void:%' then
    begin
      v_purchase_id := nullif(split_part(v_note, ':', 2), '')::uuid;
    exception
      when others then
        v_purchase_id := null;
    end;
    v_is_purchase_note := v_purchase_id is not null;
  end if;

  select p.stock_on_hand, p.updated_at, coalesce(p.metadata, '{}'::jsonb)
  into v_server_stock, v_server_updated_at, v_metadata
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id and p.is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  -- Durable purchase dedupe (survives lastStockNote overwrite by later ops).
  if v_is_purchase_note then
    select exists (
      select 1
      from public.inventory_movements im
      where im.shop_id = p_shop_id
        and im.reference_type = 'purchase'
        and im.reference_id = v_purchase_id
        and im.product_id = v_product_id
    ) into v_already;

    if v_already then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'stock_on_hand', v_server_stock,
        'updated_at', v_server_updated_at
      );
    end if;
  end if;

  -- Fast path from migration 165 (immediate duplicates while note still matches).
  v_last_note := nullif(v_metadata ->> 'lastStockNote', '');
  if v_is_purchase_note
     and v_last_note is not null
     and v_last_note = v_note then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stock_on_hand', v_server_stock,
      'updated_at', v_server_updated_at
    );
  end if;

  if v_base_updated_at is not null
     and v_server_updated_at > v_base_updated_at
     and v_base_stock is not null
     and v_server_stock is distinct from v_base_stock then
    return jsonb_build_object(
      'ok', false,
      'error', 'stale_version',
      'server_stock_on_hand', v_server_stock,
      'server_updated_at', v_server_updated_at
    );
  end if;

  v_new_stock := greatest(coalesce(v_server_stock, 0) + v_delta, 0);

  update public.products p
  set stock_on_hand = v_new_stock,
      updated_at = now(),
      metadata = case
        when v_note is not null then
          jsonb_set(coalesce(p.metadata, '{}'::jsonb), '{lastStockNote}', to_jsonb(v_note), true)
        else p.metadata
      end
  where p.id = v_product_id and p.shop_id = p_shop_id;

  if v_is_purchase_note then
    v_movement_id := public.inventory_movement_uuid (
      p_shop_id,
      'purchase',
      v_purchase_id,
      v_product_id
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
      v_product_id,
      v_delta,
      'purchase',
      'purchase',
      v_purchase_id,
      v_note,
      v_uid
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'stock_on_hand', v_new_stock,
    'updated_at', (select updated_at from public.products where id = v_product_id)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_push_product_stock (uuid, jsonb) from public;
grant execute on function public.shop_push_product_stock (uuid, jsonb) to authenticated;
