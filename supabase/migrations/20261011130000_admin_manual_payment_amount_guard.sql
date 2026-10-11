-- ============================================================================
-- Manual / offline payment: the server owns the amount
-- ============================================================================
-- APPROVED DECISION A. "The server calculates the authoritative discounted
-- amount and rejects mismatches."
--
-- WHAT WAS WRONG. `admin_subscription_mark_payment` took whatever amount the
-- caller typed and recorded it, without ever comparing it to the price the
-- discount implies. The shop console offered the amount from the PUBLIC price
-- book (`fetchPublicSubscriptionPricing`), which by design excludes the admin
-- discount — so a shop on a 50% discount was offered, and could be charged,
-- the full list price. This is the one place in the system where a discount
-- genuinely never applied.
--
-- WHAT THIS DOES. Two functions, no signature changes:
--
--   1. `admin_subscription_expected_amount(uuid)` — a billing-gated READ that
--      returns exactly what the money path says this subscription costs right
--      now, computed by `subscription_payment_plan_amount` itself. The admin
--      console shows this number instead of the public book's.
--
--   2. `admin_subscription_mark_payment` (same uuid, bigint, text signature, so
--      every existing caller and the pinned suites keep working) now resolves
--      the expected amount AFTER locking the subscription row and BEFORE any
--      mutation, and refuses:
--        * `amount_mismatch`      — a supplied amount that is not the expected one
--        * `invalid_amount`       — null, zero or negative
--        * `fully_discounted`     — the expected price is 0 because the
--                                   effective discount is 100%; the caller must
--                                   use `admin_subscription_activate_free`
--        * `nothing_to_pay`       — the expected price is 0 for any other
--                                   reason (e.g. a free plan)
--      Each refusal raises BEFORE the stale-pending sweep, before the period
--      advance and before the ledger insert, so a wrong amount mutates nothing.
--      The ledger amount written is always the SERVER's `v_expected`.
--
--   3. A NEGOTIATED OFFER PAYS FOR ONE PERIOD. The one amount that is not the
--      plan's is an organization billing offer (039's fulfil flow records the
--      payment at the OFFER's amount, so refusing it would break that flow).
--      When that path is taken, the offer is now marked `fulfilled` in the SAME
--      transaction — the schema's existing terminal state — so one commitment
--      can only ever settle one payment. A second call with the same amount
--      finds no live offer and is refused, and 039's own fulfilment update
--      becomes a harmless no-op instead of a conflict.
--
-- Zero-value payment rows are therefore impossible on this path. The other
-- writer, `subscription_payment_create`, is closed in
-- `20261011170000_public_pricing_with_global_discounts.sql`.

