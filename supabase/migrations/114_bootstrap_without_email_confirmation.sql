-- Provision owner workspace on signup when Supabase returns a session, even if
-- email_confirmed_at is still null (common when "Confirm email" is off in Auth).

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
    returning id into v_shop_id;
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

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
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

create or replace function public.repair_owner_workspace (
  p_org_name text default 'My Shop',
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_health jsonb;
  v_org uuid;
  v_shop uuid;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  v_health := public.owner_workspace_health ();
  if coalesce ((v_health ->> 'ok')::boolean, false) then
    return jsonb_build_object ('ok', true, 'repaired', false, 'health', v_health);
  end if;

  select b.organization_id, b.shop_id
  into v_org, v_shop
  from public.bootstrap_owner_workspace (
    p_org_name,
    p_business_type,
    p_full_name,
    p_email,
    null,
    null,
    null,
    true,
    null,
    null,
    p_org_name
  ) b;

  v_health := public.owner_workspace_health ();

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_shop,
    auth.uid (),
    'owner',
    'workspace_repaired',
    'Owner workspace auto-repaired',
    jsonb_build_object ('health', v_health)
  );

  return jsonb_build_object (
    'ok',
    coalesce ((v_health ->> 'ok')::boolean, false),
    'repaired',
    true,
    'organization_id',
    v_org,
    'shop_id',
    v_shop,
    'health',
    v_health
  );
end;
$$;
