-- Shop + device presence for Mission Control (real-time online counts).

create or replace function public.shop_device_heartbeat (
  p_shop_id uuid,
  p_device_fingerprint text,
  p_label text default null,
  p_platform text default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone ('Africa/Kampala', now ());
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_device_fingerprint is null or length(trim(p_device_fingerprint)) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  insert into public.shop_devices (
    shop_id,
    device_fingerprint,
    label,
    platform,
    app_version,
    last_seen_at,
    is_active,
    updated_at
  )
  values (
    p_shop_id,
    trim(p_device_fingerprint),
    nullif(trim(coalesce(p_label, '')), ''),
    nullif(trim(coalesce(p_platform, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    v_now,
    true,
    now()
  )
  on conflict (shop_id, device_fingerprint) do update
  set
    label = coalesce(excluded.label, shop_devices.label),
    platform = coalesce(excluded.platform, shop_devices.platform),
    app_version = coalesce(excluded.app_version, shop_devices.app_version),
    last_seen_at = excluded.last_seen_at,
    is_active = true,
    updated_at = now();

  update public.shops sh
  set
    last_seen_at = v_now,
    active_device_count = (
      select count(*)::int
      from public.shop_devices d
      where d.shop_id = p_shop_id
        and d.is_active = true
    ),
    updated_at = now()
  where sh.id = p_shop_id;
end;
$$;

revoke all on function public.shop_device_heartbeat (uuid, text, text, text, text) from public;
grant execute on function public.shop_device_heartbeat (uuid, text, text, text, text) to authenticated;

-- Mission Control: devices/shops seen in the last 15 minutes count as online.
create or replace function public.internal_ops_dashboard_metrics ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := (
    (timezone ('Africa/Kampala', now ())::date)::text || ' 00:00:00+03:00'
  )::timestamptz;
  v_online_cutoff timestamptz := now () - interval '15 minutes';
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
      pr.email as owner_email,
      pr.full_name as owner_name,
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
    left join public.profiles pr on pr.id = own.user_id
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
    'shops_online_now', (select count (*)::bigint from public.shops sh where sh.last_seen_at >= v_online_cutoff),
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
    'active_devices',
    (
      select count (*)::bigint
      from public.shop_devices d
      where d.is_active = true
        and d.last_seen_at >= v_online_cutoff
    ),
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

revoke all on function public.internal_ops_dashboard_metrics () from public;
grant execute on function public.internal_ops_dashboard_metrics () to authenticated;
