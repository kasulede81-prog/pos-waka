-- Premium dashboard compatibility pack:
-- ensures all owner-side request RPCs and backing tables exist on older deployments.

-- 1) Required tables for plan/support/audit flows
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

create table if not exists public.internal_ops_admin_audit (
  id uuid primary key default gen_random_uuid (),
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  target_shop_id uuid references public.shops (id) on delete set null,
  target_org_id uuid references public.organizations (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists internal_ops_admin_audit_created_idx
  on public.internal_ops_admin_audit (created_at desc);

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

-- 2) Support request compatibility columns used by premium request RPCs
alter table public.support_requests
  drop constraint if exists support_requests_status_check;

alter table public.support_requests
  add constraint support_requests_status_check
  check (status in ('pending', 'open', 'in_progress', 'resolved', 'closed'));

alter table public.support_requests
  add column if not exists issue_type text;

alter table public.support_requests
  add column if not exists internal_notes text;

alter table public.support_requests
  add column if not exists contact_phone_e164 text;

alter table public.support_requests
  add column if not exists device_fingerprint text;

alter table public.support_requests
  add column if not exists app_version text;

alter table public.support_requests
  add column if not exists sync_health_snapshot jsonb not null default '{}'::jsonb;

-- 3) Owner-facing premium request RPCs
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
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_requested_plan is null
    or trim (p_requested_plan) not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
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
    organization_id, shop_id, requested_by, requested_plan, status, notes
  )
  values (
    v_org, v_shop, v_uid, trim (p_requested_plan), 'pending', 'Requested from POS app'
  );

  return jsonb_build_object ('ok', true);
end;
$$;

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
    shop_id, organization_id, opened_by_user_id, channel, subject, body, status, priority, issue_type
  )
  values (
    v_shop, v_org, v_uid, 'app',
    'AI Stock Assistant request',
    'Owner requested AI-assisted stock setup from Back Office.',
    'pending', 'normal', 'ai_stock_setup'
  );

  insert into public.organization_feature_entitlements (organization_id, feature_code, status, metadata)
  values (v_org, 'ai_stock_assistant', 'pending', jsonb_build_object ('requested_at', now ()))
  on conflict (organization_id, feature_code) do update
  set status = 'pending',
      updated_at = now (),
      metadata = public.organization_feature_entitlements.metadata || jsonb_build_object ('requested_at', now ());

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
  values (v_uid, 'ai_stock_assistant_requested', v_shop, v_org, '{}'::jsonb);

  return jsonb_build_object ('ok', true);
end;
$$;

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
    shop_id, organization_id, opened_by_user_id, channel, subject, body, status, priority, issue_type
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
  set status = 'pending',
      updated_at = now (),
      metadata = public.organization_feature_entitlements.metadata || jsonb_build_object ('trial_request', true, 'requested_at', now ());

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
  values (v_uid, 'ai_stock_trial_requested', v_shop, v_org, '{}'::jsonb);

  return jsonb_build_object ('ok', true);
end;
$$;

-- 4) Entitlements read RPC used by premium card
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

revoke all on function public.request_subscription_plan_change (text) from public;
grant execute on function public.request_subscription_plan_change (text) to authenticated;

revoke all on function public.request_ai_stock_assistant () from public;
grant execute on function public.request_ai_stock_assistant () to authenticated;

revoke all on function public.request_annual_plan_support () from public;
grant execute on function public.request_annual_plan_support () to authenticated;

revoke all on function public.request_free_ai_trial () from public;
grant execute on function public.request_free_ai_trial () to authenticated;

revoke all on function public.my_feature_entitlements () from public;
grant execute on function public.my_feature_entitlements () to authenticated;
