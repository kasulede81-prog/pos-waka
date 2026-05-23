-- Free Mode on onboarding (no auto Starter trial) + marketing agent referrals

-- ---------- Onboarding: new shops start on Free Mode (not Starter trial) ----------
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
  v_plan uuid;
  v_cur text := upper (trim (coalesce (p_currency, 'UGX')));
  v_phone text;
  v_bt text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_owner_name text := coalesce (nullif (trim (p_shop_name), ''), 'Owner');
  v_shop_label text := coalesce (nullif (trim (p_shop_name), ''), 'Main Shop');
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if v_cur !~ '^[A-Z]{3}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_currency');
  end if;

  v_phone := trim (coalesce (p_phone_e164, ''));
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  if p_district_id is null then
    return jsonb_build_object ('ok', false, 'error', 'district_required');
  end if;

  if v_bt not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_bt := 'kiosk_duka';
  end if;

  select d.name into v_district_name
  from public.districts d
  where d.id = p_district_id
  limit 1;

  insert into public.profiles (id, full_name, phone_e164, business_name)
  values (v_uid, v_owner_name, v_phone, nullif (trim (p_shop_name), ''))
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (public.profiles.full_name), ''), excluded.full_name),
      phone_e164 = excluded.phone_e164,
      business_name = coalesce (excluded.business_name, public.profiles.business_name),
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

  if not exists (
    select 1 from public.subscriptions s where s.organization_id = v_org_id
  ) then
    select sp.id into v_plan
    from public.subscription_plans sp
    where sp.code = 'free' and sp.is_active
    limit 1;

    if v_plan is not null then
      insert into public.subscriptions (
        organization_id,
        shop_id,
        plan_id,
        status,
        billing_interval,
        trial_ends_at,
        current_period_start,
        current_period_end,
        payment_status,
        external_provider,
        activation_source
      )
      values (
        v_org_id,
        v_shop_id,
        v_plan,
        'active',
        'month',
        null,
        now (),
        null,
        'waived',
        'free_onboarding',
        'free_onboarding'
      );
    end if;
  end if;

  return jsonb_build_object ('ok', true, 'shop_id', v_shop_id, 'organization_id', v_org_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

-- ---------- Marketing agents ----------
create table if not exists public.marketing_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  referral_code text not null,
  full_name text,
  phone_e164 text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_agents_referral_code_key unique (referral_code)
);

create index if not exists marketing_agents_user_idx on public.marketing_agents (user_id);
create index if not exists marketing_agents_code_idx on public.marketing_agents (lower(referral_code));

create table if not exists public.agent_referrals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.marketing_agents (id) on delete cascade,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  referred_shop_id uuid references public.shops (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  shop_name text,
  owner_email text,
  created_at timestamptz not null default now(),
  constraint agent_referrals_user_key unique (referred_user_id)
);

create index if not exists agent_referrals_agent_idx on public.agent_referrals (agent_id, created_at desc);

alter table public.marketing_agents enable row level security;
alter table public.agent_referrals enable row level security;

drop policy if exists marketing_agents_select on public.marketing_agents;
create policy marketing_agents_select on public.marketing_agents for select
  using (public.is_waka_internal_staff () or user_id = auth.uid ());

drop policy if exists agent_referrals_select on public.agent_referrals;
create policy agent_referrals_select on public.agent_referrals for select
  using (
    public.is_waka_internal_staff ()
    or exists (
      select 1 from public.marketing_agents ma
      where ma.id = agent_referrals.agent_id and ma.user_id = auth.uid ()
    )
  );

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
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if exists (select 1 from public.agent_referrals ar where ar.referred_user_id = v_uid) then
    return jsonb_build_object ('ok', true, 'already_applied', true);
  end if;

  select * into v_agent
  from public.marketing_agents ma
  where lower (trim (ma.referral_code)) = lower (trim (p_code)) and ma.active
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

  insert into public.agent_referrals (
    agent_id, referred_user_id, referred_shop_id, organization_id, shop_name, owner_email
  )
  values (v_agent.id, v_uid, v_shop_id, v_org_id, v_shop_name, v_email);

  return jsonb_build_object ('ok', true, 'agent_id', v_agent.id);
end;
$$;

revoke all on function public.apply_referral_code (text) from public;
grant execute on function public.apply_referral_code (text) to authenticated;

create or replace function public.marketing_agent_me ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent public.marketing_agents%rowtype;
  v_count bigint;
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

  select count(*) into v_count from public.agent_referrals ar where ar.agent_id = v_agent.id;

  return jsonb_build_object (
    'ok', true,
    'referral_code', v_agent.referral_code,
    'full_name', v_agent.full_name,
    'referral_count', v_count
  );
end;
$$;

revoke all on function public.marketing_agent_me () from public;
grant execute on function public.marketing_agent_me () to authenticated;

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
          'referral_count', (select count(*)::int from public.agent_referrals ar where ar.agent_id = ma.id),
          'created_at', ma.created_at
        )
        order by ma.created_at desc
      )
      from public.marketing_agents ma
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.internal_list_marketing_agents () from public;
grant execute on function public.internal_list_marketing_agents () to authenticated;

