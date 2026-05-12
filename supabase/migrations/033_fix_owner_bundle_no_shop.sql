-- Ensure onboarding business-profile save can self-heal missing workspace membership.

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

  select sh.id, sh.organization_id
  into v_shop_id, v_org_id
  from public.shop_members sm
  join public.shops sh on sh.id = sm.shop_id
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  if v_shop_id is null then
    select b.shop_id, b.organization_id
    into v_shop_id, v_org_id
    from public.bootstrap_owner_workspace(
      coalesce (nullif (trim (p_shop_name), ''), 'My Shop'),
      v_bt,
      null,
      null,
      p_district_id,
      v_phone,
      p_address,
      (p_latitude is null or p_longitude is null),
      p_latitude,
      p_longitude,
      coalesce (nullif (trim (p_shop_name), ''), 'Main Shop')
    ) as b
    limit 1;
  end if;

  if v_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_shop');
  end if;

  select d.name into v_district_name from public.districts d where d.id = p_district_id limit 1;

  update public.profiles p
  set
    phone_e164 = v_phone,
    business_name = coalesce (nullif (trim (p_shop_name), ''), p.business_name),
    updated_at = now ()
  where p.id = v_uid;

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

  if not exists (select 1 from public.subscriptions s where s.organization_id = v_org_id) then
    select sp.id into v_plan from public.subscription_plans sp where sp.code = 'starter' and sp.is_active limit 1;
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
        external_provider
      )
      values (
        v_org_id,
        v_shop_id,
        v_plan,
        'trial',
        'month',
        (timezone ('Africa/Kampala', now ())::date + interval '14 days')::timestamptz,
        now (),
        (timezone ('Africa/Kampala', now ())::date + interval '14 days')::timestamptz,
        'starter_trial_onboarding'
      );
    end if;
  end if;

  return jsonb_build_object ('ok', true, 'shop_id', v_shop_id, 'organization_id', v_org_id);
exception
  when others then
    return jsonb_build_object ('ok', false, 'error', 'save_failed', 'detail', sqlerrm);
end;
$$;

revoke all on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) from public;
grant execute on function public.save_owner_business_profile_bundle (text, text, uuid, text, text, text, text, text, double precision, double precision) to authenticated;
