-- Shop business-data reset + certified hard delete: one FK-ordered, fully verified deletion plan.
--
-- WHY
--   admin_reset_shop_business_data (191/196/20260918024500) deleted a hand-maintained list of tables. Every new
--   business table that reached production behind a RESTRICT / NO ACTION foreign key broke it again:
--     - 2026-09-15: sale_line_item_corrections            (fixed by 196)
--     - 2026-09-19: table_sessions.sale_id -> sales RESTRICT (this migration; 4 failed resets on shop 1a110d2e)
--   The verification step only counted the same hand-picked list, so it could not notice rows it never deleted
--   (100 shop_stock_movements survived the 2026-09-16 reset and were pulled back onto devices).
--   certified_hard_delete_organization_execute (148) had the same blind spots (corrections, loyalty, kitchen).
--
-- WHAT
--   1. public.shop_reset_business_plan()               the single ordered plan (children before parents)
--   2. public.shop_reset_table_classification()        every shop-scoped table is RESET or RETAINED, with a reason
--   3. public.shop_reset_business_counts(uuid)         counts for every plan table (preview + verification)
--   4. public.shop_reset_business_data_core(uuid)      executes the plan, names the table that failed
--   5. admin_shop_reset_preview_counts / admin_reset_shop_business_data   same contract + authorization, but:
--        - executes the whole plan atomically, verifies EVERY plan table is empty inside the same transaction
--          and rolls everything back (ok=false, failed_table set, audited) if anything is left or fails
--        - refuses (does not silently skip) when the shop takes part in an enterprise stock transfer
--        - keeps the force_full_resync marker and sync_health reset exactly as before
--   6. certified_hard_delete_organization_execute / hard_delete_verification_report use the same plan
--   7. drops the legacy one-shot overloads owner_permanently_delete_own_account(text) and
--      admin_permanently_delete_shop_account(uuid, text): they bypass the certified path and re-verification.
--
-- NOT CHANGED: authorization (super_admin / operations_admin for reset, super_admin for admin delete, owner for
-- self delete), the internal-admin delete protection, shop / organization / user / membership identity.

