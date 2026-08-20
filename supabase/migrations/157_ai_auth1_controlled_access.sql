-- AI-AUTH-1: controlled authorized AI access.
-- Does not add AI products or providers. Does not change POS/checkout/sync/Remote Support.
-- Does not mass-disable existing authorized shops.

-- ---------------------------------------------------------------------------
-- Defaults: selected shops only; role buckets; WAKA plan keys
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
      'starter', 500,
      'business', 5000,
      'enterprise', null
    ),
    'role_access', jsonb_build_object (
      'owner', true,
      'manager', true,
      'cashier', false
    )
  );
$$;

create or replace function public.ai_shop_role_bucket (p_role text)
returns text
language sql
immutable
as $$
  select case lower(replace(coalesce(p_role, ''), '-', '_'))
    when 'owner' then 'owner'
    when 'manager' then 'manager'
    when 'supervisor' then 'manager'
    else 'cashier'
  end;
$$;

create or replace function public.ai_role_is_authorized (p_role text, p_role_access jsonb)
returns boolean
language sql
immutable
as $$
  select case public.ai_shop_role_bucket (p_role)
    when 'owner' then coalesce ((p_role_access ->> 'owner')::boolean, true)
    when 'manager' then coalesce ((p_role_access ->> 'manager')::boolean, true)
    else coalesce ((p_role_access ->> 'cashier')::boolean, false)
  end;
$$;

-- null = unlimited
create or replace function public.ai_plan_request_limit (p_plan text, p_limits jsonb)
returns integer
language plpgsql
immutable
as $$
declare
  v_plan text := lower(coalesce(nullif(trim(p_plan), ''), 'free'));
  v_key text;
  v_raw text;
begin
  v_key := case
    when v_plan in ('waka_plus', 'enterprise') then 'enterprise'
    when v_plan in ('business', 'premium') then 'business'
    when v_plan in ('starter', 'standard') then 'starter'
    else 'free'
  end;

  v_raw := case v_key
    when 'starter' then coalesce (p_limits ->> 'starter', p_limits ->> 'standard')
    when 'business' then coalesce (p_limits ->> 'business', p_limits ->> 'premium')
    else p_limits ->> v_key
  end;

  if v_raw is null or v_raw = '' or v_raw = 'null' then
    return null;
  end if;

  return greatest (0, v_raw::integer);
end;
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
  v_provider text;
  v_limits jsonb;
  v_roles jsonb;
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

  v_limits := coalesce (v -> 'plan_limits', '{}'::jsonb);
  if not (v_limits ? 'starter') and (v_limits ? 'standard') then
    v_limits := v_limits || jsonb_build_object ('starter', v_limits -> 'standard');
  end if;
  if not (v_limits ? 'business') and (v_limits ? 'premium') then
    v_limits := v_limits || jsonb_build_object ('business', v_limits -> 'premium');
  end if;
  if not (v_limits ? 'free') then
    v_limits := v_limits || jsonb_build_object ('free', 50);
  end if;
  if not (v_limits ? 'starter') then
    v_limits := v_limits || jsonb_build_object ('starter', 500);
  end if;
  if not (v_limits ? 'business') then
    v_limits := v_limits || jsonb_build_object ('business', 5000);
  end if;
  if not (v_limits ? 'enterprise') then
    v_limits := v_limits || jsonb_build_object ('enterprise', null);
  end if;
  v := v || jsonb_build_object ('plan_limits', v_limits);

  v_roles := coalesce (v -> 'role_access', '{}'::jsonb);
  v := v || jsonb_build_object (
    'role_access',
    jsonb_build_object (
      'owner', coalesce ((v_roles ->> 'owner')::boolean, true),
      'manager', coalesce ((v_roles ->> 'manager')::boolean, true),
      'cashier', coalesce ((v_roles ->> 'cashier')::boolean, false)
    )
  );

  return v;
end;
$$;

-- New shops: AI off unless pilot auto-enable. Existing rows are unchanged.
create or replace function public.ensure_shop_ai_settings (p_shop_id uuid)
returns public.shop_ai_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_ai_settings;
  v_settings jsonb;
  v_pilot boolean;
  v_auto boolean;
  v_enabled boolean;
