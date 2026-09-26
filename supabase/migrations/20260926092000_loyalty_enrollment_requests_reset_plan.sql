-- WAKA Loyalty Phase 2 — register loyalty_enrollment_requests in the shop business-data
-- reset plan.
--
-- The reset plan (20260920100000) is the single ordered delete list used by
-- admin_reset_shop_business_data and the certified hard delete, and every shop-scoped
-- table must appear in it exactly once. The Phase 2 migration added
-- public.loyalty_enrollment_requests (shop_id NOT NULL) without registering it, which the
-- shop-reset classification drift guard flags and which would have broken a real reset.
--
-- Body reproduced verbatim from 20260920100000_shop_reset_fk_ordered_plan.sql:32-155 with
-- exactly one added step (5) — no other step, ordinal or statement is changed. The new
-- step is ordered BEFORE loyalty_accounts (step 30) because requests reference it.

create or replace function public.shop_reset_business_plan ()
returns table (step integer, tbl text, count_sql text, delete_sql text)
language sql
immutable
set search_path to 'public'
as $function$
  select v.step, v.tbl, v.count_sql, v.delete_sql
  from (
    values
      -- Phase 2: requests reference loyalty_accounts (SET NULL) and enrollment links,
      -- so they MUST be removed before loyalty_accounts below.
      (5,   'loyalty_enrollment_requests',
        'select count(*) from public.loyalty_enrollment_requests where shop_id = $1',
        'delete from public.loyalty_enrollment_requests where shop_id = $1'),
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

revoke all on function public.shop_reset_business_plan () from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shop_reset_business_plan () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.shop_reset_business_plan () from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.shop_reset_business_plan () to service_role';
  end if;
end;
$g$;
