-- ============================================================================
-- Zero-payment activation for a 100% discount
-- ============================================================================
-- APPROVED DECISION C. "Allow secure, authorized, audited zero-payment
-- activation. Do not create zero-value payment records or call payment
-- providers with UGX 0. Make the operation atomic and idempotent."
--
-- WHY A SEPARATE FLOW RATHER THAN LETTING A ZERO PAYMENT THROUGH. The ledger,
-- the provider contract and the reconciliation ticks are all built around a
-- payment having a positive amount and a provider reference. A UGX 0 row would
-- sit pending forever, be swept as stale, and grant nothing. So a fully
-- discounted account gets its period granted directly, with NO row in
-- `subscription_payments` at all — the subscription's own history and the
-- platform audit table are the record.
--
-- WHAT MAKES IT SAFE.
--   * Authorization   — `_pricing_require_billing_admin()`, the same four
--                       billing roles that may set a discount. A shop can never
--                       activate itself.
--   * Eligibility     — the discount must resolve to EXACTLY 100% for this
--                       subscription right now (account rule in its window, or
--                       a global rule), AND the authoritative pricing function
--                       must actually return 0 for it. Both are re-checked
--                       server-side; neither is taken from the caller.
--   * Atomicity       — one transaction: the subscription row is locked for
--                       update, the period is advanced by the SAME function a
--                       paid settlement uses, and the marker is written inside
--                       it. There is no window in which a period exists without
--                       its record, or the reverse.
--   * Idempotency     — a retry (double-click, network re-send, or two admins)
--                       finds an activation already recorded for the window the
--                       subscription is currently in and returns it unchanged.
--                       A unique index on (subscription_id, covered_from) is
--                       the durable backstop behind the row lock.
--   * No re-pricing  — nothing here touches a settled payment, and
--                       `_subscription_payment_advance_period` is the only
--                       period writer (decision F).
--
-- WHAT IT DOES NOT DO. It cannot grant a second period while the first is still
-- running: the covered-window check returns the existing activation instead.
-- Extending again after that period lapses is a new, separate activation.

create table if not exists public.subscription_free_activations (
  id uuid primary key default gen_random_uuid (),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  plan_code text,
  billing_interval text,
  -- The effective percentage that entitled this activation. Stored, not
  -- recomputed later: the audit must say what was true when it was granted.
  discount_percent numeric(5, 2) not null
    check (discount_percent >= 0 and discount_percent <= 100),
  -- The period start this activation paid for. The idempotency key.
  covered_from timestamptz not null,
  period_end timestamptz,
  reason text,
  activated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now ()
);

comment on table public.subscription_free_activations is
  'One row per free (100%-discount) period granted. Read only through the '
  'subscription history and the admin audit trail; RLS is enabled with NO '
  'policies and all client privileges are revoked.';

create unique index if not exists subscription_free_activations_window_uq
  on public.subscription_free_activations (subscription_id, covered_from);

create index if not exists subscription_free_activations_org_idx
  on public.subscription_free_activations (organization_id, created_at desc);

alter table public.subscription_free_activations enable row level security;

-- No policies on purpose, and the table privileges are revoked too, so a future
-- policy cannot accidentally expose it (same posture as admin_plan_discounts).
revoke all on table public.subscription_free_activations from public;
revoke all on table public.subscription_free_activations from anon;
revoke all on table public.subscription_free_activations from authenticated;

