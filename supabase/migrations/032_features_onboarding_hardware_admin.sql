-- Waka POS — Feature entitlements (AI stock assistant), support flows (pending + issue types),
-- transactional owner business profile save, extended dashboard + field map pins,
-- hardware / print queue tables (foundation).

-- ---------- 1) support_requests: allow pending status ----------
alter table public.support_requests
  drop constraint if exists support_requests_status_check;

alter table public.support_requests
  add constraint support_requests_status_check
  check (status in ('pending', 'open', 'in_progress', 'resolved', 'closed'));

comment on column public.support_requests.status is 'pending = awaiting staff triage (AI / annual requests).';

-- ---------- 2) Organization feature entitlements (AI assistant, etc.) ----------
create table if not exists public.organization_feature_entitlements (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_code text not null
    check (feature_code in ('ai_stock_assistant')),
  status text not null default 'none'
    check (status in ('none', 'pending', 'trial', 'active', 'rejected')),
  trial_ends_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  primary key (organization_id, feature_code)
);

create index if not exists org_feature_entitlements_status_idx
  on public.organization_feature_entitlements (status, feature_code);

alter table public.organization_feature_entitlements enable row level security;

drop policy if exists org_feature_entitlements_member_select on public.organization_feature_entitlements;
create policy org_feature_entitlements_member_select
  on public.organization_feature_entitlements for select
  to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_feature_entitlements.organization_id
        and om.user_id = auth.uid ()
    )
  );

drop policy if exists org_feature_entitlements_internal_all on public.organization_feature_entitlements;
create policy org_feature_entitlements_internal_all
  on public.organization_feature_entitlements for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- ---------- 3) Hardware foundation ----------
