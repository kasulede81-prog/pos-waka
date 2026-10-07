-- ============================================================================
-- M3-G — PRICING FAIL-CLOSED FOR CATALOG PLANS (checkout paths)
-- ============================================================================
-- M3-G audit finding (PROVEN code path, HYPOTHESIS trigger):
--   subscription_payment_plan_amount fell back to the legacy 066 price book
--   (subscription_plans: starter 25,000 / business 49,000 / waka_plus 99,000)
--   whenever the canonical book (113: 18,000 / 36,000 / 82,000) did not
--   produce a value — i.e. when subscription_canonical_prices or
--   pricing_campaign_plan_discounts was missing, or the canonical row for the
--   plan was absent. Quote and create share this core, so BOTH would agree on
--   the stale number: a real customer could be charged 49,000 while every
--   display surface shows 36,000.
--
-- Fix: for the three catalog plans the fallback is removed. If canonical
-- pricing cannot produce the amount, the function RAISES
-- 'pricing_unavailable':
--   * subscription_payment_quote  → the RPC fails → checkout quote fails
--   * subscription_payment_create → the RPC fails → no payment row is written
-- Display-only surfaces are untouched: public_subscription_pricing() calls
-- _pricing_compute_plan_row directly (never this function), and the client
-- keeps its harmless display fallback (CANONICAL_PLAN_PRICES).
--
-- Non-catalog legacy plans (e.g. small_shop / wholesale / supermarket) keep
-- the plan-row fallback: for them the subscription_plans row IS the only
-- price source, and they are not purchasable through checkout.
-- 'free' (0 UGX) and any non-catalog code behave exactly as before.

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
    -- M3-G FAIL-CLOSED: the catalog plans must NEVER be priced from the
    -- legacy 066 book. If canonical pricing did not produce a value, refuse
    -- the quote/create instead of silently charging a stale price.
    if v_plan in ('starter', 'business', 'waka_plus') then
      raise exception 'pricing_unavailable';
    end if;

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
