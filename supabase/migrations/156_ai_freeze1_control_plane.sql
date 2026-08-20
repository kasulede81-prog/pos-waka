-- AI-FREEZE-1: control-plane hardening.
-- Does not add AI products or providers. Does not change POS/checkout/sync.
-- Default remains fail-closed (enabled false in platform_default_ai_settings).

-- ---------------------------------------------------------------------------
-- shop_ai_settings: staff read-only; writes only via security-definer RPCs
-- ---------------------------------------------------------------------------

drop policy if exists shop_ai_settings_staff_all on public.shop_ai_settings;

drop policy if exists shop_ai_settings_staff_read on public.shop_ai_settings;
create policy shop_ai_settings_staff_read on public.shop_ai_settings
  for select
  using (public.is_waka_internal_staff ());

revoke insert, update, delete on table public.shop_ai_settings from anon;
revoke insert, update, delete on table public.shop_ai_settings from authenticated;
grant select on table public.shop_ai_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Live feature allowlist (Edge + RPC). Coming-soon flags cannot enable spend.
-- ---------------------------------------------------------------------------

create or replace function public.ai_is_live_feature (p_feature text)
returns boolean
language sql
immutable
as $$
  select p_feature in (
    'product_assistant',
    'business_setup_assistant',
    'inventory_assistant',
    'ask_waka'
  );
$$;

revoke all on function public.ai_is_live_feature (text) from public;
grant execute on function public.ai_is_live_feature (text) to authenticated;

-- ---------------------------------------------------------------------------
-- Normalize: coerce unimplemented providers; force undeployed feature flags off
-- ---------------------------------------------------------------------------

