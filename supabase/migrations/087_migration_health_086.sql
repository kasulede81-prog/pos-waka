-- Extend production migration verification with 086 certification closure.

create or replace function public.waka_verify_production_migrations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_pass boolean;
  v_src text;
begin
  v_pass := to_regprocedure('public.apply_sale_stock_movements(uuid)') is not null;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '082_inventory_integrity',
    'pass', v_pass,
    'detail', case when v_pass then 'apply_sale_stock_movements present' else 'missing function' end
  ));

  v_pass := false;
  if to_regprocedure('public.shop_push_sale_complete(uuid,jsonb)') is not null then
    select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'shop_push_sale_complete'
    limit 1;
    v_pass := coalesce(v_src, '') like '%apply_sale_stock_movements%';
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '083_sale_stock_sync',
    'pass', v_pass,
    'detail', case when v_pass then 'sale complete calls stock sync' else 'stock sync hook missing' end
  ));

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'inventory_movements_sale_product_unique'
  ) into v_pass;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '084_remediate_sale_inventory_movement_duplicates',
    'pass', v_pass,
    'detail', case when v_pass then 'unique sale movement index present' else 'index missing — run 084' end
  ));

  select exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'audit_logs_shop_client_entry_unique'
  ) into v_pass;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '085_audit_log_client_entry_idempotent',
    'pass', v_pass,
    'detail', case when v_pass then 'audit client_entry_id unique index present' else 'index missing — run 085' end
  ));

  v_pass := to_regprocedure('public.validate_sale_return_ceilings(uuid,uuid,uuid,numeric,bigint,uuid)') is not null;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '086_certification_closure',
    'pass', v_pass,
    'detail', case when v_pass then 'return ceiling validation present' else 'missing — run 086' end
  ));

  v_pass := false;
  if to_regprocedure('public.waka_verify_production_migrations()') is not null then
    select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'waka_verify_production_migrations'
    limit 1;
    v_pass := coalesce(v_src, '') like '%086_certification_closure%';
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', '087_migration_health_086',
    'pass', v_pass,
    'detail', case when v_pass then 'migration health check includes 086 coverage' else 'migration 087 not applied' end
  ));

  return jsonb_build_object(
    'ok', not exists (
      select 1
      from jsonb_array_elements(v_checks) c
      where coalesce((c ->> 'pass')::boolean, false) is not true
    ),
    'checks', v_checks
  );
end;
$$;

revoke all on function public.waka_verify_production_migrations () from public;
grant execute on function public.waka_verify_production_migrations () to authenticated;
