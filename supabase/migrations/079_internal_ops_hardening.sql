-- Internal ops hardening: pilot cohort, shared notes, crash log, pilot dashboard RPCs.

-- ---------- Pilot cohort flag ----------
alter table public.shops
  add column if not exists pilot_cohort boolean not null default false;

create index if not exists shops_pilot_cohort_idx on public.shops (pilot_cohort)
where
  pilot_cohort = true;

comment on column public.shops.pilot_cohort is 'True when shop is in the active pilot program cohort.';

-- ---------- Shared internal notes ----------
create table if not exists public.internal_shop_notes (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  author_internal_admin_id uuid references public.internal_admins (id) on delete set null,
  author_label text not null,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now ()
);

create index if not exists internal_shop_notes_shop_idx on public.internal_shop_notes (shop_id, created_at desc);

create table if not exists public.internal_ticket_notes (
  id uuid primary key default gen_random_uuid (),
  support_request_id uuid not null references public.support_requests (id) on delete cascade,
  author_internal_admin_id uuid references public.internal_admins (id) on delete set null,
  author_label text not null,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now ()
);

create index if not exists internal_ticket_notes_ticket_idx on public.internal_ticket_notes (support_request_id, created_at desc);

alter table public.internal_shop_notes enable row level security;
alter table public.internal_ticket_notes enable row level security;

drop policy if exists internal_shop_notes_staff on public.internal_shop_notes;
create policy internal_shop_notes_staff
  on public.internal_shop_notes for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists internal_ticket_notes_staff on public.internal_ticket_notes;
create policy internal_ticket_notes_staff
  on public.internal_ticket_notes for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- ---------- Client-reported crashes (read-only in admin; complements Sentry) ----------
