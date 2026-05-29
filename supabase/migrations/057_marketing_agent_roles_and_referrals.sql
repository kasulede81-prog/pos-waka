-- Agent roles (multiple), richer referral list (phone + plan), agent VIP/trial upgrades for referred shops.

alter table public.marketing_agents
  add column if not exists roles text[] not null default array['field_agent']::text[];

update public.marketing_agents
set roles = array['field_agent']::text[]
where roles is null or cardinality (roles) = 0;

create or replace function public._normalize_agent_roles (p_roles text[])
returns text[]
language sql
immutable
as $$
  select coalesce (
    (
      select array_agg(distinct r order by r)
      from (
        select unnest (coalesce (p_roles, array[]::text[])) as r
      ) x
      where r in ('trial_agent', 'vip_agent', 'field_agent')
    ),
    array['field_agent']::text[]
  );
$$;

create or replace function public.internal_set_marketing_agent_roles (
  p_agent_id uuid,
  p_roles text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles text[] := public._normalize_agent_roles (p_roles);
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_agent_id is null then
    return jsonb_build_object ('ok', false, 'error', 'agent_required');
  end if;

  update public.marketing_agents ma
  set roles = v_roles, updated_at = now ()
  where ma.id = p_agent_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'agent_not_found');
  end if;

  return jsonb_build_object ('ok', true, 'roles', to_jsonb (v_roles));
end;
$$;

revoke all on function public.internal_set_marketing_agent_roles (uuid, text[]) from public;
grant execute on function public.internal_set_marketing_agent_roles (uuid, text[]) to authenticated;

create or replace function public.internal_list_marketing_agents ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce (
    (
      select jsonb_agg (
        jsonb_build_object (
          'id', ma.id,
          'referral_code', ma.referral_code,
          'full_name', ma.full_name,
          'email', ma.email,
          'phone_e164', ma.phone_e164,
          'active', ma.active,
          'roles', ma.roles,
          'referral_count', (select count(*)::int from public.agent_referrals ar where ar.agent_id = ma.id),
          'created_at', ma.created_at,
          'shop_id', own.shop_id,
          'shop_name', own.shop_name
        )
        order by ma.created_at desc
      )
      from public.marketing_agents ma
      left join lateral (
        select s.id as shop_id, s.name as shop_name
        from public.shop_members sm
        join public.shops s on s.id = sm.shop_id
        where sm.user_id = ma.user_id
        order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
        limit 1
      ) own on true
    ),
    '[]'::jsonb
  );
end;
$$;

drop function if exists public.internal_grant_marketing_agent_by_shop (uuid);

