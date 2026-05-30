-- Referral reliability: case-normalized codes, public validation, stronger apply + list ordering.

create or replace function public.normalize_referral_code (p_code text)
returns text
language sql
immutable
as $$
  select upper (trim (coalesce (p_code, '')));
$$;

-- Pre-signup / registration validation (no auth required).
create or replace function public.validate_referral_code (p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := public.normalize_referral_code (p_code);
  v_agent public.marketing_agents%rowtype;
begin
  if length (v_norm) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where public.normalize_referral_code (ma.referral_code) = v_norm
    and ma.active
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  return jsonb_build_object (
    'ok', true,
    'referral_code', v_agent.referral_code,
    'agent_name', coalesce (nullif (trim (v_agent.full_name), ''), 'Waka agent')
  );
end;
$$;

revoke all on function public.validate_referral_code (text) from public;
grant execute on function public.validate_referral_code (text) to anon, authenticated;

create or replace function public.apply_referral_code (p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_agent public.marketing_agents%rowtype;
  v_shop_id uuid;
  v_org_id uuid;
  v_email text;
  v_shop_name text;
  v_phone text;
  v_norm text := public.normalize_referral_code (p_code);
  v_existing_agent_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if length (v_norm) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  select ar.agent_id into v_existing_agent_id
  from public.agent_referrals ar
  where ar.referred_user_id = v_uid
  limit 1;

  if v_existing_agent_id is not null then
    return jsonb_build_object (
      'ok', true,
      'already_applied', true,
      'agent_id', v_existing_agent_id
    );
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where public.normalize_referral_code (ma.referral_code) = v_norm
    and ma.active
  limit 1;

  if v_agent.id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;

  if v_agent.user_id = v_uid then
    return jsonb_build_object ('ok', false, 'error', 'self_referral');
  end if;

  select sm.shop_id, s.organization_id, s.name
  into v_shop_id, v_org_id, v_shop_name
  from public.shop_members sm
  join public.shops s on s.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  select u.email into v_email from auth.users u where u.id = v_uid;
  select pr.phone_e164 into v_phone from public.profiles pr where pr.id = v_uid;

  insert into public.agent_referrals (
    agent_id,
    referred_user_id,
    referred_shop_id,
    organization_id,
    shop_name,
    owner_email
  )
  values (
    v_agent.id,
    v_uid,
    v_shop_id,
    v_org_id,
    coalesce (nullif (trim (v_shop_name), ''), 'Shop setting up'),
    coalesce (nullif (trim (v_email), ''), nullif (trim (v_phone), ''))
  );

  return jsonb_build_object (
    'ok', true,
    'agent_id', v_agent.id,
    'referral_id', (
      select ar.id from public.agent_referrals ar
      where ar.referred_user_id = v_uid
      limit 1
    )
  );
end;
$$;

-- Ensure list + count include pending shop setups (newest first).
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
        select jsonb_agg (row_data order by (row_data ->> 'created_at') desc)
        from (
          select jsonb_build_object (
            'id', ar.id,
            'shop_name', coalesce (
              nullif (trim (ar.shop_name), ''),
              nullif (trim (sh.name), ''),
              'Shop setting up'
            ),
            'owner_email', ar.owner_email,
            'owner_phone', coalesce (nullif (trim (sh.phone_e164), ''), nullif (trim (pr.phone_e164), '')),
            'created_at', ar.created_at,
            'shop_id', ar.referred_shop_id,
            'district', sh.district,
            'city', sh.city,
            'latitude', sh.latitude,
            'longitude', sh.longitude,
            'plan_code', sp.code,
            'subscription_status', coalesce (sub.status, 'pending')
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
  select count(*)::bigint into v_count from public.agent_referrals ar where ar.agent_id = v_agent.id;

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

-- Backfill shop context on existing referral rows when user opens agent portal or sync runs.
create or replace function public.sync_agent_referral_shop_context ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_shop_name text;
  v_email text;
  v_phone text;
  v_updated int := 0;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select sm.shop_id, s.organization_id, s.name
  into v_shop_id, v_org_id, v_shop_name
  from public.shop_members sm
  join public.shops s on s.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  select u.email into v_email from auth.users u where u.id = v_uid;
  select pr.phone_e164 into v_phone from public.profiles pr where pr.id = v_uid;

  update public.agent_referrals ar
  set
    referred_shop_id = coalesce (v_shop_id, ar.referred_shop_id),
    organization_id = coalesce (v_org_id, ar.organization_id),
    shop_name = coalesce (nullif (trim (v_shop_name), ''), ar.shop_name),
    owner_email = coalesce (nullif (trim (v_email), ''), ar.owner_email)
  where ar.referred_user_id = v_uid
    and (
      ar.referred_shop_id is distinct from v_shop_id
      or ar.organization_id is distinct from v_org_id
      or (v_shop_name is not null and ar.shop_name is distinct from v_shop_name)
    );

  get diagnostics v_updated = row_count;

  return jsonb_build_object ('ok', true, 'updated', v_updated);
end;
$$;
