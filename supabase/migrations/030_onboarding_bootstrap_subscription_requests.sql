-- Waka POS — Onboarding bootstrap (shop GPS flags), subscription trial requests, admin audit,
-- improved recent-shops RPC owner resolution, performance indexes.

-- ---------- 1) Shop GPS onboarding flags ----------
alter table public.shops
  add column if not exists gps_missing boolean not null default true;

comment on column public.shops.gps_missing is 'True until owner saves at least one GPS pin (or explicit skip in app).';

create index if not exists shops_created_at_desc_idx on public.shops (created_at desc);
create index if not exists shops_org_created_idx on public.shops (organization_id, created_at desc);

-- ---------- 2) Subscription trial requests (admin approval queue) ----------
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  requested_by uuid references auth.users (id) on delete set null,
  requested_plan text not null
    check (requested_plan in ('starter', 'business', 'waka_plus')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'extended')),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now ()
);

create unique index if not exists subscription_requests_one_pending_per_org
  on public.subscription_requests (organization_id)
  where status = 'pending';

create index if not exists subscription_requests_status_created_idx
  on public.subscription_requests (status, created_at desc);

alter table public.subscription_requests enable row level security;

drop policy if exists subscription_requests_internal_all on public.subscription_requests;
create policy subscription_requests_internal_all
  on public.subscription_requests for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists subscription_requests_owner_insert on public.subscription_requests;
create policy subscription_requests_owner_insert
  on public.subscription_requests for insert
  to authenticated
  with check (
    requested_by = auth.uid ()
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = subscription_requests.organization_id
        and om.user_id = auth.uid ()
        and om.role in ('owner', 'admin')
    )
  );

drop policy if exists subscription_requests_owner_select on public.subscription_requests;
create policy subscription_requests_owner_select
  on public.subscription_requests for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = subscription_requests.organization_id
        and om.user_id = auth.uid ()
    )
  );

-- ---------- 3) Internal admin audit (server-side) ----------
create table if not exists public.internal_ops_admin_audit (
  id uuid primary key default gen_random_uuid (),
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  target_shop_id uuid references public.shops (id) on delete set null,
  target_org_id uuid references public.organizations (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists internal_ops_admin_audit_created_idx on public.internal_ops_admin_audit (created_at desc);

alter table public.internal_ops_admin_audit enable row level security;

drop policy if exists internal_ops_admin_audit_staff on public.internal_ops_admin_audit;
create policy internal_ops_admin_audit_staff
  on public.internal_ops_admin_audit for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

-- ---------- 4) Replace bootstrap: extended params + starter active + pending business trial request ----------
drop function if exists public.bootstrap_owner_workspace (text, text, text, text);

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
  p_longitude double precision default null
)
returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce (nullif (trim (p_business_type), ''), 'kiosk_duka');
  v_business_plan uuid;
  v_district_name text;
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
      gps_missing
    )
    values (
      v_org_id,
      coalesce (nullif (trim (p_org_name), ''), 'Main Shop'),
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
        and (p_latitude is null or p_longitude is null)
    )
    returning id into v_shop_id;
  else
    update public.shops s
    set
      district_id = coalesce (p_district_id, s.district_id),
      district = coalesce (v_district_name, s.district),
      phone_e164 = coalesce (
        case
          when trim (coalesce (p_phone_e164, '')) ~ '^\+256[0-9]{9}$' then trim (p_phone_e164)
          else null
        end,
        s.phone_e164
      ),
      address_line = coalesce (nullif (trim (p_address), ''), s.address_line),
      latitude = case when p_latitude is not null then p_latitude else s.latitude end,
      longitude = case when p_longitude is not null then p_longitude else s.longitude end,
      gps_missing = case
        when p_latitude is not null and p_longitude is not null then false
        else coalesce (p_gps_missing, s.gps_missing)
      end,
      business_type = coalesce (nullif (v_business_type, ''), s.business_type),
      updated_at = now ()
    where s.id = v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

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

grant execute on function public.bootstrap_owner_workspace (
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  boolean,
  double precision,
  double precision
) to authenticated;

