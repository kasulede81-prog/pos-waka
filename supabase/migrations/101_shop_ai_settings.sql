-- Waka POS — Per-shop AI settings, pilot rollout, admin audit

-- ---------------------------------------------------------------------------
-- Shop AI settings (one row per shop)
-- ---------------------------------------------------------------------------

create table if not exists public.shop_ai_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  ai_enabled boolean not null default false,
  product_assistant boolean not null default false,
  business_setup_assistant boolean not null default false,
  inventory_assistant boolean not null default false,
  marketing_assistant boolean not null default false,
  marketplace_assistant boolean not null default false,
  monthly_request_limit integer not null default 500 check (monthly_request_limit >= 0),
  plan_code text check (plan_code is null or plan_code in ('free', 'standard', 'premium', 'enterprise')),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists shop_ai_settings_ai_enabled_idx
  on public.shop_ai_settings (ai_enabled)
  where ai_enabled = true;

alter table public.shop_ai_settings enable row level security;

drop policy if exists shop_ai_settings_staff_all on public.shop_ai_settings;
create policy shop_ai_settings_staff_all on public.shop_ai_settings
  for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists shop_ai_settings_member_read on public.shop_ai_settings;
create policy shop_ai_settings_member_read on public.shop_ai_settings
  for select
  using (
    exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_ai_settings.shop_id
        and sm.user_id = auth.uid ()
    )
  );

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------

create table if not exists public.ai_admin_audit_log (
  id uuid primary key default gen_random_uuid (),
  actor_id uuid references auth.users (id),
  shop_id uuid references public.shops (id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists ai_admin_audit_log_shop_idx
  on public.ai_admin_audit_log (shop_id, created_at desc);

create index if not exists ai_admin_audit_log_created_idx
  on public.ai_admin_audit_log (created_at desc);

alter table public.ai_admin_audit_log enable row level security;

drop policy if exists ai_admin_audit_log_staff_read on public.ai_admin_audit_log;
create policy ai_admin_audit_log_staff_read on public.ai_admin_audit_log
  for select
  using (public.is_waka_internal_staff ());

-- ---------------------------------------------------------------------------
-- Defaults & normalization
-- ---------------------------------------------------------------------------

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
    'monthly_request_limit', v_limit
  );
  return v;
end;
$$;

create or replace function public.ensure_shop_ai_settings (p_shop_id uuid)
returns public.shop_ai_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_ai_settings;
begin
  if p_shop_id is null then
    return null;
  end if;

  insert into public.shop_ai_settings (shop_id)
  values (p_shop_id)
  on conflict (shop_id) do nothing;

  select * into v_row
  from public.shop_ai_settings sas
  where sas.shop_id = p_shop_id;

  return v_row;
end;
$$;

revoke all on function public.ensure_shop_ai_settings (uuid) from public;

create or replace function public.trg_shops_ensure_ai_settings ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_shop_ai_settings (new.id);
  return new;
end;
$$;

drop trigger if exists shops_ensure_ai_settings on public.shops;
create trigger shops_ensure_ai_settings
  after insert on public.shops
  for each row
  execute function public.trg_shops_ensure_ai_settings ();

-- Backfill existing shops (preserve current open rollout: AI allowed at shop level)
insert into public.shop_ai_settings (
  shop_id,
  ai_enabled,
  product_assistant,
  business_setup_assistant,
  inventory_assistant,
  marketing_assistant,
  marketplace_assistant,
  monthly_request_limit
)
select
  s.id,
  true,
  true,
  true,
  true,
  false,
  false,
  500
from public.shops s
on conflict (shop_id) do nothing;

-- ---------------------------------------------------------------------------
-- Platform settings: pilot rollout mode
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

  if coalesce (v ->> 'provider', '') not in ('deepseek', 'openai', 'gemini', 'claude') then
    v := v || jsonb_build_object ('provider', 'deepseek');
  end if;

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
-- Shop settings read helpers
-- ---------------------------------------------------------------------------

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
    'monthly_request_limit', v_row.monthly_request_limit,
    'plan_code', v_row.plan_code,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_shop_ai_settings_row (uuid) from public;
grant execute on function public.get_shop_ai_settings_row (uuid) to authenticated;

create or replace function public.get_shop_ai_settings_for_member (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_shop_id is null then
    return null;
  end if;

  if not public.is_waka_internal_staff ()
     and not exists (
       select 1
       from public.shop_members sm
       where sm.shop_id = p_shop_id
         and sm.user_id = auth.uid ()
     ) then
    raise exception 'Forbidden';
  end if;

  return public.get_shop_ai_settings_row (p_shop_id);
end;
$$;

revoke all on function public.get_shop_ai_settings_for_member (uuid) from public;
grant execute on function public.get_shop_ai_settings_for_member (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Feature permission check (shop-aware)
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

-- ---------------------------------------------------------------------------
-- Admin: shop AI settings + usage summary
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_shop_ai_settings (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_requests integer;
  v_last_activity timestamptz;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  perform public.ensure_shop_ai_settings (p_shop_id);
  v_settings := public.get_shop_ai_settings_row (p_shop_id);

  select count (*)::integer, max (l.created_at)
  into v_requests, v_last_activity
  from public.ai_generation_usage_log l
  where l.shop_id = p_shop_id
    and l.created_at >= date_trunc ('month', now ());

  return jsonb_build_object (
    'settings', v_settings,
    'usage', jsonb_build_object (
      'requests_this_month', coalesce (v_requests, 0),
      'last_activity_at', v_last_activity
    )
  );
end;
$$;

revoke all on function public.admin_get_shop_ai_settings (uuid) from public;
grant execute on function public.admin_get_shop_ai_settings (uuid) to authenticated;

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
        'monthly_request_limit', v_before.monthly_request_limit
      ),
      'after', jsonb_build_object (
        'ai_enabled', v_after.ai_enabled,
        'product_assistant', v_after.product_assistant,
        'business_setup_assistant', v_after.business_setup_assistant,
        'inventory_assistant', v_after.inventory_assistant,
        'marketing_assistant', v_after.marketing_assistant,
        'marketplace_assistant', v_after.marketplace_assistant,
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

revoke all on function public.admin_update_shop_ai_settings (uuid, jsonb) from public;
grant execute on function public.admin_update_shop_ai_settings (uuid, jsonb) to authenticated;
