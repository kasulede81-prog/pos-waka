-- Internal admin: resolve owner email from auth.users when profiles.email is empty;
-- restore full shop detail RPC; never expose raw user UUID as owner_label.

create or replace function public.internal_resolve_owner_email (p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select nullif(
    lower(
      trim(
        coalesce(
          (select pr.email from public.profiles pr where pr.id = p_user_id),
          (select au.email from auth.users au where au.id = p_user_id)
        )
      )
    ),
    ''
  );
$$;

create or replace function public.internal_resolve_owner_full_name (p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select nullif(
    trim(
      coalesce(
        (select pr.full_name from public.profiles pr where pr.id = p_user_id),
        (select nullif(trim(au.raw_user_meta_data ->> 'full_name'), '') from auth.users au where au.id = p_user_id),
        (select pr.business_name from public.profiles pr where pr.id = p_user_id)
      )
    ),
    ''
  );
$$;

revoke all on function public.internal_resolve_owner_email (uuid) from public;
grant execute on function public.internal_resolve_owner_email (uuid) to authenticated;

revoke all on function public.internal_resolve_owner_full_name (uuid) from public;
grant execute on function public.internal_resolve_owner_full_name (uuid) to authenticated;

-- Full shop detail bundle (054+) with owner contact from profiles + auth.users.
create or replace function public.internal_ops_shop_detail (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  j jsonb;
  v_table_products int := 0;
  v_table_sales_30d int := 0;
  v_snap jsonb;
  v_snap_products int := 0;
  v_snap_sales int := 0;
  v_owner_uid uuid;
  v_owner_email text;
  v_owner_name text;
  v_sensitive boolean;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_sensitive := public.internal_can_view_sensitive_shop_data ();

  select count(*)::int
  into v_table_products
  from public.products p
  where p.shop_id = p_shop_id and coalesce (p.is_active, true);

  select count(*)::int
  into v_table_sales_30d
  from public.sales s
  where s.shop_id = p_shop_id
    and s.status = 'completed'
    and s.created_at >= timezone ('Africa/Kampala', now ()) - interval '30 days';

  select scs.snapshot
  into v_snap
  from public.shop_cloud_snapshots scs
  where scs.shop_id = p_shop_id;

  if v_snap is not null then
    v_snap_products := coalesce(
      jsonb_array_length(v_snap -> 'snapshot' -> 'products'),
      jsonb_array_length(v_snap -> 'products'),
      0
    );
    v_snap_sales := coalesce(
      jsonb_array_length(v_snap -> 'snapshot' -> 'sales'),
      jsonb_array_length(v_snap -> 'sales'),
      0
    );
  end if;

  select own.user_id
  into v_owner_uid
  from public.shops sh
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = sh.id and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  where sh.id = p_shop_id;

  if v_owner_uid is not null then
    v_owner_email := public.internal_resolve_owner_email (v_owner_uid);
    v_owner_name := public.internal_resolve_owner_full_name (v_owner_uid);
  end if;

  select
    jsonb_build_object (
      'shop',
      to_jsonb (sh),
      'owner_full_name',
      v_owner_name,
      'owner_label',
      coalesce(
        v_owner_name,
        nullif (trim (pr.business_name), ''),
        case when v_sensitive then v_owner_email else null end,
        'Shop owner'
      ),
      'owner_email',
      case when v_sensitive then v_owner_email else null end,
      'product_count',
      greatest (v_table_products, v_snap_products),
      'product_count_table',
      v_table_products,
      'product_count_snapshot',
      v_snap_products,
      'sale_count_30d',
      greatest (v_table_sales_30d, 0),
      'sale_count_table_30d',
      v_table_sales_30d,
      'sales_in_snapshot',
      v_snap_sales,
      'last_sale_at',
      (
        select max (s.created_at)
        from public.sales s
        where s.shop_id = sh.id and s.status = 'completed'
      ),
      'cloud_snapshot_at',
      (select scs.updated_at from public.shop_cloud_snapshots scs where scs.shop_id = sh.id),
      'cloud_snapshot_bytes',
      (select scs.byte_size from public.shop_cloud_snapshots scs where scs.shop_id = sh.id),
      'products_preview',
      (
        select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
        from (
          select
            p.id,
            p.name,
            coalesce (pc.name, nullif (trim (p.metadata ->> 'category'), ''), 'Uncategorized') as category,
            p.selling_price_per_unit_ugx as selling_price_ugx,
            p.stock_on_hand as stock_quantity,
            p.is_active,
            p.updated_at
          from public.products p
          left join public.product_categories pc on pc.id = p.category_id
          where p.shop_id = p_shop_id
          order by p.updated_at desc nulls last
          limit 80
        ) x
      ),
      'subscription',
      (
        select to_jsonb (s)
        from public.subscriptions s
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'plan_code',
      (
        select sp2.code
        from public.subscriptions s
        join public.subscription_plans sp2 on sp2.id = s.plan_id
        where s.organization_id = sh.organization_id
        order by s.created_at desc
        limit 1
      ),
      'devices',
      (
        select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
        from (
          select d.*
          from public.shop_devices d
          where d.shop_id = p_shop_id
          order by d.last_seen_at desc nulls last
          limit 50
        ) x
      ),
      'sync_health',
      (
        select to_jsonb (sy)
        from public.sync_health sy
        where sy.shop_id = p_shop_id
      ),
      'subscription_payments_recent',
      (
        select coalesce (jsonb_agg (to_jsonb (y)), '[]'::jsonb)
        from (
          select sp2.*
          from public.subscription_payments sp2
          join public.subscriptions s2 on s2.id = sp2.subscription_id
          join public.shops sh2 on sh2.organization_id = s2.organization_id
          where sh2.id = p_shop_id
          order by sp2.created_at desc
          limit 12
        ) y
      ),
      'sensitive_data_redacted',
      not v_sensitive
    )
  into j
  from public.shops sh
  left join public.profiles pr on pr.id = v_owner_uid
  where sh.id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

-- Recent shops: same owner contact resolution (no UUID labels).
drop function if exists public.internal_ops_recent_shops (int);

create or replace function public.internal_ops_recent_shops (p_limit int default 20)
returns table (
  id uuid,
  shop_number text,
  name text,
  district text,
  city text,
  is_active boolean,
  created_at timestamptz,
  organization_id uuid,
  plan_code text,
  trial_ends_at timestamptz,
  subscription_status text,
  owner_label text,
  owner_email text,
  owner_full_name text,
  phone_e164 text,
  business_type text,
  gps_missing boolean,
  last_seen_at timestamptz,
  product_count int,
  sale_count_30d int
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    s.id,
    s.shop_number,
    s.name,
    s.district,
    s.city,
    s.is_active,
    s.created_at,
    s.organization_id,
    sp.code as plan_code,
    sub.trial_ends_at,
    sub.status as subscription_status,
    coalesce(
      public.internal_resolve_owner_full_name (own.user_id),
      nullif (trim (pr.business_name), ''),
      case
        when public.internal_can_view_sensitive_shop_data ()
          then public.internal_resolve_owner_email (own.user_id)
        else null
      end,
      'Shop owner'
    ) as owner_label,
    case
      when public.internal_can_view_sensitive_shop_data ()
        then public.internal_resolve_owner_email (own.user_id)
      else null
    end as owner_email,
    public.internal_resolve_owner_full_name (own.user_id) as owner_full_name,
    coalesce (s.phone_e164, pr.phone_e164) as phone_e164,
    s.business_type,
    coalesce (s.gps_missing, true) as gps_missing,
    s.last_seen_at,
    (
      select count(*)::int
      from public.products p
      where p.shop_id = s.id and coalesce (p.is_active, true)
    ) as product_count,
    coalesce (sa.sale_count_30d, 0)::int as sale_count_30d
  from public.shops s
  left join public.shop_activity sa on sa.shop_id = s.id
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = s.id
    order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  left join lateral (
    select s2.*
    from public.subscriptions s2
    where s2.organization_id = s.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  left join public.subscription_plans sp on sp.id = sub.plan_id
  order by coalesce (s.last_seen_at, s.created_at) desc
  limit least (greatest (coalesce (p_limit, 20), 1), 100);
end;
$$;

-- Password reset: fall back to auth.users email when profiles.email is empty.
create or replace function public.admin_shop_send_owner_password_reset (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_uid uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select sm.user_id
  into v_uid
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'owner_not_found');
  end if;

  v_email := public.internal_resolve_owner_email (v_uid);

  if v_email is null or v_email = '' or v_email like '%@login.waka.ug' then
    return jsonb_build_object ('ok', false, 'error', 'owner_email_missing');
  end if;

  insert into public.shop_recovery_signals (shop_id, password_reset_requested_at, password_reset_requested_by, updated_at)
  values (p_shop_id, now(), auth.uid (), now())
  on conflict (shop_id) do update
    set password_reset_requested_at = now(),
        password_reset_requested_by = auth.uid (),
        updated_at = now();

  insert into public.audit_logs (shop_id, actor_user_id, action, payload)
  values (
    p_shop_id,
    auth.uid (),
    'admin_request_owner_password_reset',
    jsonb_build_object ('owner_email', v_email, 'at', now())
  );

  return jsonb_build_object ('ok', true, 'owner_email', v_email);
end;
$$;

-- Admin profile override: allow updating owner full name from support console.
create or replace function public.admin_shop_update_profile (
  p_shop_id uuid,
  p_shop_name text default null,
  p_phone_e164 text default null,
  p_owner_email text default null,
  p_owner_full_name text default null,
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
  v_owner_name text;
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
  v_owner_name := nullif (trim (coalesce (p_owner_full_name, '')), '');

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
      full_name = coalesce (v_owner_name, pr.full_name),
      business_name = coalesce (v_shop_name, pr.business_name),
      phone_e164 = coalesce (v_phone, pr.phone_e164),
      email = coalesce (v_email, pr.email),
      updated_at = now ()
    where pr.id = v_uid;
  end if;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    action,
    payload
  )
  values (
    p_shop_id,
    auth.uid (),
    'admin_shop_update_profile',
    jsonb_build_object (
      'shop_name',
      v_shop_name,
      'owner_email',
      v_email,
      'owner_full_name',
      v_owner_name,
      'note',
      nullif (trim (coalesce (p_note, '')), '')
    )
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.internal_ops_shop_detail (uuid) from public;
grant execute on function public.internal_ops_shop_detail (uuid) to authenticated;

revoke all on function public.internal_ops_recent_shops (int) from public;
grant execute on function public.internal_ops_recent_shops (int) to authenticated;

revoke all on function public.admin_shop_send_owner_password_reset (uuid) from public;
grant execute on function public.admin_shop_send_owner_password_reset (uuid) to authenticated;

revoke all on function public.admin_shop_update_profile (
  uuid,
  text,
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
  text,
  uuid,
  text,
  text,
  text,
  text,
  text
) to authenticated;
