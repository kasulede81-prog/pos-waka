-- ============================================================================
-- M3-G — PROTECT admin_subscription_mark_payment (cross-channel double-count)
-- ============================================================================
-- M3-G audit finding #19 (mechanism PROVEN): admin "Mark Paid" advanced the
-- period unconditionally. If a customer's provider payment was already in
-- flight (pending row), a later settlement of THAT row advanced the period a
-- second time — two periods for one commercial charge. The H1 grant-window
-- de-dup does not apply: mark_payment never writes plan_set_at.
--
-- Fix (preserves legitimate independent payments):
--   1. Lock the subscription FIRST (lock order: subscription → payment,
--      matching create/confirm/fail/cancel/refund after 20261007200000).
--   2. If a PROVIDER-INITIATED payment is pending → REFUSE with
--      'payment_reconciliation_required': money may be moving; an operator
--      must reconcile first (explicit, auditable — never guess).
--   3. Ordinary (never-initiated) pending checkouts are stale-replaced by
--      the manual payment — exactly like a newer intent would do — so the
--      abandoned checkout can no longer settle later.
--   4. Everything else (roles, amount, advance, insert, history, audit)
--      byte-identical to M1.
--
-- Same-row idempotency was already safe: manual rows are born 'confirmed'
-- with a NULL reference, so subscription_payment_confirm can never settle
-- them again (M1 idempotent/terminal branches).

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
