-- Waka POS — Live dashboard metrics RPCs, subscription / device / sync admin tools, support & map data.

-- ---------- Schema: shop_devices (operational fields) ----------
alter table public.shop_devices
  add column if not exists app_version text;

alter table public.shop_devices
  add column if not exists trusted boolean not null default false;

alter table public.shop_devices
  add column if not exists suspicious_flag boolean not null default false;

comment on column public.shop_devices.app_version is 'Client app build for support triage.';
comment on column public.shop_devices.trusted is 'Marked trusted by Waka staff after review.';
comment on column public.shop_devices.suspicious_flag is 'Flagged for review (shared fingerprint, etc.).';

create index if not exists shop_devices_shop_seen_idx on public.shop_devices (shop_id, last_seen_at desc nulls last);

-- ---------- Schema: support_requests extras ----------
alter table public.support_requests
  add column if not exists issue_type text;

alter table public.support_requests
  add column if not exists device_fingerprint text;

alter table public.support_requests
  add column if not exists app_version text;

alter table public.support_requests
  add column if not exists sync_health_snapshot jsonb not null default '{}'::jsonb;

create index if not exists support_requests_assigned_idx on public.support_requests (assigned_internal_admin_id);

-- ---------- subscription_payments (SaaS billing, not sale_payments) ----------
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid (),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  amount_ugx bigint not null default 0 check (amount_ugx >= 0),
  currency text not null default 'UGX',
  provider text,
  reference text,
  status text not null default 'recorded' check (status in ('recorded', 'confirmed', 'failed')),
  recorded_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now ()
);

create index if not exists subscription_payments_sub_idx on public.subscription_payments (subscription_id, created_at desc);
create index if not exists subscription_payments_org_idx on public.subscription_payments (organization_id, created_at desc);

alter table public.subscription_payments enable row level security;

drop policy if exists subscription_payments_internal_select on public.subscription_payments;
create policy subscription_payments_internal_select
  on public.subscription_payments for select
  using (public.is_waka_internal_staff ());

