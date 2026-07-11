-- Phase 18.3 — Enterprise Update Engine: policy generation, resend recovery, pilot target, realtime signal

alter table public.app_releases
  add column if not exists policy_generation integer not null default 0,
  add column if not exists last_notification_at timestamptz;

-- Client-readable published rows for Realtime (policy metadata only; notes stay in RPC)
drop policy if exists app_releases_published_client_read on public.app_releases;
create policy app_releases_published_client_read on public.app_releases
  for select using (status = 'published');

grant select on public.app_releases to anon;

alter table public.app_releases replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.app_releases;
  end if;
exception
  when duplicate_object then null;
end;
$$;

create or replace function public._pilot_target_app_version ()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.version_number
      from public.app_releases r
      where r.status = 'published'
      order by r.google_play_version_code desc
      limit 1
    ),
    '0.0.0'
  );
$$;

revoke all on function public._pilot_target_app_version () from public;
grant execute on function public._pilot_target_app_version () to authenticated;

create or replace function public.get_app_release_client_policy ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_pub text := '';
begin
  select r.* into v_row
  from public.app_releases r
  where r.status = 'published'
  order by r.google_play_version_code desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'policy', null);
  end if;

  select coalesce(pn.content_html, '') into v_pub
  from public.release_public_notes pn
  where pn.release_id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'policy', jsonb_build_object(
      'release_id', v_row.id,
      'version_number', v_row.version_number,
      'release_name', v_row.release_name,
      'google_play_version_code', v_row.google_play_version_code,
      'minimum_supported_version', v_row.minimum_supported_version,
      'minimum_supported_version_code', v_row.minimum_supported_version_code,
      'update_type', v_row.update_type,
      'prompt_users', v_row.prompt_users,
      'force_below_minimum', v_row.force_below_minimum,
      'show_whats_new', v_row.show_whats_new,
      'public_notes_html', v_pub,
      'policy_generation', coalesce(v_row.policy_generation, 0),
      'published_at', v_row.published_at
    )
  );
end;
$$;

create or replace function public.admin_publish_app_release (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public._release_require_ops_admin ();

  select status into v_status from public.app_releases where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.app_releases
  set status = 'archived', updated_by = auth.uid ()
  where status = 'published' and id <> p_id;

  update public.app_releases
  set
    status = 'published',
    published_at = now (),
    published_by = auth.uid (),
    updated_by = auth.uid (),
    policy_generation = coalesce(policy_generation, 0) + 1,
    last_notification_at = now ()
  where id = p_id;

  perform public._release_audit('app_release_published', jsonb_build_object('release_id', p_id));

  insert into public.app_release_events (release_id, event_type, actor_user_id, metadata)
  values (p_id, 'release_published', auth.uid (), jsonb_build_object('source', 'admin'));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(p_id));
end;
$$;

create or replace function public.admin_resend_release_notification (p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public._release_require_ops_admin ();

  select status into v_status from public.app_releases where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'not_published');
  end if;

  update public.app_releases
  set
    policy_generation = coalesce(policy_generation, 0) + 1,
    last_notification_at = now (),
    updated_by = auth.uid ()
  where id = p_id;

  perform public._release_audit('app_release_notification_resent', jsonb_build_object('release_id', p_id));

  insert into public.app_release_events (release_id, event_type, actor_user_id, metadata)
  values (p_id, 'notification_resent', auth.uid (), jsonb_build_object('source', 'admin_resend'));

  return jsonb_build_object('ok', true, 'release', public._release_row_to_json(p_id));
end;
$$;

revoke all on function public.admin_resend_release_notification (uuid) from public;
grant execute on function public.admin_resend_release_notification (uuid) to authenticated;