create table if not exists public.shop_hardware (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  device_kind text not null,
  config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists shop_hardware_shop_idx on public.shop_hardware (shop_id, device_kind);

alter table public.shop_hardware enable row level security;

drop policy if exists shop_hardware_member_rw on public.shop_hardware;
create policy shop_hardware_member_rw
  on public.shop_hardware for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_hardware_internal_all on public.shop_hardware;
create policy shop_hardware_internal_all
  on public.shop_hardware for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists print_jobs_shop_created_idx on public.print_jobs (shop_id, created_at desc);

alter table public.print_jobs enable row level security;

drop policy if exists print_jobs_member_rw on public.print_jobs;
create policy print_jobs_member_rw
  on public.print_jobs for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

create table if not exists public.device_logs (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete cascade,
  device_fingerprint text,
  level text not null default 'info',
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists device_logs_shop_created_idx on public.device_logs (shop_id, created_at desc);

alter table public.device_logs enable row level security;

drop policy if exists device_logs_member_insert on public.device_logs;
create policy device_logs_member_insert
  on public.device_logs for insert
  to authenticated
  with check (
    shop_id is not null
    and public.user_can_manage_shop (shop_id)
  );

drop policy if exists device_logs_internal_all on public.device_logs;
create policy device_logs_internal_all
  on public.device_logs for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

create table if not exists public.barcode_labels (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid,
  symbology text not null default 'code128',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists barcode_labels_shop_idx on public.barcode_labels (shop_id, created_at desc);

alter table public.barcode_labels enable row level security;

drop policy if exists barcode_labels_member_rw on public.barcode_labels;
create policy barcode_labels_member_rw
  on public.barcode_labels for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

create table if not exists public.hardware_pairings (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  adapter text not null,
  paired_device_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists hardware_pairings_shop_idx on public.hardware_pairings (shop_id, adapter);

alter table public.hardware_pairings enable row level security;

drop policy if exists hardware_pairings_member_rw on public.hardware_pairings;
create policy hardware_pairings_member_rw
  on public.hardware_pairings for all
  using (public.user_can_manage_shop (shop_id))
  with check (public.user_can_manage_shop (shop_id));

-- ---------- 4) Owner onboarding status (for app gate) ----------
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
  v_complete boolean := false;
  v_missing text[] := array[]::text[];
begin
  if v_uid is null then
    return jsonb_build_object ('complete', true, 'missing', '[]'::jsonb);
  end if;

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
  if v_shop.default_currency is null or length (trim (v_shop.default_currency)) <> 3 then
    v_missing := array_append (v_missing, 'currency');
  end if;

  v_complete := coalesce (array_length (v_missing, 1), 0) = 0;
  return jsonb_build_object ('complete', v_complete, 'missing', to_jsonb (v_missing));
end;
$$;

revoke all on function public.owner_onboarding_status () from public;
grant execute on function public.owner_onboarding_status () to authenticated;

-- ---------- 5) Transactional business profile save + starter trial ----------
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

-- ---------- 6) AI stock assistant + annual plan support requests ----------
create or replace function public.request_ai_stock_assistant ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org uuid;
  v_shop uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select om.organization_id
  into v_org
  from public.organization_members om
  where om.user_id = v_uid and om.role in ('owner', 'admin')
  order by om.created_at asc
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  select s.id into v_shop from public.shops s where s.organization_id = v_org order by s.created_at asc limit 1;

  insert into public.support_requests (
    shop_id,
    organization_id,
    opened_by_user_id,
    channel,
    subject,
    body,
    status,
    priority,
    issue_type
  )
  values (
    v_shop,
    v_org,
    v_uid,
    'app',
    'AI Stock Assistant request',
    'Owner requested AI-assisted stock setup from Back Office.',
    'pending',
    'normal',
    'ai_stock_setup'
  );

  insert into public.organization_feature_entitlements (organization_id, feature_code, status, metadata)
  values (v_org, 'ai_stock_assistant', 'pending', jsonb_build_object ('requested_at', now ()))
  on conflict (organization_id, feature_code) do update
  set status = 'pending', updated_at = now (), metadata = organization_feature_entitlements.metadata || jsonb_build_object ('requested_at', now ());

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
  values (v_uid, 'ai_stock_assistant_requested', v_shop, v_org, '{}'::jsonb);

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.request_ai_stock_assistant () from public;
grant execute on function public.request_ai_stock_assistant () to authenticated;

create or replace function public.request_annual_plan_support ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org uuid;
  v_shop uuid;
  v_plan text;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select om.organization_id
  into v_org
  from public.organization_members om
  where om.user_id = v_uid and om.role in ('owner', 'admin')
  order by om.created_at asc
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  select s.id into v_shop from public.shops s where s.organization_id = v_org order by s.created_at asc limit 1;

  select sp.code into v_plan
  from public.subscriptions sub
  join public.subscription_plans sp on sp.id = sub.plan_id
  where sub.organization_id = v_org
  order by sub.created_at desc
  limit 1;

  insert into public.support_requests (
    shop_id,
    organization_id,
    opened_by_user_id,
    channel,
    subject,
    body,
    status,
    priority,
    issue_type
  )
  values (
    v_shop,
    v_org,
    v_uid,
    'app',
    'Annual subscription pricing request',
    format ('Current plan (if any): %s. Owner asked for annual business pricing.', coalesce (v_plan, 'none')),
    'pending',
    'normal',
    'annual_plan_request'
  );

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
  values (v_uid, 'annual_plan_requested', v_shop, v_org, jsonb_build_object ('plan', v_plan));

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.request_annual_plan_support () from public;
grant execute on function public.request_annual_plan_support () to authenticated;

create or replace function public.request_free_ai_trial ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org uuid;
  v_shop uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select om.organization_id into v_org
  from public.organization_members om
  where om.user_id = v_uid and om.role in ('owner', 'admin')
  order by om.created_at asc
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  select s.id into v_shop from public.shops s where s.organization_id = v_org order by s.created_at asc limit 1;

  insert into public.support_requests (
    shop_id, organization_id, opened_by_user_id, channel, subject, body, status, priority, issue_type
  )
  values (
    v_shop, v_org, v_uid, 'app', 'Free AI Stock trial request',
    'Owner requested a free trial of AI Stock Assistant.',
    'pending', 'normal', 'ai_stock_trial_request'
  );

  insert into public.organization_feature_entitlements (organization_id, feature_code, status, metadata)
  values (v_org, 'ai_stock_assistant', 'pending', jsonb_build_object ('trial_request', true, 'requested_at', now ()))
  on conflict (organization_id, feature_code) do update
  set status = 'pending', updated_at = now (),
      metadata = organization_feature_entitlements.metadata || jsonb_build_object ('trial_request', true, 'requested_at', now ());

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.request_free_ai_trial () from public;
grant execute on function public.request_free_ai_trial () to authenticated;

-- ---------- 7) Staff: activate AI for org (trial) ----------
create or replace function public.internal_ops_activate_ai_stock_assistant (
  p_organization_id uuid,
  p_trial_days int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  d int := greatest (least (coalesce (p_trial_days, 14), 90), 1);
  v_end timestamptz := (timezone ('Africa/Kampala', now ())::date + (d || ' days')::interval)::timestamptz;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select ia.role into v_role from public.internal_admins ia where ia.user_id = auth.uid () and ia.active = true limit 1;
  if v_role is null or v_role not in ('super_admin', 'support_admin', 'finance_admin') then
    raise exception 'Forbidden';
  end if;

  insert into public.organization_feature_entitlements (organization_id, feature_code, status, trial_ends_at, approved_at, approved_by)
  values (p_organization_id, 'ai_stock_assistant', 'trial', v_end, now (), auth.uid ())
  on conflict (organization_id, feature_code) do update
  set
    status = 'trial',
    trial_ends_at = v_end,
    approved_at = now (),
    approved_by = auth.uid (),
    updated_at = now ();

  update public.support_requests sr
  set status = 'closed', updated_at = now (), internal_notes = coalesce (sr.internal_notes || E'\n', '') || 'AI Stock Assistant activated by staff.'
  where sr.organization_id = p_organization_id
    and sr.issue_type in ('ai_stock_setup', 'ai_stock_trial_request')
    and sr.status = 'pending';

  insert into public.internal_ops_admin_audit (actor, action, target_org_id, payload)
  values (auth.uid (), 'ai_stock_assistant_activated', p_organization_id, jsonb_build_object ('trial_days', d));

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.internal_ops_activate_ai_stock_assistant (uuid, int) from public;
grant execute on function public.internal_ops_activate_ai_stock_assistant (uuid, int) to authenticated;

-- ---------- 8) Extended dashboard metrics ----------
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

