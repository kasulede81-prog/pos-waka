-- ============================================================================
-- M1 FOLLOW-UP — H1 period compounding, H2 price authority, campaign revenue
-- ============================================================================
-- Read-only forensic review follow-up. Three contained fixes, no schema
-- changes (pure `create or replace` of existing M1/113 functions):
--
-- H1 — PLAN-GRANT x MARK-PAID COMPOUNDING
--   `admin_shop_set_subscription_plan` (043) grants `now() + N days` and
--   stamps `metadata.plan_set_at` (Africa/Kampala wall clock) while setting
--   `current_period_start = now()`. M1's payment path then advanced from
--   `greatest(now, current_period_end)` — so "Apply Plan" followed by
--   "Mark Paid" handed out ~60 days for one monthly payment.
--   Invariant now enforced in `_subscription_payment_advance_period` (the
--   single choke point used by BOTH `admin_subscription_mark_payment` and
--   `subscription_payment_confirm`, so no caller order can bypass it):
--     * the current window is a FRESH admin plan-grant (plan_set_at matches
--       current_period_start within 1s), AND it is still live, AND no settled
--       payment has claimed that exact window yet
--       -> the payment FUNDS that window instead of stacking a second one;
--     * every other case keeps the M1 semantics: advance from
--       greatest(now, current_period_end) exactly once.
--   Which payment claimed a window is tracked in
--   `subscriptions.metadata.period_covered_window_start` (written only by
--   this function; survives plan-set because 043 merges metadata with `||`).
--   Fail-open by design: if `plan_set_at` is absent or unparseable, behaviour
--   is exactly M1's (extend), never a broken payment.
--   Explicit grants (`admin_shop_set_subscription_plan` days), explicit
--   extensions (`admin_extend_subscription_trial`), trials, promotional
--   grants (separate `promotional_grants` table — never touches periods) and
--   the annual-offer fulfilment (039 overwrites the period afterwards with
--   now()+365d) are all unchanged.
--
-- H2 — ONE AUTHORITATIVE PRICE SOURCE
--   113 declares `subscription_canonical_prices` the protected source of
--   truth and `public_subscription_pricing()` (anon) is what customers see,
--   including active campaign discounts via `_pricing_compute_plan_row`.
--   M1's `subscription_payment_expected_amount` read `subscription_plans`
--   instead (066 values 25k/49k/99k vs canonical 18k/36k/82k) and ignored
--   campaigns. It now mirrors `public_subscription_pricing()` exactly —
--   same canonical table, same active-campaign lookup, same
--   `_pricing_compute_plan_row` — so the server price and the advertised
--   price cannot drift. Fallbacks (free plan, canonical book absent) keep
--   the previous list-price behaviour. Tamper protection is untouched:
--   the client amount is still only COMPARED against this value and the
--   stored amount is still immutable.
--
-- CAMPAIGN REVENUE ATTRIBUTION
--   `admin_pricing_campaign_metrics` (113) picked the newest
--   `subscription_payments` row with no status filter, so pending / failed /
--   cancelled / refunded rows would count as `revenue_recorded_ugx` once
--   provider checkout exists. The lateral now selects the newest SETTLED row
--   (`confirmed` or legacy `recorded`). Existing behaviour for confirmed and
--   recorded payments is byte-identical.
--
-- Compatibility: same signatures for all three functions, no DDL, no grant
-- changes (ACLs survive `create or replace`), SECURITY DEFINER +
-- `set search_path = public` per project convention.

-- ----------------------------------------------------------------------------
-- H1 — period advancement: fund a fresh admin grant, otherwise extend once
-- ----------------------------------------------------------------------------