-- ---------------------------------------------------------------------------------------------------------
-- 1. the plan
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.shop_reset_business_plan ()
returns table (step integer, tbl text, count_sql text, delete_sql text)
language sql
immutable
set search_path to 'public'
as $function$
  select v.step, v.tbl, v.count_sql, v.delete_sql
  from (
    values
      (10,  'loyalty_redemptions',
        'select count(*) from public.loyalty_redemptions where shop_id = $1',
        'delete from public.loyalty_redemptions where shop_id = $1'),
      (20,  'loyalty_transactions',
        'select count(*) from public.loyalty_transactions where shop_id = $1',
        'delete from public.loyalty_transactions where shop_id = $1'),
      (30,  'loyalty_accounts',
        'select count(*) from public.loyalty_accounts where shop_id = $1',
        'delete from public.loyalty_accounts where shop_id = $1'),
      (40,  'financial_correction_requests',
        'select count(*) from public.financial_correction_requests where shop_id = $1',
        'delete from public.financial_correction_requests where shop_id = $1'),
      (50,  'sale_line_item_corrections',
        'select count(*) from public.sale_line_item_corrections where shop_id = $1',
        'delete from public.sale_line_item_corrections where shop_id = $1'),
      (60,  'kitchen_ticket_items',
        'select count(*) from public.kitchen_ticket_items where ticket_id in (select id from public.kitchen_tickets where shop_id = $1)',
        'delete from public.kitchen_ticket_items where ticket_id in (select id from public.kitchen_tickets where shop_id = $1)'),
      (70,  'kitchen_tickets',
        'select count(*) from public.kitchen_tickets where shop_id = $1',
        'delete from public.kitchen_tickets where shop_id = $1'),
      (80,  'table_session_events',
        'select count(*) from public.table_session_events where shop_id = $1',
        'delete from public.table_session_events where shop_id = $1'),
      (90,  'waitlist_entries',
        'select count(*) from public.waitlist_entries where shop_id = $1',
        'delete from public.waitlist_entries where shop_id = $1'),
      (100, 'table_reservations',
        'select count(*) from public.table_reservations where shop_id = $1',
        'delete from public.table_reservations where shop_id = $1'),
      -- table_sessions.sale_id -> sales is ON DELETE RESTRICT: sessions MUST go before sales.
      (110, 'table_sessions',
        'select count(*) from public.table_sessions where shop_id = $1',
        'delete from public.table_sessions where shop_id = $1'),
      (120, 'sale_line_items',
        'select count(*) from public.sale_line_items where sale_id in (select id from public.sales where shop_id = $1)',
        'delete from public.sale_line_items where sale_id in (select id from public.sales where shop_id = $1)'),
      (130, 'sale_payments',
        'select count(*) from public.sale_payments where sale_id in (select id from public.sales where shop_id = $1)',
        'delete from public.sale_payments where sale_id in (select id from public.sales where shop_id = $1)'),
      (140, 'receipts',
        'select count(*) from public.receipts where shop_id = $1',
        'delete from public.receipts where shop_id = $1'),
      (150, 'sale_voids',
        'select count(*) from public.sale_voids where shop_id = $1',
        'delete from public.sale_voids where shop_id = $1'),
      (160, 'sale_returns',
        'select count(*) from public.sale_returns where shop_id = $1',
        'delete from public.sale_returns where shop_id = $1'),
      (170, 'customer_debt_payments',
        'select count(*) from public.customer_debt_payments where shop_id = $1',
        'delete from public.customer_debt_payments where shop_id = $1'),
      (180, 'sales',
        'select count(*) from public.sales where shop_id = $1',
        'delete from public.sales where shop_id = $1'),
      (190, 'inventory_movements',
        'select count(*) from public.inventory_movements where shop_id = $1',
        'delete from public.inventory_movements where shop_id = $1'),
      (200, 'shop_stock_movements',
        'select count(*) from public.shop_stock_movements where shop_id = $1',
        'delete from public.shop_stock_movements where shop_id = $1'),
      (210, 'shop_cash_drawer_adjustments',
        'select count(*) from public.shop_cash_drawer_adjustments where shop_id = $1',
        'delete from public.shop_cash_drawer_adjustments where shop_id = $1'),
      (220, 'shop_inventory_count_sessions',
        'select count(*) from public.shop_inventory_count_sessions where shop_id = $1',
        'delete from public.shop_inventory_count_sessions where shop_id = $1'),
      (230, 'shop_supplier_payments',
        'select count(*) from public.shop_supplier_payments where shop_id = $1',
        'delete from public.shop_supplier_payments where shop_id = $1'),
      (240, 'shop_purchases',
        'select count(*) from public.shop_purchases where shop_id = $1',
        'delete from public.shop_purchases where shop_id = $1'),
      (250, 'expenses',
        'select count(*) from public.expenses where shop_id = $1',
        'delete from public.expenses where shop_id = $1'),
      (260, 'shop_suppliers',
        'select count(*) from public.shop_suppliers where shop_id = $1',
        'delete from public.shop_suppliers where shop_id = $1'),
      (270, 'print_jobs',
        'select count(*) from public.print_jobs where shop_id = $1',
        'delete from public.print_jobs where shop_id = $1'),
      (280, 'barcode_labels',
        'select count(*) from public.barcode_labels where shop_id = $1',
        'delete from public.barcode_labels where shop_id = $1'),
      (290, 'products',
        'select count(*) from public.products where shop_id = $1',
        'delete from public.products where shop_id = $1'),
      (300, 'customers',
        'select count(*) from public.customers where shop_id = $1',
        'delete from public.customers where shop_id = $1'),
      (310, 'ai_generation_usage_log',
        'select count(*) from public.ai_generation_usage_log where shop_id = $1',
        'delete from public.ai_generation_usage_log where shop_id = $1'),
      (320, 'shop_day_closes',
        'select count(*) from public.shop_day_closes where shop_id = $1',
        'delete from public.shop_day_closes where shop_id = $1'),
      (330, 'shop_day_drawer_opens',
        'select count(*) from public.shop_day_drawer_opens where shop_id = $1',
        'delete from public.shop_day_drawer_opens where shop_id = $1'),
      (340, 'shop_shifts',
        'select count(*) from public.shop_shifts where shop_id = $1',
        'delete from public.shop_shifts where shop_id = $1'),
      (350, 'shop_activity',
        'select count(*) from public.shop_activity where shop_id = $1',
        'delete from public.shop_activity where shop_id = $1'),
      (360, 'shop_cloud_snapshots',
        'select count(*) from public.shop_cloud_snapshots where shop_id = $1',
        'delete from public.shop_cloud_snapshots where shop_id = $1'),
      (370, 'audit_logs',
        'select count(*) from public.audit_logs where shop_id = $1',
        'delete from public.audit_logs where shop_id = $1')
  ) as v(step, tbl, count_sql, delete_sql)
  order by v.step;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. classification of every shop-scoped table (drift guard: a new shop-scoped table must be added here)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.shop_reset_table_classification ()
