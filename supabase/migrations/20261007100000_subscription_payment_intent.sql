-- ============================================================================
-- M3-A — PAYMENT INTENT FOUNDATION (provider-free checkout foundation)
-- ============================================================================
-- Builds the M3 audit's approved foundation on top of M1 (b46e084c) and M2
-- (46487e3d). No providers, no webhooks, no checkout UI, no new tables, no
-- new payment status, no expires_at.
--
-- What this migration does:
--   1. subscription_payment_plan_amount(plan, cycle, discount) — one pricing
--      core shared with public_subscription_pricing(): canonical price + active
--      campaign (percentage/fixed/floor/annual) via _pricing_compute_plan_row,
--      falling back to the plan row for free / non-catalog codes.
--      subscription_payment_expected_amount() now delegates to it, so a
--      payment intent and the public price page can never diverge.
--   2. subscription_payment_create gains requested plan_code + billing_cycle
--      (monthly|month|yearly|annual|year), prices the REQUESTED plan/cycle
--      server-side, and stores a bounded metadata.checkout snapshot
--      {plan_code, billing_interval, quoted_amount, campaign_id, quoted_at}.
--      The client amount is still only COMPARED against the server result.
--      Older pending intents for the same subscription are auto-cancelled
--      (status_reason = 'stale_replaced') under a subscription row lock.
--   3. subscription_payment_confirm validates the checkout snapshot against
--      the immutable ledger amount, applies the purchased plan_id +
--      billing_interval, advances the period exactly once, flips the payment
--      to confirmed, refreshes payment_status and writes history/audit — all
--      inside ONE guarded block that rolls back together (a
--      subscription_conflict leaves the payment pending, never half-settled).
--      Confirmation remains can_settle only (service_role / internal staff):
--      customers can initiate, only trusted settlement confirms.
--   4. _subscription_payment_can_initiate now also accepts the org 'billing'
--      role (owner | admin | billing). staff/manager/viewer remain excluded.
--
-- Preserved guarantees: durable payment_id replay, (provider, reference)
-- uniqueness (index untouched), cross-subscription reference rejection,
-- cross-shop/organization resolution, H1 period semantics, M2 lockdown (no
-- table privilege or RLS changes on subscriptions; payment-table posture
-- untouched). Signature swap of create: the old 7-parameter overload is
-- dropped and replaced by one 9-parameter function (defaults keep every
-- existing 7-argument call working) so a single creation path applies.

-- ----------------------------------------------------------------------------
-- 1. Shared pricing core (same inputs as public_subscription_pricing)
-- ----------------------------------------------------------------------------