create or replace function public._subscription_payment_advance_period (p_subscription_id uuid)
returns table (period_start timestamptz, period_end timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_interval text;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_monthly bigint;
  v_annual bigint;
  v_metadata jsonb;
  v_plan_set_wall timestamp := null;
  v_start_wall timestamp;
  v_plan_granted boolean := false;
  v_covered_start timestamptz;
  v_covered boolean := false;
  v_anchor timestamptz;
  v_start timestamptz;
  v_end timestamptz;
begin
  select s.status,
         s.billing_interval,
         s.current_period_start,
         s.current_period_end,
         coalesce (sp.monthly_price_ugx, 0),
         coalesce (sp.annual_price_ugx, 0),
         coalesce (s.metadata, '{}'::jsonb)
    into v_status, v_interval, v_current_start, v_current_end, v_monthly, v_annual, v_metadata
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

  -- Is the CURRENT window a fresh admin plan grant? 043 writes
  -- plan_set_at = timezone('Africa/Kampala', now())::text (wall clock, no
  -- offset) in the same statement that sets current_period_start = now(),
  -- so the two must describe the same instant. Any parse problem means
  -- "not a fresh grant" -> M1 extend behaviour (fail-open).
  if v_current_start is not null and nullif (v_metadata ->> 'plan_set_at', '') is not null then
    begin
      v_plan_set_wall := (v_metadata ->> 'plan_set_at')::timestamp;
      v_start_wall := timezone ('Africa/Kampala', v_current_start);
      v_plan_granted := v_plan_set_wall is not null
        and abs (extract (epoch from (v_start_wall - v_plan_set_wall))) <= 1;
    exception
      when others then
        v_plan_granted := false;
    end;
  end if;

  -- Has a settled payment already claimed this exact window?
  if v_current_start is not null and nullif (v_metadata ->> 'period_covered_window_start', '') is not null then
    begin
      v_covered_start := (v_metadata ->> 'period_covered_window_start')::timestamptz;
      v_covered := v_covered_start is not null and v_covered_start = v_current_start;
    exception
      when others then
        v_covered := false;
    end;
  end if;

  if v_current_end is not null
     and v_current_end > now ()
     and v_plan_granted
     and not v_covered then
    -- Fresh, still-live admin grant with no payment behind it yet: this
    -- payment settles THAT billing action. Claim the window; never add a
    -- second one on top (Apply Plan -> Mark Paid must stay one period).
    update public.subscriptions s
    set
      metadata = coalesce (s.metadata, '{}'::jsonb)
        || jsonb_build_object ('period_covered_window_start', v_current_start),
      updated_at = now ()
    where s.id = p_subscription_id;

    period_start := v_current_start;
    period_end := v_current_end;
    return next;
    return;
  end if;

  -- Normal (M1) path: renew from max(now, current_period_end) exactly once.
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
    metadata = coalesce (s.metadata, '{}'::jsonb)
      || jsonb_build_object ('period_covered_window_start', v_start),
    updated_at = now ()
  where s.id = p_subscription_id;

  period_start := v_start;
  period_end := v_end;
  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- H2 — expected amount from the canonical + campaign price (what customers see)
-- ----------------------------------------------------------------------------

create or replace function public.subscription_payment_expected_amount (p_subscription_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_code text;
  v_interval text;
  v_admin_discount numeric;
  v_list_monthly bigint;
  v_list_annual bigint;
  v_campaign_id uuid;
  v_disc_type text;
  v_disc_value numeric;
  v_disc_annual numeric;
  v_row jsonb;
  v_monthly bigint;
  v_annual bigint;
  v_amount numeric;
begin
  select sp.code,
         s.billing_interval,
         coalesce (s.admin_discount_percent, 0),
         coalesce (sp.monthly_price_ugx, 0),
         coalesce (sp.annual_price_ugx, 0)
    into v_plan_code, v_interval, v_admin_discount, v_list_monthly, v_list_annual
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_plan_code is null then
    return 0;
  end if;

  -- Authoritative path: identical inputs and the identical computation as
  -- public_subscription_pricing() (113) — canonical list price plus the
  -- active campaign's discount row, via _pricing_compute_plan_row (which
  -- also enforces the 5,000 UGX floor and the annual discount).
  if to_regclass ('public.subscription_canonical_prices') is not null
     and to_regclass ('public.pricing_campaign_plan_discounts') is not null
     and v_plan_code in ('starter', 'business', 'waka_plus') then
    v_campaign_id := public._pricing_active_campaign_id ();

    if v_campaign_id is not null then
      select d.monthly_discount_type, d.monthly_discount_value, d.annual_discount_percent
        into v_disc_type, v_disc_value, v_disc_annual
      from public.pricing_campaign_plan_discounts d
      where d.campaign_id = v_campaign_id
        and d.plan_code = v_plan_code;
    end if;

    if v_disc_type is not null then
      v_row := public._pricing_compute_plan_row (v_plan_code, v_disc_type, v_disc_value, v_disc_annual);
    else
      v_row := public._pricing_compute_plan_row (v_plan_code, 'none', 0, null);
    end if;
  end if;

  if v_row is not null then
    v_monthly := (v_row ->> 'final_monthly_ugx')::bigint;
    v_annual := (v_row ->> 'final_annual_ugx')::bigint;
  else
    -- Free plan, a deployment without 113, or a canonical row that is
    -- missing for this plan: use the plan row (free = 0), i.e. exactly the
    -- pre-H2 behaviour — never fall through to zero.
    v_monthly := v_list_monthly;
    v_annual := v_list_annual;
  end if;

  v_amount := case when v_interval = 'year' then v_annual else v_monthly end;

  -- Per-subscription manual override (M1 semantics; no writer exists today).
  v_amount := round (v_amount * (100 - least (greatest (v_admin_discount, 0), 100)) / 100);

  return greatest (coalesce (v_amount::bigint, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- Campaign revenue attribution — only settled payments count
-- ----------------------------------------------------------------------------
-- Re-definition of 113's admin_pricing_campaign_metrics with TWO changes:
--
-- 1. The lateral now takes the newest SETTLED row (`confirmed` or legacy
--    `recorded`). A newer pending/failed/cancelled/refunded row can no longer
--    hide an older confirmed payment, and a payment that never settled
--    contributes nothing to revenue_recorded_ugx.
--
-- 2. DISCOVERED PRE-EXISTING DEFECT (reproduced while testing fix 1, both
--    branches, before any change here): 113 declares `v_campaign record`.
--    With no active campaign the variable is never assigned, so
--    `v_campaign.name` in the return payload raises `record "v_campaign" is
--    not assigned yet`; with an active campaign, passing the untyped record
--    to `pricing_campaign_is_active(public.pricing_campaigns)` raises
--    `cannot cast type record to pricing_campaigns`. Either way the function
--    errors before returning any revenue — the caller
--    (`fetchPricingCampaignMetrics`) swallows RPC errors, which is why this
--    was never surfaced. Typing the variable as the table's rowtype makes
--    both branches return the same payload shape as113 intended (campaign
--    fields null when there is no campaign). This is required for the
--    attribution fix to be observable at all; no other line of 113's
--    behaviour changes.

create or replace function public.admin_pricing_campaign_metrics (
  p_campaign_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid := coalesce(p_campaign_id, public._pricing_active_campaign_id());
  v_campaign public.pricing_campaigns%rowtype;
  v_new_subs integer := 0;
  v_by_plan jsonb := '{}'::jsonb;
  v_revenue_impact bigint := 0;
  v_total_in_window integer := 0;
begin
  perform public._pricing_require_admin ();

  if v_campaign_id is not null then
    select * into v_campaign from public.pricing_campaigns where id = v_campaign_id;
  end if;

  with window_subs as (
    select
      sp.code as plan_code,
      s.organization_id,
      s.created_at,
      coalesce(spay.amount_ugx, 0) as paid_ugx
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    left join lateral (
      select amount_ugx
      from public.subscription_payments spay
      where spay.subscription_id = s.id
        -- M1 follow-up: revenue attribution counts settled payments only.
        and spay.status in ('confirmed', 'recorded')
      order by spay.created_at desc
      limit 1
    ) spay on true
    where sp.code in ('starter', 'business', 'waka_plus')
      and s.status in ('active', 'trialing')
      and (p_from is null or s.created_at >= p_from)
      and (p_to is null or s.created_at <= p_to)
      and (
        v_campaign_id is null
        or (
          (v_campaign.starts_at is null or s.created_at >= v_campaign.starts_at)
          and (v_campaign.ends_at is null or s.created_at < v_campaign.ends_at)
        )
      )
  )
  select
    coalesce(sum(cnt), 0)::integer,
    coalesce(jsonb_object_agg(plan_code, cnt), '{}'::jsonb),
    coalesce(sum(paid_ugx), 0)::bigint
  into v_new_subs, v_by_plan, v_revenue_impact
  from (
    select plan_code, count(*)::integer as cnt, sum(paid_ugx) as paid_ugx
    from window_subs
    group by plan_code
  ) agg;

  select count(*)::integer into v_total_in_window
  from public.subscriptions s
  where (p_from is null or s.created_at >= p_from)
    and (p_to is null or s.created_at <= p_to);

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'campaign_name', v_campaign.name,
    'campaign_active', v_campaign.id is not null and public.pricing_campaign_is_active(v_campaign),
    'new_subscribers', v_new_subs,
    'new_subscribers_by_plan', v_by_plan,
    'revenue_recorded_ugx', v_revenue_impact,
    'conversion_rate_percent',
      case when v_total_in_window > 0
        then round((v_new_subs::numeric / v_total_in_window) * 100, 2)
        else 0
      end,
    'total_subscriptions_in_window', v_total_in_window
  );
end;
$$;

revoke all on function public.admin_pricing_campaign_metrics (uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_pricing_campaign_metrics (uuid, timestamptz, timestamptz) to authenticated;
