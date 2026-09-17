-- DEFECT FIX (WAKA POS financial transaction laboratory, Phase 3) —
-- packCostUnitsDepleted (the FIFO pack-slot allocation counter used by
-- non-evenly-divisible pack-cost products, e.g. eggs: 10,000/30=333.33...)
-- is computed and updated correctly CLIENT-SIDE after every sale
-- (usePosStore.ts), but stock deduction for a completed sale happens
-- entirely SERVER-SIDE via apply_sale_stock_movements (called from
-- shop_push_sale_complete), which only ever touches stock_on_hand. Nothing
-- in the sale-completion flow pushes the client's locally-advanced
-- packCostUnitsDepleted back to Supabase. It only reaches the server
-- incidentally via a full product-catalog push (product edit / purchase
-- restock), never via an ordinary sale.
--
-- CONFIRMED LIVE on production shop 2df4b0c8-8b30-489a-8167-41de2549041f:
-- two real 5-egg sales (10 units total, same never-reset pack) left
-- products.metadata->>'packCostUnitsDepleted' at 0 server-side, while the
-- selling device's own local state correctly showed 5 (only its own most
-- recent sale, since a fresh cloud restore reset it to the stale server
-- value of 0 first). Every device restart / cloud-restore / additional
-- staff device resets pack-slot allocation back to slot 0, so the
-- "premium" first-remainder slots get repeatedly reused while the later,
-- cheaper slots are never reached — violating the pack's own invariant
-- that all 30 slots must sum to exactly its buyingPackCostUgx over the
-- pack's real operational lifetime.
--
-- FIX: a small, narrowly-scoped RPC the client calls after a sale push
-- succeeds, for each line whose product uses pack-slot allocation, to sync
-- just packCostUnitsDepleted (nothing else) to the server. Deliberately NOT
-- implemented by editing shop_push_sale_complete itself — that function has
-- already been the site of more than one production incident this
-- engagement, and this fix does not need to touch it: it is a separate,
-- idempotent, additive metadata sync, gated by the same authorization tier
-- as ordinary stock/sale writes (user_is_cashier_or_above), not a financial
-- correction (no COGS/GP/revenue value is touched by this RPC).
--
-- Idempotency (financial transaction laboratory Phase 12): uses GREATEST()
-- against the currently-stored value rather than a blind overwrite, so
-- replaying the same push (or a duplicate/out-of-order push from another
-- device) can only ever advance the counter forward, never regress it.

create or replace function public.shop_sync_product_pack_slot_state(p_shop_id uuid, p_product_id uuid, p_pack_cost_units_depleted numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current numeric;
  v_new numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_product_id is null or p_pack_cost_units_depleted is null or p_pack_cost_units_depleted < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select coalesce((metadata ->> 'packCostUnitsDepleted')::numeric, 0)
  into v_current
  from public.products
  where id = p_product_id and shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;

  v_new := greatest(v_current, p_pack_cost_units_depleted);

  update public.products
  set metadata = metadata || jsonb_build_object('packCostUnitsDepleted', v_new)
  where id = p_product_id and shop_id = p_shop_id;

  return jsonb_build_object('ok', true, 'pack_cost_units_depleted', v_new);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_sync_product_pack_slot_state(uuid, uuid, numeric) from public, anon;
grant execute on function public.shop_sync_product_pack_slot_state(uuid, uuid, numeric) to authenticated, service_role;
