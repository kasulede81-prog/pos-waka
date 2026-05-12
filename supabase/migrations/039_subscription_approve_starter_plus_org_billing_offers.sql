-- 1) Approve starter / business / waka_plus subscription requests (was business-only).
-- 2) Annual billing offers: admin sends amount; owner claims paid; admin fulfills.

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
  v_trial_end timestamptz;
  v_plan uuid;
  v_plan_code text;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select * into v_req from public.subscription_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'request_not_found');
  end if;

  select ia.role into v_role from public.internal_admins ia where ia.user_id = auth.uid () and ia.active = true limit 1;
  if v_role is null or v_role not in (
    'super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin'
  ) then
    raise exception 'Forbidden';
  end if;

  if p_status = 'approved' and v_req.status = 'pending' then
    v_plan_code := trim (lower (v_req.requested_plan));
    if v_plan_code not in ('starter', 'business', 'waka_plus') then
      return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
    end if;

    select sp.id into v_plan from public.subscription_plans sp where sp.code = v_plan_code and sp.is_active limit 1;
    if v_plan is null then
      return jsonb_build_object ('ok', false, 'error', 'plan_missing');
    end if;

    if v_plan_code = 'starter' then
      v_trial_end := (timezone ('Africa/Kampala', now ())::date + interval '14 days')::timestamptz;
    else
      v_trial_end := (timezone ('Africa/Kampala', now ())::date + interval '30 days')::timestamptz;
    end if;

    update public.subscriptions s
    set
      plan_id = v_plan,
      status = 'trial',
      trial_ends_at = v_trial_end,
      current_period_start = now (),
      current_period_end = v_trial_end,
      external_provider = 'trial_request_approved',
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
      jsonb_build_object ('request_id', p_request_id, 'plan', v_plan_code)
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

-- ---------- org billing offers (annual etc.) ----------
create table if not exists public.org_billing_offers (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  amount_ugx bigint not null check (amount_ugx > 0),
  currency text not null default 'UGX',
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'claimed_paid', 'fulfilled', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now (),
  fulfilled_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists org_billing_offers_org_status_idx
  on public.org_billing_offers (organization_id, status, created_at desc);

alter table public.org_billing_offers enable row level security;

drop policy if exists org_billing_offers_staff_all on public.org_billing_offers;
create policy org_billing_offers_staff_all
  on public.org_billing_offers for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists org_billing_offers_member_select on public.org_billing_offers;
create policy org_billing_offers_member_select
  on public.org_billing_offers for select
  to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = org_billing_offers.organization_id
        and om.user_id = auth.uid ()
    )
  );

-- Admin: create offer (supersedes prior pending for same org)
create or replace function public.internal_ops_org_billing_offer_send (
  p_organization_id uuid,
  p_amount_ugx bigint,
  p_message text default null,
  p_shop_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select ia.role into v_role from public.internal_admins ia where ia.user_id = auth.uid () and ia.active = true limit 1;
  if v_role is null or v_role not in (
    'super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin', 'support_admin'
  ) then
    raise exception 'Forbidden';
  end if;

  if p_organization_id is null or coalesce (p_amount_ugx, 0) <= 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_input');
  end if;

  update public.org_billing_offers o
  set status = 'cancelled', cancelled_at = now ()
  where o.organization_id = p_organization_id and o.status = 'pending';

  insert into public.org_billing_offers (
    organization_id, shop_id, amount_ugx, currency, message, status, created_by
  )
  values (
    p_organization_id,
    p_shop_id,
    p_amount_ugx,
    'UGX',
    nullif (trim (p_message), ''),
    'pending',
    auth.uid ()
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.internal_ops_org_billing_offer_send (uuid, bigint, text, uuid) from public;
grant execute on function public.internal_ops_org_billing_offer_send (uuid, bigint, text, uuid) to authenticated;

-- Owner: mark they paid (staff still fulfills)
create or replace function public.owner_org_billing_offer_claim_paid (p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid () is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select o.organization_id into v_org
  from public.org_billing_offers o
  where o.id = p_offer_id and o.status = 'pending'
  limit 1;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'offer_not_found');
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_org and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  ) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.org_billing_offers o
  set status = 'claimed_paid'
  where o.id = p_offer_id and o.status = 'pending';

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.owner_org_billing_offer_claim_paid (uuid) from public;
grant execute on function public.owner_org_billing_offer_claim_paid (uuid) to authenticated;

-- Admin: fulfill after verifying payment — extend annual window + mark paid
create or replace function public.internal_ops_org_billing_offer_fulfill (p_offer_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_offer public.org_billing_offers%rowtype;
  v_sub_id uuid;
  v_year_end timestamptz := (timezone ('Africa/Kampala', now ())::date + interval '365 days')::timestamptz;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select ia.role into v_role from public.internal_admins ia where ia.user_id = auth.uid () and ia.active = true limit 1;
  if v_role is null or v_role not in (
    'super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin'
  ) then
    raise exception 'Forbidden';
  end if;

  select * into v_offer from public.org_billing_offers o where o.id = p_offer_id limit 1;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'offer_not_found');
  end if;

  if v_offer.status not in ('pending', 'claimed_paid') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  select s.id into v_sub_id
  from public.subscriptions s
  where s.organization_id = v_offer.organization_id
  order by s.created_at desc
  limit 1;

  if v_sub_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_subscription');
  end if;

  perform public.admin_subscription_mark_payment (v_sub_id, v_offer.amount_ugx, coalesce (nullif (trim (p_note), ''), 'Annual plan payment'));

  update public.subscriptions s
  set
    status = 'active',
    trial_ends_at = null,
    current_period_start = now (),
    current_period_end = v_year_end,
    updated_at = now ()
  where s.id = v_sub_id;

  update public.org_billing_offers o
  set status = 'fulfilled', fulfilled_at = now ()
  where o.id = p_offer_id;

  return jsonb_build_object ('ok', true, 'subscription_id', v_sub_id);
end;
$$;

revoke all on function public.internal_ops_org_billing_offer_fulfill (uuid, text) from public;
grant execute on function public.internal_ops_org_billing_offer_fulfill (uuid, text) to authenticated;

-- Owner read pending + claimed (for UI)
create or replace function public.my_org_billing_offers ()
returns setof public.org_billing_offers
language sql
stable
security definer
set search_path = public
as $$
  select o.*
  from public.org_billing_offers o
  where o.organization_id in (
    select om.organization_id from public.organization_members om
    where om.user_id = auth.uid ()
  )
  and o.status in ('pending', 'claimed_paid')
  order by o.created_at desc
  limit 5;
$$;

revoke all on function public.my_org_billing_offers () from public;
grant execute on function public.my_org_billing_offers () to authenticated;

-- Allow operations admins to record payments (used by annual offer fulfill).
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
  if not public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin']::text[]
  ) then
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
