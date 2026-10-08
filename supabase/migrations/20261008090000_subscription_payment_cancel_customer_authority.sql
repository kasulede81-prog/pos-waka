-- ============================================================================
-- CUSTOMER PAYMENT CANCELLATION — correct authority for subscription_payment_cancel
-- ============================================================================
-- PROVEN production defect: a paying customer could not abandon their own
-- pending checkout. The frontend called subscription_payment_cancel correctly
-- and the RPC answered {"ok": false, "error": "forbidden"}.
--
-- WHY. The cancel RPC was gated by _subscription_payment_can_settle, which is
-- deliberately restricted to service_role and internal Waka billing roles —
-- its contract is "a shop owner must not be able to confirm their own payment
-- into existence". Grouping `cancel` with confirm/fail/refund was right for
-- those three (they GRANT entitlement and must stay webhook/settlement-only)
-- and wrong for this one: cancelling a pending intent grants nothing. It only
-- flips pending → cancelled and writes history/audit. The gate was never
-- exercised by a customer before, because the only prior caller was the
-- payment Edge Functions, which run as service_role (for whom it returns true).
--
-- FIX. Re-create the function with the CUSTOMER-FACING gate that already
-- authorizes this exact payer to create and initiate the very payment they are
-- abandoning: _subscription_payment_can_initiate (service_role | internal
-- billing roles | organization member with role owner/admin). No new
-- authorization concept is introduced.
--
-- DELIBERATELY UNCHANGED:
--   * _subscription_payment_can_settle — untouched.
--   * confirm / fail / refund — keep the settlement gate. A shop owner must
--     still never be able to confirm their own payment into existence.
--   * the M1 state machine, idempotent branch, pending-only rule,
--     payment_not_found masking, lock order (subscription → payment),
--     history + audit rows, refresh_status.
--   * no provider call, no entitlement change.
--
-- Body is byte-identical to 20261007200000_subscription_payment_lock_order.sql
-- except the single authorization line. Signature unchanged → EXECUTE grants
-- (authenticated, service_role) survive CREATE OR REPLACE.

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

  -- CUSTOMER-FACING AUTHORITY (was _subscription_payment_can_settle).
  -- Abandoning a pending intent is not a settlement: it moves no money and
  -- grants no entitlement, so it takes the same authority as creating and
  -- initiating that intent. Settlement authority is unchanged for confirm /
  -- fail / refund.
  if not public._subscription_payment_can_initiate (v_payment.organization_id) then
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