create or replace function public.subscription_payment_plan_amount (
  p_plan_code text,
  p_billing_interval text,
  p_admin_discount_percent numeric default 0
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_cycle text := lower (nullif (trim (coalesce (p_billing_interval, '')), ''));
  v_campaign_id uuid;
  v_disc_type text;
  v_disc_value numeric;
  v_disc_annual numeric;
  v_row jsonb;
  v_monthly bigint;
  v_annual bigint;
  v_amount bigint;
  v_discount numeric := least (greatest (coalesce (p_admin_discount_percent, 0), 0), 100);
begin
  if v_plan is null then
    raise exception 'plan_not_available';
  end if;

  if v_cycle in ('monthly', 'month') then
    v_cycle := 'month';
  elsif v_cycle in ('yearly', 'annual', 'annually', 'year') then
    v_cycle := 'year';
  else
    raise exception 'invalid_billing_interval';
  end if;

  -- Authoritative branch: canonical book + active campaign, computed by the
  -- exact function public_subscription_pricing() uses.
  if to_regclass ('public.subscription_canonical_prices') is not null
     and to_regclass ('public.pricing_campaign_plan_discounts') is not null
     and v_plan in ('starter', 'business', 'waka_plus') then
    v_campaign_id := public._pricing_active_campaign_id ();

    if v_campaign_id is not null then
      select d.monthly_discount_type, d.monthly_discount_value, d.annual_discount_percent
        into v_disc_type, v_disc_value, v_disc_annual
      from public.pricing_campaign_plan_discounts d
      where d.campaign_id = v_campaign_id
        and d.plan_code = v_plan;
    end if;

    if v_disc_type is not null then
      v_row := public._pricing_compute_plan_row (v_plan, v_disc_type, v_disc_value, v_disc_annual);
    else
      v_row := public._pricing_compute_plan_row (v_plan, 'none', 0, null);
    end if;

    if v_row is not null then
      v_monthly := (v_row ->> 'final_monthly_ugx')::bigint;
      v_annual := (v_row ->> 'final_annual_ugx')::bigint;
    end if;
  end if;

  if v_monthly is null then
    -- Free plan, non-catalog code, or a deployment without 113: the plan row
    -- is the price. is_active is deliberately not enforced here (the plan row
    -- of an existing subscription must keep pricing); purchase-time activation
    -- is checked by subscription_payment_create.
    select sp.monthly_price_ugx, sp.annual_price_ugx
      into v_monthly, v_annual
    from public.subscription_plans sp
    where sp.code = v_plan;

    if v_monthly is null then
      raise exception 'plan_not_available';
    end if;
  end if;

  v_amount := case when v_cycle = 'year' then v_annual else v_monthly end;
  v_amount := greatest (coalesce (round (v_amount * (100 - v_discount) / 100)::bigint, 0), 0);

  return v_amount;
end;
$$;

revoke all on function public.subscription_payment_plan_amount (text, text, numeric) from public;
revoke all on function public.subscription_payment_plan_amount (text, text, numeric) from anon;
grant execute on function public.subscription_payment_plan_amount (text, text, numeric) to authenticated;

-- expected_amount now delegates to the shared core: intent pricing and the
-- public price page are computed by the same code path (signature unchanged,
-- ACLs survive create-or-replace).
create or replace function public.subscription_payment_expected_amount (p_subscription_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_code text;
  v_cycle text;
  v_discount numeric;
begin
  select sp.code,
         s.billing_interval,
         coalesce (s.admin_discount_percent, 0)
    into v_plan_code, v_cycle, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_plan_code is null then
    return 0; -- preserved M1 behaviour for an unknown subscription
  end if;

  return public.subscription_payment_plan_amount (v_plan_code, v_cycle, v_discount);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Initiation now includes the org 'billing' role
-- ----------------------------------------------------------------------------
-- Owner | admin | billing may start a checkout for their own organization.
-- staff / manager / viewer cannot. Settlement (can_settle) is untouched:
-- service_role + internal billing roles only.

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
      and om.role in ('owner', 'admin', 'billing')
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Payment intent creation (requested plan/cycle + checkout snapshot +
--    stale-pending auto-cancel)
-- ----------------------------------------------------------------------------
-- The 7-parameter signature is replaced by a single 9-parameter function so
-- there is exactly one creation path. Existing 7-argument calls keep working
-- through the defaults (plan/cycle then resolve to the subscription's current
-- values, and a snapshot is still written).

drop function if exists public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid);

create or replace function public.subscription_payment_create (
  p_shop_id uuid,
  p_provider text,
  p_reference text default null,
  p_amount_ugx bigint default null,
  p_note text default null,
  p_payment_id uuid default null,
  p_subscription_id uuid default null,
  p_plan_code text default null,
  p_billing_cycle text default null
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
  v_cur_plan text;
  v_cur_cycle text;
  v_discount numeric;
  v_plan text;
  v_cycle text;
  v_campaign_id uuid;
  v_amount bigint;
  v_existing record;
  v_locked uuid;
  v_stale_id uuid;
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

  -- Resolve the requested (or current) plan / billing cycle. The SERVER picks
  -- the price from this; the client only ever asks for it.
  select sp.code,
         s.billing_interval,
         coalesce (s.admin_discount_percent, 0)
    into v_cur_plan, v_cur_cycle, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = v_sub_id;

  if v_cur_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if p_plan_code is not null then
    v_plan := lower (nullif (trim (p_plan_code), ''));
    if v_plan is null
       or not exists (
         select 1 from public.subscription_plans sp where sp.code = v_plan and sp.is_active
       ) then
      return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
    end if;
  else
    v_plan := v_cur_plan;
  end if;

  if p_billing_cycle is not null then
    v_cycle := case
      when lower (trim (p_billing_cycle)) in ('monthly', 'month') then 'month'
      when lower (trim (p_billing_cycle)) in ('yearly', 'annual', 'annually', 'year') then 'year'
      else null
    end;
    if v_cycle is null then
      return jsonb_build_object ('ok', false, 'error', 'invalid_billing_interval');
    end if;
  else
    v_cycle := v_cur_cycle;
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

  -- Server price for the REQUESTED plan/cycle (shared core with the price page).
  v_amount := public.subscription_payment_plan_amount (v_plan, v_cycle, v_discount);

  if p_amount_ugx is not null and p_amount_ugx <> v_amount then
    return jsonb_build_object (
      'ok', false,
      'error', 'amount_mismatch',
      'expected_amount_ugx', v_amount
    );
  end if;

  -- Serialize concurrent intent creation for this subscription, then retire
  -- older pending checkouts so exactly one intent can remain actionable.
  select s.id
    into v_locked
  from public.subscriptions s
  where s.id = v_sub_id
  for update;

  if v_locked is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  for v_stale_id in
    select sp.id
      from public.subscription_payments sp
     where sp.subscription_id = v_sub_id
       and sp.status = 'pending'
       and sp.id <> v_payment_id
       and (v_reference is null or sp.reference is distinct from v_reference)
       for update
  loop
    update public.subscription_payments sp
       set status = 'cancelled',
           status_reason = 'stale_replaced'
     where sp.id = v_stale_id;

    perform public._internal_subscription_history_write (
      v_sub_id,
      'payment_cancelled',
      'Superseded by a newer payment intent',
      jsonb_build_object (
        'payment_id', v_stale_id,
        'status', 'cancelled',
        'status_reason', 'stale_replaced'
      )
    );
  end loop;

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
      v_amount,
      'UGX',
      v_provider,
      v_reference,
      'pending',
      auth.uid (),
      nullif (trim (coalesce (p_note, '')), ''),
      jsonb_build_object (
        'created_via', 'subscription_payment_create',
        'checkout', jsonb_build_object (
          'plan_code', v_plan,
          'billing_interval', v_cycle,
          'quoted_amount', v_amount,
          'campaign_id', case
            when to_regclass ('public.subscription_canonical_prices') is not null
               and to_regclass ('public.pricing_campaign_plan_discounts') is not null
               and v_plan in ('starter', 'business', 'waka_plus')
            then public._pricing_active_campaign_id ()
            else null
          end,
          'quoted_at', now ()
        )
      )
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
      'amount_ugx', v_amount,
      'provider', v_provider,
      'reference', v_reference,
      'status', 'pending',
      'plan_code', v_plan,
      'billing_interval', v_cycle
    )
  );

  perform public._subscription_payment_audit (
    v_sub_id,
    'subscription_payment_create',
    'Payment initiated',
    jsonb_build_object (
      'payment_id', v_payment_id,
      'amount_ugx', v_amount,
      'provider', v_provider,
      'reference', v_reference,
      'plan_code', v_plan,
      'billing_interval', v_cycle
    )
  );

  perform public._subscription_payment_refresh_status (v_sub_id);

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id,
    'status', 'pending',
    'amount_ugx', v_amount,
    'expected_amount_ugx', v_amount,
    'plan_code', v_plan,
    'billing_interval', v_cycle
  );
