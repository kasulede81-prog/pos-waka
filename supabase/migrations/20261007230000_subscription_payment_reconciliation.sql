-- ============================================================================
-- M3-G — PENDING-PAYMENT RECONCILIATION FOUNDATION
-- ============================================================================
-- M3-G audit findings addressed (all PROVEN gaps):
--   * no pending-payment TTL (M3-A ships without expires_at) — ordinary
--     abandoned intents lived forever;
--   * initiated-but-never-settled payments had no explicit, auditable
--     operator state (only Edge console logs);
--   * plan deactivated between create and confirm left a charged payment
--     stuck pending with no signal;
--   * stale_success (provider says SUCCESS for a terminal row) was a log
--     line only.
--
-- Design rules for this phase:
--   * NO automatic refunds — the architecture has no safe auto-refund path.
--   * Operator cases become EXPLICIT and AUDITABLE: a
--     'payment_reconciliation_required' history row (customer timeline) plus
--     an audit_logs row, never a silent failure and never a state change
--     that could destroy value.
--   * TTL cancellation only ever touches ordinary pendings (no initiated_at,
--     no fresh claim) — provider-held payments are never cancelled here.

-- ---------------------------------------------------------------------------
-- 1. Flag a payment for operator reconciliation (no state change)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_flag_reconciliation (
  p_payment_id uuid,
  p_reason text default 'operator_review'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_reason text := coalesce (nullif (trim (p_reason), ''), 'operator_review');
begin
  select sp.id, sp.subscription_id, sp.organization_id, sp.status, sp.provider
    into v_payment
  from public.subscription_payments sp
  where sp.id = p_payment_id;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'payment_not_found');
  end if;

  if not public._subscription_payment_can_settle (v_payment.organization_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  perform public._internal_subscription_history_write (
    v_payment.subscription_id,
    'payment_reconciliation_required',
    'Payment under review',
    jsonb_build_object (
      'payment_id', v_payment.id,
      'reason', v_reason,
      'status', v_payment.status,
      'provider', v_payment.provider
    )
  );

  perform public._subscription_payment_audit (
    v_payment.subscription_id,
    'subscription_payment_flag_reconciliation',
    'Payment flagged for reconciliation',
    jsonb_build_object ('payment_id', v_payment.id, 'reason', v_reason)
  );

  return jsonb_build_object (
    'ok', true,
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.subscription_payment_flag_reconciliation (uuid, text) from public;
revoke all on function public.subscription_payment_flag_reconciliation (uuid, text) from anon;
grant execute on function public.subscription_payment_flag_reconciliation (uuid, text) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_flag_reconciliation (uuid, text) to service_role';
  end if;
end;
$service$;

-- ---------------------------------------------------------------------------
-- 2. Reconciliation tick (scheduled by M3-G lifecycle cron; also callable)
-- ---------------------------------------------------------------------------
create or replace function public.subscription_payment_reconcile_tick (
  p_pending_ttl_seconds int default 86400,
  p_initiated_ttl_seconds int default 172800,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce (p_now, now ());
  v_pending_ttl interval := make_interval (secs => greatest (coalesce (p_pending_ttl_seconds, 86400), 60));
  v_initiated_ttl interval := make_interval (secs => greatest (coalesce (p_initiated_ttl_seconds, 172800), 60));
  v_cancelled int := 0;
  v_flagged_initiated int := 0;
  v_flagged_plan int := 0;
  v_subs uuid[] := array[]::uuid[];
  v_one uuid;
  rec record;
begin
  -- 2a. TTL: ordinary abandoned pendings (never handed to a provider, no
  --     fresh claim) → cancelled / timed_out. Provider-held payments are
  --     never touched.
  for rec in
    select sp.id, sp.subscription_id
      from public.subscription_payments sp
     where sp.status = 'pending'
       and sp.created_at <= v_now - v_pending_ttl
       and nullif (sp.metadata ->> 'initiated_at', '') is null
       and (
         nullif (sp.metadata ->> 'initiate_claimed_at', '') is null
         or (sp.metadata ->> 'initiate_claimed_at')::timestamptz < v_now - interval '300 seconds'
       )
     for update skip locked
  loop
    update public.subscription_payments sp
       set status = 'cancelled',
           status_reason = 'timed_out'
     where sp.id = rec.id;

    perform public._internal_subscription_history_write (
      rec.subscription_id,
      'payment_cancelled',
      'Pending payment intent expired',
      jsonb_build_object (
        'payment_id', rec.id,
        'status', 'cancelled',
        'status_reason', 'timed_out'
      )
    );

    v_subs := v_subs || rec.subscription_id;
    v_cancelled := v_cancelled + 1;
  end loop;

  -- 2b. Initiated but never settled past the window → explicit operator state.
  for rec in
    select sp.id, sp.subscription_id
      from public.subscription_payments sp
     where sp.status = 'pending'
       and nullif (sp.metadata ->> 'initiated_at', '') is not null
       and (sp.metadata ->> 'initiated_at')::timestamptz <= v_now - v_initiated_ttl
       and not exists (
         select 1
         from public.subscription_history h
         where h.subscription_id = sp.subscription_id
           and h.action = 'payment_reconciliation_required'
           and h.payload ->> 'payment_id' = sp.id::text
           and h.payload ->> 'reason' = 'initiated_unsettled'
       )
  loop
    perform public._internal_subscription_history_write (
      rec.subscription_id,
      'payment_reconciliation_required',
      'Payment under review',
      jsonb_build_object (
        'payment_id', rec.id,
        'reason', 'initiated_unsettled',
        'status', 'pending'
      )
    );
    perform public._subscription_payment_audit (
      rec.subscription_id,
      'subscription_payment_reconcile_tick',
      'Initiated payment not settled in time',
      jsonb_build_object ('payment_id', rec.id, 'reason', 'initiated_unsettled')
    );
    v_flagged_initiated := v_flagged_initiated + 1;
  end loop;

  -- 2c. Plan deactivated between create and confirm → explicit operator state
  --     (the payment stays pending; nothing is auto-failed or refunded).
  for rec in
    select sp.id, sp.subscription_id
      from public.subscription_payments sp
     where sp.status = 'pending'
       and nullif (sp.metadata -> 'checkout' ->> 'plan_code', '') is not null
       and not exists (
         select 1
         from public.subscription_plans pl
         where pl.code = sp.metadata -> 'checkout' ->> 'plan_code'
           and pl.is_active
       )
       and not exists (
         select 1
         from public.subscription_history h
         where h.subscription_id = sp.subscription_id
           and h.action = 'payment_reconciliation_required'
           and h.payload ->> 'payment_id' = sp.id::text
           and h.payload ->> 'reason' = 'plan_unavailable'
       )
  loop
    perform public._internal_subscription_history_write (
      rec.subscription_id,
      'payment_reconciliation_required',
      'Payment under review',
      jsonb_build_object (
        'payment_id', rec.id,
        'reason', 'plan_unavailable',
        'status', 'pending'
      )
    );
    perform public._subscription_payment_audit (
      rec.subscription_id,
      'subscription_payment_reconcile_tick',
      'Checkout plan no longer active',
      jsonb_build_object ('payment_id', rec.id, 'reason', 'plan_unavailable')
    );
    v_flagged_plan := v_flagged_plan + 1;
  end loop;

  -- Recompute payment_status for every subscription a TTL cancel touched.
  foreach v_one in array v_subs loop
    perform public._subscription_payment_refresh_status (v_one);
  end loop;

  return jsonb_build_object (
    'ok', true,
    'cancelled', v_cancelled,
    'flagged_initiated', v_flagged_initiated,
    'flagged_plan', v_flagged_plan,
    'ran_at', v_now
  );
exception
  when undefined_column then
    -- Never happen in production; keeps a partial run from wedging the cron.
    return jsonb_build_object ('ok', false, 'error', 'reconcile_failed');
end;
$$;

revoke all on function public.subscription_payment_reconcile_tick (int, int, timestamptz) from public;
revoke all on function public.subscription_payment_reconcile_tick (int, int, timestamptz) from anon;
grant execute on function public.subscription_payment_reconcile_tick (int, int, timestamptz) to authenticated;

do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.subscription_payment_reconcile_tick (int, int, timestamptz) to service_role';
  end if;
end;
$service$;
