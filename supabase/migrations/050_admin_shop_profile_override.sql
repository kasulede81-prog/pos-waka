-- Support-only shop profile edits (bypasses owner profile lock).

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
  if v_bt is not null and v_bt not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_bt := null;
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

revoke all on function public.admin_shop_update_profile (
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text
) from public;
grant execute on function public.admin_shop_update_profile (
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text
) to authenticated;