-- ----------------------------------------------------------------------------
-- The RPC
-- ----------------------------------------------------------------------------
create or replace function public.admin_subscription_activate_free (
  p_subscription_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_shop_id uuid;
  v_plan text;
  v_interval text;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_individual numeric;
  v_effective numeric;
  v_price bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_activation_id uuid;
  v_existing record;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._pricing_require_billing_admin ();

  if p_subscription_id is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  -- Lock first: everything below reads a price and a window that cannot move.
  select s.organization_id,
         s.shop_id,
         sp.code,
         s.billing_interval,
         s.current_period_start,
         s.current_period_end,
         public._admin_discount_for_row (s)
    into v_org, v_shop_id, v_plan, v_interval, v_current_start, v_current_end, v_individual
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id
  -- `of s`: the lock belongs on the subscription row. A bare FOR UPDATE cannot
  -- be applied to the nullable side of the outer join (the plan row), and the
  -- LEFT JOIN is deliberate — a subscription with no plan row must come back as
  -- "plan_not_available" rather than as no row at all.
  for update of s;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
  end if;

  -- ELIGIBILITY, resolved exactly as checkout resolves it: the account rule if
  -- it is in force, otherwise the plan's global rule, otherwise none.
  v_effective := public._admin_discount_effective (v_individual, v_plan);

  if v_effective < 100 then
    return jsonb_build_object (
      'ok', false,
      'error', 'not_fully_discounted',
      'effective_discount_percent', v_effective
    );
  end if;

  -- And the price itself must really be zero, computed by the money function.
  v_price := public.subscription_payment_plan_amount (v_plan, v_interval, v_individual);

  if v_price <> 0 then
    return jsonb_build_object (
      'ok', false,
      'error', 'not_zero_price',
      'expected_amount_ugx', v_price
    );
  end if;

  -- IDEMPOTENCY. The window the subscription is currently in was already
  -- granted for free -> return that activation, change nothing. A retry after a
  -- successful call lands here because the advance below moved
  -- current_period_start to exactly the covered_from that was recorded.
  if v_current_start is not null
     and v_current_end is not null
     and v_current_end > now () then
    select a.id,
           a.covered_from,
           a.period_end,
           a.discount_percent,
           a.created_at
      into v_existing
    from public.subscription_free_activations a
    where a.subscription_id = p_subscription_id
      and a.covered_from = v_current_start
    order by a.created_at desc
    limit 1;

    if found then
      return jsonb_build_object (
        'ok', true,
        'idempotent', true,
        'activation_id', v_existing.id,
        'subscription_id', p_subscription_id,
        'plan_code', v_plan,
        'billing_interval', v_interval,
        'discount_percent', v_existing.discount_percent,
        'period_start', v_current_start,
        'period_end', v_current_end,
        'payment_required', 0,
        'activated_at', v_existing.created_at
      );
    end if;
  end if;

  -- ------------------------------------------------------------------------
  -- CROSS-CHANNEL GUARD (review finding F1). The same predicate
  -- `admin_subscription_mark_payment` uses, for the same reason: a payment that
  -- has already been handed to the provider can still settle, and a settlement
  -- advances the period — so granting a free period underneath one would hand
  -- out TWO periods for one commercial action.
  --
  -- It sits AFTER the idempotency check on purpose. A retry of a grant that
  -- already happened must still answer "idempotent" whatever else is in flight;
  -- only a NEW grant is refused.
  --
  -- Only provider-initiated pendings block. An abandoned checkout has no
  -- `initiated_at`, can never settle (the reconciliation tick retires it), and
  -- must not stop an admin from activating an account.
  -- ------------------------------------------------------------------------
  if exists (
    select 1
    from public.subscription_payments sp
    where sp.subscription_id = p_subscription_id
      and sp.status = 'pending'
      and nullif (sp.metadata ->> 'initiated_at', '') is not null
  ) then
    raise exception 'payment_reconciliation_required'
      using detail = format ('subscription_id=%s', p_subscription_id),
            hint = 'Settle or cancel the payment in flight before granting a free period.';
  end if;

  -- Exactly one period, through the same function a paid settlement uses, so a
  -- fresh unpaid admin grant is claimed rather than extended (H1 semantics).
  select p.period_start, p.period_end
    into v_period_start, v_period_end
  from public._subscription_payment_advance_period (p_subscription_id) p;

  if v_period_start is null then
    -- Nothing to grant: the plan prices at zero with no open window at all.
    return jsonb_build_object ('ok', false, 'error', 'nothing_to_activate');
  end if;

  -- Durable marker. The unique index makes a duplicate window impossible even
  -- if two sessions ever raced past the row lock.
  insert into public.subscription_free_activations (
    subscription_id, organization_id, shop_id, plan_code, billing_interval,
    discount_percent, covered_from, period_end, reason, activated_by
  )
  values (
    p_subscription_id, v_org, v_shop_id, v_plan, v_interval,
    v_effective, v_period_start, v_period_end, v_reason, auth.uid ()
  )
  on conflict (subscription_id, covered_from) do nothing
  returning id into v_activation_id;

  if v_activation_id is null then
    -- ------------------------------------------------------------------------
    -- IMPOSSIBLE BY CONSTRUCTION (review finding F3) — and therefore fatal.
    --
    -- Reaching here means an activation row already covers the exact window this
    -- call just granted. It cannot happen: the row lock serializes every caller,
    -- the covered-window check above returns early for any window already
    -- granted, and a fresh anchor is `max(now(), current_period_end)` which can
    -- never equal an earlier activation's window start (those are all in the
    -- past by the time their period ends).
    --
    -- Reporting `idempotent: true` here would have been a LIE about a period
    -- that `_subscription_payment_advance_period` has already granted above,
    -- leaving a second period on the subscription with no record to explain it.
    -- Raising instead rolls the whole transaction back — including that advance
    -- — so an impossible state can never quietly hand out a free period.
    -- ------------------------------------------------------------------------
    raise exception 'free_activation_conflict'
      using detail = format ('subscription_id=%s;covered_from=%s', p_subscription_id, v_period_start),
            hint = 'A free activation already covers this window; nothing was granted.';
  end if;

  -- No payment was taken, so the subscription is WAIVED, not paid. A later
  -- settled payment overwrites this through the normal refresh; 'waived' is
  -- never stripped by it.
  update public.subscriptions s
  set
    payment_status = 'waived',
    updated_at = now (),
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object (
        'free_activation_window_start', v_period_start,
        'free_activation_at', timezone ('Africa/Kampala', now ())::text,
        'free_activation_by', auth.uid ()::text,
        'free_activation_percent', v_effective
      )
  where s.id = p_subscription_id;

  -- The same two trails a paid settlement leaves.
  perform public._internal_subscription_history_write (
    p_subscription_id,
    'free_activation',
    format ('%s%% discount — period granted without payment', v_effective),
    jsonb_build_object (
      'discount_percent', v_effective,
      'plan_code', v_plan,
      'billing_interval', v_interval,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'activation_id', v_activation_id,
      'reason', v_reason
    )
  );

  perform public._pricing_audit (
    'admin_subscription_free_activation',
    jsonb_build_object (
      'subscription_id', p_subscription_id,
      'organization_id', v_org,
      'shop_id', v_shop_id,
      'plan_code', v_plan,
      'billing_interval', v_interval,
      'discount_percent', v_effective,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'activation_id', v_activation_id,
      'reason', v_reason
    )
  );

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_activate_free',
    format ('Free activation at %s%% discount', v_effective),
    jsonb_build_object (
      'subscription_id', p_subscription_id,
      'discount_percent', v_effective,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'activation_id', v_activation_id,
      'reason', v_reason
    )
  );

  return jsonb_build_object (
    'ok', true,
    'idempotent', false,
    'activation_id', v_activation_id,
    'subscription_id', p_subscription_id,
    'plan_code', v_plan,
    'billing_interval', v_interval,
    'discount_percent', v_effective,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'payment_required', 0,
    'activated_at', now ()
  );
end;
$$;

revoke all on function public.admin_subscription_activate_free (uuid, text) from public;
revoke all on function public.admin_subscription_activate_free (uuid, text) from anon;
grant execute on function public.admin_subscription_activate_free (uuid, text) to authenticated;

notify pgrst, 'reload schema';
