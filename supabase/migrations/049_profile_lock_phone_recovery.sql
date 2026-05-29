-- Stricter shop profile: fix phone conflicts, lock after onboarding, email for recovery, admin password set audit.

-- ---------- Phone → recovery email lookup (forgot password by phone) ----------
create or replace function public.lookup_password_reset_email (p_phone_e164 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text := trim (coalesce (p_phone_e164, ''));
  v_email text;
begin
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  select lower (trim (pr.email))
  into v_email
  from public.profiles pr
  where pr.phone_e164 = v_phone
  limit 1;

  if v_email is null or v_email = '' or v_email like '%@login.waka.ug' then
    return jsonb_build_object ('ok', false, 'error', 'no_recovery_email');
  end if;

  return jsonb_build_object ('ok', true, 'email', v_email);
end;
$$;

revoke all on function public.lookup_password_reset_email (text) from public;
grant execute on function public.lookup_password_reset_email (text) to authenticated;
grant execute on function public.lookup_password_reset_email (text) to anon;

-- ---------- Owner onboarding: require real email on profile ----------
create or replace function public.owner_onboarding_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_shop record;
  v_profile_email text;
  v_complete boolean := false;
  v_missing text[] := array[]::text[];
begin
  if v_uid is null then
    return jsonb_build_object ('complete', true, 'missing', '[]'::jsonb);
  end if;

  select lower (trim (coalesce (pr.email, '')))
  into v_profile_email
  from public.profiles pr
  where pr.id = v_uid;

  select sh.id, sh.name, sh.district_id, sh.phone_e164, sh.business_type, o.name as org_name, o.default_currency
  into v_shop
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  join public.organizations o on o.id = sh.organization_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  if not found then
    return jsonb_build_object ('complete', false, 'missing', to_jsonb (array['shop']::text[]));
  end if;

  if coalesce (trim (v_shop.org_name), '') = '' then v_missing := array_append (v_missing, 'organization_name'); end if;
  if coalesce (trim (v_shop.name), '') = '' then v_missing := array_append (v_missing, 'shop_name'); end if;
  if v_shop.business_type is null or trim (v_shop.business_type) = '' then v_missing := array_append (v_missing, 'business_type'); end if;
  if v_shop.district_id is null then v_missing := array_append (v_missing, 'district'); end if;
  if v_shop.phone_e164 is null or trim (v_shop.phone_e164) !~ '^\+256[0-9]{9}$' then
    v_missing := array_append (v_missing, 'phone');
  end if;
  if v_profile_email is null or v_profile_email = '' or v_profile_email like '%@login.waka.ug' then
    v_missing := array_append (v_missing, 'email');
  end if;
  if v_shop.default_currency is null or length (trim (v_shop.default_currency)) <> 3 then
    v_missing := array_append (v_missing, 'currency');
  end if;

  v_complete := coalesce (array_length (v_missing, 1), 0) = 0;
  return jsonb_build_object ('complete', v_complete, 'missing', to_jsonb (v_missing));
end;
$$;

-- ---------- Save bundle: phone conflict + lock when onboarding complete ----------
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

-- ---------- Audit row when support sets password via edge function ----------
create or replace function public.admin_shop_password_set_audit (
  p_shop_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_set_owner_password',
    coalesce (nullif (trim (p_note), ''), 'Support set owner login password'),
    jsonb_build_object ('shop_id', p_shop_id, 'at', now ())
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.admin_shop_password_set_audit (uuid, text) from public;
grant execute on function public.admin_shop_password_set_audit (uuid, text) to authenticated;
