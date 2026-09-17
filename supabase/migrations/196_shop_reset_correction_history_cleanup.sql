-- Fixes a confirmed, live production blocker: admin_reset_shop_business_data fails
-- for any shop that has ever had a historical financial correction applied to it
-- (first hit: N&C, 6 consecutive failures on 2026-09-15, all with the same error —
-- see internal_ops_admin_audit action='shop_reset_failed').
--
-- Root cause: sale_line_item_corrections' foreign keys to sales/sale_line_items/
-- products use NO ACTION (not CASCADE) — a deliberate protection against a correction
-- record silently disappearing if its sale is ever deleted through some other path.
-- That protection is correct for every normal code path, but a full shop reset is an
-- intentional, total wipe of the shop's business history (it already deletes
-- audit_logs, shop_cloud_snapshots, etc.) — the reset should remove correction history
-- too, deliberately, rather than being blocked by the same guard that protects against
-- an *accidental* deletion elsewhere.
--
-- Both functions are reproduced here from their exact current live definitions
-- (confirmed via pg_get_functiondef immediately before writing this migration), with
-- only the additions described below — no other line changed.
--
-- admin_reset_shop_business_data: two new deletes (financial_correction_requests,
-- sale_line_item_corrections), positioned BEFORE the sale_line_items delete so nothing
-- blocks it, each with its own row-count counter folded into the existing v_deleted
-- summary — matching the function's own established pattern for every other table it
-- touches.
--
-- admin_shop_reset_preview_counts: the same two tables added to the preview JSON, so
-- the preview phase (and the "before_counts"/"after_counts" already recorded in
-- internal_ops_admin_audit) accurately reflect what a reset will remove — the same
-- reasoning that justified inspecting this function alongside the first.

