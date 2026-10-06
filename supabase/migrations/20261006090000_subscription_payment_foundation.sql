-- ============================================================================
-- M1 — PAYMENT FOUNDATION
-- ============================================================================
-- Backend foundation for the future MTN Mobile Money / Airtel Money phase.
-- No provider is integrated here: this migration makes the ledger itself safe
-- to receive provider traffic.
--
-- What it does:
--   1. subscription_payments becomes a proper payment ledger:
--        - explicit state model: pending -> confirmed | failed | cancelled,
--          confirmed -> refunded (plus legacy 'recorded' kept readable);
--        - one row per (provider, reference) — replaying a provider reference
--          can never create, count or activate a payment twice;
--        - immutable money/identity fields (amount, currency, provider,
--          reference, subscription, organization, shop, recorded_by);
--        - DML revoked from anon/authenticated: rows are written only through
--          SECURITY DEFINER RPCs (no browser-side ledger writes).
--   2. Settlement RPCs (create / confirm / fail / cancel / refund / lookup)
--      with server-authoritative amount, shop, subscription, provider,
--      reference and final status. Nothing is read from the customer UI.
--   3. admin_subscription_mark_payment (manual admin payment) keeps its exact
--      signature, roles and recording behaviour, and now advances the
--      subscription period in the same transaction as the payment record —
--      the old foot-gun was "payment recorded, period never moved".
--
-- Follows the migration-174 durable-idempotency pattern (client-supplied id,
-- lock-then-apply, unique_violation returns the winner) adapted to a payment
-- ledger that has a state machine rather than a single append.
--
-- Strict scope: no MTN/Airtel API calls, no checkout UI, no pricing/plan/
-- entitlement changes.

-- ----------------------------------------------------------------------------
-- 1. Ledger columns
-- ----------------------------------------------------------------------------

