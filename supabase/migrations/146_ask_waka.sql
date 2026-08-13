-- Ask WAKA (ASK-1): feature flags + staff sales aggregate RPC
-- READ-ONLY. Does not modify RLS policies or POS write paths.

-- ---------------------------------------------------------------------------
-- Platform defaults: ask_waka feature (disabled by default)
-- ---------------------------------------------------------------------------

create or replace function public.platform_default_ai_settings ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object (
    'schema_version', 2,
    'enabled', false,
    'provider', 'deepseek',
    'provider_config', jsonb_build_object ('deepseek_model', 'deepseek-chat'),
    'pilot_rollout_mode', false,
    'pilot_auto_enable_new_shops', false,
    'product_assistant', false,
    'product_scanner', false,
    'ocr', false,
    'barcode_detection', false,
    'business_setup_assistant', false,
    'inventory_assistant', false,
    'restock_suggestions', false,
    'marketing_assistant', false,
    'marketplace_assistant', false,
    'ask_waka', false,
    'monthly_request_limit', 20000,
    'monthly_budget_limit', 50,
    'per_shop_limit', 500,
    'per_user_limit', 100,
    'plan_limits', jsonb_build_object (
      'free', 50,
      'standard', 500,
      'premium', 5000,
      'enterprise', null
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Shop AI settings: ask_waka column + helpers
-- ---------------------------------------------------------------------------

alter table public.shop_ai_settings
  add column if not exists ask_waka boolean not null default false;

create or replace function public.shop_ai_settings_defaults ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object (
    'ai_enabled', false,
    'product_assistant', false,
    'business_setup_assistant', false,
    'inventory_assistant', false,
    'marketing_assistant', false,
    'marketplace_assistant', false,
    'ask_waka', false,
    'monthly_request_limit', 500,
    'plan_code', null
  );
$$;

create or replace function public.normalize_shop_ai_settings (p_raw jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v jsonb := public.shop_ai_settings_defaults () || coalesce (p_raw, '{}'::jsonb);
  v_limit integer;
begin
  v_limit := greatest (0, coalesce ((v ->> 'monthly_request_limit')::integer, 500));
  v := v || jsonb_build_object (
    'ai_enabled', coalesce ((v ->> 'ai_enabled')::boolean, false),
    'product_assistant', coalesce ((v ->> 'product_assistant')::boolean, false),
    'business_setup_assistant', coalesce ((v ->> 'business_setup_assistant')::boolean, false),
    'inventory_assistant', coalesce ((v ->> 'inventory_assistant')::boolean, false),
    'marketing_assistant', coalesce ((v ->> 'marketing_assistant')::boolean, false),
    'marketplace_assistant', coalesce ((v ->> 'marketplace_assistant')::boolean, false),
    'ask_waka', coalesce ((v ->> 'ask_waka')::boolean, false),
    'monthly_request_limit', v_limit
  );
  return v;
end;
$$;

create or replace function public.get_shop_ai_settings_row (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.shop_ai_settings;
begin
  if p_shop_id is null then
    return null;
  end if;

  select * into v_row
  from public.shop_ai_settings sas
  where sas.shop_id = p_shop_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object (
    'shop_id', v_row.shop_id,
    'ai_enabled', v_row.ai_enabled,
    'product_assistant', v_row.product_assistant,
    'business_setup_assistant', v_row.business_setup_assistant,
    'inventory_assistant', v_row.inventory_assistant,
    'marketing_assistant', v_row.marketing_assistant,
    'marketplace_assistant', v_row.marketplace_assistant,
    'ask_waka', v_row.ask_waka,
    'monthly_request_limit', v_row.monthly_request_limit,
    'plan_code', v_row.plan_code,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_update_shop_ai_settings (
  p_shop_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.shop_ai_settings;
  v_after public.shop_ai_settings;
  v_patch jsonb := coalesce (p_settings, '{}'::jsonb);
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  perform public.ensure_shop_ai_settings (p_shop_id);

  select * into v_before
  from public.shop_ai_settings sas
  where sas.shop_id = p_shop_id;

  update public.shop_ai_settings sas
  set
    ai_enabled = coalesce ((v_patch ->> 'ai_enabled')::boolean, sas.ai_enabled),
    product_assistant = coalesce ((v_patch ->> 'product_assistant')::boolean, sas.product_assistant),
    business_setup_assistant = coalesce ((v_patch ->> 'business_setup_assistant')::boolean, sas.business_setup_assistant),
    inventory_assistant = coalesce ((v_patch ->> 'inventory_assistant')::boolean, sas.inventory_assistant),
    marketing_assistant = coalesce ((v_patch ->> 'marketing_assistant')::boolean, sas.marketing_assistant),
    marketplace_assistant = coalesce ((v_patch ->> 'marketplace_assistant')::boolean, sas.marketplace_assistant),
    ask_waka = coalesce ((v_patch ->> 'ask_waka')::boolean, sas.ask_waka),
    monthly_request_limit = greatest (
      0,
      coalesce ((v_patch ->> 'monthly_request_limit')::integer, sas.monthly_request_limit)
    ),
    plan_code = case
      when v_patch ? 'plan_code' then nullif (v_patch ->> 'plan_code', '')
      else sas.plan_code
    end,
    updated_at = now ()
  where sas.shop_id = p_shop_id
  returning * into v_after;

  insert into public.ai_admin_audit_log (actor_id, shop_id, action, payload)
  values (
    auth.uid (),
    p_shop_id,
    'shop_ai_settings_updated',
    jsonb_build_object (
      'before', jsonb_build_object (
        'ai_enabled', v_before.ai_enabled,
        'product_assistant', v_before.product_assistant,
        'business_setup_assistant', v_before.business_setup_assistant,
        'inventory_assistant', v_before.inventory_assistant,
        'marketing_assistant', v_before.marketing_assistant,
        'marketplace_assistant', v_before.marketplace_assistant,
        'ask_waka', v_before.ask_waka,
        'monthly_request_limit', v_before.monthly_request_limit
      ),
      'after', jsonb_build_object (
        'ai_enabled', v_after.ai_enabled,
        'product_assistant', v_after.product_assistant,
        'business_setup_assistant', v_after.business_setup_assistant,
        'inventory_assistant', v_after.inventory_assistant,
        'marketing_assistant', v_after.marketing_assistant,
        'marketplace_assistant', v_after.marketplace_assistant,
        'ask_waka', v_after.ask_waka,
        'monthly_request_limit', v_after.monthly_request_limit
      )
    )
  );

  return jsonb_build_object (
    'ok', true,
    'settings', public.get_shop_ai_settings_row (p_shop_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff sales summary (read-only aggregate; shop via _report_assert_shop)
-- ---------------------------------------------------------------------------

create or replace function public.shop_get_staff_sales_summary (
  p_start_day date default null,
  p_end_day date default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop uuid := public._report_assert_shop ();
  v_end date := coalesce (p_end_day, public._sale_kampala_day (now ()));
  v_start date := coalesce (p_start_day, v_end);
  v_limit int := greatest (1, least (coalesce (p_limit, 20), 20));
  v_rows jsonb;
  v_span int;
begin
  if v_start > v_end then
    return jsonb_build_object ('ok', false, 'error', 'invalid_date_range');
  end if;

  v_span := (v_end - v_start);
  if v_span > 92 then
    return jsonb_build_object ('ok', false, 'error', 'date_range_too_large');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'staff_key', t.staff_key,
        'transaction_count', t.tx_count,
        'total_revenue_ugx', t.revenue
      )
      order by t.revenue desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      coalesce (s.created_by::text, 'unknown') as staff_key,
      count(*)::int as tx_count,
      coalesce (sum(s.total_ugx), 0)::bigint as revenue
    from public.sales s
    where s.shop_id = v_shop
      and s.status = 'completed'
      and public._sale_kampala_day (coalesce (s.completed_at, s.created_at)) between v_start and v_end
    group by coalesce (s.created_by::text, 'unknown')
    order by coalesce (sum(s.total_ugx), 0) desc
    limit v_limit
  ) t;

  return jsonb_build_object (
    'ok', true,
    'start_day', v_start,
    'end_day', v_end,
    'staff', v_rows
  );
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.shop_get_staff_sales_summary (date, date, int) from public;
grant execute on function public.shop_get_staff_sales_summary (date, date, int) to authenticated;