returns table (tbl text, disposition text, reason text)
language sql
immutable
set search_path to 'public'
as $function$
  select p.tbl, 'reset'::text, 'business data deleted by the reset plan'::text
  from public.shop_reset_business_plan() p
  union all
  select r.tbl, 'retained'::text, r.reason
  from (
    values
      ('activation_requests',                     'platform onboarding history'),
      ('admin_assignments',                       'internal-admin authorization structure'),
      ('agent_referrals',                         'marketing attribution'),
      ('ai_admin_audit_log',                      'internal admin audit trail'),
      ('app_crash_events',                        'device diagnostics'),
      ('business_licenses',                       'licensing / billing identity'),
      ('business_status',                         'licensing / billing identity'),
      ('device_logs',                             'device diagnostics'),
      ('dining_areas',                            'hospitality floor configuration'),
      ('dining_tables',                           'hospitality floor configuration'),
      ('enterprise_purchase_order_branches',      'organization-level purchasing structure'),
      ('enterprise_stock_transfer_receive_events','belongs to an enterprise transfer (reset refuses while any exists)'),
      ('enterprise_stock_transfers',              'cross-shop; reset refuses while the shop takes part in one'),
      ('field_visits',                            'internal ops record'),
      ('hardware_pairings',                       'device configuration'),
      ('internal_ops_admin_audit',                'platform admin audit trail (shop reference is nulled on shop delete)'),
      ('internal_shop_notes',                     'internal ops record'),
      ('kitchen_stations',                        'hospitality station configuration'),
      ('loyalty_programs',                        'shop configuration (kept, like shop settings)'),
      ('loyalty_rewards',                         'shop configuration (kept, like shop settings)'),
      ('merchant_notifications',                  'merchant inbox (a notification tied to a deleted correction request cascades with it)'),
      ('merchant_support_attachments',            'support communication, not business data'),
      ('merchant_support_messages',               'support communication, not business data'),
      ('merchant_support_session_events',         'support communication, not business data'),
      ('merchant_support_sessions',               'support communication, not business data'),
      ('merchant_support_tickets',                'support communication, not business data'),
      ('org_billing_offers',                      'billing'),
      ('product_categories',                      'catalog structure (configuration)'),
      ('promotional_grants',                      'billing / growth'),
      ('remote_support_requests',                 'support communication'),
      ('remote_support_session_events',           'support communication'),
      ('remote_support_sessions',                 'support communication'),
      ('shop_ai_settings',                        'shop configuration'),
      ('shop_ai_setup_templates',                 'shop configuration'),
      ('shop_catalog_meta',                       'catalog structure (configuration)'),
      ('shop_catalog_nodes',                      'catalog structure (configuration)'),
      ('shop_catalog_shelf_layout',               'catalog structure (configuration)'),
      ('shop_counters',                           'sequence counters'),
      ('shop_devices',                            'device registry / authorization'),
      ('shop_efris_config',                       'tax configuration'),
      ('shop_efris_submissions',                  'regulatory tax submissions (never deleted by a business reset)'),
      ('shop_hardware',                           'device configuration'),
      ('shop_locations',                          'shop configuration'),
      ('shop_members',                            'authorization structure'),
      ('shop_policy_settings',                    'shop configuration'),
      ('shop_pos_staff',                          'staff / authorization structure'),
      ('shop_pos_staff_revisions',                'staff / authorization structure'),
      ('shop_recovery_signals',                   'reset marker (rewritten by the reset, never deleted)'),
      ('shop_security_credentials',               'authorization structure'),
      ('shop_staff_invitations',                  'authorization structure'),
      ('shop_staff_security_events',              'security audit trail'),
      ('shop_vision_settings',                    'shop configuration'),
      ('subscription_history',                    'billing'),
      ('subscription_requests',                   'billing'),
      ('subscriptions',                           'billing'),
      ('support_requests',                        'support communication'),
      ('sync_health',                             'reset marker (rewritten by the reset, never deleted)')
  ) as r(tbl, reason);
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. counts (preview + verification use exactly the deletion plan)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.shop_reset_business_counts (p_shop_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_row record;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  for v_row in select * from public.shop_reset_business_plan() loop
    execute v_row.count_sql into v_n using p_shop_id;
    v_out := v_out || jsonb_build_object(v_row.tbl, v_n);
  end loop;
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. core: run the plan in FK order. A failing step names its table.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.shop_reset_business_data_core (p_shop_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row record;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  if p_shop_id is null then
    raise exception 'shop_reset_failed_at:(none):shop_id_required';
  end if;
  for v_row in select * from public.shop_reset_business_plan() loop
    begin
      execute v_row.delete_sql using p_shop_id;
      get diagnostics v_n = row_count;
    exception when others then
      raise exception 'shop_reset_failed_at:%:%', v_row.tbl, sqlerrm using errcode = sqlstate;
    end;
    v_out := v_out || jsonb_build_object(v_row.tbl, v_n);
  end loop;
  return v_out;
end;
$function$;

revoke all on function public.shop_reset_business_plan () from public;
revoke all on function public.shop_reset_table_classification () from public;
revoke all on function public.shop_reset_business_counts (uuid) from public;
revoke all on function public.shop_reset_business_data_core (uuid) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.shop_reset_business_plan () from anon;
    revoke all on function public.shop_reset_table_classification () from anon;
    revoke all on function public.shop_reset_business_counts (uuid) from anon;
    revoke all on function public.shop_reset_business_data_core (uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.shop_reset_business_plan () from authenticated;
    revoke all on function public.shop_reset_table_classification () from authenticated;
    revoke all on function public.shop_reset_business_counts (uuid) from authenticated;
    revoke all on function public.shop_reset_business_data_core (uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.shop_reset_business_plan () to service_role;
    grant execute on function public.shop_reset_table_classification () to service_role;
    grant execute on function public.shop_reset_business_counts (uuid) to service_role;
    grant execute on function public.shop_reset_business_data_core (uuid) to service_role;
  end if;
end
$grants$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. admin reset (same authorization / marker contract; atomic; verified against the whole plan)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_shop_reset_preview_counts (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_waka_internal_role(array['super_admin','operations_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  return public.shop_reset_business_counts(p_shop_id);
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
  v_left jsonb;
  v_failed_table text;
  v_msg text;
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

  -- Everything below is ONE atomic unit: any failure (including a non-empty verification) rolls the whole
  -- block back, so a partial reset can never be committed or reported as success.
  begin
    -- serialize concurrent resets of the same shop without blocking ordinary child-row inserts (FOR KEY SHARE)
    perform 1 from public.shops where id = p_shop_id for no key update;

    -- a cross-shop stock transfer cannot be reset from one side without corrupting the other shop: refuse.
    if exists (
      select 1 from public.enterprise_stock_transfers t
      where t.from_shop_id = p_shop_id or t.to_shop_id = p_shop_id
    ) then
      raise exception 'shop_reset_failed_at:enterprise_stock_transfers:shop_takes_part_in_enterprise_stock_transfers';
    end if;

    v_deleted := public.shop_reset_business_data_core(p_shop_id);

    -- verify EVERY plan table (not a hand-picked subset)
    v_left := public.shop_reset_business_counts(p_shop_id);
    select e.k into v_failed_table
    from jsonb_each_text(v_left) as e(k, n)
    where e.n::bigint <> 0
    order by e.k
    limit 1;
    if v_failed_table is not null then
      raise exception 'shop_reset_failed_at:%:verification_failed_rows_remaining=%', v_failed_table, v_left ->> v_failed_table;
    end if;

    insert into public.sync_health (shop_id, pending_outbound, last_error, last_pull_at, last_push_ok_at, updated_at)
    values (p_shop_id, 0, null, null, null, v_reset_at)
    on conflict (shop_id) do update
      set pending_outbound = 0, last_error = null, last_pull_at = null, last_push_ok_at = null, updated_at = v_reset_at;

    insert into public.shop_recovery_signals (shop_id, force_full_resync_at, updated_at)
    values (p_shop_id, v_reset_at, v_reset_at)
    on conflict (shop_id) do update
      set force_full_resync_at = v_reset_at, updated_at = v_reset_at;

  exception when others then
    v_msg := sqlerrm;
    v_failed_table := nullif(substring(v_msg from '^shop_reset_failed_at:([^:]+):'), '');
    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
    values (auth.uid(), 'shop_reset_failed', p_shop_id, jsonb_build_object(
      'error', 'reset_failed', 'detail', v_msg, 'failed_table', v_failed_table,
      'shop_name', v_shop_name, 'before_counts', v_before
    ));
    return jsonb_build_object('ok', false, 'error', 'reset_failed', 'detail', v_msg, 'failed_table', v_failed_table);
  end;

  v_after := v_left;

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

-- ---------------------------------------------------------------------------------------------------------
-- 6. certified hard delete: same plan, transfers first (they RESTRICT products/shops), verification covers the plan
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.hard_delete_verification_report (
  p_org_id uuid,
  p_shop_ids uuid[],
  p_owner_user_id uuid default null,
  p_staff_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_counts jsonb;
  v_orgs int := 0;
  v_shops int := 0;
  v_products int := 0;
  v_sales int := 0;
  v_customers int := 0;
  v_suppliers int := 0;
  v_purchases int := 0;
  v_shifts int := 0;
  v_inventory_counts int := 0;
  v_stock_movements int := 0;
  v_cloud_snapshots int := 0;
  v_devices int := 0;
  v_subscriptions int := 0;
  v_audit_logs int := 0;
  v_support_requests int := 0;
  v_table_sessions int := 0;
  v_stock_transfers int := 0;
  v_support_messages int := 0;
  v_biz jsonb := '{}'::jsonb;
  v_plan record;
  v_sid uuid;
  v_n bigint;
  v_c bigint;
  v_all_passed boolean := true;
begin
  -- p_owner_user_id / p_staff_user_ids are retained for signature compatibility.
  -- Auth.users is verified only after Edge auth.admin.deleteUser.
  perform p_owner_user_id, p_staff_user_ids;

  if p_org_id is not null then
    select count(*)::int into v_orgs from public.organizations o where o.id = p_org_id;
    select count(*)::int into v_shops from public.shops sh where sh.organization_id = p_org_id;
    select count(*)::int into v_subscriptions from public.subscriptions s where s.organization_id = p_org_id;
    select count(*)::int
    into v_support_requests
    from public.support_requests sr
    where sr.organization_id = p_org_id
       or (cardinality(p_shop_ids) > 0 and sr.shop_id = any (p_shop_ids));
    select count(*)::int
    into v_stock_transfers
    from public.enterprise_stock_transfers est
    where est.organization_id = p_org_id;
  end if;

  if cardinality(p_shop_ids) > 0 then
    select count(*)::int into v_products from public.products p where p.shop_id = any (p_shop_ids);
    select count(*)::int into v_sales from public.sales s where s.shop_id = any (p_shop_ids);
    select count(*)::int into v_customers from public.customers c where c.shop_id = any (p_shop_ids);
    select count(*)::int into v_suppliers from public.shop_suppliers ss where ss.shop_id = any (p_shop_ids);
    select count(*)::int into v_purchases from public.shop_purchases sp where sp.shop_id = any (p_shop_ids);
    select count(*)::int into v_shifts from public.shop_shifts shf where shf.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_inventory_counts
    from public.shop_inventory_count_sessions ic
    where ic.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_stock_movements
    from public.shop_stock_movements sm
    where sm.shop_id = any (p_shop_ids);
    select count(*)::int into v_cloud_snapshots from public.shop_cloud_snapshots scs where scs.shop_id = any (p_shop_ids);
    select count(*)::int into v_devices from public.shop_devices d where d.shop_id = any (p_shop_ids);
    select count(*)::int into v_audit_logs from public.audit_logs al where al.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_table_sessions
    from public.table_sessions ts
    where ts.shop_id = any (p_shop_ids);
    select count(*)::int
    into v_support_messages
    from public.merchant_support_messages msg
    where msg.shop_id = any (p_shop_ids);

    -- every table of the shared deletion plan, summed over the org's shops (flat integer keys biz_<table>)
    for v_plan in select * from public.shop_reset_business_plan() loop
      v_n := 0;
      foreach v_sid in array p_shop_ids loop
        execute v_plan.count_sql into v_c using v_sid;
        v_n := v_n + coalesce(v_c, 0);
      end loop;
      v_biz := v_biz || jsonb_build_object('biz_' || v_plan.tbl, v_n);
    end loop;
  end if;

  v_counts := jsonb_build_object(
    'organizations', v_orgs,
    'shops', v_shops,
    'products', v_products,
    'sales', v_sales,
    'customers', v_customers,
    'suppliers', v_suppliers,
    'purchases', v_purchases,
    'shifts', v_shifts,
    'inventory_counts', v_inventory_counts,
    'stock_movements', v_stock_movements,
    'cloud_snapshots', v_cloud_snapshots,
    'devices', v_devices,
    'subscriptions', v_subscriptions,
    'audit_logs', v_audit_logs,
    'support_requests', v_support_requests,
    'table_sessions', v_table_sessions,
    'stock_transfers', v_stock_transfers,
    'support_messages', v_support_messages
  ) || v_biz;

  select bool_and((value)::bigint = 0)
  into v_all_passed
  from jsonb_each_text(v_counts);

  return jsonb_build_object(
    'all_passed', coalesce(v_all_passed, true),
    'counts', v_counts,
    'scope', 'database',
    'checked_at', now()
  );
end;
$function$;

create or replace function public.certified_hard_delete_organization_execute (
  p_org_id uuid,
  p_primary_shop_id uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_audit_action text default 'certified_hard_delete_executed'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shop_ids uuid[];
  v_user_ids uuid[];
  v_staff_user_ids uuid[];
  v_owner_email text;
  v_agents_removed int := 0;
  v_referrals_removed int := 0;
  v_sales_deleted int := 0;
  v_numbers_released int := 0;
  v_devices_deactivated int := 0;
  v_audit_logs_removed int := 0;
  v_support_removed int := 0;
  v_profiles_removed int := 0;
  v_table_sessions_removed int := 0;
  v_stock_transfers_removed int := 0;
  v_sid uuid;
  v_core jsonb;
  v_verification jsonb;
begin
  if p_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'organization_required');
  end if;

  v_shop_ids := public.hard_delete_collect_org_shop_ids (p_org_id);
  v_user_ids := public.hard_delete_collect_org_user_ids (p_org_id);

  if p_owner_user_id is not null and not (p_owner_user_id = any (v_user_ids)) then
    v_user_ids := array_append(v_user_ids, p_owner_user_id);
  end if;

  v_staff_user_ids := array(
    select uid
    from unnest(v_user_ids) uid
    where uid is distinct from p_owner_user_id
  );

  select lower (trim (coalesce (pr.email, u.email, '')))
  into v_owner_email
  from auth.users u
  left join public.profiles pr on pr.id = u.id
  where u.id = p_owner_user_id;

  if p_primary_shop_id is not null then
    insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
    values (
      p_primary_shop_id,
      p_actor_user_id,
      coalesce (nullif (trim (p_actor_role), ''), 'system'),
      p_audit_action,
      'Certified hard delete started',
      jsonb_build_object(
        'organization_id', p_org_id,
        'owner_user_id', p_owner_user_id,
        'shop_ids', to_jsonb (v_shop_ids),
        'user_ids', to_jsonb (v_user_ids)
      )
    );
  end if;

  update public.shop_devices d
  set
    status = 'revoked'::public.shop_device_status,
    updated_at = now ()
  where d.shop_id = any (v_shop_ids);
  get diagnostics v_devices_deactivated = row_count;

  delete from public.support_requests sr
  where sr.organization_id = p_org_id
     or (cardinality(v_shop_ids) > 0 and sr.shop_id = any (v_shop_ids));
  get diagnostics v_support_removed = row_count;

  if cardinality(v_shop_ids) > 0 then
    delete from public.audit_logs al
    where al.shop_id = any (v_shop_ids);
    get diagnostics v_audit_logs_removed = row_count;
  end if;

  insert into public.waka_shop_number_released (shop_number)
  select distinct upper (trim (sh.shop_number))
  from public.shops sh
  where sh.organization_id = p_org_id
    and sh.shop_number is not null
    and trim (sh.shop_number) <> ''
    and upper (trim (sh.shop_number)) ~ '^A[0-9]+$'
  on conflict (shop_number) do nothing;
  get diagnostics v_numbers_released = row_count;

  delete from public.agent_referrals ar
  where ar.organization_id = p_org_id
     or ar.referred_user_id = any (v_user_ids)
     or (cardinality(v_shop_ids) > 0 and ar.referred_shop_id = any (v_shop_ids));
  get diagnostics v_referrals_removed = row_count;

  delete from public.marketing_agents ma
  where ma.user_id = any (v_user_ids)
     or (
       v_owner_email is not null
       and v_owner_email <> ''
       and ma.email is not null
       and lower (trim (ma.email)) = v_owner_email
     );
  get diagnostics v_agents_removed = row_count;

  if cardinality(v_user_ids) > 0 then
    delete from public.profiles pr
    where pr.id = any (v_user_ids);
    get diagnostics v_profiles_removed = row_count;
  end if;

  -- Transfers CASCADE from organization_id but RESTRICT shop AND product deletes: they must go BEFORE the
  -- shared plan deletes products (enterprise_stock_transfer_lines.destination_product_id is RESTRICT).
  delete from public.enterprise_stock_transfers est
  where est.organization_id = p_org_id
     or (cardinality(v_shop_ids) > 0 and (est.from_shop_id = any (v_shop_ids) or est.to_shop_id = any (v_shop_ids)));
  get diagnostics v_stock_transfers_removed = row_count;

  -- The SAME FK-ordered plan as the admin business-data reset: corrections, loyalty, kitchen, table sessions,
  -- sales, stock, catalog products ... all in dependency order.
  if cardinality(v_shop_ids) > 0 then
    foreach v_sid in array v_shop_ids loop
      v_core := public.shop_reset_business_data_core (v_sid);
      v_sales_deleted := v_sales_deleted + coalesce((v_core ->> 'sales')::int, 0);
      v_table_sessions_removed := v_table_sessions_removed + coalesce((v_core ->> 'table_sessions')::int, 0);
    end loop;
  end if;

  -- merchant_support_messages.shop_id -> shops is NO ACTION (not CASCADE like its ticket): the organization delete
  -- would fail with merchant_support_messages_shop_id_fkey whenever a shop has a support message.
  if cardinality(v_shop_ids) > 0 then
    delete from public.merchant_support_messages msg
    where msg.shop_id = any (v_shop_ids);
  end if;

  delete from public.organizations o
  where o.id = p_org_id;

  v_verification := public.hard_delete_verification_report (
    p_org_id,
    v_shop_ids,
    p_owner_user_id,
    v_staff_user_ids
  );

  if coalesce((v_verification ->> 'all_passed')::boolean, false) is not true then
    return jsonb_build_object(
      'ok',
      false,
      'error',
      'verification_failed',
      'detail',
      'Post-delete database verification found remaining rows.',
      'verification',
      v_verification,
      'user_ids',
      to_jsonb (v_user_ids),
      'owner_user_id',
      p_owner_user_id,
      'shop_ids',
      to_jsonb (v_shop_ids),
      'sales_deleted',
      v_sales_deleted,
      'audit_logs_removed',
      v_audit_logs_removed,
      'support_requests_removed',
      v_support_removed
    );
  end if;

  return jsonb_build_object(
    'ok',
    true,
    'organization_id',
    p_org_id,
    'owner_user_id',
    p_owner_user_id,
    'user_ids',
    to_jsonb (v_user_ids),
    'staff_user_ids',
    to_jsonb (v_staff_user_ids),
    'shop_ids',
    to_jsonb (v_shop_ids),
    'sales_deleted',
    v_sales_deleted,
    'agents_removed',
    v_agents_removed,
    'referrals_removed',
    v_referrals_removed,
    'shop_numbers_released',
    v_numbers_released,
    'devices_deactivated',
    v_devices_deactivated,
    'audit_logs_removed',
    v_audit_logs_removed,
    'support_requests_removed',
    v_support_removed,
    'profiles_removed',
    v_profiles_removed,
    'table_sessions_removed',
    v_table_sessions_removed,
    'stock_transfers_removed',
    v_stock_transfers_removed,
    'verification',
    v_verification
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'delete_failed', 'detail', sqlerrm);
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. legacy one-shot overloads (bypass the certified prepare/execute/verify path)
-- ---------------------------------------------------------------------------------------------------------
drop function if exists public.owner_permanently_delete_own_account (text);
drop function if exists public.admin_permanently_delete_shop_account (uuid, text);
