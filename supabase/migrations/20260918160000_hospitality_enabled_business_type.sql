-- Waka POS — enable the unified `hospitality` business type on the platform.
--
-- Findings (production, read-only inspection):
--   * is_valid_shop_business_type() and the shops/organizations CHECK constraints already
--     accept 'hospitality' (20260918003000 + 20260918143000).
--   * platform_settings 'business_types_enabled' (the list onboarding uses to decide which
--     business types a merchant may pick) and platform_default_business_types_enabled() still
--     only listed the legacy restaurant / bar / restaurant_bar types. Every hospitality
--     onboarding style except Hotel is `hospitality`, so non-super-admin merchants could not
--     select Restaurant / Bar / Restaurant + Bar.
--   * bootstrap_owner_workspace() used a literal allow-list that omitted hospitality (and
--     bar / restaurant_bar / hotel), coercing them to kiosk_duka on first workspace creation.
--
-- This migration is purely additive and non-destructive:
--   * legacy restaurant / bar / restaurant_bar / hotel stay enabled and valid,
--   * no shop / organization row is rewritten,
--   * 'hospitality' is appended to the stored list ONLY when a hospitality-family type is
--     already enabled (an admin who deliberately disabled all of them is not overridden).

create or replace function public.platform_default_business_types_enabled ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array (
    'kiosk_duka',
    'boutique',
    'pharmacy',
    'wholesale',
    'hospitality',
    'restaurant',
    'bar',
    'restaurant_bar',
    'hotel',
    'mobile_money_agent',
    'other'
  );
$$;

update public.platform_settings ps
set
  value = ps.value || '["hospitality"]'::jsonb,
  updated_at = now ()
where ps.key = 'business_types_enabled'
  and jsonb_typeof (ps.value) = 'array'
  and not (ps.value ? 'hospitality')
  and (
    ps.value ? 'restaurant'
    or ps.value ? 'bar'
    or ps.value ? 'restaurant_bar'
  );

-- bootstrap_owner_workspace: identical to 117 except the business-type check now uses the
-- shared validator.
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
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_business_plan uuid;
  v_district_name text;
  v_shop_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Use the shared validator (kept in sync with the shops CHECK constraint) instead of a
  -- literal list that predated hospitality / bar / restaurant_bar / hotel and silently
  -- coerced them to kiosk_duka. Unknown values still fall back to kiosk_duka.
  if not public.is_valid_shop_business_type (v_business_type) then
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

  insert into public.organization_members as om (
    organization_id,
    user_id,
    profile_id,
    role
  )
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict on constraint organization_members_organization_id_user_id_key do update
  set role = 'owner',
      profile_id = coalesce (om.profile_id, excluded.profile_id);

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
    insert into public.shops as sh (
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
      gps_missing,
      owner_user_id
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
        and (p_latitude is null or p_longitude is null),
      v_uid
    )
    returning sh.id into v_shop_id;
  else
    update public.shops sh
    set
      owner_user_id = coalesce (sh.owner_user_id, v_uid),
      name = case
        when nullif (trim (p_shop_display_name), '') is not null then trim (p_shop_display_name)
        when nullif (trim (p_org_name), '') is not null and (sh.name is null or trim (sh.name) = '') then trim (p_org_name)
        else sh.name
      end
    where sh.id = v_shop_id;
  end if;

  insert into public.shop_members as sm (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict on constraint shop_members_shop_id_user_id_key do update
  set role = 'owner';

  update public.profiles pr
  set primary_shop_id = coalesce (pr.primary_shop_id, v_shop_id), updated_at = now ()
  where pr.id = v_uid;

  select sp.id into v_business_plan
  from public.subscription_plans sp
  where sp.code = 'business' and sp.is_active
  limit 1;

  if v_business_plan is not null then
    if not exists (
      select 1 from public.subscriptions s where s.organization_id = v_org_id
    ) then
      insert into public.subscriptions as sub (
        organization_id,
        shop_id,
        plan_id,
        status,
        billing_interval,
        trial_ends_at,
        current_period_start,
        current_period_end,
        external_provider
      )
      values (
        v_org_id,
        v_shop_id,
        v_business_plan,
        'trial',
        'month',
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        now (),
        (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz,
        'trial_auto'
      );
    end if;
  end if;

  return query select v_org_id, v_shop_id;
end;
$$;