end;
$$;

revoke all on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid, text, text) from public;
revoke all on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid, text, text) from anon;
grant execute on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid, text, text) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_create (uuid, text, text, bigint, text, uuid, uuid, text, text) to service_role';
  end if;
end;
$service$;

-- ----------------------------------------------------------------------------
-- 4. Confirmation applies the purchased plan/interval in ONE guarded block
-- ----------------------------------------------------------------------------
-- Lock → verify pending → validate snapshot → bind reference → [apply plan
-- interval + advance period + flip confirmed, atomic] → history/audit →
-- refresh. A unique_violation anywhere inside the guarded block (the
-- subscription_conflict case) rolls the whole block back, so the payment can
-- never be half-confirmed and the plan can never change without settlement.
-- The idempotent (already-confirmed) branch returns before any of it, so a
-- repeated confirm cannot advance the period, re-apply the plan, or duplicate
-- history.

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
  v_locked_sub uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_checkout jsonb;
  v_req_plan text;
  v_req_cycle text;
  v_quoted bigint;
  v_plan_id uuid := null;
begin
  -- Two-phase locking: read the payment once (unlocked) to learn its
  -- subscription, then take locks in the SAME order creation uses
  -- (subscription → payment) so a webhook confirmation racing a new intent
  -- creation can never deadlock. The second read is the authoritative one.
  select sp.id,
         sp.subscription_id,
         sp.organization_id,
         sp.status,
         sp.reference,
         sp.amount_ugx,
         sp.provider,
         sp.metadata
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  select s.id
    into v_locked_sub
  from public.subscriptions s
  where s.id = v_payment.subscription_id
  for update;

  if v_locked_sub is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select sp.id,
         sp.subscription_id,
         sp.organization_id,
         sp.status,
         sp.reference,
         sp.amount_ugx,
         sp.provider,
         sp.metadata
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

  -- M3-A: validate the checkout snapshot BEFORE any settlement mutation.
  -- The snapshot is trusted only because it is cross-checked against the
  -- immutable ledger amount and the live catalog.
  v_checkout := v_payment.metadata -> 'checkout';

  if v_checkout is not null and v_checkout ->> 'plan_code' is not null then
    v_req_plan := lower (nullif (trim (v_checkout ->> 'plan_code'), ''));
    v_req_cycle := lower (nullif (trim (v_checkout ->> 'billing_interval'), ''));

    if jsonb_typeof (v_checkout -> 'quoted_amount') = 'number' then
      v_quoted := (v_checkout ->> 'quoted_amount')::bigint;
    end if;

    if v_req_plan is null
       or v_req_cycle is null
       or v_req_cycle not in ('month', 'year')
       or v_quoted is null
       or v_quoted <> v_payment.amount_ugx then
      return jsonb_build_object ('ok', false, 'error', 'checkout_invalid');
    end if;

    select sp.id
      into v_plan_id
    from public.subscription_plans sp
    where sp.code = v_req_plan
      and sp.is_active;

    if v_plan_id is null then
      return jsonb_build_object ('ok', false, 'error', 'checkout_invalid');
    end if;
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

  -- ONE guarded settlement block: plan/interval application, period advance
  -- and the confirmed flip commit together or not at all.
  begin
    if v_plan_id is not null then
      update public.subscriptions s
         set plan_id = v_plan_id,
             billing_interval = v_req_cycle,
             updated_at = now ()
       where s.id = v_payment.subscription_id
         and (s.plan_id is distinct from v_plan_id
              or s.billing_interval is distinct from v_req_cycle);
    end if;

    select p.period_start, p.period_end
      into v_period_start, v_period_end
    from public._subscription_payment_advance_period (v_payment.subscription_id) p;

    update public.subscription_payments sp
    set
      status = 'confirmed',
      note = coalesce (nullif (trim (coalesce (p_note, '')), ''), note)
    where sp.id = v_payment.id;
  exception
    when unique_violation then
      return jsonb_build_object ('ok', false, 'error', 'subscription_conflict');
  end;

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
      'period_end', v_period_end,
      'plan_code', v_req_plan,
      'billing_interval', v_req_cycle
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
      'reference', coalesce (v_reference, v_payment.reference),
      'plan_code', v_req_plan,
      'billing_interval', v_req_cycle
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
    'period_end', v_period_end,
    'plan_code', v_req_plan,
    'billing_interval', v_req_cycle
  );
end;
$$;