begin
  if p_shop_id is null then
    return null;
  end if;

  v_settings := public.get_platform_ai_settings ();
  v_pilot := coalesce ((v_settings ->> 'pilot_rollout_mode')::boolean, false);
  v_auto := coalesce ((v_settings ->> 'pilot_auto_enable_new_shops')::boolean, false);
  v_enabled := case when v_pilot then v_auto else false end;

  insert into public.shop_ai_settings (
    shop_id,
    ai_enabled,
    product_assistant,
    business_setup_assistant,
    inventory_assistant,
    marketing_assistant,
    marketplace_assistant,
    ask_waka,
    monthly_request_limit
  )
  values (
    p_shop_id,
    v_enabled,
    v_enabled,
    v_enabled,
    v_enabled,
    false,
    false,
    false,
    500
  )
  on conflict (shop_id) do nothing;

  select * into v_row
  from public.shop_ai_settings sas
  where sas.shop_id = p_shop_id;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoritative allow check: shop + role + plan cap
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
  v_plan_cap integer;
  v_requests integer;
  v_shop_requests integer;
  v_user_requests integer;
  v_cost numeric;
  v_member_role text;
  v_internal boolean := false;
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

  if p_shop_id is null then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Shop is not authorized for AI',
      'code', 'shop_not_authorized'
    );
  end if;

  v_pilot := coalesce ((v_settings ->> 'pilot_rollout_mode')::boolean, false);
  v_shop := public.get_shop_ai_settings_row (p_shop_id);

  if v_shop is null then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Shop is not authorized for AI',
      'code', case when v_pilot then 'pilot_not_approved' else 'shop_not_authorized' end
    );
  end if;

  if coalesce ((v_shop ->> 'ai_enabled')::boolean, false) = false then
    return jsonb_build_object (
      'allowed', false,
      'reason', case when v_pilot then 'Shop is not approved for AI pilot' else 'Shop AI disabled' end,
      'code', case when v_pilot then 'pilot_not_approved' else 'shop_ai_disabled' end
    );
  end if;

  v_shop_feature_on := coalesce ((v_shop ->> p_feature)::boolean, false);
  if not v_shop_feature_on then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'AI feature disabled for this shop',
      'code', 'shop_feature_disabled'
    );
  end if;

  if p_user_id is null then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Your role is not authorized for AI',
      'code', 'user_not_authorized'
    );
  end if;

  select exists (
    select 1
    from public.internal_admins ia
    where coalesce (ia.auth_user_id, ia.user_id) = p_user_id
      and coalesce (ia.is_active, ia.active, true) = true
  ) into v_internal;

  if not v_internal then
    select sm.role into v_member_role
    from public.shop_members sm
    where sm.shop_id = p_shop_id
      and sm.user_id = p_user_id
    limit 1;

    if v_member_role is null then
      return jsonb_build_object (
        'allowed', false,
        'reason', 'Your role is not authorized for AI',
        'code', 'user_not_authorized'
      );
    end if;

    if not public.ai_role_is_authorized (v_member_role, v_settings -> 'role_access') then
      return jsonb_build_object (
        'allowed', false,
        'reason', 'Your role is not authorized for AI',
        'code', 'user_not_authorized'
      );
    end if;
  end if;

  v_shop_monthly_limit := greatest (0, coalesce ((v_shop ->> 'monthly_request_limit')::integer, 0));
  v_shop_requests := public.ai_request_count_this_month (p_shop_id, null);

  if v_shop_monthly_limit > 0 and v_shop_requests >= v_shop_monthly_limit then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Shop monthly AI limit reached',
      'code', 'shop_monthly_limit_reached'
    );
  end if;

  v_plan_cap := public.ai_plan_request_limit (
    public.shop_effective_plan_code (p_shop_id),
    v_settings -> 'plan_limits'
  );
  if v_plan_cap is not null and v_shop_requests >= v_plan_cap then
    return jsonb_build_object (
      'allowed', false,
      'reason', 'Plan AI request limit reached',
      'code', 'plan_limit_reached'
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

    if v_shop_requests >= v_shop_limit then
      return jsonb_build_object ('allowed', false, 'reason', 'Shop monthly limit reached', 'code', 'per_shop_limit_reached');
    end if;

    v_user_requests := public.ai_request_count_this_month (null, p_user_id);
    if v_user_requests >= v_user_limit then
      return jsonb_build_object ('allowed', false, 'reason', 'User monthly limit reached', 'code', 'per_user_limit_reached');
    end if;
  end if;

  return jsonb_build_object (
    'allowed', true,
    'remaining_requests', greatest (0, v_monthly_limit - v_requests)
  );
end;
$$;

revoke all on function public.check_ai_feature_allowed (text, uuid, uuid, boolean) from public;
revoke all on function public.ai_shop_role_bucket (text) from public;
revoke all on function public.ai_role_is_authorized (text, jsonb) from public;
revoke all on function public.ai_plan_request_limit (text, jsonb) from public;

grant execute on function public.ai_shop_role_bucket (text) to authenticated;
grant execute on function public.ai_role_is_authorized (text, jsonb) to authenticated;
grant execute on function public.ai_plan_request_limit (text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Control Center: authorized shops + users (role policy + usage this month)
-- ---------------------------------------------------------------------------

create or replace function public.admin_ai_authorization_snapshot ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_roles jsonb;
  v_shops jsonb;
  v_users jsonb;
  v_shop_count integer;
  v_user_count integer;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_settings := public.get_platform_ai_settings ();
  v_roles := coalesce (v_settings -> 'role_access', '{}'::jsonb);

  select count (*)::integer into v_shop_count
  from public.shop_ai_settings sas
  where sas.ai_enabled = true;

  select coalesce (jsonb_agg (row_to_json (t)::jsonb), '[]'::jsonb) into v_shops
  from (
    select
      s.id as shop_id,
      coalesce (s.name, s.id::text) as shop_name,
      sas.product_assistant,
      sas.inventory_assistant,
      sas.business_setup_assistant,
      sas.ask_waka,
      sas.monthly_request_limit,
      public.shop_effective_plan_code (s.id) as plan_code,
      public.ai_request_count_this_month (s.id, null) as requests_this_month
    from public.shop_ai_settings sas
    join public.shops s on s.id = sas.shop_id
    where sas.ai_enabled = true
    order by s.name nulls last
    limit 200
  ) t;

  select count (*)::integer into v_user_count
  from public.shop_members sm
  join public.shop_ai_settings sas on sas.shop_id = sm.shop_id and sas.ai_enabled = true
  where public.ai_role_is_authorized (sm.role, v_roles);

  select coalesce (jsonb_agg (row_to_json (t)::jsonb), '[]'::jsonb) into v_users
  from (
    select
      sm.user_id,
      coalesce (nullif (trim (pr.full_name), ''), sm.user_id::text) as full_name,
      sm.role,
      public.ai_shop_role_bucket (sm.role) as role_bucket,
      s.id as shop_id,
      coalesce (s.name, s.id::text) as shop_name,
      public.ai_request_count_this_month (sm.shop_id, sm.user_id) as requests_this_month
    from public.shop_members sm
    join public.shop_ai_settings sas on sas.shop_id = sm.shop_id and sas.ai_enabled = true
    join public.shops s on s.id = sm.shop_id
    left join public.profiles pr on pr.id = sm.user_id
    where public.ai_role_is_authorized (sm.role, v_roles)
    order by public.ai_request_count_this_month (sm.shop_id, sm.user_id) desc, pr.full_name nulls last
    limit 100
  ) t;

  return jsonb_build_object (
    'enabled', coalesce ((v_settings ->> 'enabled')::boolean, false),
    'role_access', jsonb_build_object (
      'owner', coalesce ((v_roles ->> 'owner')::boolean, true),
      'manager', coalesce ((v_roles ->> 'manager')::boolean, true),
      'cashier', coalesce ((v_roles ->> 'cashier')::boolean, false)
    ),
    'authorized_shop_count', coalesce (v_shop_count, 0),
    'authorized_user_count', coalesce (v_user_count, 0),
    'authorized_shops', v_shops,
    'authorized_users', v_users
  );
end;
$$;

revoke all on function public.admin_ai_authorization_snapshot () from public;
grant execute on function public.admin_ai_authorization_snapshot () to authenticated;
