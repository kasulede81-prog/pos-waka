-- ============================================================================
-- M3-B — CUSTOMER PAYMENT READ / QUOTE FOUNDATION
-- ============================================================================
-- Three additive, read-only SECURITY DEFINER RPCs designed by the M3-B
-- forensic audit. They are the last foundation piece required before any
-- checkout UI (M3-D): a customer-visible price quote, a single-payment poll,
-- and a scoped payment history.
--
--   1. subscription_payment_quote(shop, plan, cycle)
--        Resolves shop -> subscription with the SAME anchor rule as
--        subscription_payment_create (_subscription_payment_resolve), gates
--        with the SAME predicate as initiation (_subscription_payment_can_
--        initiate: owner/admin/billing | internal | service_role), and prices
--        with the SAME core the price page and create use
--        (subscription_payment_plan_amount -> canonical + active campaign +
--        floor + annual discount, minus the subscription's admin discount).
--        The quote is advisory: create re-prices server-side, so a stale
--        quote can only ever produce amount_mismatch (fail-closed).
--        No expiry is stored — quoted_at is the freshness signal.
--
--   2. subscription_payment_get(payment_id)
--        Single-payment poll for the client that holds the id returned by
--        create. Organization-scoped read (billing is org-level; the anchor
--        rule governs creation only). Gate failure returns
--        payment_not_found — byte-identical to a missing id — so the RPC can
--        never be used as a foreign-UUID existence oracle.
--
--   3. my_subscription_payments(shop, limit, before)
--        Keyset-paged history for exactly one shop of the caller's own
--        organization: organization_id = org AND (shop_id = shop OR
--        shop_id IS NULL — org-level manual payments). Clamped limit (1..100),
--        created_at DESC, cursor `before`. No id input, so it cannot
--        enumerate other records.
--
-- SAFE PROJECTION (get + every history row — never subscription_payments.*):
--   payment_id, subscription_id, shop_id, status, status_reason, amount_ugx,
--   currency, provider, reference, created_at, confirmed_at,
--   checkout (rebuilt field-by-field: plan_code, billing_interval,
--             quoted_amount, campaign_id, quoted_at),
--   provider_status (future whitelist: a single string only).
-- Deliberately EXCLUDED: note (staff text), recorded_by (internal identity),
-- raw metadata (future phone / callback payloads / provider secrets),
-- organization_id (derivable, unnecessary).
--
-- No tables, no schema changes, no SELECT policies, no state-machine or
-- settlement changes: M1 / M2 / M3-A are untouched. The internal SELECT
-- policy on subscription_payments remains the only table policy; these RPCs
-- are the only customer read path.
--
-- Grants: EXECUTE revoked from public + anon (anon fails at the grant layer),
-- granted to authenticated and service_role (guarded), matching the M1/M3-A
-- payment RPC surface.

-- ----------------------------------------------------------------------------
-- 1. Quote — advisory server price for a requested plan/cycle
-- ----------------------------------------------------------------------------

create or replace function public.subscription_payment_quote (
  p_shop_id uuid,
  p_plan_code text,
  p_billing_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop_org uuid;
  v_sub_id uuid;
  v_org uuid;
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_cycle text;
  v_cur_plan text;
  v_cur_cycle text;
  v_discount numeric;
  v_amount bigint;
  v_campaign_id uuid := null;
begin
  select s.organization_id
    into v_shop_org
  from public.shops s
  where s.id = p_shop_id;

  if v_shop_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- Same shop/subscription/anchor resolution as payment creation.
  select o_subscription_id, o_organization_id
    into v_sub_id, v_org
  from public._subscription_payment_resolve (p_shop_id, null);

  if v_sub_id is null then
    if exists (select 1 from public.subscriptions s where s.organization_id = v_shop_org) then
      return jsonb_build_object ('ok', false, 'error', 'shop_subscription_mismatch');
    end if;
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  -- Same predicate as initiation: owner/admin/billing | internal | service.
  if not public._subscription_payment_can_initiate (v_org) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if v_plan is null
     or not exists (
       select 1 from public.subscription_plans sp where sp.code = v_plan and sp.is_active
     ) then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
  end if;

  v_cycle := case
    when lower (trim (p_billing_cycle)) in ('monthly', 'month') then 'month'
    when lower (trim (p_billing_cycle)) in ('yearly', 'annual', 'annually', 'year') then 'year'
    else null
  end;
  if v_cycle is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_billing_interval');
  end if;

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

  -- Identical inputs to subscription_payment_create, so quote == create.
  v_amount := public.subscription_payment_plan_amount (v_plan, v_cycle, v_discount);

  -- Same campaign id rule as the create snapshot / public price page.
  if to_regclass ('public.subscription_canonical_prices') is not null
     and to_regclass ('public.pricing_campaign_plan_discounts') is not null
     and v_plan in ('starter', 'business', 'waka_plus') then
    v_campaign_id := public._pricing_active_campaign_id ();
  end if;

  return jsonb_build_object (
    'ok', true,
    'shop_id', p_shop_id,
    'subscription_id', v_sub_id,
    'plan_code', v_plan,
    'billing_interval', v_cycle,
    'amount_ugx', v_amount,
    'currency', 'UGX',
    'campaign_id', v_campaign_id,
    'quoted_at', now (),
    'current_plan_code', v_cur_plan,
    'current_billing_interval', v_cur_cycle,
    'is_current', v_plan = v_cur_plan and v_cycle = v_cur_cycle
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Get one payment — org-scoped, fail-closed, safe projection
-- ----------------------------------------------------------------------------

create or replace function public.subscription_payment_get (p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_checkout jsonb := null;
  v_checkout_src jsonb;
begin
  select sp.id,
         sp.subscription_id,
         sp.shop_id,
         sp.organization_id,
         sp.status,
         sp.status_reason,
         sp.amount_ugx,
         sp.currency,
         sp.provider,
         sp.reference,
         sp.created_at,
         sp.confirmed_at,
         sp.metadata
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  -- Gate failure is indistinguishable from a missing id: no UUID oracle.
  if not public._subscription_payment_can_initiate (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  -- Rebuild the checkout snapshot field-by-field: future metadata keys (phone,
  -- callback payloads, provider secrets) must never leak by association.
  v_checkout_src := v_payment.metadata -> 'checkout';
  if v_checkout_src is not null and (v_checkout_src ->> 'plan_code') is not null then
    v_checkout := jsonb_build_object (
      'plan_code', v_checkout_src ->> 'plan_code',
      'billing_interval', v_checkout_src ->> 'billing_interval',
      'quoted_amount', case
        when jsonb_typeof (v_checkout_src -> 'quoted_amount') = 'number'
        then (v_checkout_src ->> 'quoted_amount')::bigint
      end,
      'campaign_id', case
        when jsonb_typeof (v_checkout_src -> 'campaign_id') = 'string'
        then v_checkout_src -> 'campaign_id'
      end,
      'quoted_at', case
        when jsonb_typeof (v_checkout_src -> 'quoted_at') = 'string'
        then v_checkout_src -> 'quoted_at'
      end
    );
  end if;

  return jsonb_build_object (
    'ok', true,
    'payment_id', v_payment.id,
    'subscription_id', v_payment.subscription_id,
    'shop_id', v_payment.shop_id,
    'status', v_payment.status,
    'status_reason', v_payment.status_reason,
    'amount_ugx', v_payment.amount_ugx,
    'currency', v_payment.currency,
    'provider', v_payment.provider,
    'reference', v_payment.reference,
    'created_at', v_payment.created_at,
    'confirmed_at', v_payment.confirmed_at,
    'checkout', v_checkout,
    'provider_status', case
      when jsonb_typeof (v_payment.metadata -> 'provider_status') = 'string'
      then v_payment.metadata ->> 'provider_status'
    end
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Customer payment history — one shop, keyset paged, clamped
-- ----------------------------------------------------------------------------

create or replace function public.my_subscription_payments (
  p_shop_id uuid,
  p_limit integer default 10,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit integer := least (greatest (coalesce (p_limit, 10), 1), 100);
  v_payments jsonb := '[]'::jsonb;
  v_next timestamptz := null;
  v_prev_created timestamptz := null;
  v_n integer := 0;
  v_row record;
  v_checkout jsonb;
  v_checkout_src jsonb;
begin
  -- Missing and foreign shops collapse to the same error (no shop oracle).
  select s.organization_id
    into v_org
  from public.shops s
  where s.id = p_shop_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  if not public._subscription_payment_can_initiate (v_org) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  for v_row in
    select sp.id,
           sp.subscription_id,
           sp.shop_id,
           sp.status,
           sp.status_reason,
           sp.amount_ugx,
           sp.currency,
           sp.provider,
           sp.reference,
           sp.created_at,
           sp.confirmed_at,
           sp.metadata
      from public.subscription_payments sp
     where sp.organization_id = v_org
       and (sp.shop_id = p_shop_id or sp.shop_id is null)
       and (p_before is null or sp.created_at < p_before)
     order by sp.created_at desc, sp.id desc
     limit v_limit + 1
  loop
    v_n := v_n + 1;
    exit when v_n > v_limit;

    v_checkout := null;
    v_checkout_src := v_row.metadata -> 'checkout';
    if v_checkout_src is not null and (v_checkout_src ->> 'plan_code') is not null then
      v_checkout := jsonb_build_object (
        'plan_code', v_checkout_src ->> 'plan_code',
        'billing_interval', v_checkout_src ->> 'billing_interval',
        'quoted_amount', case
          when jsonb_typeof (v_checkout_src -> 'quoted_amount') = 'number'
          then (v_checkout_src ->> 'quoted_amount')::bigint
        end,
        'campaign_id', case
          when jsonb_typeof (v_checkout_src -> 'campaign_id') = 'string'
          then v_checkout_src -> 'campaign_id'
        end,
        'quoted_at', case
          when jsonb_typeof (v_checkout_src -> 'quoted_at') = 'string'
          then v_checkout_src -> 'quoted_at'
        end
      );
    end if;

    v_payments := v_payments || jsonb_build_object (
      'payment_id', v_row.id,
      'subscription_id', v_row.subscription_id,
      'shop_id', v_row.shop_id,
      'status', v_row.status,
      'status_reason', v_row.status_reason,
      'amount_ugx', v_row.amount_ugx,
      'currency', v_row.currency,
      'provider', v_row.provider,
      'reference', v_row.reference,
      'created_at', v_row.created_at,
      'confirmed_at', v_row.confirmed_at,
      'checkout', v_checkout,
      'provider_status', case
        when jsonb_typeof (v_row.metadata -> 'provider_status') = 'string'
        then v_row.metadata ->> 'provider_status'
      end
    );
    v_prev_created := v_row.created_at;
  end loop;

  -- A limit+1-th row proved there is more: cursor points at the last returned.
  if v_n > v_limit then
    v_next := v_prev_created;
  end if;

  return jsonb_build_object (
    'ok', true,
    'payments', v_payments,
    'next_cursor', v_next
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. EXECUTE surface: authenticated customers + service_role, never anon
-- ----------------------------------------------------------------------------

do $revoke$
declare
  sig text;
begin
  foreach sig in array array[
    'public.subscription_payment_quote (uuid, text, text)',
    'public.subscription_payment_get (uuid)',
    'public.my_subscription_payments (uuid, integer, timestamptz)'
  ] loop
    if to_regprocedure (sig) is not null then
      execute format ('revoke all on function %s from public', sig);
      execute format ('revoke all on function %s from anon', sig);
    end if;
  end loop;
end;
$revoke$;

grant execute on function public.subscription_payment_quote (uuid, text, text) to authenticated;
grant execute on function public.subscription_payment_get (uuid) to authenticated;
grant execute on function public.my_subscription_payments (uuid, integer, timestamptz) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_quote (uuid, text, text) to service_role';
    execute 'grant execute on function public.subscription_payment_get (uuid) to service_role';
    execute 'grant execute on function public.my_subscription_payments (uuid, integer, timestamptz) to service_role';
  end if;
end;
$service$;
