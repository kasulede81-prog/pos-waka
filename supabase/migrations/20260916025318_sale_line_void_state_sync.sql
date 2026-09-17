-- DEFECT FIX (WAKA POS financial transaction laboratory, Phase 7 — void) —
-- Voiding a sale line correctly sets `voided: true` on the LOCAL sale line
-- object (usePosStore.ts voidSaleLine, line ~5601) and the local dashboard/
-- reports correctly exclude it (saleFinancialEngine.ts's canonical
-- `if (line.voided) continue` filter). The void is also correctly recorded
-- server-side in the sale_voids ledger (stock restoration via
-- shop_apply_sale_void_stock) — confirmed live.
--
-- CONFIRMED LIVE on production shop 2df4b0c8-8b30-489a-8167-41de2549041f:
-- after voiding one line of sale 504a9ab3-edc4-4641-b2a3-66872412721b,
-- `sale_line_items.metadata` for that line still has NO `voided` key at all
-- server-side (cogsUgx/grossProfitUgx/financial_revision all byte-identical
-- to before the void). `pushSaleVoidStockToCloud`
-- (src/offline/cloudSync.ts:803-834) only ever sends
-- {product_id, void_record_id, reference_id, delta, note, sale_id,
-- amount_ugx, line_index, sale_voided_at, product_name} to
-- shop_apply_sale_void_stock — never `voided`/cogsUgx/grossProfitUgx — and
-- that RPC only touches products.stock_on_hand + sale_voids, never
-- sale_line_items. The pull-side merge (saleAdjustmentLedger.ts's
-- mergeVoidRecordsForRecovery, saleFinancialMerge.ts's
-- `voided: Boolean(baseLine.voided || other.voided)`) only OR-preserves an
-- ALREADY-locally-true voided flag — nothing reconstructs it fresh from the
-- sale_voids ledger for a device that never had it locally in the first
-- place (a different staff device, or this same device after a full cloud
-- restore). That device would pull the line with no voided flag and
-- wrongly re-include its revenue/COGS/profit in its own reports.
--
-- FIX: mirrors 20260916015249's pattern exactly — a small, narrowly-scoped,
-- idempotent RPC the client now calls right after
-- shop_apply_sale_void_stock succeeds, to sync just the voided flag (never
-- any financial value) onto the server's sale_line_items row. No COGS/GP/
-- revenue is touched by this RPC — those remain frozen on the original line
-- exactly as recorded at sale time (matching how sale_returns already
-- preserves its own historical cogsUgx snapshot), and voided-status
-- exclusion continues to happen entirely client-side.

create or replace function public.shop_sync_sale_line_void_state(p_shop_id uuid, p_sale_line_item_id uuid, p_voided_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_shop_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if not public.user_is_cashier_or_above(p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_sale_line_item_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select sli.sale_id, s.shop_id
  into v_sale_id, v_sale_shop_id
  from public.sale_line_items sli
  join public.sales s on s.id = sli.sale_id
  where sli.id = p_sale_line_item_id
  for update of sli;

  if v_sale_id is null then
    return jsonb_build_object('ok', false, 'error', 'line_not_found');
  end if;
  if v_sale_shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'error', 'line_not_found');
  end if;

  update public.sale_line_items
  set metadata = metadata || jsonb_build_object('voided', true, 'voidedAt', p_voided_at)
  where id = p_sale_line_item_id;

  return jsonb_build_object('ok', true, 'sale_line_item_id', p_sale_line_item_id, 'voided_at', p_voided_at);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_sync_sale_line_void_state(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.shop_sync_sale_line_void_state(uuid, uuid, timestamptz) to authenticated, service_role;