create or replace function public.admin_shop_reset_preview_counts(p_shop_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_waka_internal_role(array['super_admin','operations_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  return jsonb_build_object(
    'products', (select count(*) from public.products where shop_id = p_shop_id),
    'inventory_movements', (select count(*) from public.inventory_movements where shop_id = p_shop_id),
    'sales', (select count(*) from public.sales where shop_id = p_shop_id),
    'sale_line_items', (select count(*) from public.sale_line_items sli join public.sales s on s.id = sli.sale_id where s.shop_id = p_shop_id),
    'sale_payments', (select count(*) from public.sale_payments sp join public.sales s on s.id = sp.sale_id where s.shop_id = p_shop_id),
    'sale_voids', (select count(*) from public.sale_voids where shop_id = p_shop_id),
    'sale_returns', (select count(*) from public.sale_returns where shop_id = p_shop_id),
    'receipts', (select count(*) from public.receipts where shop_id = p_shop_id),
    'customers', (select count(*) from public.customers where shop_id = p_shop_id),
    'customer_debt_payments', (select count(*) from public.customer_debt_payments where shop_id = p_shop_id),
    'audit_logs', (select count(*) from public.audit_logs where shop_id = p_shop_id),
    'ai_generation_usage_log', (select count(*) from public.ai_generation_usage_log where shop_id = p_shop_id),
    'shop_day_closes', (select count(*) from public.shop_day_closes where shop_id = p_shop_id),
    'shop_day_drawer_opens', (select count(*) from public.shop_day_drawer_opens where shop_id = p_shop_id),
    'shop_shifts', (select count(*) from public.shop_shifts where shop_id = p_shop_id),
    'shop_purchases', (select count(*) from public.shop_purchases where shop_id = p_shop_id),
    'shop_supplier_payments', (select count(*) from public.shop_supplier_payments where shop_id = p_shop_id),
    'shop_cash_drawer_adjustments', (select count(*) from public.shop_cash_drawer_adjustments where shop_id = p_shop_id),
    'shop_inventory_count_sessions', (select count(*) from public.shop_inventory_count_sessions where shop_id = p_shop_id),
    'shop_cloud_snapshots', (select count(*) from public.shop_cloud_snapshots where shop_id = p_shop_id),
    'financial_correction_requests', (select count(*) from public.financial_correction_requests where shop_id = p_shop_id),
    'sale_line_item_corrections', (select count(*) from public.sale_line_item_corrections where shop_id = p_shop_id)
  );
end;
$function$;

create or replace function public.admin_reset_shop_business_data(p_shop_id uuid, p_phase text DEFAULT 'preview'::text, p_confirmation text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phase text := lower(trim(coalesce(p_phase, 'preview')));
  v_confirm text := upper(trim(coalesce(p_confirmation, '')));
  v_shop_name text;
  v_shop_number text;
  v_before jsonb;
  v_after jsonb;
  v_deleted jsonb;
  v_reset_at timestamptz := now();
  n_sale_line_items int := 0;
  n_sale_payments int := 0;
  n_receipts int := 0;
  n_sale_voids int := 0;
  n_sale_returns int := 0;
  n_customer_debt_payments int := 0;
  n_sales int := 0;
  n_inventory_movements int := 0;
  n_cash_adjustments int := 0;
  n_count_sessions int := 0;
  n_supplier_payments int := 0;
  n_purchases int := 0;
  n_products int := 0;
  n_customers int := 0;
  n_ai_usage int := 0;
  n_day_closes int := 0;
  n_drawer_opens int := 0;
  n_shifts int := 0;
  n_snapshots int := 0;
  n_audit_logs int := 0;
  n_correction_requests int := 0;
  n_corrections int := 0;
begin
  if not public.is_waka_internal_role(array['super_admin','operations_admin']::text[]) then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'detail', 'WAKA internal admin (super_admin or operations_admin) only.');
  end if;

  if p_shop_id is null then
    return jsonb_build_object('ok', false, 'error', 'shop_id_required');
  end if;

  select sh.name, sh.shop_number into v_shop_name, v_shop_number
  from public.shops sh where sh.id = p_shop_id;

  if v_shop_name is null then
    return jsonb_build_object('ok', false, 'error', 'shop_not_found');
  end if;

  v_before := public.admin_shop_reset_preview_counts(p_shop_id);

  if v_phase = 'preview' then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_preview', p_shop_id, jsonb_build_object('shop_name', v_shop_name, 'counts', v_before));

    return jsonb_build_object(
      'ok', true, 'phase', 'preview', 'shop_id', p_shop_id,
      'shop_name', v_shop_name, 'shop_number', v_shop_number, 'counts', v_before
    );
  end if;

  if v_phase <> 'execute' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phase');
  end if;

  if v_confirm <> 'RESET SHOP' then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_failed', p_shop_id, jsonb_build_object('error', 'confirmation_required', 'shop_name', v_shop_name));

    return jsonb_build_object('ok', false, 'error', 'confirmation_required', 'detail', 'Type RESET SHOP to confirm.');
  end if;

  begin
    -- Historical financial correction records for this shop's sale lines are
    -- protected by NO ACTION foreign keys during normal operation, specifically so a
    -- correction can never silently disappear out from under an accidental delete
    -- elsewhere. A full shop reset is not accidental — it is an intentional, total
    -- wipe of the shop's business history (this function already deletes audit_logs,
    -- shop_cloud_snapshots, etc.) — so correction history is removed here explicitly,
    -- deliberately, and only as part of that same wipe. Must run BEFORE the
    -- sale_line_items delete below, or that delete fails with a foreign key violation
    -- for any shop that has ever had a correction applied.
    delete from public.financial_correction_requests where shop_id = p_shop_id;
    get diagnostics n_correction_requests = row_count;

    delete from public.sale_line_item_corrections where shop_id = p_shop_id;
    get diagnostics n_corrections = row_count;

    with target_sales as (select id from public.sales where shop_id = p_shop_id)
    delete from public.sale_line_items where sale_id in (select id from target_sales);
    get diagnostics n_sale_line_items = row_count;

    with target_sales as (select id from public.sales where shop_id = p_shop_id)
    delete from public.sale_payments where sale_id in (select id from target_sales);
    get diagnostics n_sale_payments = row_count;

    delete from public.receipts where shop_id = p_shop_id;
    get diagnostics n_receipts = row_count;

    delete from public.sale_voids where shop_id = p_shop_id;
    get diagnostics n_sale_voids = row_count;

    delete from public.sale_returns where shop_id = p_shop_id;
    get diagnostics n_sale_returns = row_count;

    delete from public.customer_debt_payments where shop_id = p_shop_id;
    get diagnostics n_customer_debt_payments = row_count;

    delete from public.sales where shop_id = p_shop_id;
    get diagnostics n_sales = row_count;

    delete from public.inventory_movements where shop_id = p_shop_id;
    get diagnostics n_inventory_movements = row_count;

    delete from public.shop_cash_drawer_adjustments where shop_id = p_shop_id;
    get diagnostics n_cash_adjustments = row_count;

    delete from public.shop_inventory_count_sessions where shop_id = p_shop_id;
    get diagnostics n_count_sessions = row_count;

    delete from public.shop_supplier_payments where shop_id = p_shop_id;
    get diagnostics n_supplier_payments = row_count;

    delete from public.shop_purchases where shop_id = p_shop_id;
    get diagnostics n_purchases = row_count;

    delete from public.products where shop_id = p_shop_id;
    get diagnostics n_products = row_count;

    delete from public.customers where shop_id = p_shop_id;
    get diagnostics n_customers = row_count;

    delete from public.ai_generation_usage_log where shop_id = p_shop_id;
    get diagnostics n_ai_usage = row_count;

    delete from public.shop_day_closes where shop_id = p_shop_id;
    get diagnostics n_day_closes = row_count;

    delete from public.shop_day_drawer_opens where shop_id = p_shop_id;
    get diagnostics n_drawer_opens = row_count;

    delete from public.shop_shifts where shop_id = p_shop_id;
    get diagnostics n_shifts = row_count;

    -- Stale cross-device restore blob: delete outright rather than patch
    -- in-place, since its JSON shape is inconsistent across shops (some wrap
    -- payload under a top-level "snapshot" key, some are flat) -- deleting is
    -- the safe option already proven correct in the manual reset this mirrors.
    delete from public.shop_cloud_snapshots where shop_id = p_shop_id;
    get diagnostics n_snapshots = row_count;

    -- Shop-scoped transactional audit trail (distinct from
    -- internal_ops_admin_audit below, which is never touched by this reset).
    delete from public.audit_logs where shop_id = p_shop_id;
    get diagnostics n_audit_logs = row_count;

    -- Sync-health reset, inlined rather than calling admin_shop_reset_sync():
    -- that function's own authorization gate is ['super_admin','support_admin'],
    -- which does not include 'operations_admin' -- calling it here would raise
    -- "Forbidden" for an operations_admin caller who was already authorized by
    -- this function's own check above, and that exception would be caught by
    -- this block and misreported as a reset failure. The upsert itself is
    -- identical to that function's.
    insert into public.sync_health (shop_id, pending_outbound, last_error, last_pull_at, last_push_ok_at, updated_at)
    values (p_shop_id, 0, null, null, null, v_reset_at)
    on conflict (shop_id) do update
      set pending_outbound = 0, last_error = null, last_pull_at = null, last_push_ok_at = null, updated_at = v_reset_at;

    -- Offline/device safety (Feature 8): signal every device for this shop to
    -- do a fresh full pull instead of replaying its local cache.
    insert into public.shop_recovery_signals (shop_id, force_full_resync_at, updated_at)
    values (p_shop_id, v_reset_at, v_reset_at)
    on conflict (shop_id) do update
      set force_full_resync_at = v_reset_at, updated_at = v_reset_at;

  exception when others then
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_failed', p_shop_id, jsonb_build_object(
      'error', 'reset_failed', 'detail', sqlerrm, 'shop_name', v_shop_name, 'before_counts', v_before
    ));
    return jsonb_build_object('ok', false, 'error', 'reset_failed', 'detail', sqlerrm);
  end;

  v_deleted := jsonb_build_object(
    'sale_line_items', n_sale_line_items,
    'sale_payments', n_sale_payments,
    'receipts', n_receipts,
    'sale_voids', n_sale_voids,
    'sale_returns', n_sale_returns,
    'customer_debt_payments', n_customer_debt_payments,
    'sales', n_sales,
    'inventory_movements', n_inventory_movements,
    'shop_cash_drawer_adjustments', n_cash_adjustments,
    'shop_inventory_count_sessions', n_count_sessions,
    'shop_supplier_payments', n_supplier_payments,
    'shop_purchases', n_purchases,
    'products', n_products,
    'customers', n_customers,
    'ai_generation_usage_log', n_ai_usage,
    'shop_day_closes', n_day_closes,
    'shop_day_drawer_opens', n_drawer_opens,
    'shop_shifts', n_shifts,
    'shop_cloud_snapshots', n_snapshots,
    'audit_logs', n_audit_logs,
    'financial_correction_requests', n_correction_requests,
    'sale_line_item_corrections', n_corrections
  );

  v_after := public.admin_shop_reset_preview_counts(p_shop_id);

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
  values (auth.uid(), 'shop_reset_executed', p_shop_id, jsonb_build_object(
    'shop_name', v_shop_name, 'shop_number', v_shop_number,
    'before_counts', v_before, 'deleted_counts', v_deleted, 'after_counts', v_after
  ));

  return jsonb_build_object(
    'ok', true, 'phase', 'execute', 'shop_id', p_shop_id,
    'shop_name', v_shop_name, 'shop_number', v_shop_number,
    'deleted', v_deleted, 'verification', v_after
  );
end;
$function$;