-- ---------- 9) Field map pins with owner + plan + last seen ----------
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
          sh.district_id,
          sh.last_seen_at,
          coalesce (nullif (trim (pr.full_name), ''), nullif (trim (pr.email), ''), '—') as owner_label,
          sp.code as plan_code,
          sub.status as subscription_status
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

revoke all on function public.internal_ops_dashboard_metrics () from public;
grant execute on function public.internal_ops_dashboard_metrics () to authenticated;

revoke all on function public.internal_ops_field_map_pins (uuid, int) from public;
grant execute on function public.internal_ops_field_map_pins (uuid, int) to authenticated;

create or replace function public.my_feature_entitlements ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text := 'none';
  v_trial timestamptz;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ai_stock_assistant', 'none');
  end if;

  select om.organization_id
  into v_org
  from public.organization_members om
  where om.user_id = auth.uid ()
  order by om.created_at asc
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ai_stock_assistant', 'none');
  end if;

  select e.status, e.trial_ends_at
  into v_status, v_trial
  from public.organization_feature_entitlements e
  where e.organization_id = v_org and e.feature_code = 'ai_stock_assistant';

  return jsonb_build_object (
    'ai_stock_assistant', coalesce (v_status, 'none'),
    'ai_trial_ends_at', v_trial
  );
end;
$$;

revoke all on function public.my_feature_entitlements () from public;
grant execute on function public.my_feature_entitlements () to authenticated;

-- ---------- 10) Support queue: expose organization_id for staff actions ----------
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
          sr.organization_id,
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