create or replace function public.normalize_ai_settings (p_raw jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v jsonb := public.platform_default_ai_settings () || coalesce (p_raw, '{}'::jsonb);
  v_enabled boolean;
  v_model text;
  v_provider text;
begin
  v_enabled := coalesce (
    (v ->> 'enabled')::boolean,
    (v ->> 'ai_enabled')::boolean,
    false
  );

  v := v || jsonb_build_object (
    'enabled', v_enabled,
    'schema_version', 2,
    'pilot_rollout_mode', coalesce ((v ->> 'pilot_rollout_mode')::boolean, false),
    'pilot_auto_enable_new_shops', coalesce ((v ->> 'pilot_auto_enable_new_shops')::boolean, false)
  );

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

  v_provider := lower (coalesce (v ->> 'provider', 'deepseek'));
  -- ollama remains valid for staging/dev JSON; unimplemented cloud providers coerce to deepseek
  if v_provider not in ('deepseek', 'ollama') then
    v_provider := 'deepseek';
  end if;
  v := v || jsonb_build_object ('provider', v_provider);

  v := v || jsonb_build_object (
    'product_scanner', false,
    'ocr', false,
    'barcode_detection', false,
    'restock_suggestions', false,
    'marketing_assistant', false,
    'marketplace_assistant', false
  );

  if not (v ? 'plan_limits') then
    v := v || jsonb_build_object (
      'plan_limits',
      jsonb_build_object (
        'free', 50,
        'standard', 500,
        'premium', 5000,
        'enterprise', null
      )
    );
  end if;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative allow check: reject undeployed features before spend
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
  v_shop jsonb;
  v_pilot boolean;
  v_enabled boolean;
  v_feature_on boolean;
  v_shop_feature_on boolean;
  v_monthly_limit integer;
  v_budget_limit numeric;
  v_shop_limit integer;
  v_user_limit integer;
  v_shop_monthly_limit integer;
  v_requests integer;
  v_shop_requests integer;
  v_user_requests integer;
  v_cost numeric;
  v_has_shop_row boolean := false;
begin
  v_settings := public.get_platform_ai_settings ();
  v_enabled := coalesce ((v_settings ->> 'enabled')::boolean, false);

  if not v_enabled then
    return jsonb_build_object ('allowed', false, 'reason', 'AI platform is disabled.', 'code', 'ai_platform_disabled');
  end if;

  if not public.ai_is_live_feature (p_feature) then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'AI feature is not deployed',
      'code', 'feature_not_deployed'
    );
  end if;

  v_feature_on := coalesce ((v_settings ->> p_feature)::boolean, false);
  if not v_feature_on then
    return jsonb_build_object ('allowed', false, 'reason', 'AI feature disabled', 'code', 'feature_disabled');
  end if;

  v_pilot := coalesce ((v_settings ->> 'pilot_rollout_mode')::boolean, false);

  if p_shop_id is not null then
    v_shop := public.get_shop_ai_settings_row (p_shop_id);
    v_has_shop_row := v_shop is not null;

    if v_pilot then
      if not v_has_shop_row or coalesce ((v_shop ->> 'ai_enabled')::boolean, false) = false then
        return jsonb_build_object (
          'allowed', false,
          'reason', 'Shop is not approved for AI pilot',
          'code', 'pilot_not_approved'
        );
      end if;
    elsif v_has_shop_row and coalesce ((v_shop ->> 'ai_enabled')::boolean, false) = false then
      return jsonb_build_object (
        'allowed', false,
        'reason', 'Shop AI disabled',
        'code', 'shop_ai_disabled'
      );
    end if;

    if v_has_shop_row then
      v_shop_feature_on := coalesce ((v_shop ->> p_feature)::boolean, false);
      if not v_shop_feature_on then
        return jsonb_build_object (
          'allowed', false,
          'reason', 'AI feature disabled for this shop',
          'code', 'shop_feature_disabled'
        );
      end if;

      v_shop_monthly_limit := greatest (0, coalesce ((v_shop ->> 'monthly_request_limit')::integer, 0));
      if v_shop_monthly_limit > 0 then
        v_shop_requests := public.ai_request_count_this_month (p_shop_id, null);
        if v_shop_requests >= v_shop_monthly_limit then
          return jsonb_build_object (
            'allowed', false,
            'reason', 'Shop monthly AI limit reached',
            'code', 'shop_monthly_limit_reached'
          );
        end if;
      end if;
    end if;
  elsif v_pilot then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Shop is not approved for AI pilot',
      'code', 'pilot_not_approved'
    );
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
-- Shop AI update: never persist undeployed feature columns as on
-- ---------------------------------------------------------------------------

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
    marketing_assistant = false,
    marketplace_assistant = false,
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
-- Usage dashboard: today + error_reason aggregates (no prompts / secrets)
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
  v_by_error jsonb;
  v_today_requests integer;
  v_today_failed integer;
  v_today_cost numeric;
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

  select count (*)::integer,
         count (*) filter (where l.success = false)::integer,
         coalesce (sum (l.estimated_cost_usd) filter (where l.cache_hit = false), 0)
  into v_today_requests, v_today_failed, v_today_cost
  from public.ai_generation_usage_log l
  where l.created_at >= date_trunc ('day', now ());

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

  select coalesce (jsonb_agg (row_to_json (t)::jsonb), '[]'::jsonb) into v_by_error
  from (
    select left (coalesce (nullif (trim (l.error_reason), ''), 'unknown'), 120) as reason,
           count (*)::integer as count
    from public.ai_generation_usage_log l
    where l.created_at >= v_since and l.success = false
    group by 1
    order by count (*) desc
    limit 10
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
    'today', jsonb_build_object (
      'requests', coalesce (v_today_requests, 0),
      'failed', coalesce (v_today_failed, 0),
      'estimated_cost_usd', round (coalesce (v_today_cost, 0), 4)
    ),
    'limits', jsonb_build_object (
      'monthly_request_limit', v_limit,
      'monthly_budget_limit', v_budget,
      'remaining_requests', greatest (0, v_limit - v_total),
      'remaining_budget_usd', greatest (0, v_budget - v_cost)
    ),
    'by_feature', v_by_feature,
    'by_shop', v_by_shop,
    'by_error', v_by_error
  );
end;
$$;