create or replace function public.internal_grant_marketing_agent_by_shop (
  p_shop_id uuid,
  p_roles text[] default array['trial_agent', 'field_agent']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_id uuid;
  v_email text;
  v_name text;
  v_phone text;
  v_shop_name text;
  v_roles text[] := public._normalize_agent_roles (p_roles);
  v_try int := 0;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  select s.name into v_shop_name from public.shops s where s.id = p_shop_id;
  if v_shop_name is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select sm.user_id into v_uid
  from public.shop_members sm
  where sm.shop_id = p_shop_id
  order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'no_owner');
  end if;

  select lower (trim (u.email)) into v_email from auth.users u where u.id = v_uid;
  select nullif (trim (pr.full_name), ''), nullif (trim (pr.phone_e164), '')
  into v_name, v_phone
  from public.profiles pr
  where pr.id = v_uid;

  if exists (select 1 from public.marketing_agents ma where ma.user_id = v_uid and ma.active) then
    select ma.id, ma.referral_code into v_id, v_code
    from public.marketing_agents ma
    where ma.user_id = v_uid and ma.active
    limit 1;

    update public.marketing_agents ma
    set roles = v_roles, updated_at = now ()
    where ma.id = v_id;

    return jsonb_build_object (
      'ok', true,
      'id', v_id,
      'referral_code', v_code,
      'already_agent', true,
      'shop_name', v_shop_name,
      'roles', to_jsonb (v_roles)
    );
  end if;

  loop
    v_try := v_try + 1;
    v_code := 'WAKA-' || upper (substr (replace (gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.marketing_agents ma where ma.referral_code = v_code);
    if v_try > 12 then
      return jsonb_build_object ('ok', false, 'error', 'code_generation_failed');
    end if;
  end loop;

  insert into public.marketing_agents (user_id, referral_code, email, full_name, phone_e164, active, roles)
  values (v_uid, v_code, v_email, v_name, v_phone, true, v_roles)
  returning id into v_id;

  return jsonb_build_object (
    'ok', true,
    'id', v_id,
    'referral_code', v_code,
    'user_id', v_uid,
    'shop_name', v_shop_name,
    'roles', to_jsonb (v_roles)
  );
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'already_agent');
end;
$$;

revoke all on function public.internal_grant_marketing_agent_by_shop (uuid, text[]) from public;
grant execute on function public.internal_grant_marketing_agent_by_shop (uuid, text[]) to authenticated;

create or replace function public.marketing_agent_me ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.marketing_agents%rowtype;
  v_count bigint;
  v_roles text[];
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where ma.user_id = auth.uid () and ma.active
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_agent');
  end if;

  v_roles := public._normalize_agent_roles (v_agent.roles);
  select count(*) into v_count from public.agent_referrals ar where ar.agent_id = v_agent.id;

  return jsonb_build_object (
    'ok', true,
    'referral_code', v_agent.referral_code,
    'full_name', v_agent.full_name,
    'referral_count', v_count,
    'roles', to_jsonb (v_roles),
    'can_activate_trial', 'trial_agent' = any (v_roles) or 'vip_agent' = any (v_roles),
    'can_activate_vip', 'vip_agent' = any (v_roles)
  );
end;
$$;

create or replace function public.list_agent_referrals (p_agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid := p_agent_id;
  v_is_staff boolean := public.is_waka_internal_staff ();
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if v_agent_id is null then
    select ma.id into v_agent_id
    from public.marketing_agents ma
    where ma.user_id = auth.uid () and ma.active
    limit 1;
  elsif not v_is_staff then
    if not exists (
      select 1 from public.marketing_agents ma
      where ma.id = v_agent_id and ma.user_id = auth.uid () and ma.active
    ) then
      return jsonb_build_object ('ok', false, 'error', 'forbidden');
    end if;
  end if;

  if v_agent_id is null then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object (
    'ok', true,
    'rows', coalesce (
      (
        select jsonb_agg (row_data order by row_data ->> 'created_at' desc)
        from (
          select jsonb_build_object (
            'id', ar.id,
            'shop_name', coalesce (nullif (trim (ar.shop_name), ''), nullif (trim (sh.name), '')),
            'owner_email', ar.owner_email,
            'owner_phone', coalesce (nullif (trim (sh.phone_e164), ''), nullif (trim (pr.phone_e164), '')),
            'created_at', ar.created_at,
            'shop_id', ar.referred_shop_id,
            'district', sh.district,
            'city', sh.city,
            'latitude', sh.latitude,
            'longitude', sh.longitude,
            'plan_code', sp.code,
            'subscription_status', sub.status
          ) as row_data
          from public.agent_referrals ar
          left join public.shops sh on sh.id = ar.referred_shop_id
          left join public.profiles pr on pr.id = ar.referred_user_id
          left join lateral (
            select s.id, s.status, s.plan_id
            from public.subscriptions s
            where s.organization_id = ar.organization_id
            order by s.created_at desc
            limit 1
          ) sub on true
          left join public.subscription_plans sp on sp.id = sub.plan_id
          where ar.agent_id = v_agent_id
        ) t
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- Agent upgrades a referred shop plan (VIP agent → business/waka_plus; trial agent → starter).
create or replace function public.marketing_agent_upgrade_referral_plan (
  p_referral_id uuid,
  p_plan_code text,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.marketing_agents%rowtype;
  v_ref public.agent_referrals%rowtype;
  v_plan_code text := lower (trim (coalesce (p_plan_code, '')));
  v_days integer := greatest (1, coalesce (p_days, 30));
  v_roles text[];
  v_shop_id uuid;
  v_org uuid;
  v_plan uuid;
  v_sub_id uuid;
  v_period_end timestamptz;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where ma.user_id = auth.uid () and ma.active
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_agent');
  end if;

  v_roles := public._normalize_agent_roles (v_agent.roles);

  select * into v_ref
  from public.agent_referrals ar
  where ar.id = p_referral_id and ar.agent_id = v_agent.id;

  if v_ref.id is null then
    return jsonb_build_object ('ok', false, 'error', 'referral_not_found');
  end if;

  v_shop_id := v_ref.referred_shop_id;
  v_org := v_ref.organization_id;

  if v_shop_id is null or v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_ready');
  end if;

  if v_plan_code not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  if v_plan_code = 'starter' then
    if not ('trial_agent' = any (v_roles) or 'vip_agent' = any (v_roles)) then
      return jsonb_build_object ('ok', false, 'error', 'role_forbidden');
    end if;
  else
    if not ('vip_agent' = any (v_roles)) then
      return jsonb_build_object ('ok', false, 'error', 'vip_role_required');
    end if;
  end if;

  select sp.id into v_plan
  from public.subscription_plans sp
  where sp.code = v_plan_code and sp.is_active
  limit 1;

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_found');
  end if;

  select s.id into v_sub_id
  from public.subscriptions s
  where s.organization_id = v_org
  order by s.created_at desc
  limit 1;

  v_period_end := now () + (v_days::text || ' days')::interval;

  if v_sub_id is null then
    insert into public.subscriptions (
      organization_id, shop_id, plan_id, status, billing_interval,
      trial_ends_at, current_period_start, current_period_end,
      payment_status, external_provider, activation_source, metadata
    )
    values (
      v_org, v_shop_id, v_plan, 'active', 'month',
      case when v_plan_code = 'starter' then v_period_end else null end,
      now (), v_period_end,
      'paid', 'agent_referral', 'agent_referral',
      jsonb_build_object (
        'agent_id', v_agent.id,
        'referral_id', v_ref.id,
        'plan_code', v_plan_code,
        'days', v_days
      )
    )
    returning id into v_sub_id;
  else
    update public.subscriptions s
    set
      shop_id = coalesce (s.shop_id, v_shop_id),
      plan_id = v_plan,
      status = 'active',
      trial_ends_at = case when v_plan_code = 'starter' then v_period_end else null end,
      current_period_start = now (),
      current_period_end = v_period_end,
      payment_status = 'paid',
      external_provider = 'agent_referral',
      activation_source = 'agent_referral',
      updated_at = now (),
      metadata = coalesce (s.metadata, '{}'::jsonb)
        || jsonb_build_object (
          'agent_id', v_agent.id,
          'referral_id', v_ref.id,
          'plan_code', v_plan_code,
          'days', v_days
        )
    where s.id = v_sub_id;
  end if;

  return jsonb_build_object (
    'ok', true,
    'plan_code', v_plan_code,
    'subscription_id', v_sub_id,
    'shop_id', v_shop_id
  );
end;
$$;

revoke all on function public.marketing_agent_upgrade_referral_plan (uuid, text, integer) from public;
grant execute on function public.marketing_agent_upgrade_referral_plan (uuid, text, integer) to authenticated;
