-- Restock double-count fix (R1): shop_push_product_stock is idempotent for
-- purchase:<purchaseId>… notes. Duplicate delivery / stale_version retry must
-- NOT apply the same purchase stock delta twice.
--
-- Check note idempotency BEFORE optimistic-concurrency stale rejection so a
-- second queue path that races the first returns the already-applied result.

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

  select p.stock_on_hand, p.updated_at, coalesce(p.metadata, '{}'::jsonb)
  into v_server_stock, v_server_updated_at, v_metadata
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id and p.is_active = true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  -- At-most-once for purchase stock-in notes (purchase:<id> or purchase:<id>:<productId>).
  -- purchase_void:… notes are intentionally excluded (leading "purchase_" ≠ "purchase:").
  v_last_note := nullif(v_metadata ->> 'lastStockNote', '');
  if v_note is not null
     and v_note like 'purchase:%'
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
