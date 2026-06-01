-- Pilot blocker: persist all shop business types (incl. hospitality) without coercing to kiosk_duka.

create or replace function public.is_valid_shop_business_type (p_type text)
returns boolean
language sql
immutable
as $$
  select coalesce (
    nullif (trim (p_type), '') in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'restaurant',
      'bar',
      'restaurant_bar',
      'hotel',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    ),
    false
  );
$$;

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

-- Admin profile override: accept hospitality types (reject unknown instead of silently ignoring).
create or replace function public.admin_shop_update_profile (
  p_shop_id uuid,
  p_shop_name text default null,
  p_phone_e164 text default null,
  p_owner_email text default null,
  p_district_id uuid default null,
  p_address_line text default null,
  p_city text default null,
  p_area text default null,
  p_business_type text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_org_id uuid;
  v_phone text;
  v_email text;
  v_district_name text;
  v_bt text;
  v_shop_name text;
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin', 'operations_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  select sh.organization_id
  into v_org_id
  from public.shops sh
  where sh.id = p_shop_id;

  if v_org_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select sm.user_id
  into v_uid
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  v_shop_name := nullif (trim (coalesce (p_shop_name, '')), '');
  v_phone := nullif (trim (coalesce (p_phone_e164, '')), '');
  v_email := nullif (lower (trim (coalesce (p_owner_email, ''))), '');

  if v_phone is not null and v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  if v_email is not null and (v_email !~ '^[^@]+@[^@]+\.[^@]+$' or v_email like '%@login.waka.ug') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_email');
  end if;

  if v_phone is not null and v_uid is not null then
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
        'Phone is registered to another Waka account.'
      );
    end if;
  end if;

  if v_email is not null and v_uid is not null then
    if exists (
      select 1
      from public.profiles pr
      where lower (trim (pr.email)) = v_email
        and pr.id <> v_uid
    ) then
      return jsonb_build_object ('ok', false, 'error', 'email_in_use', 'detail', 'Email is on another account.');
    end if;
  end if;

  if p_district_id is not null then
    select d.name into v_district_name
    from public.districts d
    where d.id = p_district_id
    limit 1;
  end if;

  v_bt := nullif (trim (coalesce (p_business_type, '')), '');
  if v_bt is not null and not public.is_valid_shop_business_type (v_bt) then
    return jsonb_build_object (
      'ok',
      false,
      'error',
      'invalid_business_type',
      'detail',
      format ('Unknown business type: %s', v_bt)
    );
  end if;

  update public.shops sh
  set
    name = coalesce (v_shop_name, sh.name),
    phone_e164 = coalesce (v_phone, sh.phone_e164),
    district_id = coalesce (p_district_id, sh.district_id),
    district = coalesce (v_district_name, sh.district),
    address_line = coalesce (nullif (trim (coalesce (p_address_line, '')), ''), sh.address_line),
    city = coalesce (nullif (trim (coalesce (p_city, '')), ''), sh.city),
    area = coalesce (nullif (trim (coalesce (p_area, '')), ''), sh.area),
    business_type = coalesce (v_bt, sh.business_type),
    updated_at = now ()
  where sh.id = p_shop_id;

  if v_bt is not null then
    update public.organizations o
    set business_type = v_bt, updated_at = now ()
    where o.id = v_org_id;
  end if;

  if v_shop_name is not null then
    update public.organizations o
    set name = v_shop_name, updated_at = now ()
    where o.id = v_org_id;
  end if;

  if v_uid is not null then
    update public.profiles pr
    set
      full_name = coalesce (pr.full_name, v_shop_name),
      business_name = coalesce (v_shop_name, pr.business_name),
      phone_e164 = coalesce (v_phone, pr.phone_e164),
      email = coalesce (v_email, pr.email),
      updated_at = now ()
    where pr.id = v_uid;
  end if;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_shop_update_profile',
    coalesce (nullif (trim (p_note), ''), 'Support updated shop profile'),
    jsonb_build_object (
      'shop_id',
      p_shop_id,
      'shop_name',
      v_shop_name,
      'phone_e164',
      v_phone,
      'owner_email',
      v_email,
      'district_id',
      p_district_id,
      'business_type',
      v_bt
    )
  );

  return jsonb_build_object ('ok', true);
exception
  when unique_violation then
    if sqlerrm ilike '%profiles_phone_e164%' then
      return jsonb_build_object ('ok', false, 'error', 'phone_in_use', 'detail', sqlerrm);
    end if;
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;
