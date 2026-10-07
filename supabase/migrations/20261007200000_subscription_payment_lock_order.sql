-- ============================================================================
-- M3-G — PAYMENT LOCK-ORDER NORMALIZATION (fail / cancel / refund)
-- ============================================================================
-- M3-G audit finding (PROVEN mechanism, HYPOTHESIS occurrence):
--   subscription_payment_create  locks  subscription → payment rows
--   subscription_payment_confirm locks  subscription → payment
--   subscription_payment_fail / _cancel / _refund DID lock payment →
--     subscription (the subscription lock was taken later, inside
--     _subscription_payment_refresh_status), i.e. the REVERSE order.
--
-- A provider callback's fail/cancel racing a new intent creation (or a
-- confirm) on the same rows is a classic ABBA deadlock: PostgreSQL aborts
-- one side, surfacing as a retryable `rpc_failed` / `settle_refused`.
--
-- This migration re-creates the three settlement RPCs with the SAME lock
-- order as create/confirm:
--
--   1. read the payment row WITHOUT a lock (only to learn subscription_id)
--   2. lock the subscription row FOR UPDATE (if present)
--   3. lock the payment row FOR UPDATE and re-read it
--   4. everything else (authorization, state checks, writes,
--      _subscription_payment_refresh_status) unchanged
--
-- Invariants preserved: _subscription_payment_can_settle gate runs before
-- any mutation; the M1 state machine / idempotent branches / history /
-- audit rows / refresh_status calls are byte-identical to M1. No security
-- check is weakened — the unlocked first read only obtains subscription_id,
-- and every decision is made on the re-read (locked) row.
--
-- Signatures unchanged → EXECUTE grants survive CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- PENDING → FAILED
-- ---------------------------------------------------------------------------
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
  v_sub_id uuid;
begin
  -- M3-G lock order: subscription first (matches create/confirm).
  select sp.subscription_id
    into v_sub_id
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if v_sub_id is not null then
    perform 1
    from public.subscriptions s
    where s.id = v_sub_id
    for update;
  end if;

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

-- ---------------------------------------------------------------------------
-- PENDING → CANCELLED
-- ---------------------------------------------------------------------------
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
  v_sub_id uuid;
begin
  -- M3-G lock order: subscription first (matches create/confirm).
  select sp.subscription_id
    into v_sub_id
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if v_sub_id is not null then
    perform 1
    from public.subscriptions s
    where s.id = v_sub_id
    for update;
  end if;

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

-- ---------------------------------------------------------------------------
-- CONFIRMED/RECORDED → REFUNDED
-- ---------------------------------------------------------------------------
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
  v_sub_id uuid;
begin
  -- M3-G lock order: subscription first (matches create/confirm).
  select sp.subscription_id
    into v_sub_id
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if v_sub_id is not null then
    perform 1
    from public.subscriptions s
    where s.id = v_sub_id
    for update;
  end if;

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

-- REFUND POLICY (M3-G, explicit): the granted period is NOT rolled back by
-- this function — refund-entitlement revocation is an open PRODUCT decision
-- (see the M3-G final report). The refund path deliberately records only the
-- ledger reversal (status → refunded, payment_status → unpaid via
-- _subscription_payment_refresh_status); nothing in this function — or its
-- history/audit payloads — claims that entitlement was reversed.
