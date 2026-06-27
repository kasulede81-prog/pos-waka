-- Internal admin: show owner email to all active internal staff (not only super_admin
-- with can_view_sensitive_data). Resolve email from auth.users when profiles.email is empty.

create or replace function public.internal_can_view_owner_contact ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_waka_internal_staff ();
$$;

revoke all on function public.internal_can_view_owner_contact () from public;
grant execute on function public.internal_can_view_owner_contact () to authenticated;

-- Dashboard latest signups: auth.users fallback for owner email.
create or replace function public.internal_ops_dashboard_metrics ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_day_start timestamptz := (
    (timezone ('Africa/Kampala', now ())::date)::text || ' 00:00:00+03:00'
  )::timestamptz;
  v_week_end timestamptz := now () + interval '7 days';
  j_district jsonb;
  j_latest jsonb;
  v_sales bigint;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select coalesce (jsonb_agg (to_jsonb (x)), '[]'::jsonb)
  into j_district
  from (
    select coalesce (nullif (trim (sh.district), ''), nullif (trim (sh.city), ''), '—') as label, count (*)::int as count
    from public.shops sh
    group by 1
    order by count (*) desc
    limit 8
  ) x;

  select coalesce (jsonb_agg (to_jsonb (y)), '[]'::jsonb)
  into j_latest
  from (
    select
      sh.id as shop_id,
      sh.name as shop_name,
      sh.created_at,
      sh.district,
      case
        when public.internal_can_view_owner_contact ()
          then public.internal_resolve_owner_email (own.user_id)
        else null
      end as owner_email,
      public.internal_resolve_owner_full_name (own.user_id) as owner_name,
      sp.code as plan_code,
      sub.status as subscription_status,
      sub.trial_ends_at
    from public.shops sh
    left join lateral (
      select sm.user_id from public.shop_members sm
      where sm.shop_id = sh.id
      order by (case when sm.role = 'owner' then 0 else 1 end), sm.created_at asc
      limit 1
    ) own on true
    left join lateral (
      select s2.* from public.subscriptions s2
      where s2.organization_id = sh.organization_id
      order by s2.created_at desc
      limit 1
    ) sub on true
    left join public.subscription_plans sp on sp.id = sub.plan_id
    order by sh.created_at desc
    limit 8
  ) y;

  select coalesce (sum (s.total_ugx)::bigint, 0)
  into v_sales
  from public.sales s
  where s.status = 'completed';

  return jsonb_build_object (
    'total_shops', (select count (*)::bigint from public.shops),
    'active_today', (select count (*)::bigint from public.shops sh where sh.last_seen_at >= v_day_start),
    'paid_subscriptions', (select count (*)::bigint from public.subscriptions s where s.status = 'active'),
    'trial_subscriptions', (select count (*)::bigint from public.subscriptions s where s.status in ('trial', 'trialing')),
    'expired_subscriptions', (select count (*)::bigint from public.subscriptions s where s.status = 'expired'),
    'suspended_shops', (select count (*)::bigint from public.shops sh where sh.is_active = false),
    'lapsed_trials',
    (
      select count (*)::bigint from public.subscriptions s
      where s.status in ('trial', 'trialing')
        and s.trial_ends_at is not null and s.trial_ends_at < now ()
    ),
    'expiring_trials_7d',
    (
      select count (*)::bigint from public.subscriptions s
      where s.status in ('trial', 'trialing')
        and s.trial_ends_at is not null and s.trial_ends_at >= now () and s.trial_ends_at <= v_week_end
    ),
    'active_devices', (select count (*)::bigint from public.shop_devices d where d.is_active = true),
    'open_support',
    (
      select count (*)::bigint from public.support_requests sr
      where sr.status in ('open', 'in_progress', 'pending')
    ),
    'pending_ai_requests',
    (
      select count (*)::bigint from public.support_requests sr
      where sr.status = 'pending' and sr.issue_type in ('ai_stock_setup', 'ai_stock_trial_request')
    ),
    'pending_annual_requests',
    (
      select count (*)::bigint from public.support_requests sr
      where sr.status = 'pending' and sr.issue_type = 'annual_plan_request'
    ),
    'sales_total_ugx', v_sales,
    'shops_by_district', coalesce (j_district, '[]'::jsonb),
    'latest_signups', coalesce (j_latest, '[]'::jsonb)
  );
end;
$$;

-- Recent shops list (signup / activity sort).
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
        when public.internal_can_view_owner_contact ()
          then public.internal_resolve_owner_email (own.user_id)
        else null
      end,
      'Shop owner'
    ) as owner_label,
    case
      when public.internal_can_view_owner_contact ()
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

-- Shops by signup date (for admin lists when activity sort is not desired).
create or replace function public.internal_ops_shops_by_signup (p_limit int default 50)
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
        when public.internal_can_view_owner_contact ()
          then public.internal_resolve_owner_email (own.user_id)
        else null
      end,
      'Shop owner'
    ) as owner_label,
    case
      when public.internal_can_view_owner_contact ()
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
  order by s.created_at desc
  limit least (greatest (coalesce (p_limit, 50), 1), 100);
end;
$$;

-- Shop detail bundle: owner email for all internal staff.
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
  v_show_contact boolean;
  v_sensitive boolean;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  v_show_contact := public.internal_can_view_owner_contact ();
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
        case when v_show_contact then v_owner_email else null end,
        'Shop owner'
      ),
      'owner_email',
      case when v_show_contact then v_owner_email else null end,
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

-- Support queue: resolve owner email from auth.users when profile is empty.
create or replace function public.internal_ops_support_queue (p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  lim int := least (greatest (coalesce (p_limit, 30), 1), 100);
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce(
    (
      select coalesce (jsonb_agg (to_jsonb (t)), '[]'::jsonb)
      from (
        select
          sr.id,
          sr.subject,
          sr.body,
          sr.status,
          sr.priority,
          sr.channel,
          sr.created_at,
          sr.contact_phone_e164,
          sr.issue_type,
          sr.device_fingerprint,
          sr.app_version,
          sr.sync_health_snapshot,
          sr.assigned_internal_admin_id,
          sr.organization_id,
          sh.id as shop_id,
          sh.name as shop_name,
          sh.district as shop_district,
          sh.phone_e164 as shop_phone_e164,
          public.internal_resolve_owner_full_name (own.user_id) as owner_name,
          case
            when public.internal_can_view_owner_contact ()
              then public.internal_resolve_owner_email (own.user_id)
            else null
          end as owner_email,
          ia.email as assigned_admin_email
        from public.support_requests sr
        left join public.shops sh on sh.id = sr.shop_id
        left join lateral (
          select sm.user_id
          from public.shop_members sm
          where sm.shop_id = sh.id
            and sm.role = 'owner'
          order by sm.created_at asc
          limit 1
        ) own on true
        left join public.internal_admins ia on ia.id = sr.assigned_internal_admin_id
        order by sr.created_at desc
        limit lim
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.internal_ops_dashboard_metrics () from public;
grant execute on function public.internal_ops_dashboard_metrics () to authenticated;

revoke all on function public.internal_ops_recent_shops (int) from public;
grant execute on function public.internal_ops_recent_shops (int) to authenticated;

revoke all on function public.internal_ops_shops_by_signup (int) from public;
grant execute on function public.internal_ops_shops_by_signup (int) to authenticated;

revoke all on function public.internal_ops_shop_detail (uuid) from public;
grant execute on function public.internal_ops_shop_detail (uuid) to authenticated;

revoke all on function public.internal_ops_support_queue (int) from public;
grant execute on function public.internal_ops_support_queue (int) to authenticated;