-- Pilot ops: read target from published release policy (replaces hardcoded 1.0.5)
create or replace function public.internal_ops_pilot_dashboard ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target text := public._pilot_target_app_version();
  v_total int;
  v_active int;
  v_at_risk int;
  v_sync_fail int;
  v_queue int;
  v_offline int;
  v_outdated int;
  v_revenue bigint;
  v_crashes int;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select count(*)::int into v_total from public.shops sh where sh.pilot_cohort = true;
  select count(*)::int into v_active
  from public.shops sh
  where sh.pilot_cohort = true and sh.last_seen_at >= now () - interval '24 hours';

  select count(*)::int into v_at_risk
  from public.shops sh
  left join public.sync_health sy on sy.shop_id = sh.id
  where sh.pilot_cohort = true
    and (
      not sh.is_active
      or (sy.last_error is not null and trim (sy.last_error) <> '')
      or coalesce (sy.pending_outbound, 0) > 10
      or sh.last_seen_at is null
      or sh.last_seen_at < now () - interval '24 hours'
    );

  select count(*)::int into v_sync_fail
  from public.shops sh
  join public.sync_health sy on sy.shop_id = sh.id
  where sh.pilot_cohort = true and sy.last_error is not null and trim (sy.last_error) <> '';

  select count(*)::int into v_queue
  from public.shops sh
  join public.sync_health sy on sy.shop_id = sh.id
  where sh.pilot_cohort = true and coalesce (sy.pending_outbound, 0) > 10;

  select count(*)::int into v_offline
  from public.shops sh
  where sh.pilot_cohort = true
    and (sh.last_seen_at is null or sh.last_seen_at < now () - interval '24 hours');

  select count(distinct sh.id)::int into v_outdated
  from public.shops sh
  join public.shop_devices d on d.shop_id = sh.id
  where sh.pilot_cohort = true and d.is_active and coalesce (d.app_version, '') <> '' and d.app_version < v_target;

  select coalesce (sum (s.total_ugx), 0)::bigint into v_revenue
  from public.sales s
  join public.shops sh on sh.id = s.shop_id
  where sh.pilot_cohort = true
    and s.status = 'completed'
    and s.completed_at >= now () - interval '30 days';

  select count(*)::int into v_crashes
  from public.app_crash_events e
  join public.shops sh on sh.id = e.shop_id
  where sh.pilot_cohort = true
    and e.created_at >= timezone ('Africa/Kampala', now ())::date::timestamptz;

  return jsonb_build_object (
    'total_pilot_shops', v_total,
    'active_pilot_shops', v_active,
    'at_risk_pilot_shops', v_at_risk,
    'shops_sync_failure', v_sync_fail,
    'shops_queue_overload', v_queue,
    'shops_offline_24h', v_offline,
    'shops_outdated_version', v_outdated,
    'pilot_revenue_ugx_30d', v_revenue,
    'pilot_crashes_today', v_crashes,
    'target_app_version', v_target
  );
end;
$$;