-- ---------- 5) Approve / reject subscription request (internal) ----------
create or replace function public.internal_ops_subscription_request_set_status (
  p_request_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_req public.subscription_requests%rowtype;
  v_trial_end timestamptz := (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz;
  v_business_plan uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select * into v_req from public.subscription_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'request_not_found');
  end if;

  select ia.role into v_role from public.internal_admins ia where ia.user_id = auth.uid () and ia.active = true limit 1;
  if v_role is null or v_role not in ('super_admin', 'subscriptions_admin', 'finance_admin') then
    raise exception 'Forbidden';
  end if;

  if p_status = 'approved' and v_req.status = 'pending' and v_req.requested_plan = 'business' then
    select sp.id into v_business_plan from public.subscription_plans sp where sp.code = 'business' and sp.is_active limit 1;
    if v_business_plan is null then
      return jsonb_build_object ('ok', false, 'error', 'business_plan_missing');
    end if;

    update public.subscriptions s
    set
      plan_id = v_business_plan,
      status = 'trial',
      trial_ends_at = v_trial_end,
      current_period_start = now (),
      current_period_end = v_trial_end,
      external_provider = 'trial_approved',
      updated_at = now ()
    where s.organization_id = v_req.organization_id;

    update public.subscription_requests r
    set
      status = 'approved',
      approved_by = auth.uid (),
      approved_at = now (),
      notes = coalesce (p_note, r.notes)
    where r.id = p_request_id;

    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
    values (
      auth.uid (),
      'subscription_request_approved',
      v_req.shop_id,
      v_req.organization_id,
      jsonb_build_object ('request_id', p_request_id, 'plan', 'business')
    );

    return jsonb_build_object ('ok', true);
  elsif p_status = 'rejected' and v_req.status = 'pending' then
    update public.subscription_requests r
    set
      status = 'rejected',
      approved_by = auth.uid (),
      approved_at = now (),
      notes = coalesce (p_note, r.notes)
    where r.id = p_request_id;

    insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
    values (
      auth.uid (),
      'subscription_request_rejected',
      v_req.shop_id,
      v_req.organization_id,
      jsonb_build_object ('request_id', p_request_id)
    );

    return jsonb_build_object ('ok', true);
  end if;

  return jsonb_build_object ('ok', false, 'error', 'invalid_transition');
end;
$$;

revoke all on function public.internal_ops_subscription_request_set_status (uuid, text, text) from public;
grant execute on function public.internal_ops_subscription_request_set_status (uuid, text, text) to authenticated;

create or replace function public.internal_ops_subscription_requests_pending (p_limit int default 50)
returns setof public.subscription_requests
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.subscription_requests r
  where r.status = 'pending'
    and public.is_waka_internal_staff ()
  order by r.created_at asc
  limit least (greatest (coalesce (p_limit, 50), 1), 200);
$$;

revoke all on function public.internal_ops_subscription_requests_pending (int) from public;
grant execute on function public.internal_ops_subscription_requests_pending (int) to authenticated;

-- ---------- 6) Recent shops: resolve owner even when role column was backfilled inconsistently ----------
drop function if exists public.internal_ops_recent_shops (int);

create or replace function public.internal_ops_recent_shops (p_limit int default 20)
returns table (
  id uuid,
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
  phone_e164 text,
  business_type text,
  gps_missing boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  return query
  select
    s.id,
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
      nullif (trim (pr.full_name), ''),
      nullif (trim (pr.business_name), ''),
      nullif (trim (pr.email), ''),
      own.user_id::text
    ) as owner_label,
    pr.email as owner_email,
    coalesce (s.phone_e164, pr.phone_e164) as phone_e164,
    s.business_type,
    coalesce (s.gps_missing, true) as gps_missing
  from public.shops s
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
  limit least (greatest (coalesce (p_limit, 20), 1), 100);
end;
$$;

-- ---------- 6b) Shop owner: request plan change (creates pending admin queue row) ----------
create or replace function public.request_subscription_plan_change (p_requested_plan text)
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
    raise exception 'Not authenticated';
  end if;

  if p_requested_plan is null
    or trim (p_requested_plan) not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  select om.organization_id
  into v_org
  from public.organization_members om
  where om.user_id = v_uid
    and om.role in ('owner', 'admin')
  order by om.created_at asc
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'no_organization');
  end if;

  select s.id
  into v_shop
  from public.shops s
  where s.organization_id = v_org
  order by s.created_at asc
  limit 1;

  if exists (
    select 1
    from public.subscription_requests r
    where r.organization_id = v_org
      and r.status = 'pending'
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_pending');
  end if;

  insert into public.subscription_requests (
    organization_id,
    shop_id,
    requested_by,
    requested_plan,
    status,
    notes
  )
  values (
    v_org,
    v_shop,
    v_uid,
    trim (p_requested_plan),
    'pending',
    'Requested from POS app'
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.request_subscription_plan_change (text) from public;
grant execute on function public.request_subscription_plan_change (text) to authenticated;

-- ---------- 7) Subscriptions index for dashboard ----------
create index if not exists subscriptions_status_org_idx on public.subscriptions (status, organization_id);
