-- Phase 16.4 — Enterprise Subscription Foundation
-- Unified server-side effective subscription resolution (mirrors effectiveSubscription.ts).
-- Removes bootstrap / onboarding subscription race; aligns trial + promotional grant logic.

-- ---------------------------------------------------------------------------
-- Plan normalization (shared helper)
-- ---------------------------------------------------------------------------

create or replace function public._normalize_plan_code (p_code text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_code, 'free')))
    when 'free' then 'free'
    when 'free_mode' then 'free'
    when 'starter' then 'starter'
    when 'business' then 'business'
    when 'waka_plus' then 'waka_plus'
    when 'waka plus' then 'waka_plus'
    else 'starter'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Active promotional grant tier for an organization (upgrade overlay)
-- ---------------------------------------------------------------------------

create or replace function public._resolve_promotional_grant_tier (p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_org_id is null then
    return null;
  end if;

  select public._normalize_plan_code (pg.plan_code)
  into v_code
  from public.promotional_grants pg
  where pg.organization_id = p_org_id
    and pg.revoked_at is null
    and pg.expires_at > now()
  order by pg.expires_at desc
  limit 1;

  if v_code is null or v_code = 'free' then
    return null;
  end if;

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Base subscription tier from subscriptions row (before promotional overlay)
-- Mirrors resolveBaseSubscription in effectiveSubscription.ts
-- ---------------------------------------------------------------------------

create or replace function public._resolve_subscription_base_tier (
  p_status text,
  p_plan_code text,
  p_trial_ends_at timestamptz,
  p_period_end timestamptz
)
returns text
language plpgsql
stable
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_plan text := public._normalize_plan_code (p_plan_code);
begin
  if v_status = 'expired' then
    return 'free';
  end if;

  if v_status in ('trial', 'trialing') then
    if p_trial_ends_at is not null and p_trial_ends_at <= now() then
      return 'free';
    end if;
    if v_plan = 'free' then
      return 'free';
    end if;
    return v_plan;
  end if;

  if v_status = 'active' and p_period_end is not null and p_period_end <= now() then
    return 'free';
  end if;

  return v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Effective plan tier: promotional grant (upgrade only) → subscription base → free
-- ---------------------------------------------------------------------------

create or replace function public.shop_effective_plan_code (p_shop_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
  v_code text;
  v_trial_ends timestamptz;
  v_period_end timestamptz;
  v_base text;
  v_grant text;
begin
  v_org := public.shop_org_id(p_shop_id);
  if v_org is null then
    return 'free';
  end if;

  select sub.status, sp.code, sub.trial_ends_at, sub.current_period_end
  into v_status, v_code, v_trial_ends, v_period_end
  from public.subscriptions sub
  join public.subscription_plans sp on sp.id = sub.plan_id
  where sub.organization_id = v_org
  order by sub.created_at desc
  limit 1;

  v_base := public._resolve_subscription_base_tier(v_status, v_code, v_trial_ends, v_period_end);
  v_grant := public._resolve_promotional_grant_tier(v_org);

  if v_grant is not null and public._plan_rank(v_grant) > public._plan_rank(v_base) then
    return v_grant;
  end if;

  return coalesce(v_base, 'free');
end;
$$;

-- ---------------------------------------------------------------------------
-- Device limits consume effective plan tier (not raw subscription row plan)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_shop_device_limit (p_shop_id uuid)
returns table (
  device_limit int,
  plan_code text,
  plan_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_effective text;
  v_features jsonb;
  v_devices jsonb;
  v_limit int;
begin
  if p_shop_id is null then
    return;
  end if;

  v_effective := public.shop_effective_plan_code(p_shop_id);

  select sp.features, sp.code, sp.name
  into v_features, plan_code, plan_name
  from public.subscription_plans sp
  where sp.code = v_effective and sp.is_active
  limit 1;

  if plan_code is null then
    plan_code := coalesce(v_effective, 'free');
    plan_name := initcap(replace(plan_code, '_', ' '));
    device_limit := public._plan_default_device_limit(plan_code);
    return next;
    return;
  end if;

  v_devices := v_features -> 'devices';
  if jsonb_typeof(v_devices) = 'number' then
    v_limit := (v_devices #>> '{}')::int;
  elsif jsonb_typeof(v_devices) = 'string' then
    v_limit := nullif(trim(both '"' from v_devices::text), '')::int;
  else
    v_limit := null;
  end if;

  if v_limit is null or v_limit <= 0 then
    device_limit := public._plan_default_device_limit(plan_code);
  else
    device_limit := v_limit;
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap conflict resolution: subscription init owned by bootstrap_owner_workspace only
-- save_owner_business_profile_bundle must NOT create competing subscription rows.
-- ---------------------------------------------------------------------------

create or replace function public.save_owner_business_profile_bundle (
  p_shop_name text,
  p_business_type text,
  p_district_id uuid,
  p_phone_e164 text,
  p_currency text,
  p_address text default null,
  p_city text default null,
  p_area text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop_id uuid;
  v_org_id uuid;
  v_district_name text;
  v_cur text := upper (trim (coalesce (p_currency, 'UGX')));
  v_phone text;
  v_bt text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_owner_name text := coalesce (nullif (trim (p_shop_name), ''), 'Owner');
  v_shop_label text := coalesce (nullif (trim (p_shop_name), ''), 'Main Shop');
  v_onboarding jsonb;
  v_auth_email text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  v_onboarding := public.owner_onboarding_status ();
  if coalesce ((v_onboarding ->> 'complete')::boolean, false) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'profile_locked',
      'detail',
      'Shop details are locked. Contact Waka support to change them.'
    );
  end if;

  if v_cur !~ '^[A-Z]{3}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_currency');
  end if;

  v_phone := trim (coalesce (p_phone_e164, ''));
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  if exists (
    select 1
    from public.profiles pr
    where pr.phone_e164 = v_phone
      and pr.id <> v_uid
  ) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'phone_in_use',
      'detail',
      'This phone number is already registered to another Waka account.'
    );
  end if;

  if p_district_id is null then
    return jsonb_build_object ('ok', false, 'error', 'district_required');
  end if;

  if not public.is_valid_shop_business_type (v_bt) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'invalid_business_type',
      'detail',
      format ('Unknown business type: %s', v_bt)
    );
  end if;

  select d.name into v_district_name
  from public.districts d
  where d.id = p_district_id
  limit 1;

  select lower (trim (u.email))
  into v_auth_email
  from auth.users u
  where u.id = v_uid;

  insert into public.profiles (id, full_name, phone_e164, business_name, email)
  values (
    v_uid,
    v_owner_name,
    v_phone,
    nullif (trim (p_shop_name), ''),
    nullif (v_auth_email, '')
  )
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (public.profiles.full_name), ''), excluded.full_name),
      phone_e164 = excluded.phone_e164,
      business_name = coalesce (excluded.business_name, public.profiles.business_name),
      email = coalesce (
        nullif (lower (trim (public.profiles.email)), ''),
        nullif (v_auth_email, ''),
        public.profiles.email
      ),
      updated_at = now ();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, default_currency, created_by)
    values (coalesce (nullif (trim (p_shop_name), ''), 'My Shop'), v_bt, v_cur, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce (public.organization_members.profile_id, excluded.profile_id);

  select sh.id
  into v_shop_id
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  if v_shop_id is null then
    select sh.id
    into v_shop_id
    from public.shops sh
    where sh.organization_id = v_org_id
    order by sh.created_at asc
    limit 1;
  end if;

  if v_shop_id is null then
    insert into public.shops (
      organization_id,
      name,
      business_type,
      is_active,
      district_id,
      district,
      city,
      area,
      phone_e164,
      address_line,
      latitude,
      longitude,
      gps_missing
    )
    values (
      v_org_id,
      v_shop_label,
      v_bt,
      true,
      p_district_id,
      v_district_name,
      nullif (trim (p_city), ''),
      nullif (trim (p_area), ''),
      v_phone,
      nullif (trim (p_address), ''),
      p_latitude,
      p_longitude,
      (p_latitude is null or p_longitude is null)
    )
    returning id into v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  update public.organizations o
  set
    name = coalesce (nullif (trim (p_shop_name), ''), o.name),
    business_type = v_bt,
    default_currency = v_cur,
    updated_at = now ()
  where o.id = v_org_id;

  update public.shops sh
  set
    name = coalesce (nullif (trim (p_shop_name), ''), sh.name),
    business_type = v_bt,
    district_id = p_district_id,
    district = coalesce (v_district_name, sh.district),
    city = nullif (trim (p_city), ''),
    area = nullif (trim (p_area), ''),
    phone_e164 = v_phone,
    address_line = nullif (trim (p_address), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    gps_missing = (p_latitude is null or p_longitude is null),
    updated_at = now ()
  where sh.id = v_shop_id;

  -- Subscription initialization is owned exclusively by bootstrap_owner_workspace.
  -- Do not insert subscription rows here — prevents race with Business trial bootstrap.

  return jsonb_build_object ('ok', true, 'shop_id', v_shop_id, 'organization_id', v_org_id);
exception
  when unique_violation then
    if sqlerrm ilike '%profiles_phone_e164%' then
      return jsonb_build_object (
        'ok',
        false,
        'error',
        'phone_in_use',
        'detail',
        'This phone number is already registered to another Waka account.'
      );
    end if;
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public._normalize_plan_code (text) from public;
grant execute on function public._normalize_plan_code (text) to authenticated;

revoke all on function public._resolve_promotional_grant_tier (uuid) from public;
grant execute on function public._resolve_promotional_grant_tier (uuid) to authenticated;

revoke all on function public._resolve_subscription_base_tier (text, text, timestamptz, timestamptz) from public;
grant execute on function public._resolve_subscription_base_tier (text, text, timestamptz, timestamptz) to authenticated;

grant execute on function public.shop_effective_plan_code (uuid) to authenticated;
grant execute on function public.resolve_shop_device_limit (uuid) to authenticated;