-- ----------------------------------------------------------------------------
-- What this subscription costs right now
-- ----------------------------------------------------------------------------
create or replace function public.admin_subscription_expected_amount (p_subscription_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_cycle text;
  v_individual numeric;
  v_effective numeric;
  v_org uuid;
  v_monthly bigint;
  v_annual bigint;
begin
  perform public._pricing_require_billing_admin ();

  if p_subscription_id is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select sp.code,
         s.billing_interval,
         public._admin_discount_for_row (s),
         s.organization_id
    into v_plan, v_cycle, v_individual, v_org
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
  end if;

  -- The same resolution every money path performs: the individual discount if
  -- it is in force, otherwise the plan's global rule, otherwise none.
  v_effective := public._admin_discount_effective (v_individual, v_plan);

  -- Both cycles, priced by the authoritative function (never re-derived here).
  v_monthly := public.subscription_payment_plan_amount (v_plan, 'month', v_individual);
  v_annual := public.subscription_payment_plan_amount (v_plan, 'year', v_individual);

  return jsonb_build_object (
    'ok', true,
    'subscription_id', p_subscription_id,
    'organization_id', v_org,
    'plan_code', v_plan,
    'billing_interval', case
      when lower (coalesce (v_cycle, '')) in ('year', 'yearly', 'annual', 'annually', 'year') then 'year'
      else 'month'
    end,
    'effective_discount_percent', v_effective,
    'individual_discount_percent', coalesce (v_individual, 0),
    'monthly_ugx', v_monthly,
    'annual_ugx', v_annual,
    'expected_amount_ugx', case
      when lower (coalesce (v_cycle, '')) in ('year', 'yearly', 'annual', 'annually') then v_annual
      else v_monthly
    end,
    'fully_discounted', v_effective >= 100,
    'quoted_at', now ()
  );
end;
$$;

revoke all on function public.admin_subscription_expected_amount (uuid) from public;
revoke all on function public.admin_subscription_expected_amount (uuid) from anon;
grant execute on function public.admin_subscription_expected_amount (uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Mark payment — the same body, with the amount guard in front of it
-- ----------------------------------------------------------------------------
-- Everything below is byte-identical to `20261007250000_admin_mark_payment_guard.sql`
-- except: two declaration lines, the derivation of `v_expected`, and the guard
-- block that sits between the row lock and the cross-channel check. The
-- transformation was applied mechanically and diffed, not retyped.
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
  v_shop_id uuid;
  v_amount bigint;
  v_plan_code text;
  v_interval text;
  v_discount numeric;
  v_effective numeric;
  v_expected bigint;
  v_offer_id uuid;
  v_consumed_offer_id uuid;
  v_payment_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_stale_id uuid;
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

  -- M3-G lock order: subscription first.
  perform 1
  from public.subscriptions s
  where s.id = p_subscription_id
  for update;

  -- ------------------------------------------------------------------------
  -- THE AMOUNT GUARD (decision A). Placed after the row lock so the price
  -- cannot move underneath it, and before EVERY mutation below — the stale
  -- sweep, the advance and the ledger insert — so a wrong amount changes
  -- nothing at all.
  -- ------------------------------------------------------------------------
  select sp.code,
         s.billing_interval,
         s.shop_id,
         public._admin_discount_for_row (s)
    into v_plan_code, v_interval, v_shop_id, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_plan_code is null then
    raise exception 'Subscription not found';
  end if;

  -- What the money path charges for this subscription, right now, with the
  -- campaign price, the account discount and the global rule all resolved.
  v_expected := public.subscription_payment_plan_amount (v_plan_code, v_interval, v_discount);
  v_effective := public._admin_discount_effective (v_discount, v_plan_code);

  if v_expected = 0 then
    -- Nothing to pay. A fully-discounted account must go through the audited
    -- free-activation RPC, which grants the period and writes NO payment row;
    -- any other zero price (a free plan, say) has nothing to mark paid either.
    if v_effective >= 100 then
      raise exception 'fully_discounted'
        using detail = format ('effective_discount_percent=%s', v_effective),
              hint = 'Use admin_subscription_activate_free for a fully discounted account.';
    end if;
    raise exception 'nothing_to_pay'
      using detail = format ('expected_amount_ugx=0;effective_discount_percent=%s', v_effective);
  end if;

  if coalesce (p_amount_ugx, 0) <= 0 then
    raise exception 'invalid_amount'
      using detail = format ('expected_amount_ugx=%s', v_expected);
  end if;

  if p_amount_ugx <> v_expected then
    -- ONE OTHER AUTHORITATIVE SOURCE. An organization billing offer is a
    -- negotiated price the organization already agreed to, stored server-side in
    -- `org_billing_offers` and fulfilled by 039's
    -- `internal_ops_org_billing_offer_fulfill` — which records the payment at
    -- the OFFER's amount, not the plan's. Honouring it keeps that flow working
    -- without letting a caller invent a number: the amount must already exist on
    -- a live offer for THIS organization (and this shop, when the offer names
    -- one). Anything else is still refused.
    --
    -- FIFO: the oldest outstanding commitment for that amount is the one being
    -- settled. (`internal_ops_org_billing_offer_send` cancels pending offers it
    -- supersedes but leaves a `claimed_paid` one alone, so more than one live
    -- offer can exist.)
    select o.id
      into v_offer_id
    from public.org_billing_offers o
    where o.organization_id = v_org
      and (o.shop_id is null or o.shop_id = v_shop_id)
      and o.amount_ugx = p_amount_ugx
      and o.status in ('pending', 'claimed_paid')
    order by o.created_at asc
    limit 1;

    if v_offer_id is null then
      raise exception 'amount_mismatch'
        using detail = format ('expected_amount_ugx=%s', v_expected),
              hint = 'The server price includes the account or global discount.';
    end if;

    -- ------------------------------------------------------------------------
    -- CONSUME IT. A negotiated offer pays for ONE period, so it must not be
    -- reusable: without this, the same live offer would satisfy this guard on
    -- every later call, which is exactly the reuse the review flagged (F2).
    --
    -- The status predicate is the atomic gate: if another session settled this
    -- offer first, the update matches nothing and the payment is refused rather
    -- than recording a second one against a commitment that is already spent.
    -- `fulfilled`/`fulfilled_at` are the schema's existing terminal state for a
    -- settled offer, which is also what 039's fulfil writes — so that flow's own
    -- update becomes a harmless no-op instead of a conflict.
    --
    -- One transaction: if anything below raises (a payment already in flight,
    -- the ledger guard, the period advance), this rolls back with it.
    -- ------------------------------------------------------------------------
    update public.org_billing_offers o
       set status = 'fulfilled',
           fulfilled_at = now ()
     where o.id = v_offer_id
       and o.status in ('pending', 'claimed_paid')
    returning o.id into v_consumed_offer_id;

    if v_consumed_offer_id is null then
      raise exception 'amount_mismatch'
        using detail = format ('expected_amount_ugx=%s', v_expected),
              hint = 'That billing offer was settled by another payment a moment ago.';
    end if;

    -- The matched offer amount IS the authoritative amount for this payment —
    -- it is the price the organization agreed to, and the ledger must record
    -- the money that actually changed hands.
    v_amount := p_amount_ugx;
  else
    -- The ordinary case: the ledger records the SERVER's number, which is what
    -- makes the server, not the caller, authoritative.
    v_amount := v_expected;
  end if;

  -- M3-G cross-channel guard: never grant a manual period while a provider
  -- payment for the same subscription is in flight — its settlement would
  -- grant a second period for the same commercial payment.
  if exists (
    select 1
    from public.subscription_payments sp
    where sp.subscription_id = p_subscription_id
      and sp.status = 'pending'
      and nullif (sp.metadata ->> 'initiated_at', '') is not null
  ) then
    raise exception 'payment_reconciliation_required';
  end if;

  -- Retire ordinary abandoned checkouts so they can never settle afterwards.
  for v_stale_id in
    select sp.id
      from public.subscription_payments sp
     where sp.subscription_id = p_subscription_id
       and sp.status = 'pending'
       and nullif (sp.metadata ->> 'initiated_at', '') is null
       for update
  loop
    update public.subscription_payments sp
       set status = 'cancelled',
           status_reason = 'stale_replaced'
     where sp.id = v_stale_id;

    perform public._internal_subscription_history_write (
      p_subscription_id,
      'payment_cancelled',
      'Superseded by a manual payment',
      jsonb_build_object (
        'payment_id', v_stale_id,
        'status', 'cancelled',
        'status_reason', 'stale_replaced'
      )
    );
  end loop;

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

revoke all on function public.admin_subscription_mark_payment (uuid, bigint, text) from public;
revoke all on function public.admin_subscription_mark_payment (uuid, bigint, text) from anon;
grant execute on function public.admin_subscription_mark_payment (uuid, bigint, text) to authenticated;

notify pgrst, 'reload schema';