-- ---------- Helper: write subscription_history (SECURITY DEFINER callers only) ----------
create or replace function public._internal_subscription_history_write (
  p_subscription_id uuid,
  p_action text,
  p_note text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shop uuid;
begin
  select s.organization_id, s.shop_id
  into v_org, v_shop
  from public.subscriptions s
  where s.id = p_subscription_id;

  if v_org is null then
    return;
  end if;

  insert into public.subscription_history (
    subscription_id,
    organization_id,
    shop_id,
    actor_user_id,
    action,
    note,
    payload
  )
  values (
    p_subscription_id,
    v_org,
    v_shop,
    auth.uid (),
    p_action,
    p_note,
    coalesce (p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._internal_subscription_history_write (uuid, text, text, jsonb) from public;

-- ---------- Dashboard: single JSON metrics (indexed-friendly counts) ----------
create or replace function public.internal_ops_dashboard_metrics ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := (
    (
      timezone ('Africa/Kampala', now ())::date
    )::text || ' 00:00:00+03:00'
  )::timestamptz;
  v_week_end timestamptz := now () + interval '7 days';
  j_district jsonb;
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

  select coalesce (sum (s.total_ugx)::bigint, 0)
  into v_sales
  from public.sales s
  where s.status = 'completed';

  return jsonb_build_object (
    'total_shops',
    (select count (*)::bigint from public.shops),
    'active_today',
    (select count (*)::bigint from public.shops sh where sh.last_seen_at >= v_day_start),
    'paid_subscriptions',
    (select count (*)::bigint from public.subscriptions s where s.status = 'active'),
    'trial_subscriptions',
    (select count (*)::bigint from public.subscriptions s where s.status in ('trial', 'trialing')),
    'expired_subscriptions',
    (select count (*)::bigint from public.subscriptions s where s.status = 'expired'),
    'lapsed_trials',
    (
      select count (*)::bigint
      from public.subscriptions s
      where s.status in ('trial', 'trialing')
        and s.trial_ends_at is not null
        and s.trial_ends_at < now ()
    ),
    'expiring_trials_7d',
    (
      select count (*)::bigint
      from public.subscriptions s
      where s.status in ('trial', 'trialing')
        and s.trial_ends_at is not null
        and s.trial_ends_at >= now ()
        and s.trial_ends_at <= v_week_end
    ),
    'active_devices',
    (select count (*)::bigint from public.shop_devices d where d.is_active = true),
    'open_support',
    (
      select count (*)::bigint
      from public.support_requests sr
      where sr.status in ('open', 'in_progress')
    ),
    'sales_total_ugx',
    v_sales,
    'shops_by_district',
    coalesce (j_district, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.internal_ops_dashboard_metrics () from public;
grant execute on function public.internal_ops_dashboard_metrics () to authenticated;

-- ---------- Charts: last 7 Kampala days (lightweight arrays) ----------
create or replace function public.internal_ops_chart_buckets_7d ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d0 date := (timezone ('Africa/Kampala', now ())::date - 6);
  i int;
  d date;
  arr_s int[] := array[]::int[];
  arr_sub int[] := array[]::int[];
  arr_sales bigint[] := array[]::bigint[];
  lbl text[] := array[]::text[];
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  for i in 0..6 loop
    d := d0 + i;
    lbl := array_append (lbl, to_char (d, 'MM-DD'));

    arr_s := array_append (
      arr_s,
      (
        select count (*)::int
        from public.shops sh
        where (sh.created_at at time zone 'Africa/Kampala')::date = d
      )
    );

    arr_sub := array_append (
      arr_sub,
      (
        select count (*)::int
        from public.subscriptions s
        where (s.created_at at time zone 'Africa/Kampala')::date = d
      )
    );

    arr_sales := array_append (
      arr_sales,
      coalesce(
        (
          select sum (sa.total_ugx)::bigint
          from public.sales sa
          where sa.status = 'completed'
            and sa.completed_at is not null
            and (sa.completed_at at time zone 'Africa/Kampala')::date = d
        ),
        0
      )
    );
  end loop;

  return jsonb_build_object (
    'labels',
    to_jsonb (lbl),
    'shop_signups',
    to_jsonb (arr_s),
    'subscriptions',
    to_jsonb (arr_sub),
    'sales_ugx',
    to_jsonb (arr_sales)
  );
end;
$$;

revoke all on function public.internal_ops_chart_buckets_7d () from public;
grant execute on function public.internal_ops_chart_buckets_7d () to authenticated;

-- ---------- Field map pins (GPS shops; field agents district-scoped) ----------
create or replace function public.internal_ops_field_map_pins (
  p_district_id uuid default null,
  p_limit int default 400
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int := least (greatest (coalesce (p_limit, 400), 1), 800);
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return coalesce(
    (
      select jsonb_agg (to_jsonb (t))
      from (
        select
          sh.id as shop_id,
          sh.name as shop_name,
          sh.latitude as lat,
          sh.longitude as lng,
          sh.district,
          sh.city,
          sh.is_active,
          sh.district_id
        from public.shops sh
        where sh.latitude is not null
          and sh.longitude is not null
          and (
            p_district_id is null
            or sh.district_id = p_district_id
          )
          and (
            not public.is_waka_internal_role (array['field_agent']::text[])
            or (
              sh.district_id is not null
              and sh.district_id = any (public.waka_internal_my_districts ())
            )
          )
        order by sh.updated_at desc nulls last
        limit lim
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.internal_ops_field_map_pins (uuid, int) from public;
grant execute on function public.internal_ops_field_map_pins (uuid, int) to authenticated;

-- ---------- Support queue (joined; one round trip) ----------
create or replace function public.internal_ops_support_queue (p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
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
          sh.id as shop_id,
          sh.name as shop_name,
          sh.district as shop_district,
          sh.phone_e164 as shop_phone_e164,
          pr.full_name as owner_name,
          pr.email as owner_email,
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
        left join public.profiles pr on pr.id = own.user_id
        left join public.internal_admins ia on ia.id = sr.assigned_internal_admin_id
        order by sr.created_at desc
        limit lim
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.internal_ops_support_queue (int) from public;
grant execute on function public.internal_ops_support_queue (int) to authenticated;

-- ---------- Shop detail for internal console ----------
create or replace function public.internal_ops_shop_detail (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select
    jsonb_build_object (
      'shop',
      to_jsonb (sh),
      'owner_label',
      coalesce(
        nullif (trim (pr.full_name), ''),
        nullif (trim (pr.email), ''),
        nullif (trim (pr.business_name), ''),
        own.user_id::text
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
      )
    )
  into j
  from public.shops sh
  left join lateral (
    select sm.user_id
    from public.shop_members sm
    where sm.shop_id = sh.id
      and sm.role = 'owner'
    order by sm.created_at asc
    limit 1
  ) own on true
  left join public.profiles pr on pr.id = own.user_id
  where sh.id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

revoke all on function public.internal_ops_shop_detail (uuid) from public;
grant execute on function public.internal_ops_shop_detail (uuid) to authenticated;

-- ---------- Replace trial extend: add subscription_history ----------
create or replace function public.admin_extend_subscription_trial (
  p_subscription_id uuid,
  p_extra_days int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if p_extra_days is null or p_extra_days < 1 or p_extra_days > 366 then
    raise exception 'Invalid trial extension';
  end if;

  update public.subscriptions s
  set
    trial_ends_at = coalesce (s.trial_ends_at, timezone ('Africa/Kampala', now ())) + (p_extra_days::text || ' days')::interval,
    updated_at = now (),
    activation_source = coalesce (s.activation_source, 'manual_admin'),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object (
        'trial_extended_days', p_extra_days,
        'trial_extended_at', to_jsonb (timezone ('Africa/Kampala', now ())::text),
        'trial_extended_by', auth.uid ()::text
      )
  where s.id = p_subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;

  perform public._internal_subscription_history_write (
    p_subscription_id,
    'extend_trial',
    format ('+%s days', p_extra_days),
    jsonb_build_object ('extra_days', p_extra_days)
  );

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    null,
    auth.uid (),
    'internal',
    'admin_extend_subscription_trial',
    'Extended trial on subscription ' || p_subscription_id::text,
    jsonb_build_object ('subscription_id', p_subscription_id, 'extra_days', p_extra_days)
  );
end;
$$;

-- ---------- Subscription: set plan (upgrade / downgrade) ----------
create or replace function public.admin_subscription_set_plan (
  p_subscription_id uuid,
  p_plan_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan uuid;
  v_old text;
begin
  if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  select sp.id
  into v_plan
  from public.subscription_plans sp
  where sp.code = lower (trim (p_plan_code))
    and sp.is_active
  limit 1;

  if v_plan is null then
    raise exception 'Unknown plan';
  end if;

  select sp2.code
  into v_old
  from public.subscriptions s
  join public.subscription_plans sp2 on sp2.id = s.plan_id
  where s.id = p_subscription_id;

  update public.subscriptions s
  set
    plan_id = v_plan,
    updated_at = now (),
    activation_source = coalesce (s.activation_source, 'manual_admin'),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object ('plan_changed_by', auth.uid ()::text, 'plan_changed_at', timezone ('Africa/Kampala', now ())::text)
  where s.id = p_subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;

  perform public._internal_subscription_history_write (
    p_subscription_id,
    'set_plan',
    format ('%s → %s', v_old, lower (trim (p_plan_code))),
    jsonb_build_object ('from_plan', v_old, 'to_plan', lower (trim (p_plan_code)))
  );

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  select
    s.shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_set_plan',
    'Plan change',
    jsonb_build_object ('subscription_id', p_subscription_id, 'plan_code', lower (trim (p_plan_code)))
  from public.subscriptions s
  where s.id = p_subscription_id;
end;
$$;

revoke all on function public.admin_subscription_set_plan (uuid, text) from public;
grant execute on function public.admin_subscription_set_plan (uuid, text) to authenticated;

-- ---------- Subscription: lifecycle status ----------
create or replace function public.admin_subscription_set_status (
  p_subscription_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_st text := lower (trim (p_status));
begin
  if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if v_st not in (
    'trial',
    'trialing',
    'active',
    'expired',
    'past_due',
    'cancelled',
    'canceled',
    'paused'
  ) then
    raise exception 'Invalid status';
  end if;

  update public.subscriptions s
  set
    status = case
      when v_st = 'canceled' then 'cancelled'
      else v_st
    end,
    updated_at = now (),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object ('status_set_by', auth.uid ()::text, 'status_set_at', timezone ('Africa/Kampala', now ())::text)
  where s.id = p_subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;

  perform public._internal_subscription_history_write (
    p_subscription_id,
    'set_status',
    v_st,
    jsonb_build_object ('status', v_st)
  );

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  select
    s.shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_set_status',
    'Subscription status ' || v_st,
    jsonb_build_object ('subscription_id', p_subscription_id, 'status', v_st)
  from public.subscriptions s
  where s.id = p_subscription_id;
end;
$$;

revoke all on function public.admin_subscription_set_status (uuid, text) from public;
grant execute on function public.admin_subscription_set_status (uuid, text) to authenticated;

-- ---------- Mark subscription payment received ----------
create or replace function public.admin_subscription_mark_payment (
  p_subscription_id uuid,
  p_amount_ugx bigint,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'subscriptions_admin', 'finance_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  select s.organization_id
  into v_org
  from public.subscriptions s
  where s.id = p_subscription_id;

  if v_org is null then
    raise exception 'Subscription not found';
  end if;

  update public.subscriptions s
  set
    payment_status = 'paid',
    updated_at = now (),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object ('payment_marked_by', auth.uid ()::text, 'payment_marked_at', timezone ('Africa/Kampala', now ())::text)
  where s.id = p_subscription_id;

  if not found then
    raise exception 'Subscription not found';
  end if;

  insert into public.subscription_payments (
    subscription_id,
    organization_id,
    amount_ugx,
    provider,
    status,
    recorded_by,
    note
  )
  values (
    p_subscription_id,
    v_org,
    greatest (coalesce (p_amount_ugx, 0), 0),
    'manual_admin',
    'confirmed',
    auth.uid (),
    nullif (trim (p_note), '')
  );

  perform public._internal_subscription_history_write (
    p_subscription_id,
    'mark_payment',
    coalesce (nullif (trim (p_note), ''), 'Payment recorded'),
    jsonb_build_object ('amount_ugx', p_amount_ugx)
  );

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  select
    s.shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_mark_payment',
    'Marked payment received',
    jsonb_build_object ('subscription_id', p_subscription_id, 'amount_ugx', p_amount_ugx)
  from public.subscriptions s
  where s.id = p_subscription_id;
end;
$$;

revoke all on function public.admin_subscription_mark_payment (uuid, bigint, text) from public;
grant execute on function public.admin_subscription_mark_payment (uuid, bigint, text) to authenticated;

-- ---------- Shop: reset sync state ----------
create or replace function public.admin_shop_reset_sync (p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  insert into public.sync_health (shop_id, pending_outbound, last_error, last_pull_at, last_push_ok_at, updated_at)
  values (p_shop_id, 0, null, null, null, now ())
  on conflict (shop_id) do update
  set
    pending_outbound = 0,
    last_error = null,
    last_pull_at = null,
    last_push_ok_at = null,
    updated_at = now ();

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
    'admin_shop_reset_sync',
    'Reset cloud sync markers',
    jsonb_build_object ('shop_id', p_shop_id)
  );
end;
$$;

revoke all on function public.admin_shop_reset_sync (uuid) from public;
grant execute on function public.admin_shop_reset_sync (uuid) to authenticated;

-- ---------- Shop: force logout (deactivate all devices) ----------
create or replace function public.admin_shop_force_logout_devices (p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  update public.shop_devices d
  set
    is_active = false,
    updated_at = now ()
  where d.shop_id = p_shop_id;

  update public.shops sh
  set
    active_device_count = 0,
    updated_at = now ()
  where sh.id = p_shop_id;

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
    'admin_shop_force_logout_devices',
    'Deactivated all registered devices',
    jsonb_build_object ('shop_id', p_shop_id)
  );
end;
$$;

revoke all on function public.admin_shop_force_logout_devices (uuid) from public;
grant execute on function public.admin_shop_force_logout_devices (uuid) to authenticated;

-- ---------- Device: activate / deactivate / trust ----------
create or replace function public.admin_shop_device_set_active (
  p_device_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  update public.shop_devices d
  set
    is_active = p_active,
    updated_at = now ()
  where d.id = p_device_id
  returning d.shop_id into v_shop;

  if v_shop is null then
    raise exception 'Device not found';
  end if;

  update public.shops sh
  set
    active_device_count = (
      select count (*)::int
      from public.shop_devices d2
      where d2.shop_id = v_shop
        and d2.is_active = true
    ),
    updated_at = now ()
  where sh.id = v_shop;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    v_shop,
    auth.uid (),
    'internal',
    'admin_shop_device_set_active',
    format ('Device %s active=%s', p_device_id::text, p_active::text),
    jsonb_build_object ('device_id', p_device_id, 'active', p_active)
  );
end;
$$;

revoke all on function public.admin_shop_device_set_active (uuid, boolean) from public;
grant execute on function public.admin_shop_device_set_active (uuid, boolean) to authenticated;

create or replace function public.admin_shop_device_set_trusted (
  p_device_id uuid,
  p_trusted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  update public.shop_devices d
  set
    trusted = p_trusted,
    updated_at = now ()
  where d.id = p_device_id
  returning d.shop_id into v_shop;

  if v_shop is null then
    raise exception 'Device not found';
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
    v_shop,
    auth.uid (),
    'internal',
    'admin_shop_device_set_trusted',
    format ('Device %s trusted=%s', p_device_id::text, p_trusted::text),
    jsonb_build_object ('device_id', p_device_id, 'trusted', p_trusted)
  );
end;
$$;

revoke all on function public.admin_shop_device_set_trusted (uuid, boolean) from public;
grant execute on function public.admin_shop_device_set_trusted (uuid, boolean) to authenticated;

-- ---------- Open internal support thread for a shop ----------
create or replace function public.admin_shop_open_support_message (
  p_shop_id uuid,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin', 'finance_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  select sh.organization_id
  into v_org
  from public.shops sh
  where sh.id = p_shop_id;

  if v_org is null then
    raise exception 'Shop not found';
  end if;

  insert into public.support_requests (
    shop_id,
    organization_id,
    channel,
    subject,
    body,
    status,
    priority,
    issue_type,
    metadata
  )
  values (
    p_shop_id,
    v_org,
    'other',
    coalesce (nullif (trim (p_subject), ''), 'Staff message'),
    nullif (trim (p_body), ''),
    'open',
    'normal',
    'internal_admin',
    jsonb_build_object ('opened_by_internal', auth.uid ()::text)
  )
  returning id into v_id;

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
    'admin_shop_open_support_message',
    'Opened support thread',
    jsonb_build_object ('support_request_id', v_id)
  );

  return v_id;
end;
$$;

revoke all on function public.admin_shop_open_support_message (uuid, text, text) from public;
grant execute on function public.admin_shop_open_support_message (uuid, text, text) to authenticated;

create index if not exists subscriptions_status_trial_end_idx on public.subscriptions (status, trial_ends_at)
  where status in ('trial', 'trialing');