alter table public.subscription_payments
  add column if not exists shop_id uuid references public.shops (id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists status_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.subscription_payments.shop_id is
  'Shop the payment was initiated for (denormalized from subscriptions.shop_id; null on legacy rows).';
comment on column public.subscription_payments.confirmed_at is
  'Server timestamp of the pending -> confirmed transition (stamped by the state guard).';
comment on column public.subscription_payments.status_reason is
  'Failure / cancellation / refund reason for the current terminal state.';
comment on column public.subscription_payments.metadata is
  'Provider metadata and settlement context. Written by RPCs only.';

create index if not exists subscription_payments_shop_idx
  on public.subscription_payments (shop_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Explicit payment states
-- ----------------------------------------------------------------------------
-- 'recorded' is the pre-M1 state written by admin_subscription_mark_payment;
-- it stays valid so no existing row (or reader) breaks, and it is treated as
-- an already-settled state everywhere in the state machine below.

alter table public.subscription_payments drop constraint if exists subscription_payments_status_check;
alter table public.subscription_payments add constraint subscription_payments_status_check
  check (status in ('recorded', 'pending', 'confirmed', 'failed', 'cancelled', 'refunded'));

-- ----------------------------------------------------------------------------
-- 3. Provider reference identity (idempotency authority)
-- ----------------------------------------------------------------------------
-- Scoped to (provider, reference) rather than (subscription_id, provider,
-- reference): provider settlement ids (MTN referenceId, Airtel transactionId)
-- are unique per provider, so a wider scope also stops the same provider
-- reference from activating a SECOND subscription. Manual admin payments carry
-- provider = 'manual_admin' and a NULL reference, so they are unaffected.

create unique index if not exists subscription_payments_provider_reference_uq
  on public.subscription_payments (provider, reference)
  where reference is not null and reference <> '';

-- Ledger rows are written by SECURITY DEFINER RPCs only. Production grants
-- (010_grants.sql + Supabase table defaults) hand INSERT/UPDATE/DELETE to
-- `authenticated`; RLS only carries a SELECT policy, so writes were already
-- policy-denied. Revoking the grants too makes the control explicit and
-- independent of RLS ever being flipped on this table.

revoke insert, update, delete, truncate on table public.subscription_payments from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. State guard (immutability + transition matrix)
-- ----------------------------------------------------------------------------

create or replace function public.subscription_payment_state_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'confirmed', 'recorded') then
      raise exception 'payment_invalid_initial_status';
    end if;
    if new.amount_ugx is null or new.amount_ugx < 0 then
      raise exception 'payment_invalid_amount';
    end if;
    if new.reference is not null and new.provider is null then
      raise exception 'payment_reference_requires_provider';
    end if;
    if new.status in ('confirmed', 'recorded') and new.confirmed_at is null then
      new.confirmed_at := now ();
    end if;
    return new;
  end if;

  -- Immutable ledger fields: money and identity can never be rewritten.
  if new.id is distinct from old.id
     or new.subscription_id is distinct from old.subscription_id
     or new.organization_id is distinct from old.organization_id
     or new.shop_id is distinct from old.shop_id
     or new.amount_ugx is distinct from old.amount_ugx
     or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider
     or new.recorded_by is distinct from old.recorded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_row_is_immutable';
  end if;

  -- A reference may be bound once (settlement supplies it late), never changed.
  if new.reference is distinct from old.reference
     and not (old.reference is null and new.reference is not null) then
    raise exception 'payment_row_is_immutable';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('confirmed', 'failed', 'cancelled') then
      if new.status = 'confirmed' and new.confirmed_at is null then
        new.confirmed_at := now ();
      end if;
      return new;
    end if;
    if old.status in ('confirmed', 'recorded') and new.status = 'refunded' then
      return new;
    end if;
    raise exception 'payment_invalid_transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke all on function public.subscription_payment_state_guard () from public;

drop trigger if exists trg_subscription_payment_state on public.subscription_payments;
create trigger trg_subscription_payment_state
  before insert or update on public.subscription_payments
  for each row execute function public.subscription_payment_state_guard ();

-- ----------------------------------------------------------------------------
-- 5. Server-authoritative helpers
-- ----------------------------------------------------------------------------

-- The ONLY source of a payment amount. Client-supplied amounts are compared
-- against this and never stored.
create or replace function public.subscription_payment_expected_amount (p_subscription_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list bigint;
  v_discount numeric;
  v_amount numeric;
begin
  select case
           when s.billing_interval = 'year' then coalesce (sp.annual_price_ugx, 0)
           else coalesce (sp.monthly_price_ugx, 0)
         end,
         coalesce (s.admin_discount_percent, 0)
    into v_list, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_list is null then
    return 0;
  end if;

  v_amount := round (v_list * (100 - least (greatest (v_discount, 0), 100)) / 100);
  return greatest (v_amount::bigint, 0);
end;
$$;

-- Edge functions settle with the service_role key; that is a server caller,
-- not a browser. Everything else must present a user JWT.
create or replace function public._subscription_payment_is_service_role ()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims text;
begin
  v_claims := nullif (coalesce (current_setting ('request.jwt.claims', true), ''), '');
  if v_claims is null then
    return false;
  end if;
  return coalesce (v_claims::jsonb ->> 'role', '') = 'service_role';
exception
  when others then
    return false;
end;
$$;

-- May this caller START a payment (create/lookup)? Internal Waka billing roles,
-- the owning org's owner/admin, or the service role. Never anon, never a
-- cashier, never a member of another organization.
create or replace function public._subscription_payment_can_initiate (p_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._subscription_payment_is_service_role () then
    return true;
  end if;
  if auth.uid () is null then
    return false;
  end if;
  if public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin']::text[]
  ) then
    return true;
  end if;
  return exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
end;
$$;

-- May this caller SETTLE a payment (confirm/fail/cancel/refund)? Provider
-- webhooks (service role) and internal Waka billing roles only — a shop owner
-- must not be able to confirm their own payment into existence.
create or replace function public._subscription_payment_can_settle (p_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._subscription_payment_is_service_role () then
    return true;
  end if;
  if auth.uid () is null then
    return false;
  end if;
  return public.is_waka_internal_role (
    array['super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin']::text[]
  );
end;
$$;

-- Applies the entitlement effect of a successful payment: the period is
-- advanced from max(now, current_period_end) by the plan's billing interval,
-- the trial is consumed, and a non-cancelled/paused subscription becomes
-- active. Free plans with no period have nothing to advance.
create or replace function public._subscription_payment_advance_period (p_subscription_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_interval text;
  v_current_end timestamptz;
  v_monthly bigint;
  v_annual bigint;
  v_anchor timestamptz;
  v_start timestamptz;
  v_end timestamptz;
begin
  select s.status,
         s.billing_interval,
         s.current_period_end,
         coalesce (sp.monthly_price_ugx, 0),
         coalesce (sp.annual_price_ugx, 0)
    into v_status, v_interval, v_current_end, v_monthly, v_annual
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id
  for update;

  if v_status is null then
    raise exception 'Subscription not found';
  end if;

  if v_monthly = 0 and v_annual = 0 and v_current_end is null then
    period_start := null;
    period_end := null;
    return next;
    return;
  end if;

  v_anchor := greatest (now (), coalesce (v_current_end, now ()));
  v_start := v_anchor;
  v_end := v_anchor + case when v_interval = 'year' then interval '1 year' else interval '1 month' end;

  update public.subscriptions s
  set
    current_period_start = v_start,
    current_period_end = v_end,
    trial_ends_at = null,
    status = case
      when s.status in ('cancelled', 'canceled', 'paused') then s.status
      else 'active'
    end,
    updated_at = now ()
  where s.id = p_subscription_id;

  period_start := v_start;
  period_end := v_end;
  return next;
end;
$$;

-- Recomputes subscriptions.payment_status from the ledger so the status can
-- never drift from the rows that produced it. Never strips a 'paid'/'waived'
-- marker that a plan grant set without a payment row.
create or replace function public._subscription_payment_refresh_status (p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_next text;
  v_confirmed boolean;
  v_pending boolean;
  v_failed boolean;
  v_refunded boolean;
begin
  select s.payment_status
    into v_current
  from public.subscriptions s
  where s.id = p_subscription_id
  for update;

  if not found then
    return;
  end if;

  select
    coalesce (bool_or (sp.status in ('confirmed', 'recorded')), false),
    coalesce (bool_or (sp.status = 'pending'), false),
    coalesce (bool_or (sp.status = 'failed'), false),
    coalesce (bool_or (sp.status = 'refunded'), false)
    into v_confirmed, v_pending, v_failed, v_refunded
  from public.subscription_payments sp
  where sp.subscription_id = p_subscription_id;

  v_next := case
    when v_confirmed then 'paid'
    when v_pending then case when v_current in ('paid', 'waived') then v_current else 'pending' end
    when v_current = 'waived' then 'waived'
    when v_failed and v_current = 'pending' then 'failed'
    when v_refunded then 'unpaid'
    when v_current = 'pending' then 'unpaid'
    else v_current
  end;

  update public.subscriptions s
  set
    payment_status = v_next,
    updated_at = now ()
  where s.id = p_subscription_id
    and s.payment_status is distinct from v_next;
end;
$$;

-- Append-only audit row for every payment transition (mirrors the
-- admin_subscription_mark_payment writer so all paths look the same).
create or replace function public._subscription_payment_audit (
  p_subscription_id uuid,
  p_action text,
  p_summary text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
    case
      when public.is_waka_internal_role (
        array['super_admin', 'subscriptions_admin', 'finance_admin', 'operations_admin']::text[]
      ) then 'internal'
      when auth.uid () is null then 'system'
      else 'owner'
    end,
    p_action,
    p_summary,
    coalesce (p_payload, '{}'::jsonb)
  from public.subscriptions s
  where s.id = p_subscription_id;
end;
$$;

-- Resolves + validates the (shop, subscription) pair for a payment attempt.
-- p_subscription_id is optional: when omitted the server picks the org's
-- subscription for that shop. When supplied it is cross-checked, so a client
-- cannot point a payment at someone else's subscription.
create or replace function public._subscription_payment_resolve (
  p_shop_id uuid,
  p_subscription_id uuid,
  out o_subscription_id uuid,
  out o_organization_id uuid
)
returns record
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop_org uuid;
  v_sub_org uuid;
  v_sub_shop uuid;
begin
  o_subscription_id := null;
  o_organization_id := null;

  select s.organization_id
    into v_shop_org
  from public.shops s
  where s.id = p_shop_id;

  if v_shop_org is null then
    return;
  end if;

  if p_subscription_id is not null then
    select s.organization_id, s.shop_id
      into v_sub_org, v_sub_shop
    from public.subscriptions s
    where s.id = p_subscription_id;
  else
    select s.id, s.organization_id, s.shop_id
      into o_subscription_id, v_sub_org, v_sub_shop
    from public.subscriptions s
    where s.organization_id = v_shop_org
    order by s.created_at desc
    limit 1;
  end if;

  if p_subscription_id is not null then
    o_subscription_id := p_subscription_id;
  end if;

  if o_subscription_id is null or v_sub_org is null then
    o_subscription_id := null;
    o_organization_id := null;
    return;
  end if;

  -- Same organization, and (when the subscription is shop-anchored) same shop.
  if v_sub_org <> v_shop_org or (v_sub_shop is not null and v_sub_shop <> p_shop_id) then
    o_subscription_id := null;
    o_organization_id := null;
    return;
  end if;

  o_organization_id := v_sub_org;
end;
$$;

revoke all on function public.subscription_payment_expected_amount (uuid) from public;
revoke all on function public._subscription_payment_is_service_role () from public;
revoke all on function public._subscription_payment_can_initiate (uuid) from public;
revoke all on function public._subscription_payment_can_settle (uuid) from public;
revoke all on function public._subscription_payment_advance_period (uuid) from public;
revoke all on function public._subscription_payment_refresh_status (uuid) from public;
revoke all on function public._subscription_payment_audit (uuid, text, text, jsonb) from public;
revoke all on function public._subscription_payment_resolve (uuid, uuid) from public;

-- ----------------------------------------------------------------------------
-- 6. Settlement RPCs
-- ----------------------------------------------------------------------------

-- Create a PENDING payment. Amount is server-computed; a mismatched client
-- amount is rejected rather than stored. Replay-safe on both the client
-- durable id (174 pattern) and (provider, reference).
create or replace function public.subscription_payment_create (
  p_shop_id uuid,
  p_provider text,
  p_reference text default null,
  p_amount_ugx bigint default null,
  p_note text default null,
  p_payment_id uuid default null,
  p_subscription_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid := coalesce (p_payment_id, gen_random_uuid ());
  v_provider text := lower (nullif (trim (coalesce (p_provider, '')), ''));
  v_reference text := nullif (trim (coalesce (p_reference, '')), '');
  v_shop_org uuid;
  v_sub_id uuid;
  v_org uuid;
  v_expected bigint;
  v_existing record;
begin
  select s.organization_id
    into v_shop_org
  from public.shops s
  where s.id = p_shop_id;

  if v_shop_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if p_subscription_id is not null
     and not exists (
       select 1 from public.subscriptions s where s.id = p_subscription_id
     ) then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select o_subscription_id, o_organization_id
    into v_sub_id, v_org
  from public._subscription_payment_resolve (p_shop_id, p_subscription_id);

  if v_sub_id is null then
    -- Distinguish "no subscription at all" from "that subscription belongs to
    -- a different shop / organization" so a client can never pay the wrong one.
    if p_subscription_id is not null
       or exists (
         select 1 from public.subscriptions s where s.organization_id = v_shop_org
       ) then
      return jsonb_build_object ('ok', false, 'error', 'shop_subscription_mismatch');
    end if;
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if not public._subscription_payment_can_initiate (v_org) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_provider');
  end if;

  -- Durable client id replay (same shape as migration 174).
  select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
    into v_existing
  from public.subscription_payments sp
  where sp.id = v_payment_id;

  if found then
    if v_existing.subscription_id <> v_sub_id then
      return jsonb_build_object ('ok', false, 'error', 'payment_id_conflict');
    end if;
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_existing.id,
      'subscription_id', v_existing.subscription_id,
      'status', v_existing.status,
      'amount_ugx', v_existing.amount_ugx
    );
  end if;

  -- Provider reference replay: return the existing payment, never a second one.
  if v_reference is not null then
    select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
      into v_existing
    from public.subscription_payments sp
    where sp.provider = v_provider
      and sp.reference = v_reference;

    if found then
      if v_existing.subscription_id <> v_sub_id then
        return jsonb_build_object ('ok', false, 'error', 'reference_subscription_mismatch');
      end if;
      return jsonb_build_object (
        'ok', true, 'idempotent', true,
        'payment_id', v_existing.id,
        'subscription_id', v_existing.subscription_id,
        'status', v_existing.status,
        'amount_ugx', v_existing.amount_ugx
      );
    end if;
  end if;

  v_expected := public.subscription_payment_expected_amount (v_sub_id);

  if p_amount_ugx is not null and p_amount_ugx <> v_expected then
    return jsonb_build_object (
      'ok', false,
      'error', 'amount_mismatch',
      'expected_amount_ugx', v_expected
    );
  end if;

  begin
    insert into public.subscription_payments (
      id,
      subscription_id,
      organization_id,
      shop_id,
      amount_ugx,
      currency,
      provider,
      reference,
      status,
      recorded_by,
      note,
      metadata
    )
    values (
      v_payment_id,
      v_sub_id,
      v_org,
      p_shop_id,
      v_expected,
      'UGX',
      v_provider,
      v_reference,
      'pending',
      auth.uid (),
      nullif (trim (coalesce (p_note, '')), ''),
      jsonb_build_object ('created_via', 'subscription_payment_create')
    );
  exception
    when unique_violation then
      -- Lost the race on the durable id or the provider reference: return the
      -- winner instead of counting the payment twice.
      select sp.id, sp.subscription_id, sp.status, sp.amount_ugx
        into v_existing
      from public.subscription_payments sp
      where sp.id = v_payment_id
         or (v_reference is not null and sp.provider = v_provider and sp.reference = v_reference)
      limit 1;

      if not found then
        return jsonb_build_object ('ok', false, 'error', 'reference_conflict');
      end if;

      if v_existing.subscription_id <> v_sub_id then
        return jsonb_build_object ('ok', false, 'error', 'reference_subscription_mismatch');
      end if;

      return jsonb_build_object (
        'ok', true, 'idempotent', true,
        'payment_id', v_existing.id,
        'subscription_id', v_existing.subscription_id,
        'status', v_existing.status,
        'amount_ugx', v_existing.amount_ugx
      );
  end;

  perform public._internal_subscription_history_write (
    v_sub_id,
    'payment_created',
    'Payment initiated',
    jsonb_build_object (
      'payment_id', v_payment_id,
      'subscription_id', v_sub_id,
      'shop_id', p_shop_id,
      'amount_ugx', v_expected,
      'provider', v_provider,
      'reference', v_reference,
      'status', 'pending'
    )
  );

  perform public._subscription_payment_audit (
    v_sub_id,
    'subscription_payment_create',
    'Payment initiated',
    jsonb_build_object (
      'payment_id', v_payment_id,
      'amount_ugx', v_expected,
      'provider', v_provider,
      'reference', v_reference
    )
  );

  perform public._subscription_payment_refresh_status (v_sub_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id,
    'status', 'pending',
    'amount_ugx', v_expected,
    'expected_amount_ugx', v_expected
  );
end;
$$;

-- Settle a PENDING payment as CONFIRMED: advances the subscription period,
-- flips the ledger row, writes history + audit. Idempotent on replay, and a
-- payment that is already failed/cancelled/refunded can never be confirmed.
create or replace function public.subscription_payment_confirm (
  p_payment_id uuid,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := nullif (trim (coalesce (p_reference, '')), '');
  v_payment record;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select sp.id,
         sp.subscription_id,
         sp.organization_id,
         sp.status,
         sp.reference,
         sp.amount_ugx,
         sp.provider
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_payment.status = 'confirmed' then
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_payment.id,
      'subscription_id', v_payment.subscription_id,
      'status', 'confirmed',
      'amount_ugx', v_payment.amount_ugx
    );
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_confirmable',
      'status', v_payment.status
    );
  end if;

  if v_reference is not null then
    if v_payment.reference is null then
      begin
        update public.subscription_payments sp
        set reference = v_reference
        where sp.id = v_payment.id;
      exception
        when unique_violation then
          return jsonb_build_object ('ok', false, 'error', 'reference_conflict');
      end;
    elsif v_payment.reference <> v_reference then
      return jsonb_build_object ('ok', false, 'error', 'reference_mismatch');
    end if;
  end if;

  -- Entitlement effect first: if it cannot apply, nothing is confirmed.
  begin
    select p.period_start, p.period_end
      into v_period_start, v_period_end
    from public._subscription_payment_advance_period (v_payment.subscription_id) p;
  exception
    when unique_violation then
      return jsonb_build_object ('ok', false, 'error', 'subscription_conflict');
  end;

  update public.subscription_payments sp
  set
    status = 'confirmed',
    note = coalesce (nullif (trim (coalesce (p_note, '')), ''), note)
  where sp.id = v_payment.id;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_confirmed',
    'Payment confirmed',
    jsonb_build_object (
      'payment_id', v_payment.id,
      'amount_ugx', v_payment.amount_ugx,
      'provider', v_payment.provider,
      'reference', coalesce (v_reference, v_payment.reference),
      'status', 'confirmed',
      'period_start', v_period_start,
      'period_end', v_period_end
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_confirm',
    'Payment confirmed',
    jsonb_build_object (
      'payment_id', v_payment.id,
      'amount_ugx', v_payment.amount_ugx,
      'provider', v_payment.provider,
      'reference', coalesce (v_reference, v_payment.reference)
    )
  );

  perform public._subscription_payment_refresh_status (v_payment.subscription_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'status', 'confirmed',
    'amount_ugx', v_payment.amount_ugx,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

-- PENDING -> FAILED. Never touches the subscription period.
create or replace function public.subscription_payment_fail (
  p_payment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  select sp.id, sp.subscription_id, sp.organization_id, sp.status, sp.amount_ugx, sp.provider
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_payment.status = 'failed' then
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_payment.id,
      'subscription_id', v_payment.subscription_id,
      'status', 'failed'
    );
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_failed',
      'status', v_payment.status
    );
  end if;

  update public.subscription_payments sp
  set
    status = 'failed',
    status_reason = v_reason
  where sp.id = v_payment.id;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_failed',
    coalesce (v_reason, 'Payment failed'),
    jsonb_build_object (
      'payment_id', v_payment.id,
      'amount_ugx', v_payment.amount_ugx,
      'provider', v_payment.provider,
      'status', 'failed'
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_fail',
    'Payment failed',
    jsonb_build_object ('payment_id', v_payment.id, 'reason', v_reason)
  );

  perform public._subscription_payment_refresh_status (v_payment.subscription_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'status', 'failed'
  );
end;
$$;

-- PENDING -> CANCELLED (checkout abandoned / provider cancelled the request).
create or replace function public.subscription_payment_cancel (
  p_payment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  select sp.id, sp.subscription_id, sp.organization_id, sp.status, sp.amount_ugx, sp.provider
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_payment.status = 'cancelled' then
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_payment.id,
      'subscription_id', v_payment.subscription_id,
      'status', 'cancelled'
    );
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_cancelable',
      'status', v_payment.status
    );
  end if;

  update public.subscription_payments sp
  set
    status = 'cancelled',
    status_reason = v_reason
  where sp.id = v_payment.id;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_cancelled',
    coalesce (v_reason, 'Payment cancelled'),
    jsonb_build_object (
      'payment_id', v_payment.id,
      'amount_ugx', v_payment.amount_ugx,
      'provider', v_payment.provider,
      'status', 'cancelled'
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_cancel',
    'Payment cancelled',
    jsonb_build_object ('payment_id', v_payment.id, 'reason', v_reason)
  );

  perform public._subscription_payment_refresh_status (v_payment.subscription_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'status', 'cancelled'
  );
end;
$$;

-- CONFIRMED -> REFUNDED. Records the reversal on the ledger and in history.
-- The granted period is NOT rolled back here (refund entitlement policy is a
-- later phase); the payment itself can no longer be counted as settled twice.
create or replace function public.subscription_payment_refund (
  p_payment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  select sp.id, sp.subscription_id, sp.organization_id, sp.status, sp.amount_ugx, sp.provider
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_payment.status = 'refunded' then
    return jsonb_build_object (
      'ok', true, 'idempotent', true,
      'payment_id', v_payment.id,
      'subscription_id', v_payment.subscription_id,
      'status', 'refunded'
    );
  end if;

  if v_payment.status not in ('confirmed', 'recorded') then
    return jsonb_build_object (
      'ok', false,
      'error', 'payment_not_refundable',
      'status', v_payment.status
    );
  end if;

  update public.subscription_payments sp
  set
    status = 'refunded',
    status_reason = v_reason
  where sp.id = v_payment.id;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_refunded',
    coalesce (v_reason, 'Payment refunded'),
    jsonb_build_object (
      'payment_id', v_payment.id,
      'amount_ugx', v_payment.amount_ugx,
      'provider', v_payment.provider,
      'status', 'refunded'
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_refund',
    'Payment refunded',
    jsonb_build_object ('payment_id', v_payment.id, 'reason', v_reason)
  );

  perform public._subscription_payment_refresh_status (v_payment.subscription_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'status', 'refunded'
  );
end;
$$;

-- Read model for provider adapters: resolve a (provider, reference) pair to the
-- ledger row. Read-only; the caller must be able to initiate payments for the
-- owning organization (shop self-service reads its own checkout, Waka staff
-- read anything they settle).
create or replace function public.subscription_payment_lookup (
  p_provider text,
  p_reference text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_provider text := lower (nullif (trim (coalesce (p_provider, '')), ''));
  v_reference text := nullif (trim (coalesce (p_reference, '')), '');
  v_payment record;
begin
  if v_provider is null or v_reference is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_reference');
  end if;

  select sp.id, sp.subscription_id, sp.organization_id, sp.shop_id, sp.status,
         sp.amount_ugx, sp.currency, sp.provider, sp.reference, sp.created_at, sp.confirmed_at
    into v_payment
  from public.subscription_payments sp
  where sp.provider = v_provider
    and sp.reference = v_reference;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_initiate (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object (
    'ok', true,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'shop_id', v_payment.shop_id,
    'status', v_payment.status,
    'amount_ugx', v_payment.amount_ugx,
    'currency', v_payment.currency,
    'provider', v_payment.provider,
    'reference', v_payment.reference,
    'created_at', v_payment.created_at,
    'confirmed_at', v_payment.confirmed_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Manual admin payment — same contract, period now advances atomically
-- ----------------------------------------------------------------------------
-- Signature, role list, provider ('manual_admin'), history action and audit
-- action are unchanged from 028/039 so every existing caller keeps working.
-- The change is the foot-gun fix: a recorded payment advances the subscription
-- period (and consumes the trial) inside the same transaction as the row, so a
-- payment can no longer be marked while the period silently stays behind.

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
  v_amount bigint := greatest (coalesce (p_amount_ugx, 0), 0);
  v_payment_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
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

  if v_amount > 0 then
    select p.period_start, p.period_end
    into v_period_start, v_period_end
    from public._subscription_payment_advance_period (p_subscription_id) p;
  end if;

  v_payment_id := gen_random_uuid ();

  insert into public.subscription_payments (
    id,
    subscription_id,
    organization_id,
    shop_id,
    amount_ugx,
    provider,
    status,
    recorded_by,
    note,
    metadata
  )
  select
    v_payment_id,
    p_subscription_id,
    v_org,
    s.shop_id,
    v_amount,
    'manual_admin',
    'confirmed',
    auth.uid (),
    nullif (trim (p_note), ''),
    jsonb_build_object ('created_via', 'admin_subscription_mark_payment')
  from public.subscriptions s
  where s.id = p_subscription_id;

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

  perform public._internal_subscription_history_write (
    p_subscription_id,
    'mark_payment',
    coalesce (nullif (trim (p_note), ''), 'Payment recorded'),
    jsonb_build_object (
      'amount_ugx', v_amount,
      'payment_id', v_payment_id,
      'period_start', v_period_start,
      'period_end', v_period_end
    )
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
    jsonb_build_object (
      'subscription_id', p_subscription_id,
      'amount_ugx', v_amount,
      'payment_id', v_payment_id
    )
  from public.subscriptions s
  where s.id = p_subscription_id;
end;
$$;

-- 8. EXECUTE surface: no anonymous entry into the payment ledger, the
-- settlement functions stay on `authenticated` (browser admin paths) and gain
-- `service_role` (future MTN/Airtel webhook adapters).

do $revoke$
declare
  sig text;
begin
  foreach sig in array array[
    'public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid)',
    'public.subscription_payment_confirm (uuid, text, text)',
    'public.subscription_payment_fail (uuid, text)',
    'public.subscription_payment_cancel (uuid, text)',
    'public.subscription_payment_refund (uuid, text)',
    'public.subscription_payment_lookup (text, text)',
    'public.subscription_payment_expected_amount (uuid)',
    'public.admin_subscription_mark_payment (uuid, bigint, text)'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from public', sig);
      execute format ('revoke all on function %s from anon', sig);
    end if;
  end loop;
end;
$revoke$;

grant execute on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid) to authenticated;
grant execute on function public.subscription_payment_confirm (uuid, text, text) to authenticated;
grant execute on function public.subscription_payment_fail (uuid, text) to authenticated;
grant execute on function public.subscription_payment_cancel (uuid, text) to authenticated;
grant execute on function public.subscription_payment_refund (uuid, text) to authenticated;
grant execute on function public.subscription_payment_lookup (text, text) to authenticated;
grant execute on function public.subscription_payment_expected_amount (uuid) to authenticated;
grant execute on function public.admin_subscription_mark_payment (uuid, bigint, text) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid) to service_role';
    execute 'grant execute on function public.subscription_payment_confirm (uuid, text, text) to service_role';
    execute 'grant execute on function public.subscription_payment_fail (uuid, text) to service_role';
    execute 'grant execute on function public.subscription_payment_cancel (uuid, text) to service_role';
    execute 'grant execute on function public.subscription_payment_refund (uuid, text) to service_role';
    execute 'grant execute on function public.subscription_payment_lookup (text, text) to service_role';
    execute 'grant execute on function public.subscription_payment_expected_amount (uuid) to service_role';
  end if;
end;
$service$;
