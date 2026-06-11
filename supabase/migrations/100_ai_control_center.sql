-- Waka POS — AI Control Center (centralized settings v2, limits, metrics)

-- ---------------------------------------------------------------------------
-- v2 default settings (fail-closed)
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
    'product_assistant', false,
    'product_scanner', false,
    'ocr', false,
    'barcode_detection', false,
    'business_setup_assistant', false,
    'inventory_assistant', false,
    'restock_suggestions', false,
    'marketing_assistant', false,
    'marketplace_assistant', false,
    'monthly_request_limit', 20000,
    'monthly_budget_limit', 50,
    'per_shop_limit', 500,
    'per_user_limit', 100
  );
$$;

create or replace function public.normalize_ai_settings (p_raw jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v jsonb := public.platform_default_ai_settings () || coalesce (p_raw, '{}'::jsonb);
  v_enabled boolean;
  v_model text;
begin
  v_enabled := coalesce (
    (v ->> 'enabled')::boolean,
    (v ->> 'ai_enabled')::boolean,
    false
  );

  v := v || jsonb_build_object ('enabled', v_enabled, 'schema_version', 2);

  if not (v ? 'product_assistant') and (v ? 'ai_product_assistant_enabled') then
    v := v || jsonb_build_object ('product_assistant', (v ->> 'ai_product_assistant_enabled')::boolean);
  end if;

  if not (v ? 'business_setup_assistant') and (v ? 'ai_business_setup_enabled') then
    v := v || jsonb_build_object ('business_setup_assistant', (v ->> 'ai_business_setup_enabled')::boolean);
  end if;

  if coalesce ((v ->> 'monthly_request_limit')::integer, 0) <= 0
     and (v ? 'monthly_ai_generation_limit') then
    v := v || jsonb_build_object (
      'monthly_request_limit',
      greatest (0, (v ->> 'monthly_ai_generation_limit')::integer)
    );
  end if;

  v_model := coalesce (
    v -> 'provider_config' ->> 'deepseek_model',
    v ->> 'deepseek_model',
    'deepseek-chat'
  );
  if v_model not in ('deepseek-chat', 'deepseek-reasoner') then
    v_model := 'deepseek-chat';
  end if;

  v := v || jsonb_build_object (
    'provider_config',
    coalesce (v -> 'provider_config', '{}'::jsonb) || jsonb_build_object ('deepseek_model', v_model)
  );

  if coalesce (v ->> 'provider', '') not in ('deepseek', 'openai', 'gemini', 'claude') then
    v := v || jsonb_build_object ('provider', 'deepseek');
  end if;

  return v;
end;
$$;

create or replace function public.get_platform_ai_settings ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
begin
  select ps.value into v_raw
  from public.platform_settings ps
  where ps.key = 'ai_settings';

  if v_raw is null or jsonb_typeof (v_raw) <> 'object' then
    return public.platform_default_ai_settings ();
  end if;

  return public.normalize_ai_settings (v_raw);
end;
$$;

create or replace function public.admin_update_platform_ai_settings (p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merged jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  v_merged := public.normalize_ai_settings (
    public.platform_default_ai_settings () || coalesce (p_settings, '{}'::jsonb)
  );

  v_merged := v_merged || jsonb_build_object (
    'monthly_request_limit', greatest (0, coalesce ((v_merged ->> 'monthly_request_limit')::integer, 20000)),
    'monthly_budget_limit', greatest (0, coalesce ((v_merged ->> 'monthly_budget_limit')::numeric, 50)),
    'per_shop_limit', greatest (0, coalesce ((v_merged ->> 'per_shop_limit')::integer, 500)),
    'per_user_limit', greatest (0, coalesce ((v_merged ->> 'per_user_limit')::integer, 100))
  );

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('ai_settings', v_merged, now(), auth.uid ())
  on conflict (key) do update
  set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), 'platform_ai_settings_updated', v_merged);

  return jsonb_build_object ('ok', true, 'settings', v_merged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage log extensions
-- ---------------------------------------------------------------------------

alter table public.ai_generation_usage_log
  add column if not exists feature text,
  add column if not exists success boolean not null default true,
  add column if not exists latency_ms integer,
  add column if not exists estimated_cost_usd numeric(10, 6),
  add column if not exists provider text,
  add column if not exists error_reason text;

update public.ai_generation_usage_log
set feature = kind
where feature is null and kind is not null;

-- ---------------------------------------------------------------------------
-- Usage counting helpers
-- ---------------------------------------------------------------------------

create or replace function public.ai_request_count_this_month (
  p_shop_id uuid default null,
  p_user_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count (*)::integer
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ())
    and (p_shop_id is null or l.shop_id = p_shop_id)
    and (p_user_id is null or l.user_id = p_user_id);
$$;

revoke all on function public.ai_request_count_this_month (uuid, uuid) from public;

create or replace function public.ai_provider_cost_this_month ()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce (sum (l.estimated_cost_usd), 0)::numeric
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ())
    and l.cache_hit = false;