create table if not exists public.app_crash_events (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  device_fingerprint text,
  device_id text,
  app_version text,
  scope text,
  message text,
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists app_crash_events_created_idx on public.app_crash_events (created_at desc);
create index if not exists app_crash_events_shop_idx on public.app_crash_events (shop_id, created_at desc);

alter table public.app_crash_events enable row level security;

drop policy if exists app_crash_events_insert on public.app_crash_events;
create policy app_crash_events_insert
  on public.app_crash_events for insert
  with check (auth.uid () is not null);

drop policy if exists app_crash_events_internal_select on public.app_crash_events;
create policy app_crash_events_internal_select
  on public.app_crash_events for select
  using (public.is_waka_internal_staff ());

-- ---------- Support: pilot diagnostics payload ----------
alter table public.support_requests
  add column if not exists diagnostics_json jsonb,
  add column if not exists screenshot_meta jsonb;

comment on column public.support_requests.diagnostics_json is 'Owner-exported pilot diagnostics JSON from Support Center.';
comment on column public.support_requests.screenshot_meta is 'Optional screenshot file name / hint from Support Center.';

-- ---------- Report crash from app ----------
create or replace function public.app_report_crash_event (
  p_shop_id uuid default null,
  p_device_fingerprint text default null,
  p_device_id text default null,
  p_app_version text default null,
  p_scope text default null,
  p_message text default null,
  p_extras jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    return;
  end if;

  insert into public.app_crash_events (
    shop_id,
    user_id,
    device_fingerprint,
    device_id,
    app_version,
    scope,
    message,
    extras
  )
  values (
    p_shop_id,
    auth.uid (),
    nullif (trim (p_device_fingerprint), ''),
    nullif (trim (p_device_id), ''),
    nullif (trim (p_app_version), ''),
    nullif (trim (p_scope), ''),
    left (coalesce (p_message, ''), 2000),
    coalesce (p_extras, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.app_report_crash_event (uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.app_report_crash_event (uuid, text, text, text, text, text, jsonb) to authenticated;

-- ---------- Owner: submit pilot support ticket ----------
create or replace function public.shop_submit_pilot_support_ticket (
  p_shop_id uuid,
  p_subject text,
  p_body text,
  p_diagnostics jsonb default null,
  p_screenshot_meta jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select sh.organization_id into v_org from public.shops sh where sh.id = p_shop_id;

  insert into public.support_requests (
    shop_id,
    organization_id,
    opened_by_user_id,
    channel,
    subject,
    body,
    status,
    priority,
    issue_type,
    diagnostics_json,
    screenshot_meta,
    app_version,
    device_fingerprint,
    sync_health_snapshot,
    metadata
  )
  values (
    p_shop_id,
    v_org,
    auth.uid (),
    'app',
    left (coalesce (nullif (trim (p_subject), ''), 'Pilot support'), 200),
    coalesce (nullif (trim (p_body), ''), '—'),
    'open',
    'normal',
    'pilot_support',
    p_diagnostics,
    p_screenshot_meta,
    coalesce (p_diagnostics ->> 'appVersion', p_diagnostics ->> 'app_version'),
    coalesce (p_diagnostics ->> 'deviceId', p_diagnostics ->> 'device_id'),
    coalesce (p_diagnostics -> 'syncHealth', '{}'::jsonb),
    jsonb_build_object ('source', 'pilot_support_center')
  )
  returning id into v_id;

  return jsonb_build_object ('ok', true, 'ticket_id', v_id);
end;
$$;

revoke all on function public.shop_submit_pilot_support_ticket (uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.shop_submit_pilot_support_ticket (uuid, text, text, jsonb, jsonb) to authenticated;

-- ---------- Admin: toggle pilot cohort ----------
create or replace function public.admin_set_shop_pilot_cohort (p_shop_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  update public.shops sh
  set pilot_cohort = coalesce (p_enabled, false)
  where sh.id = p_shop_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, payload)
  values (
    auth.uid (),
    case when p_enabled then 'pilot_cohort_on' else 'pilot_cohort_off' end,
    p_shop_id,
    jsonb_build_object ('enabled', coalesce (p_enabled, false))
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.admin_set_shop_pilot_cohort (uuid, boolean) from public;
grant execute on function public.admin_set_shop_pilot_cohort (uuid, boolean) to authenticated;

-- ---------- Notes ----------
create or replace function public.internal_ops_add_shop_note (p_shop_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.internal_admins%rowtype;
  v_id uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select * into v_admin
  from public.internal_admins ia
  where coalesce (ia.auth_user_id, ia.user_id) = auth.uid () and coalesce (ia.is_active, ia.active, true)
  limit 1;

  insert into public.internal_shop_notes (shop_id, author_internal_admin_id, author_label, body)
  values (
    p_shop_id,
    v_admin.id,
    coalesce (nullif (trim (v_admin.full_name), ''), nullif (trim (v_admin.email), ''), 'Staff'),
    trim (p_body)
  )
  returning id into v_id;

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

create or replace function public.internal_ops_add_ticket_note (p_ticket_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.internal_admins%rowtype;
  v_id uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select * into v_admin
  from public.internal_admins ia
  where coalesce (ia.auth_user_id, ia.user_id) = auth.uid () and coalesce (ia.is_active, ia.active, true)
  limit 1;

  insert into public.internal_ticket_notes (support_request_id, author_internal_admin_id, author_label, body)
  values (
    p_ticket_id,
    v_admin.id,
    coalesce (nullif (trim (v_admin.full_name), ''), nullif (trim (v_admin.email), ''), 'Staff'),
    trim (p_body)
  )
  returning id into v_id;

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

create or replace function public.internal_ops_list_shop_notes (p_shop_id uuid, p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;
  return (
    select coalesce (
      jsonb_agg (
        jsonb_build_object (
          'id', n.id,
          'body', n.body,
          'author', n.author_label,
          'created_at', n.created_at
        )
        order by n.created_at desc
      ),
      '[]'::jsonb
    )
    from (
      select *
      from public.internal_shop_notes n
      where n.shop_id = p_shop_id
      order by n.created_at desc
      limit greatest (1, least (coalesce (p_limit, 40), 80))
    ) n
  );
end;
$$;

create or replace function public.internal_ops_list_ticket_notes (p_ticket_id uuid, p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;
  return (
    select coalesce (
      jsonb_agg (
        jsonb_build_object (
          'id', n.id,
          'body', n.body,
          'author', n.author_label,
          'created_at', n.created_at
        )
        order by n.created_at desc
      ),
      '[]'::jsonb
    )
    from (
      select *
      from public.internal_ticket_notes n
      where n.support_request_id = p_ticket_id
      order by n.created_at desc
      limit greatest (1, least (coalesce (p_limit, 40), 80))
    ) n
  );
end;
$$;

revoke all on function public.internal_ops_add_shop_note (uuid, text) from public;
grant execute on function public.internal_ops_add_shop_note (uuid, text) to authenticated;
revoke all on function public.internal_ops_add_ticket_note (uuid, text) from public;
grant execute on function public.internal_ops_add_ticket_note (uuid, text) to authenticated;
revoke all on function public.internal_ops_list_shop_notes (uuid, int) from public;
grant execute on function public.internal_ops_list_shop_notes (uuid, int) to authenticated;
revoke all on function public.internal_ops_list_ticket_notes (uuid, int) from public;
grant execute on function public.internal_ops_list_ticket_notes (uuid, int) to authenticated;

-- ---------- Migration visibility (marker functions) ----------
create or replace function public.internal_ops_migration_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb := '[]'::jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  j := j || jsonb_build_object (
    'id', '076_scale_hardening',
    'status',
    case
      when to_regprocedure ('public.shop_push_debt_payment(uuid,jsonb)') is not null then 'applied'
      else 'missing'
    end
  );

  j := j || jsonb_build_object (
    'id', '077_financial_integrity',
    'status',
    case
      when to_regprocedure ('public.shop_push_sale_complete(uuid,jsonb)') is not null then 'applied'
      else 'missing'
    end
  );

  j := j || jsonb_build_object (
    'id', '078_business_type_persistence',
    'status',
    case
      when to_regprocedure ('public.is_valid_shop_business_type(text)') is not null then 'applied'
      else 'missing'
    end
  );

  return jsonb_build_object ('migrations', j);
end;
$$;

revoke all on function public.internal_ops_migration_status () from public;
grant execute on function public.internal_ops_migration_status () to authenticated;

-- ---------- Crash summary ----------
create or replace function public.internal_ops_crash_summary ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := timezone ('Africa/Kampala', now ())::date::timestamptz;
  j_today int;
  j_versions jsonb;
  j_shops jsonb;
  j_devices jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select count(*)::int into j_today
  from public.app_crash_events e
  where e.created_at >= v_day_start;

  select coalesce (jsonb_agg (x), '[]'::jsonb) into j_versions
  from (
    select coalesce (nullif (trim (e.app_version), ''), 'unknown') as version, count (*)::int as count
    from public.app_crash_events e
    where e.created_at >= v_day_start
    group by 1
    order by count (*) desc
    limit 10
  ) x;

  select coalesce (jsonb_agg (x), '[]'::jsonb) into j_shops
  from (
    select sh.id as shop_id, sh.name as shop_name, count (*)::int as count
    from public.app_crash_events e
    join public.shops sh on sh.id = e.shop_id
    where e.created_at >= v_day_start
    group by sh.id, sh.name
    order by count (*) desc
    limit 15
  ) x;

  select coalesce (jsonb_agg (x), '[]'::jsonb) into j_devices
  from (
    select coalesce (nullif (trim (e.device_id), ''), e.device_fingerprint, 'unknown') as device_key, count (*)::int as count
    from public.app_crash_events e
    where e.created_at >= v_day_start
    group by 1
    order by count (*) desc
    limit 15
  ) x;

  return jsonb_build_object (
    'crashes_today', j_today,
    'by_version', j_versions,
    'by_shop', j_shops,
    'by_device', j_devices
  );
end;
$$;

revoke all on function public.internal_ops_crash_summary () from public;
grant execute on function public.internal_ops_crash_summary () to authenticated;

-- ---------- Device search ----------
create or replace function public.internal_ops_device_search (p_query text, p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower (trim (coalesce (p_query, '')));
  j jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if length (v_q) < 2 then
    return '[]'::jsonb;
  end if;

  select coalesce (jsonb_agg (row_to_json (x)::jsonb), '[]'::jsonb) into j
  from (
    select
      d.id as device_id,
      d.shop_id,
      sh.name as shop_name,
      sh.shop_number,
      d.device_fingerprint,
      d.label,
      d.platform,
      d.app_version,
      d.last_seen_at,
      sy.pending_outbound,
      sy.last_error,
      sy.last_push_ok_at,
      sy.last_pull_at,
      lower (trim (pr.email)) as owner_email
    from public.shop_devices d
    join public.shops sh on sh.id = d.shop_id
    left join public.sync_health sy on sy.shop_id = sh.id
    left join lateral (
      select sm.user_id from public.shop_members sm where sm.shop_id = sh.id and sm.role = 'owner' limit 1
    ) own on true
    left join public.profiles pr on pr.user_id = own.user_id
    where
      d.id::text = v_q
      or lower (d.device_fingerprint) like '%' || v_q || '%'
      or lower (coalesce (d.label, '')) like '%' || v_q || '%'
      or d.id::text like v_q || '%'
    order by d.last_seen_at desc nulls last
    limit greatest (1, least (coalesce (p_limit, 20), 50))
  ) x;

  return j;
end;
$$;

revoke all on function public.internal_ops_device_search (text, int) from public;
grant execute on function public.internal_ops_device_search (text, int) to authenticated;

-- ---------- Pilot shops list + dashboard ----------
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
  v_target_version text := '1.0.5';
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

create or replace function public.internal_ops_pilot_dashboard ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target text := '1.0.5';
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

create or replace function public.internal_ops_operational_alerts ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target text := '1.0.5';
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

revoke all on function public.internal_ops_pilot_shops (text, text, boolean, text, int) from public;
grant execute on function public.internal_ops_pilot_shops (text, text, boolean, text, int) to authenticated;
revoke all on function public.internal_ops_pilot_dashboard () from public;
grant execute on function public.internal_ops_pilot_dashboard () to authenticated;
revoke all on function public.internal_ops_operational_alerts () from public;
grant execute on function public.internal_ops_operational_alerts () to authenticated;