create or replace function public.internal_create_marketing_agent (
  p_referral_code text,
  p_full_name text default null,
  p_email text default null,
  p_phone_e164 text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text := upper (trim (coalesce (p_referral_code, '')));
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if length (v_code) < 3 then
    return jsonb_build_object ('ok', false, 'error', 'code_too_short');
  end if;

  insert into public.marketing_agents (referral_code, full_name, email, phone_e164, user_id)
  values (
    v_code,
    nullif (trim (p_full_name), ''),
    nullif (trim (p_email), ''),
    case when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164) else null end,
    p_user_id
  )
  returning id into v_id;

  return jsonb_build_object ('ok', true, 'id', v_id, 'referral_code', v_code);
exception
  when unique_violation then
    return jsonb_build_object ('ok', false, 'error', 'code_taken');
end;
$$;

revoke all on function public.internal_create_marketing_agent (text, text, text, text, uuid) from public;
grant execute on function public.internal_create_marketing_agent (text, text, text, text, uuid) to authenticated;

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
        select jsonb_agg (
          jsonb_build_object (
            'id', ar.id,
            'shop_name', ar.shop_name,
            'owner_email', ar.owner_email,
            'created_at', ar.created_at
          )
          order by ar.created_at desc
        )
        from public.agent_referrals ar
        where ar.agent_id = v_agent_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.list_agent_referrals (uuid) from public;
grant execute on function public.list_agent_referrals (uuid) to authenticated;

-- ---------- Sign-up bootstrap: Free Mode (not Business/Starter trial) ----------
create or replace function public.bootstrap_owner_workspace (
  p_org_name text,
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null,
  p_district_id uuid default null,
  p_phone_e164 text default null,
  p_address text default null,
  p_gps_missing boolean default true,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_shop_display_name text default null
)
returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_free_plan uuid;
  v_district_name text;
  v_shop_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_business_type not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_business_type := 'kiosk_duka';
  end if;

  v_shop_label := coalesce (
    nullif (trim (p_shop_display_name), ''),
    nullif (trim (p_org_name), ''),
    'Main Shop'
  );

  insert into public.profiles (id, full_name, business_name, email, role, phone_e164)
  values (
    v_uid,
    nullif (trim (p_full_name), ''),
    nullif (trim (p_org_name), ''),
    nullif (lower (trim (p_email)), ''),
    'owner',
    case
      when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
      else null
    end
  )
  on conflict (id) do update
  set full_name = coalesce (nullif (trim (p_full_name), ''), public.profiles.full_name),
      business_name = coalesce (nullif (trim (p_org_name), ''), public.profiles.business_name),
      email = coalesce (nullif (lower (trim (p_email)), ''), public.profiles.email),
      phone_e164 = coalesce (
        case
          when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
          else null
        end,
        public.profiles.phone_e164
      ),
      role = 'owner',
      updated_at = now ();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, created_by)
    values (coalesce (nullif (trim (p_org_name), ''), 'My Shop'), v_business_type, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce (public.organization_members.profile_id, excluded.profile_id);

  if p_district_id is not null then
    select d.name into v_district_name from public.districts d where d.id = p_district_id limit 1;
  end if;

  select s.id
  into v_shop_id
  from public.shops s
  where s.organization_id = v_org_id
  order by s.created_at asc
  limit 1;

  if v_shop_id is null then
    insert into public.shops (
      organization_id,
      name,
      business_type,
      is_active,
      district_id,
      district,
      phone_e164,
      address_line,
      latitude,
      longitude,
      gps_missing
    )
    values (
      v_org_id,
      v_shop_label,
      v_business_type,
      true,
      p_district_id,
      v_district_name,
      case
        when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
        else null
      end,
      nullif (trim (p_address), ''),
      p_latitude,
      p_longitude,
      coalesce (p_gps_missing, true)
        and (p_latitude is null or p_longitude is null)
    )
    returning id into v_shop_id;
  else
    update public.shops s
    set
      name = case
        when nullif (trim (p_shop_display_name), '') is not null then trim (p_shop_display_name)
        when nullif (trim (p_org_name), '') is not null and (s.name is null or trim (s.name) = '') then trim (p_org_name)
        else s.name
      end,
      district_id = coalesce (p_district_id, s.district_id),
      district = coalesce (v_district_name, s.district),
      phone_e164 = coalesce (
        case
          when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
          else null
        end,
        s.phone_e164
      ),
      address_line = coalesce (nullif (trim (p_address), ''), s.address_line),
      latitude = case when p_latitude is not null then p_latitude else s.latitude end,
      longitude = case when p_longitude is not null then p_longitude else s.longitude end,
      gps_missing = case
        when p_latitude is not null and p_longitude is not null then false
        else coalesce (p_gps_missing, s.gps_missing)
      end,
      business_type = coalesce (nullif (v_business_type, ''), s.business_type),
      updated_at = now ()
    where s.id = v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  select sp.id into v_free_plan
  from public.subscription_plans sp
  where sp.code = 'free' and sp.is_active
  limit 1;

  if v_free_plan is not null then
    if not exists (
      select 1 from public.subscriptions s where s.organization_id = v_org_id
    ) then
      insert into public.subscriptions (
        organization_id,
        shop_id,
        plan_id,
        status,
        billing_interval,
        trial_ends_at,
        current_period_start,
        current_period_end,
        payment_status,
        external_provider,
        activation_source
      )
      values (
        v_org_id,
        v_shop_id,
        v_free_plan,
        'active',
        'month',
        null,
        now (),
        null,
        'waived',
        'free_onboarding',
        'free_onboarding'
      );
    end if;
  end if;

  return query select v_org_id, v_shop_id;
end;
$$;

grant execute on function public.bootstrap_owner_workspace (
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  boolean,
  double precision,
  double precision,
  text
) to authenticated;