$$;

revoke all on function public.ai_provider_cost_this_month () from public;

create or replace function public.ai_generation_count_this_month ()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.ai_request_count_this_month (null, null);
$$;

-- ---------------------------------------------------------------------------
-- Feature permission check (authoritative for edge functions)
-- ---------------------------------------------------------------------------

create or replace function public.check_ai_feature_allowed (
  p_feature text,
  p_shop_id uuid default null,
  p_user_id uuid default null,
  p_cache_hit boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_enabled boolean;
  v_feature_on boolean;
  v_monthly_limit integer;
  v_budget_limit numeric;
  v_shop_limit integer;
  v_user_limit integer;
  v_requests integer;
  v_shop_requests integer;
  v_user_requests integer;
  v_cost numeric;
begin
  v_settings := public.get_platform_ai_settings ();
  v_enabled := coalesce ((v_settings ->> 'enabled')::boolean, false);

  if not v_enabled then
    return jsonb_build_object ('allowed', false, 'reason', 'ai_platform_disabled', 'code', 'ai_platform_disabled');
  end if;

  v_feature_on := coalesce ((v_settings ->> p_feature)::boolean, false);
  if not v_feature_on then
    return jsonb_build_object ('allowed', false, 'reason', 'AI feature disabled', 'code', 'feature_disabled');
  end if;

  v_monthly_limit := greatest (0, coalesce ((v_settings ->> 'monthly_request_limit')::integer, 20000));
  v_budget_limit := greatest (0, coalesce ((v_settings ->> 'monthly_budget_limit')::numeric, 50));
  v_shop_limit := greatest (0, coalesce ((v_settings ->> 'per_shop_limit')::integer, 500));
  v_user_limit := greatest (0, coalesce ((v_settings ->> 'per_user_limit')::integer, 100));

  v_requests := public.ai_request_count_this_month (null, null);
  if v_requests >= v_monthly_limit then
    return jsonb_build_object ('allowed', false, 'reason', 'Monthly request limit reached', 'code', 'monthly_request_limit_reached');
  end if;

  if not p_cache_hit then
    v_cost := public.ai_provider_cost_this_month ();
    if v_cost >= v_budget_limit then
      return jsonb_build_object ('allowed', false, 'reason', 'Monthly budget limit reached', 'code', 'monthly_budget_limit_reached');
    end if;

    if p_shop_id is not null then
      v_shop_requests := public.ai_request_count_this_month (p_shop_id, null);
      if v_shop_requests >= v_shop_limit then
        return jsonb_build_object ('allowed', false, 'reason', 'Shop monthly limit reached', 'code', 'per_shop_limit_reached');
      end if;
    end if;

    if p_user_id is not null then
      v_user_requests := public.ai_request_count_this_month (null, p_user_id);
      if v_user_requests >= v_user_limit then
        return jsonb_build_object ('allowed', false, 'reason', 'User monthly limit reached', 'code', 'per_user_limit_reached');
      end if;
    end if;
  end if;

  return jsonb_build_object (
    'allowed', true,
    'remaining_requests', greatest (0, v_monthly_limit - v_requests)
  );
end;
$$;

revoke all on function public.check_ai_feature_allowed (text, uuid, uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- Extended logging
-- ---------------------------------------------------------------------------

create or replace function public.log_ai_request (
  p_shop_id uuid,
  p_user_id uuid,
  p_feature text,
  p_kind text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cache_hit boolean,
  p_success boolean,
  p_latency_ms integer,
  p_estimated_cost_usd numeric,
  p_provider text,
  p_error_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_generation_usage_log (
    shop_id,
    user_id,
    kind,
    feature,
    tokens_in,
    tokens_out,
    cache_hit,
    success,
    latency_ms,
    estimated_cost_usd,
    provider,
    error_reason
  )
  values (
    p_shop_id,
    p_user_id,
    coalesce (p_kind, p_feature),
    p_feature,
    p_tokens_in,
    p_tokens_out,
    coalesce (p_cache_hit, false),
    coalesce (p_success, true),
    p_latency_ms,
    p_estimated_cost_usd,
    p_provider,
    nullif (p_error_reason, '')
  );
end;
$$;

revoke all on function public.log_ai_request (uuid, uuid, text, text, integer, integer, boolean, boolean, integer, numeric, text, text) from public;

create or replace function public.log_ai_generation (
  p_shop_id uuid,
  p_user_id uuid,
  p_kind text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cache_hit boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_ai_request (
    p_shop_id,
    p_user_id,
    p_kind,
    p_kind,
    p_tokens_in,
    p_tokens_out,
    p_cache_hit,
    true,
    null,
    null,
    'deepseek',
    null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Metrics dashboard RPC
-- ---------------------------------------------------------------------------

create or replace function public.admin_ai_platform_metrics (p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now () - make_interval (days => greatest (1, least (p_days, 365)));
  v_settings jsonb;
  v_limit integer;
  v_budget numeric;
  v_total integer;
  v_success integer;
  v_failed integer;
  v_cache_hits integer;
  v_cache_misses integer;
  v_cost numeric;
  v_avg_latency numeric;
  v_by_feature jsonb;
  v_by_shop jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_settings := public.get_platform_ai_settings ();
  v_limit := greatest (0, coalesce ((v_settings ->> 'monthly_request_limit')::integer, 20000));
  v_budget := greatest (0, coalesce ((v_settings ->> 'monthly_budget_limit')::numeric, 50));

  select count (*)::integer into v_total
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ());

  select count (*)::integer into v_success
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ()) and l.success = true;

  select count (*)::integer into v_failed
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ()) and l.success = false;

  select count (*)::integer into v_cache_hits
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ()) and l.cache_hit = true;

  v_cache_misses := greatest (0, v_total - v_cache_hits);

  select coalesce (sum (l.estimated_cost_usd), 0) into v_cost
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('month', now ()) and l.cache_hit = false;

  select coalesce (avg (l.latency_ms), 0) into v_avg_latency
  from public.ai_generation_usage_log l
  where l.created_at >= v_since and l.latency_ms is not null;

  select coalesce (jsonb_agg (row_to_json (t)::jsonb), '[]'::jsonb) into v_by_feature
  from (
    select coalesce (l.feature, l.kind, 'unknown') as feature,
           count (*)::integer as count,
           coalesce (sum (l.estimated_cost_usd), 0)::numeric as cost_usd
    from public.ai_generation_usage_log l
    where l.created_at >= v_since
    group by 1
    order by count (*) desc
    limit 20
  ) t;

  select coalesce (jsonb_agg (row_to_json (t)::jsonb), '[]'::jsonb) into v_by_shop
  from (
    select l.shop_id,
           coalesce (s.name, l.shop_id::text) as shop_name,
           count (*)::integer as count
    from public.ai_generation_usage_log l
    left join public.shops s on s.id = l.shop_id
    where l.created_at >= v_since and l.shop_id is not null
    group by l.shop_id, s.name
    order by count (*) desc
    limit 15
  ) t;

  return jsonb_build_object (
    'totals', jsonb_build_object (
      'requests', v_total,
      'successful', v_success,
      'failed', v_failed,
      'cache_hits', v_cache_hits,
      'cache_misses', v_cache_misses,
      'estimated_cost_usd', round (v_cost, 4),
      'avg_latency_ms', round (v_avg_latency)
    ),
    'limits', jsonb_build_object (
      'monthly_request_limit', v_limit,
      'monthly_budget_limit', v_budget,
      'remaining_requests', greatest (0, v_limit - v_total),
      'remaining_budget_usd', greatest (0, v_budget - v_cost)
    ),
    'by_feature', v_by_feature,
    'by_shop', v_by_shop
  );
end;
$$;

revoke all on function public.admin_ai_platform_metrics (integer) from public;
grant execute on function public.admin_ai_platform_metrics (integer) to authenticated;

-- Keep legacy stats RPC but delegate to metrics
create or replace function public.admin_ai_platform_usage_stats ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metrics jsonb;
  v_totals jsonb;
  v_limits jsonb;
begin
  v_metrics := public.admin_ai_platform_metrics (30);
  v_totals := v_metrics -> 'totals';
  v_limits := v_metrics -> 'limits';

  return jsonb_build_object (
    'monthly_limit', (v_limits ->> 'monthly_request_limit')::integer,
    'generations_this_month', (v_totals ->> 'cache_misses')::integer,
    'cache_hits_this_month', (v_totals ->> 'cache_hits')::integer,
    'total_requests_this_month', (v_totals ->> 'requests')::integer,
    'cache_hit_rate_pct', case
      when coalesce ((v_totals ->> 'requests')::integer, 0) = 0 then 0
      else round (
        ((v_totals ->> 'cache_hits')::numeric / (v_totals ->> 'requests')::numeric) * 100,
        1
      )
    end,
    'remaining', (v_limits ->> 'remaining_requests')::integer
  );
end;
$$;