create or replace function public.internal_ops_pilot_shops (
  p_business_type text default null,
  p_plan_code text default null,
  p_active_only boolean default null,
  p_sync_filter text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest (1, least (coalesce (p_limit, 200), 500));
  v_target_version text := public._pilot_target_app_version();
  j jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select coalesce (jsonb_agg (row_to_json (t)::jsonb order by t.risk_score desc), '[]'::jsonb) into j
  from (
    select
      sh.id,
      sh.shop_number,
      sh.name,
      sh.business_type,
      sh.is_active,
      sh.last_seen_at,
      sh.pilot_cohort,
      sp.code as plan_code,
      sy.pending_outbound,
      sy.last_error,
      sy.last_push_ok_at,
      (
        select max (d.app_version)
        from public.shop_devices d
        where d.shop_id = sh.id and d.is_active
      ) as app_version,
      (
        select count(*)::int
        from public.app_crash_events ce
        where ce.shop_id = sh.id and ce.created_at >= timezone ('Africa/Kampala', now ())::date::timestamptz
      ) as crashes_today,
      case
        when not sh.is_active then 95
        when sy.last_error is not null and trim (sy.last_error) <> '' then 85
        when coalesce (sy.pending_outbound, 0) > 25 then 80
        when coalesce (sy.pending_outbound, 0) > 10 then 65
        when sh.last_seen_at is null or sh.last_seen_at < now () - interval '24 hours' then 70
        when exists (
          select 1
          from public.shop_devices d2
          where d2.shop_id = sh.id
            and d2.is_active
            and coalesce (d2.app_version, '') <> ''
            and d2.app_version < v_target_version
        ) then 55
        else 25
      end as risk_score,
      case
        when not sh.is_active then 'suspended'
        when sy.last_error is not null and trim (sy.last_error) <> '' then 'sync_failure'
        when coalesce (sy.pending_outbound, 0) > 10 then 'queue_overload'
        when sh.last_seen_at is null or sh.last_seen_at < now () - interval '24 hours' then 'offline'
        when exists (
          select 1
          from public.shop_devices d2
          where d2.shop_id = sh.id
            and d2.is_active
            and coalesce (d2.app_version, '') <> ''
            and d2.app_version < v_target_version
        ) then 'outdated_version'
        else 'healthy'
      end as health_status
    from public.shops sh
    left join public.organizations o on o.id = sh.organization_id
    left join public.subscriptions sub on sub.organization_id = o.id and sub.status in ('active', 'trial', 'trialing', 'paused')
    left join public.subscription_plans sp on sp.id = sub.plan_id
    left join public.sync_health sy on sy.shop_id = sh.id
    where sh.pilot_cohort = true
      and (p_business_type is null or p_business_type = '' or sh.business_type = p_business_type)
      and (p_plan_code is null or p_plan_code = '' or sp.code = p_plan_code)
      and (p_active_only is null or (p_active_only = true and sh.is_active) or (p_active_only = false and not sh.is_active))
      and (
        p_sync_filter is null
        or p_sync_filter = ''
        or (p_sync_filter = 'failure' and sy.last_error is not null and trim (sy.last_error) <> '')
        or (p_sync_filter = 'queue' and coalesce (sy.pending_outbound, 0) > 10)
        or (p_sync_filter = 'offline' and (sh.last_seen_at is null or sh.last_seen_at < now () - interval '24 hours'))
        or (p_sync_filter = 'outdated' and exists (
          select 1 from public.shop_devices d3
          where d3.shop_id = sh.id and d3.is_active and coalesce (d3.app_version, '') <> '' and d3.app_version < v_target_version
        ))
      )
    order by risk_score desc, sh.name
    limit v_limit
  ) t;

  return j;
end;
$$;

create or replace function public.internal_ops_operational_alerts ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target text := public._pilot_target_app_version();
  j jsonb;
  v_crash_hour int;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select count(*)::int into v_crash_hour
  from public.app_crash_events e
  where e.created_at >= now () - interval '1 hour';

  select coalesce (jsonb_agg (alert_row order by severity_rank desc), '[]'::jsonb) into j
  from (
    (
      select
        3 as severity_rank,
        jsonb_build_object (
          'kind', 'offline_24h',
          'severity', 'high',
          'shop_id', sh.id,
          'shop_name', sh.name,
          'message', 'No shop heartbeat in 24+ hours'
        ) as alert_row
      from public.shops sh
      where sh.pilot_cohort = true
        and (sh.last_seen_at is null or sh.last_seen_at < now () - interval '24 hours')
      limit 30
    )
    union all
    (
      select
        3 as severity_rank,
        jsonb_build_object (
          'kind', 'sync_failure',
          'severity', 'high',
          'shop_id', sh.id,
          'shop_name', sh.name,
          'message', left (coalesce (sy.last_error, 'Sync error'), 120)
        ) as alert_row
      from public.shops sh
      join public.sync_health sy on sy.shop_id = sh.id
      where sh.pilot_cohort = true and sy.last_error is not null and trim (sy.last_error) <> ''
      limit 30
    )
    union all
    (
      select
        2 as severity_rank,
        jsonb_build_object (
          'kind', 'queue_overload',
          'severity', 'medium',
          'shop_id', sh.id,
          'shop_name', sh.name,
          'message', 'Pending sync queue: ' || sy.pending_outbound::text
        ) as alert_row
      from public.shops sh
      join public.sync_health sy on sy.shop_id = sh.id
      where sh.pilot_cohort = true and coalesce (sy.pending_outbound, 0) > 10
      limit 30
    )
    union all
    (
      select
        1 as severity_rank,
        jsonb_build_object (
          'kind', 'outdated_version',
          'severity', 'low',
          'shop_id', sh.id,
          'shop_name', sh.name,
          'message', 'Device on version ' || d.app_version || ' (target ' || v_target || ')'
        ) as alert_row
      from public.shop_devices d
      join public.shops sh on sh.id = d.shop_id
      where sh.pilot_cohort = true
        and d.is_active
        and coalesce (d.app_version, '') <> ''
        and d.app_version < v_target
      limit 20
    )
    union all
    (
      select
        3 as severity_rank,
        jsonb_build_object (
          'kind', 'crash_spike',
          'severity', 'high',
          'shop_id', null,
          'shop_name', null,
          'message', '10+ crash reports in the last hour'
        ) as alert_row
      where v_crash_hour >= 10
    )
  ) alerts;

  return jsonb_build_object ('alerts', j);
end;
$$;
