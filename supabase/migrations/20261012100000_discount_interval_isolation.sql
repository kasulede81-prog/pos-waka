-- ============================================================================
-- MONTHLY AND ANNUAL DISCOUNTS ARE INDEPENDENT
-- ============================================================================
-- WHAT WAS COUPLED, AND WHY.
--
-- Three mechanisms joined the two billing intervals together. Only one of them
-- was a campaign:
--
--   1. `admin_plan_discounts` — the GLOBAL rule — was keyed by `plan_code`
--      alone, so a plan structurally could not hold two rules. One percent
--      priced monthly and annual alike.
--
--   2. `subscriptions.admin_discount_percent` — the INDIVIDUAL rule — was a
--      single column read through `_admin_discount_for_row(s)`, which takes a
--      row and returns ONE number.
--
--   3. `_pricing_compute_plan_row` built the ANNUAL campaign price from
--      `v_final_monthly` — the monthly price *after* the monthly campaign
--      discount — and then applied the annual percentage on top. So a monthly
--      campaign discount moved the annual price, one way, with the annual
--      percentage left at 0 making it invisible. Measured worst case on the
--      18,000 Starter plan: a legal monthly fixed-amount discount of 13,000
--      (the UGX 5,000 floor allows it) priced a year at 60,000 against a
--      216,000 list, from a monthly-only input.
--
-- ----------------------------------------------------------------------------
-- THE SHAPE, AND WHY IT IS NOT A SECOND DISCOUNT SYSTEM
-- ----------------------------------------------------------------------------
-- `pricing_campaign_plan_discounts` already models exactly what is needed: one
-- row carrying a MONTHLY leg (`monthly_discount_type` + `monthly_discount_value`)
-- and an ANNUAL leg (`annual_discount_percent`). Rather than invent a parallel
-- mechanism, both admin rules take that same pair of columns on the row they
-- already have. Nothing new is created; two columns are added.
--
--   admin_plan_discounts   + annual_discount_percent numeric(5,2) 0–99
--   subscriptions          + admin_discount_percent_annual numeric(6,2) 0–100
--
-- The window (`starts_at` / `expires_at`), `active`, `reason` and the note stay
-- SHARED by the two legs. The decision this implements is price independence,
-- not scheduling independence: a plan has one discount window, and two rates
-- inside it.
--
-- ----------------------------------------------------------------------------
-- WHAT IS PRICE-NEUTRAL, AND WHAT IS NOT
-- ----------------------------------------------------------------------------
-- PRICE-NEUTRAL, BY CONSTRUCTION. Both legs are back-filled from the single
-- percent each row already carried, so every existing rule keeps pricing both
-- cycles exactly as it did. Independence begins from that point; nothing an
-- organization pays changes on the day this ships.
--
-- NOT NEUTRAL, BUT REQUESTED. Fixing (3) does change one price: during an
-- active MONTHLY campaign the annual price stops inheriting the monthly
-- discount and returns to the campaign's annual leg applied to the LIST monthly
-- price. That is the point of the change — a monthly promotion must not move
-- annual pricing — and the annual leg remains the way to discount a year. When
-- no monthly campaign discount is running the figure is identical to before
-- (business: 36,000 × 12 × 0.8 = 345,600 either way).
--
-- ----------------------------------------------------------------------------
-- PRECEDENCE, NOW PER INTERVAL
-- ----------------------------------------------------------------------------
-- Unchanged in kind, resolved one interval at a time:
--
--   for each cycle:
--     base    canonical price for that cycle, campaign layer applied first
--     then    effective = individual leg for that cycle, if > 0
--             ELSE the global rule's leg for that cycle
--             ELSE 0
--     then    amount = round(base * (100 - effective) / 100), floored at 0
--
-- An individual leg REPLACES the global leg for its own cycle; the two are
-- never added. And because the fallback is per interval, an account holding an
-- individual MONTHLY discount no longer suppresses the global ANNUAL rule —
-- each leg answers for itself. Zero keeps its existing meaning on each leg:
-- "this account has no rule of its own here".
--
-- ----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY UNTOUCHED
-- ----------------------------------------------------------------------------
-- Every bound, gate and guard: admin 0–99 (and the 0–100 clamp in the
-- primitive, which the 100% contract test pins), the campaign's 90% monthly
-- clamp and UGX 5,000 monthly floor, the campaign annual 0–90 CHECK/RPC/clamp,
-- `_pricing_require_billing_admin`, every RLS policy, the whole payment state
-- machine, the ledger's own state guard, idempotency and the stale-replace and
-- cross-channel guards. `subscription_payment_plan_amount` keeps its signature
-- exactly, so its ACLs — including the service_role grant — survive, and every
-- money path that calls it needs no change at all.

-- ----------------------------------------------------------------------------
-- 1. Two legs, back-filled so no price moves
-- ----------------------------------------------------------------------------
alter table public.admin_plan_discounts
  add column if not exists annual_discount_percent numeric(5, 2) not null default 0;

alter table public.admin_plan_discounts
  drop constraint if exists admin_plan_discounts_annual_percent_check;

alter table public.admin_plan_discounts
  add constraint admin_plan_discounts_annual_percent_check
  check (annual_discount_percent >= 0 and annual_discount_percent <= 99);

comment on column public.admin_plan_discounts.discount_percent is
  'The MONTHLY leg of this global rule, 0-99. Applied only to a monthly cycle. '
  '0 means the rule does not discount the monthly price; it does not disable '
  'the annual leg.';
comment on column public.admin_plan_discounts.annual_discount_percent is
  'The ANNUAL leg of this global rule, 0-99. Applied only to a yearly cycle. '
  'Back-filled from discount_percent when the legs were separated, so existing '
  'rules kept pricing both cycles exactly as before.';

-- Back-fill. This is what makes the change price-neutral: today's single
-- percent governed both cycles, so it becomes both legs.
update public.admin_plan_discounts
   set annual_discount_percent = discount_percent,
       updated_at = now ()
 where annual_discount_percent <> discount_percent;

alter table public.subscriptions
  add column if not exists admin_discount_percent_annual numeric(6, 2) not null default 0;

alter table public.subscriptions
  drop constraint if exists subscriptions_admin_discount_percent_annual_check;

alter table public.subscriptions
  add constraint subscriptions_admin_discount_percent_annual_check
  check (admin_discount_percent_annual >= 0 and admin_discount_percent_annual <= 100);

comment on column public.subscriptions.admin_discount_percent_annual is
  'The ANNUAL leg of this account''s admin discount, 0-100. Applied only to a '
  'yearly cycle; `admin_discount_percent` is the monthly leg. Both share the '
  'window in admin_discount_starts_at / admin_discount_expires_at. 0 on a leg '
  'means "no individual rule for that cycle", so the plan''s GLOBAL rule for '
  'that same cycle applies instead.';

update public.subscriptions
   set admin_discount_percent_annual = admin_discount_percent,
       updated_at = now ()
 where coalesce (admin_discount_percent, 0) > 0
   and admin_discount_percent_annual <> admin_discount_percent;

-- ----------------------------------------------------------------------------
-- 2. "Is this rule live" now means "either leg is live"
-- ----------------------------------------------------------------------------
-- The row-level predicate. A rule with only an annual leg is live and must be
-- found by the resolver; a rule with only a monthly leg is equally live. Which
-- leg actually applies is then decided per cycle by the resolver below, where a
-- 0 on the requested leg simply yields no discount.
create or replace function public.admin_plan_discount_is_active (d public.admin_plan_discounts)
returns boolean
language sql
stable
as $$
  select d.active
    and (d.discount_percent > 0 or d.annual_discount_percent > 0)
    and (d.starts_at is null or now () >= d.starts_at)
    and (d.expires_at is null or now () < d.expires_at)
$$;

comment on function public.admin_plan_discount_is_active (public.admin_plan_discounts) is
  'Enabled, inside its window, and discounting at least one of the two '
  'intervals — the single definition of "this global rule is live right now". '
  'Which leg applies to a given cycle is answered by _admin_discount_effective.';

-- ----------------------------------------------------------------------------
-- 3. The interval-aware resolver — the one place precedence is decided
-- ----------------------------------------------------------------------------
drop function if exists public._admin_discount_for_row (public.subscriptions);

/**
 * The individual discount this subscription's account is entitled to RIGHT NOW
 * for ONE billing interval.
 *
 * Takes the whole row (a window cannot be evaluated from a number) and the
 * interval (a percent cannot be chosen without one). Two arguments, one number
 * out — the same contract as before, answered per cycle.
 *
 * An expired or not-yet-started window returns 0 for BOTH legs, which the
 * caller reads as "no individual rule", so the global rule for that same cycle
 * then applies. That is deliberate and unchanged: a lapsed individual discount
 * falls back to whatever the plan's global rule says, not to a stale personal
 * rate.
 *
 * `p_interval` is normalised defensively and anything unrecognised falls to
 * 'month', matching the fallback every other interval-reading path uses.
 */
create or replace function public._admin_discount_for_row (
  s public.subscriptions,
  p_interval text
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce (s.admin_discount_percent, 0) <= 0
     and coalesce (s.admin_discount_percent_annual, 0) <= 0 then 0
    when s.admin_discount_starts_at is not null and now () < s.admin_discount_starts_at then 0
    when s.admin_discount_expires_at is not null and now () >= s.admin_discount_expires_at then 0
    when lower (trim (coalesce (p_interval, ''))) in ('year', 'yearly', 'annual', 'annually')
      then least (greatest (coalesce (s.admin_discount_percent_annual, 0), 0), 100)
    else least (greatest (coalesce (s.admin_discount_percent, 0), 0), 100)
  end
$$;

comment on function public._admin_discount_for_row (public.subscriptions, text) is
  'The individual admin discount in force for ONE billing interval, window '
  'resolved. Everything that prices a cycle reads its discount through here, so '
  'a monthly rule can never reach a yearly price.';

-- Internal only. It is called from SECURITY DEFINER payment functions, whose
-- owner keeps EXECUTE; no client role needs it, so none is given it.
revoke all on function public._admin_discount_for_row (public.subscriptions, text) from public;
revoke all on function public._admin_discount_for_row (public.subscriptions, text) from anon;
revoke all on function public._admin_discount_for_row (public.subscriptions, text) from authenticated;

drop function if exists public._admin_discount_effective (numeric, text);

/**
 * Precedence, for ONE interval: the individual leg if it is in force, otherwise
 * the plan's global leg, otherwise none.
 *
 * `p_individual_percent` is ALREADY window-resolved and already the leg for the
 * cycle being priced — every caller reads it through `_admin_discount_for_row`
 * with the same interval it passes here. A 0 therefore means "no individual
 * rule for THIS cycle", and the global rule's leg for the same cycle is the
 * correct fallback.
 *
 * Clamped 0–100, not 0–99, to match what this parameter has always accepted:
 * the existing contract test pins 100% pricing at zero, and no setter in the
 * schema can write above 99. Tightening the primitive would rewrite a tested
 * guarantee to enforce a bound the write path already enforces.
 */
create or replace function public._admin_discount_effective (
  p_individual_percent numeric,
  p_plan_code text,
  p_interval text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_cycle text := case
    when lower (trim (coalesce (p_interval, ''))) in ('year', 'yearly', 'annual', 'annually') then 'year'
    else 'month'
  end;
  v_global numeric;
begin
  -- An individual leg wins outright, for its own cycle only. It is NOT added to
  -- the global rule and the global rule is not applied underneath it.
  if coalesce (p_individual_percent, 0) > 0 then
    return least (greatest (p_individual_percent, 0), 100);
  end if;

  if v_plan is null or to_regclass ('public.admin_plan_discounts') is null then
    return 0;
  end if;

  -- The leg for THIS cycle. A rule that discounts only the other interval is
  -- live at row level but contributes 0 here, which is exactly right.
  select case when v_cycle = 'year' then d.annual_discount_percent else d.discount_percent end
    into v_global
  from public.admin_plan_discounts d
  where d.plan_code = v_plan
    and public.admin_plan_discount_is_active (d);

  if v_global is null then
    return 0;
  end if;

  return least (greatest (v_global, 0), 100);
end;
$$;

revoke all on function public._admin_discount_effective (numeric, text, text) from public;
revoke all on function public._admin_discount_effective (numeric, text, text) from anon;
revoke all on function public._admin_discount_effective (numeric, text, text) from authenticated;

-- ----------------------------------------------------------------------------
-- 4. THE CAMPAIGN FIX — the annual price stops being built on the monthly one
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261011160000` except line 125, which now multiplies the
-- LIST monthly price instead of the discounted one. The 90% clamp, the UGX
-- 5,000 floor, the fallback branch, the annual 0–90 clamp and the honest-saving
-- recomputation are all untouched.
--
-- `original_annual_full_ugx` was already `v_original_monthly * 12`, so the
-- annual leg is now a percentage of the price the annual full figure names —
-- the two finally describe the same thing.
create or replace function public._pricing_compute_plan_row (
  p_plan_code text,
  p_monthly_discount_type text,
  p_monthly_discount_value numeric,
  p_annual_discount_percent numeric
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_original_monthly bigint;
  v_default_annual_pct numeric;
  v_annual_pct numeric;
  v_monthly_discount bigint := 0;
  v_final_monthly bigint;
  v_original_annual_full bigint;
  v_final_annual bigint;
  v_min_monthly bigint := public._pricing_min_final_monthly_ugx ();
begin
  select monthly_price_ugx, default_annual_discount_percent
  into v_original_monthly, v_default_annual_pct
  from public.subscription_canonical_prices
  where plan_code = p_plan_code;

  if v_original_monthly is null then
    return null;
  end if;

  -- Bounded exactly like the monthly leg. The canonical default is already
  -- 0-90 by CHECK; an explicit campaign value is what needed the clamp.
  v_annual_pct := least (greatest (coalesce (p_annual_discount_percent, v_default_annual_pct), 0), 90);

  if p_monthly_discount_type = 'fixed_amount' then
    v_monthly_discount := least(
      greatest(0, round(p_monthly_discount_value)::bigint),
      greatest(0, v_original_monthly - v_min_monthly)
    );
    v_final_monthly := v_original_monthly - v_monthly_discount;
  elsif p_monthly_discount_type = 'percentage' then
    v_monthly_discount := round(
      v_original_monthly * least(greatest(p_monthly_discount_value, 0), 90) / 100.0
    )::bigint;
    v_final_monthly := greatest(v_min_monthly, v_original_monthly - v_monthly_discount);
  else
    v_final_monthly := v_original_monthly;
    v_monthly_discount := 0;
  end if;

  -- Report what the plan actually saves. When the floor binds, the requested
  -- percentage overstates it. Deriving it from the final price makes the figure
  -- honest for both discount types, and the admin preview mirrors this line.
  v_monthly_discount := v_original_monthly - v_final_monthly;

  -- THE CHANGE. The annual leg is a percentage of the ANNUAL LIST PRICE, not of
  -- the monthly-discounted price. A promotion on the monthly cycle therefore
  -- cannot move a yearly price, in either direction, at any percentage.
  v_original_annual_full := v_original_monthly * 12;
  v_final_annual := round(v_original_annual_full * (1 - v_annual_pct / 100.0))::bigint;

  return jsonb_build_object(
    'plan_code', p_plan_code,
    'original_monthly_ugx', v_original_monthly,
    'monthly_discount_ugx', v_monthly_discount,
    'final_monthly_ugx', v_final_monthly,
    'original_annual_full_ugx', v_original_annual_full,
    'final_annual_ugx', v_final_annual,
    'annual_discount_percent', v_annual_pct,
    'has_monthly_discount', v_monthly_discount > 0,
    'has_annual_discount', v_annual_pct > 0
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The pricing primitive — ONE expression changed
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261010120000` except the resolver call, which now
-- carries `v_cycle`. Everything else — the fail-closed `pricing_unavailable`
-- raise, the canonical-book branch, the campaign lookup, the legacy fallback
-- for non-catalog plans and the final `greatest(..., 0)` — is untouched.
--
-- Signature unchanged, so `create or replace` preserves every existing ACL,
-- including the service_role grant from 20261007100000. No grant is re-issued.
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
  v_discount numeric;
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

  -- THE CHANGE: the caller passes the INDIVIDUAL percent for this cycle, and
  -- the cycle itself, so the global fallback is resolved for the same cycle.
  v_discount := public._admin_discount_effective (p_admin_discount_percent, v_plan, v_cycle);

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

-- ----------------------------------------------------------------------------
-- 6. The money paths — each reads the leg for the cycle it is pricing
-- ----------------------------------------------------------------------------
-- `subscription_payment_expected_amount` and `subscription_payment_quote` are
-- reproduced with exactly ONE expression changed. `subscription_payment_create`
-- needs one line MOVED: it read the discount before it had resolved the
-- requested cycle, so the read now sits after that resolution. Nothing else in
-- any of the three moved — the amount-mismatch rejection, the zero-amount
-- guard, the provider/state machine and the idempotency handling are the same
-- code that is running today. Signatures are unchanged, so ACLs survive.

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
         public._admin_discount_for_row (s, s.billing_interval)
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

  -- THE CHANGE: the individual leg is read for the cycle being QUOTED, which
  -- may not be the subscription's current one (a monthly shop pricing a year).
  select sp.code,
         s.billing_interval,
         public._admin_discount_for_row (s, v_cycle)
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

  -- M3-G allowlist: the client may only name a server-registered provider.
  if not public.subscription_payment_provider_allowed (v_provider) then
    return jsonb_build_object ('ok', false, 'error', 'provider_not_allowed');
  end if;

  -- Resolve the requested (or current) plan / billing cycle. The SERVER picks
  -- the price from this; the client only ever asks for it.
  select sp.code,
         s.billing_interval
    into v_cur_plan, v_cur_cycle
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

  -- THE CHANGE (moved, not rewritten). The discount read used to happen with
  -- the plan lookup above, before the cycle was known — which is precisely how
  -- one percentage came to price both cycles. It now sits here, where the cycle
  -- being charged for is resolved, and asks for that cycle's leg.
  select public._admin_discount_for_row (s, v_cycle)
    into v_discount
  from public.subscriptions s
  where s.id = v_sub_id;

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

  -- Server price for the REQUESTED plan/cycle (shared core with the price
  -- page). M3-G: raises 'pricing_unavailable' for catalog plans when the
  -- canonical book cannot price them — never the legacy 066 fallback.
  v_amount := public.subscription_payment_plan_amount (v_plan, v_cycle, v_discount);

  -- DECISION C: there is no payment to make at zero. A pending row with
  -- amount_ugx = 0 can never settle — the provider rejects a UGX 0 request — so
  -- it would be swept as stale and grant nothing while looking like a real
  -- checkout. A fully discounted account is activated by
  -- `admin_subscription_activate_free`, which writes no ledger row at all.
  if v_amount <= 0 then
    if public._admin_discount_effective (v_discount, v_plan, v_cycle) >= 100 then
      return jsonb_build_object (
        'ok', false,
        'error', 'fully_discounted',
        'expected_amount_ugx', 0
      );
    end if;

    return jsonb_build_object (
      'ok', false,
      'error', 'zero_amount',
      'expected_amount_ugx', v_amount
    );
  end if;

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
       -- M3-E: a payment already handed to the provider (initiated_at) must
       -- NEVER be stale-replaced.
       and nullif (sp.metadata ->> 'initiated_at', '') is null
       -- M3-G: a FRESH initiation claim (≤ 300 s) means a provider call is in
       -- flight right now — equally untouchable. An expired claim (crashed
       -- request) is replaceable again.
       and (
         nullif (sp.metadata ->> 'initiate_claimed_at', '') is null
         or (sp.metadata ->> 'initiate_claimed_at')::timestamptz
              < now () - interval '300 seconds'
       )
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
        'ok', true,
        'idempotent', true,
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

-- ----------------------------------------------------------------------------
-- 7. Admin reads — each leg reported as itself
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
  v_monthly_discount numeric;
  v_annual_discount numeric;
  v_effective_own numeric;
  v_effective_monthly numeric;
  v_effective_annual numeric;
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
         public._admin_discount_for_row (s, 'month'),
         public._admin_discount_for_row (s, 'year'),
         s.organization_id
    into v_plan, v_cycle, v_monthly_discount, v_annual_discount, v_org
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_available');
  end if;

  -- Same resolution every money path performs, one interval at a time: the
  -- individual leg if it is in force, otherwise that plan's global leg.
  v_effective_monthly := public._admin_discount_effective (v_monthly_discount, v_plan, 'month');
  v_effective_annual := public._admin_discount_effective (v_annual_discount, v_plan, 'year');

  -- The figure that decides `fully_discounted`: the leg for the cycle this
  -- subscription is actually on.
  v_effective_own := case
    when lower (coalesce (v_cycle, '')) in ('year', 'yearly', 'annual', 'annually') then v_effective_annual
    else v_effective_monthly
  end;

  -- Both cycles, priced by the authoritative function with their OWN leg
  -- (never re-derived here).
  v_monthly := public.subscription_payment_plan_amount (v_plan, 'month', v_monthly_discount);
  v_annual := public.subscription_payment_plan_amount (v_plan, 'year', v_annual_discount);

  return jsonb_build_object (
    'ok', true,
    'subscription_id', p_subscription_id,
    'organization_id', v_org,
    'plan_code', v_plan,
    'billing_interval', case
      when lower (coalesce (v_cycle, '')) in ('year', 'yearly', 'annual', 'annually', 'year') then 'year'
      else 'month'
    end,
    -- Kept at its historic meaning: the effective percentage for the
    -- subscription's OWN cycle. `fully_discounted` keys on it.
    'effective_discount_percent', v_effective_own,
    'effective_monthly_discount_percent', v_effective_monthly,
    'effective_annual_discount_percent', v_effective_annual,
    'individual_discount_percent', coalesce (v_monthly_discount, 0),
    'individual_annual_discount_percent', coalesce (v_annual_discount, 0),
    'monthly_ugx', v_monthly,
    'annual_ugx', v_annual,
    'expected_amount_ugx', case
      when lower (coalesce (v_cycle, '')) in ('year', 'yearly', 'annual', 'annually') then v_annual
      else v_monthly
    end,
    'fully_discounted', v_effective_own >= 100,
    'quoted_at', now ()
  );
end;
$$;

revoke all on function public.admin_subscription_expected_amount (uuid) from public;
revoke all on function public.admin_subscription_expected_amount (uuid) from anon;
grant execute on function public.admin_subscription_expected_amount (uuid) to authenticated;

create or replace function public.admin_discount_overview ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plans jsonb := '[]'::jsonb;
  v_global jsonb := '[]'::jsonb;
  v_individual jsonb := '[]'::jsonb;
  r record;
begin
  perform public._pricing_require_admin ();

  for r in
    select p.plan_code, p.monthly_price_ugx,
           p.monthly_price_ugx * 12 as annual_full_ugx
    from public.subscription_canonical_prices p
    where p.plan_code in ('starter', 'business', 'waka_plus')
    order by p.monthly_price_ugx
  loop
    v_plans := v_plans || jsonb_build_object (
      'plan_code', r.plan_code,
      'monthly_ugx', r.monthly_price_ugx,
      'annual_full_ugx', r.annual_full_ugx
    );
  end loop;

  for r in
    select d.plan_code, d.discount_percent, d.annual_discount_percent,
           d.active, d.starts_at, d.expires_at,
           d.reason, d.created_at, d.updated_at,
           public.admin_plan_discount_is_active (d) as is_active_now
    from public.admin_plan_discounts d
    order by d.plan_code
  loop
    v_global := v_global || jsonb_build_object (
      'plan_code', r.plan_code,
      -- The MONTHLY leg keeps the historic field name; the annual leg is its
      -- own field. The screen edits both.
      'discount_percent', r.discount_percent,
      'annual_discount_percent', r.annual_discount_percent,
      'active', r.active,
      'starts_at', r.starts_at,
      'expires_at', r.expires_at,
      'reason', r.reason,
      'is_active_now', r.is_active_now,
      -- Same fact, named the way the screen talks about it.
      'applies_now', r.is_active_now,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      -- The campaign-layer prices: what this plan costs with NO admin discount.
      'base_monthly_ugx', public._admin_discount_campaign_amount (r.plan_code, 'monthly'),
      'base_annual_ugx', public._admin_discount_campaign_amount (r.plan_code, 'yearly'),
      -- WHAT A SHOP WITH NO ACCOUNT DISCOUNT PAYS RIGHT NOW, per interval. With
      -- the leg live this is the discounted price; with the rule inactive,
      -- expired or not yet started it is the campaign price — because that is
      -- what checkout would actually charge.
      'effective_monthly_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'effective_annual_ugx', public.subscription_payment_plan_amount (r.plan_code, 'yearly', 0),
      -- What each leg would be worth IF it were in force. Reported, never
      -- presented as the current price.
      'configured_monthly_ugx', greatest (round (
        public._admin_discount_campaign_amount (r.plan_code, 'monthly')
        * (100 - coalesce (r.discount_percent, 0)) / 100.0
      )::bigint, 0),
      'configured_annual_ugx', greatest (round (
        public._admin_discount_campaign_amount (r.plan_code, 'yearly')
        * (100 - coalesce (r.annual_discount_percent, 0)) / 100.0
      )::bigint, 0),
      -- Historical field names, kept so existing readers keep working — now
      -- carrying the live-aware price rather than a formula that ignored the
      -- rule's own window.
      'final_monthly_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'final_monthly_with_discount_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'final_annual_ugx', public.subscription_payment_plan_amount (r.plan_code, 'yearly', 0)
    );
  end loop;

  for r in
    select s.id as subscription_id, s.organization_id, s.shop_id,
           s.admin_discount_percent, s.admin_discount_percent_annual,
           s.billing_interval,
           s.admin_discount_note, s.updated_at,
           s.admin_discount_starts_at, s.admin_discount_expires_at,
           public._admin_discount_for_row (s, 'month') as effective_percent,
           public._admin_discount_for_row (s, 'year') as effective_annual_percent,
           sp.code as plan_code,
           coalesce(sh.name, o.name, '') as account_name,
           (select count(*)::int from public.shops sh2 where sh2.organization_id = s.organization_id) as shop_count
    from public.subscriptions s
    left join public.subscription_plans sp on sp.id = s.plan_id
    left join public.shops sh on sh.id = s.shop_id
    left join public.organizations o on o.id = s.organization_id
    where coalesce (s.admin_discount_percent, 0) > 0
       or coalesce (s.admin_discount_percent_annual, 0) > 0
    order by s.updated_at desc
    limit 200
  loop
    v_individual := v_individual || jsonb_build_object (
      'subscription_id', r.subscription_id,
      'organization_id', r.organization_id,
      'shop_id', r.shop_id,
      'account_name', r.account_name,
      -- The discount lives on the organization's subscription and covers every
      -- shop of that organization.
      'scope', 'organization',
      'shop_count', r.shop_count,
      'plan_code', r.plan_code,
      'discount_percent', r.admin_discount_percent,
      'annual_discount_percent', r.admin_discount_percent_annual,
      -- The account's own cycle, so the screen can point at the leg that decides
      -- whether a free period is available at all.
      'billing_interval', case
        when lower (coalesce (r.billing_interval, '')) in ('year', 'yearly', 'annual', 'annually') then 'year'
        else 'month'
      end,
      'note', r.admin_discount_note,
      'updated_at', r.updated_at,
      'starts_at', r.admin_discount_starts_at,
      'expires_at', r.admin_discount_expires_at,
      -- What the shop is entitled to RIGHT NOW, per leg (0 once lapsed), as
      -- distinct from the configured percentages above.
      'effective_percent', r.effective_percent,
      'effective_annual_percent', r.effective_annual_percent,
      'is_active_now', r.effective_percent > 0 or r.effective_annual_percent > 0,
      'applies_now', r.effective_percent > 0 or r.effective_annual_percent > 0,
      -- Priced on each leg's EFFECTIVE percent, so a lapsed discount shows the
      -- price the shop actually pays (the global rule, or list) rather than a
      -- rate that no longer applies.
      'final_monthly_ugx',
        case when r.plan_code is null then null
             else public.subscription_payment_plan_amount (r.plan_code, 'monthly', r.effective_percent) end,
      'final_annual_ugx',
        case when r.plan_code is null then null
             else public.subscription_payment_plan_amount (r.plan_code, 'yearly', r.effective_annual_percent) end
    );
  end loop;

  return jsonb_build_object ('ok', true, 'plans', v_plans, 'global', v_global, 'individual', v_individual);
end;
$$;

revoke all on function public.admin_discount_overview () from public;
revoke all on function public.admin_discount_overview () from anon;
grant execute on function public.admin_discount_overview () to authenticated;

-- ----------------------------------------------------------------------------
-- 8. The setters — both legs, in one call
-- ----------------------------------------------------------------------------
/**
 * DROPPED FIRST, deliberately, and for the same reason 20261010120000 dropped
 * its three-argument predecessor: `create or replace` with a new parameter
 * would leave an OVERLOAD beside the old signature rather than replacing it,
 * and the old signature would remain a callable way to write a rule that
 * silently leaves the annual leg at whatever it was.
 *
 * THE NEW PARAMETER. `p_annual_discount_percent` defaults to NULL, which means
 * LEAVE THE ANNUAL LEG AS IT IS. That is a compatibility decision, not an
 * accident: a client bundle that predates this migration sends only the monthly
 * percent, and if NULL meant "no annual discount" the first such save would
 * silently wipe the annual leg this migration just back-filled. To clear an
 * annual leg, pass 0 explicitly.
 */
drop function if exists public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text);

create or replace function public.admin_plan_discount_save (
  p_plan_code text,
  p_discount_percent numeric,
  p_active boolean default true,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_reason text default null,
  p_annual_discount_percent numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_percent numeric := coalesce (p_discount_percent, 0);
  v_annual numeric;
  v_prev jsonb;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._pricing_require_admin ();

  if v_plan is null or v_plan not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  -- SERVER-SIDE BOUND, on BOTH legs. The table CHECKs would also catch these,
  -- but returning a discriminated error beats surfacing a raw 23514.
  if v_percent < 0 or v_percent > 99 then
    return jsonb_build_object ('ok', false, 'error', 'discount_out_of_range', 'max_percent', 99);
  end if;

  if p_annual_discount_percent is not null
     and (p_annual_discount_percent < 0 or p_annual_discount_percent > 99) then
    return jsonb_build_object ('ok', false, 'error', 'annual_discount_out_of_range', 'max_percent', 99);
  end if;

  if p_starts_at is not null and p_expires_at is not null and p_expires_at <= p_starts_at then
    return jsonb_build_object ('ok', false, 'error', 'invalid_window');
  end if;

  -- A plan the canonical book does not price cannot carry a discount.
  if not exists (select 1 from public.subscription_canonical_prices where plan_code = v_plan) then
    return jsonb_build_object ('ok', false, 'error', 'plan_not_priced');
  end if;

  select jsonb_build_object (
    'discount_percent', discount_percent,
    'annual_discount_percent', annual_discount_percent,
    'active', active,
    'starts_at', starts_at,
    'expires_at', expires_at,
    'reason', reason
  )
  into v_prev
  from public.admin_plan_discounts
  where plan_code = v_plan;

  -- NULL means "leave the annual leg alone". On an INSERT there is nothing to
  -- leave alone, so it starts at 0 — no annual discount until one is asked for.
  if p_annual_discount_percent is null then
    select d.annual_discount_percent
      into v_annual
    from public.admin_plan_discounts d
    where d.plan_code = v_plan;

    v_annual := coalesce (v_annual, 0);
  else
    v_annual := p_annual_discount_percent;
  end if;

  insert into public.admin_plan_discounts (
    plan_code, discount_percent, annual_discount_percent, active, starts_at, expires_at, reason,
    created_by, updated_by, updated_at
  )
  values (
    v_plan, v_percent, v_annual, coalesce (p_active, true), p_starts_at, p_expires_at, v_reason,
    auth.uid (), auth.uid (), now ()
  )
  on conflict (plan_code) do update
  set
    discount_percent = excluded.discount_percent,
    annual_discount_percent = excluded.annual_discount_percent,
    active = excluded.active,
    starts_at = excluded.starts_at,
    expires_at = excluded.expires_at,
    reason = excluded.reason,
    updated_by = auth.uid (),
    updated_at = now ();

  perform public._pricing_audit (
    'admin_plan_discount_saved',
    jsonb_build_object (
      'plan_code', v_plan,
      'previous', coalesce (v_prev, 'null'::jsonb),
      'new', jsonb_build_object (
        'discount_percent', v_percent,
        'annual_discount_percent', v_annual,
        'active', coalesce (p_active, true),
        'starts_at', p_starts_at,
        'expires_at', p_expires_at,
        'reason', v_reason
      )
    )
  );

  return jsonb_build_object (
    'ok', true,
    'plan_code', v_plan,
    'discount_percent', v_percent,
    'annual_discount_percent', v_annual
  );
end;
$$;

revoke all on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text, numeric) from public;
revoke all on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text, numeric) from anon;
grant execute on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text, numeric) to authenticated;

drop function if exists public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz);

create or replace function public.admin_subscription_discount_save (
  p_shop_id uuid,
  p_discount_percent numeric,
  p_reason text default null,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_annual_discount_percent numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_sub_id uuid;
  v_plan_code text;
  v_percent numeric := coalesce (p_discount_percent, 0);
  v_annual numeric;
  v_prev numeric;
  v_prev_annual numeric;
  v_cleared boolean;
  v_shop_count int := 0;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._pricing_require_admin ();

  if v_percent < 0 or v_percent > 99 then
    return jsonb_build_object ('ok', false, 'error', 'discount_out_of_range', 'max_percent', 99);
  end if;

  if p_annual_discount_percent is not null
     and (p_annual_discount_percent < 0 or p_annual_discount_percent > 99) then
    return jsonb_build_object ('ok', false, 'error', 'annual_discount_out_of_range', 'max_percent', 99);
  end if;

  if p_starts_at is not null and p_expires_at is not null and p_expires_at <= p_starts_at then
    return jsonb_build_object ('ok', false, 'error', 'invalid_window');
  end if;

  -- A window that has already closed would write a discount that is inert the
  -- instant it is saved. That is almost certainly a mistake, so it is refused
  -- rather than silently stored.
  if p_expires_at is not null and p_expires_at <= now () then
    return jsonb_build_object ('ok', false, 'error', 'window_already_expired');
  end if;

  select s.organization_id into v_org from public.shops s where s.id = p_shop_id limit 1;
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- The discount is stored on the organization's subscription, so it covers
  -- every shop of that organization. Counted here so the screen can say so.
  select count(*)::int into v_shop_count
  from public.shops sh
  where sh.organization_id = v_org;

  -- The same resolver the money path uses: the discount lands on the
  -- subscription `subscription_payment_quote`/`_create` will price.
  v_sub_id := public._subscription_latest_for_org (v_org);

  if v_sub_id is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select sp.code
    into v_plan_code
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = v_sub_id;

  select s.admin_discount_percent, s.admin_discount_percent_annual
    into v_prev, v_prev_annual
  from public.subscriptions s where s.id = v_sub_id;

  -- NULL means "leave the annual leg alone" — see the note on
  -- admin_plan_discount_save. An old client bundle that sends only the monthly
  -- percent must not wipe an annual rule it does not know about.
  v_annual := coalesce (p_annual_discount_percent, v_prev_annual, 0);

  -- The rule as a whole is cleared only when BOTH legs are zero, so clearing a
  -- monthly discount no longer discards an annual one, and the window and note
  -- belong to the rule rather than to one leg.
  v_cleared := v_percent = 0 and v_annual = 0;

  update public.subscriptions s
  set
    admin_discount_percent = v_percent,
    admin_discount_percent_annual = v_annual,
    admin_discount_note = case when v_cleared then null else v_reason end,
    -- A cleared rule clears its window with it, so "both zero" can never leave
    -- a window behind that a later edit would silently inherit.
    admin_discount_starts_at = case when v_cleared then null else p_starts_at end,
    admin_discount_expires_at = case when v_cleared then null else p_expires_at end,
    updated_at = now ()
  where s.id = v_sub_id;

  -- Same two audit records `admin_shop_set_subscription_plan` writes, so a
  -- discount is as traceable as a plan change: the subscription's own history
  -- and the shop-scoped audit log.
  perform public._internal_subscription_history_write (
    v_sub_id,
    'admin_set_subscription_discount',
    format ('monthly %s%% -> %s%%, annual %s%% -> %s%%',
            coalesce (v_prev, 0), v_percent, coalesce (v_prev_annual, 0), v_annual),
    jsonb_build_object (
      'from_percent', v_prev,
      'to_percent', v_percent,
      'from_annual_percent', v_prev_annual,
      'to_annual_percent', v_annual,
      'shop_id', p_shop_id,
      'plan_code', v_plan_code,
      'reason', v_reason
    )
  );

  -- The platform-wide trail too, so an individual discount is as traceable as a
  -- global one (`_pricing_audit` is what the global RPCs and the campaign
  -- discount RPC already write).
  perform public._pricing_audit (
    'admin_subscription_discount_saved',
    jsonb_build_object (
      'subscription_id', v_sub_id,
      'shop_id', p_shop_id,
      'plan_code', v_plan_code,
      'from_percent', v_prev,
      'to_percent', v_percent,
      'from_annual_percent', v_prev_annual,
      'to_annual_percent', v_annual,
      'reason', v_reason
    )
  );

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_discount_save',
    case when v_cleared then 'Admin cleared a subscription discount' else 'Admin set a subscription discount' end,
    jsonb_build_object (
      'subscription_id', v_sub_id,
      'from_percent', v_prev,
      'to_percent', v_percent,
      'from_annual_percent', v_prev_annual,
      'to_annual_percent', v_annual,
      'plan_code', v_plan_code,
      'reason', v_reason
    )
  );

  /**
   * WHAT THIS DISCOUNT ACTUALLY COSTS, computed by the same function checkout
   * uses — never by the caller and never by the client. Returned so the admin UI
   * can show the real final price without re-deriving the pricing rules.
   *
   * Each cycle is priced with the percentage just written for THAT cycle, so the
   * two figures can no longer agree by construction — which is the whole point.
   *
   * `applies_now` is separate from the prices on purpose: the figures are what
   * this RULE is worth, which for a future-dated discount is NOT what the shop
   * pays today (today it pays the global rule, or list). The UI must not present
   * the two as the same thing.
   */
  return jsonb_build_object (
    'ok', true,
    'subscription_id', v_sub_id,
    'organization_id', v_org,
    -- Explicit: this is an account-wide discount, not a per-shop one.
    'scope', 'organization',
    'shop_count', v_shop_count,
    'plan_code', v_plan_code,
    'discount_percent', v_percent,
    'annual_discount_percent', v_annual,
    'starts_at', case when v_cleared then null else p_starts_at end,
    'expires_at', case when v_cleared then null else p_expires_at end,
    'applies_now',
      not v_cleared
      and (p_starts_at is null or now () >= p_starts_at)
      and (p_expires_at is null or now () < p_expires_at),
    'monthly_ugx', public.subscription_payment_plan_amount (v_plan_code, 'monthly', v_percent),
    'annual_ugx', public.subscription_payment_plan_amount (v_plan_code, 'yearly', v_annual)
  );
end;
$$;

revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz, numeric) from public;
revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz, numeric) from anon;
grant execute on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. The preview — a hypothetical, answered per leg
-- ----------------------------------------------------------------------------
-- `p_annual_discount_percent` defaults to NULL, and here NULL means NO ANNUAL
-- DISCOUNT (0), not "same as the monthly percent". A preview is a calculator:
-- the honest model is that each leg is whatever you hand it, and quietly
-- mirroring one leg onto the other is the coupling this migration removes. The
-- response echoes `annual_discount_percent` so a caller can see what was
-- assumed.
drop function if exists public.admin_discount_preview (text, numeric, boolean);

create or replace function public.admin_discount_preview (
  p_plan_code text,
  p_discount_percent numeric,
  p_individual boolean default false,
  p_annual_discount_percent numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_percent numeric := coalesce (p_discount_percent, 0);
  v_annual_pct numeric := coalesce (p_annual_discount_percent, 0);
  v_base_monthly bigint;
  v_base_annual bigint;
  v_monthly bigint;
  v_annual bigint;
begin
  perform public._pricing_require_admin ();

  if v_plan is null or v_plan not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  if v_percent < 0 or v_percent > 99 then
    return jsonb_build_object ('ok', false, 'error', 'discount_out_of_range', 'max_percent', 99);
  end if;

  if v_annual_pct < 0 or v_annual_pct > 99 then
    return jsonb_build_object ('ok', false, 'error', 'annual_discount_out_of_range', 'max_percent', 99);
  end if;

  -- The campaign layer, with NO admin discount in it. Asking
  -- subscription_payment_plan_amount for 0 would return the GLOBAL-discounted
  -- price and then be discounted a second time below.
  v_base_monthly := public._admin_discount_campaign_amount (v_plan, 'monthly');
  v_base_annual := public._admin_discount_campaign_amount (v_plan, 'yearly');

  -- Each leg against its own base. The two answers are independent by
  -- construction; there is no branch that can make one depend on the other.
  v_monthly := greatest (round (v_base_monthly * (100 - v_percent) / 100.0)::bigint, 0);
  v_annual := greatest (round (v_base_annual * (100 - v_annual_pct) / 100.0)::bigint, 0);

  return jsonb_build_object (
    'ok', true,
    'plan_code', v_plan,
    'individual', coalesce (p_individual, false),
    'discount_percent', v_percent,
    'annual_discount_percent', v_annual_pct,
    'base_monthly_ugx', v_base_monthly,
    'base_annual_ugx', v_base_annual,
    'monthly_ugx', v_monthly,
    'annual_ugx', v_annual,
    'monthly_discount_ugx', v_base_monthly - v_monthly,
    'annual_discount_ugx', v_base_annual - v_annual
  );
end;
$$;

revoke all on function public.admin_discount_preview (text, numeric, boolean, numeric) from public;
revoke all on function public.admin_discount_preview (text, numeric, boolean, numeric) from anon;
grant execute on function public.admin_discount_preview (text, numeric, boolean, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. The public price book — both global legs published
-- ----------------------------------------------------------------------------
-- Signature unchanged, so the anon and authenticated grants survive. The two
-- authoritative prices were ALREADY taken from `subscription_payment_plan_amount`
-- per cycle; what changes is that each now resolves its own global leg, and the
-- book says so. `global_discount_percent` keeps the monthly leg it has always
-- effectively carried, and the annual leg is published beside it.
create or replace function public.public_subscription_pricing ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_campaign_name text := null;
  v_plans jsonb := '[]'::jsonb;
  v_plan text;
  v_row jsonb;
  v_discount record;
  v_campaign_monthly bigint;
  v_campaign_annual bigint;
  v_global_monthly numeric;
  v_global_annual numeric;
  v_global_active boolean := false;
begin
  v_campaign_id := public._pricing_active_campaign_id ();

  if v_campaign_id is not null then
    select name into v_campaign_name from public.pricing_campaigns where id = v_campaign_id;
  end if;

  foreach v_plan in array array['starter', 'business', 'waka_plus']
  loop
    if v_campaign_id is null then
      v_row := public._pricing_compute_plan_row(v_plan, 'none', 0, null);
    else
      select * into v_discount
      from public.pricing_campaign_plan_discounts d
      where d.campaign_id = v_campaign_id and d.plan_code = v_plan;

      if found then
        v_row := public._pricing_compute_plan_row(
          v_plan,
          v_discount.monthly_discount_type,
          v_discount.monthly_discount_value,
          v_discount.annual_discount_percent
        );
      else
        v_row := public._pricing_compute_plan_row(v_plan, 'none', 0, null);
      end if;
    end if;

    if v_row is not null then
      v_campaign_monthly := (v_row ->> 'final_monthly_ugx')::bigint;
      v_campaign_annual := (v_row ->> 'final_annual_ugx')::bigint;

      -- The GLOBAL rule only: a 0 individual percent means "this account has no
      -- discount of its own", so the resolver returns the plan's global rule for
      -- that cycle. An actual account discount is never consulted here.
      v_global_monthly := public._admin_discount_effective (0, v_plan, 'month');
      v_global_annual := public._admin_discount_effective (0, v_plan, 'year');
      v_global_active := v_global_active or v_global_monthly > 0 or v_global_annual > 0;

      v_row := v_row || jsonb_build_object(
        -- The campaign layer, published explicitly so the difference between a
        -- promotion and an administrative discount stays visible.
        'campaign_monthly_ugx', v_campaign_monthly,
        'campaign_annual_ugx', v_campaign_annual,
        'global_discount_percent', v_global_monthly,
        'global_annual_discount_percent', v_global_annual,
        -- THE AUTHORITATIVE PRICES. Taken from the same function every money path
        -- uses, so the page cannot show a number checkout would not charge — and
        -- each cycle now carries its own leg.
        'final_monthly_ugx', public.subscription_payment_plan_amount (v_plan, 'month', 0),
        'final_annual_ugx', public.subscription_payment_plan_amount (v_plan, 'year', 0)
      );

      v_plans := v_plans || jsonb_build_array(v_row);
    end if;
  end loop;

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'campaign_name', v_campaign_name,
    'campaign_active', v_campaign_id is not null,
    'global_discount_active', v_global_active,
    'plans', v_plans,
    'as_of', now ()
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. The two remaining money paths — the leg for the subscription's own cycle
-- ----------------------------------------------------------------------------
-- `admin_subscription_mark_payment` and `admin_subscription_activate_free` each
-- read the subscription's own `billing_interval`, so both change in exactly one
-- place: the discount is now asked for that interval. Everything else — the row
-- lock, the amount guard, the negotiated-offer consumption, the cross-channel
-- guard, the period advance, the idempotency check and every audit trail — is
-- byte-identical to 20261011130000 / 20261011140000.

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
         public._admin_discount_for_row (s, s.billing_interval)
    into v_plan_code, v_interval, v_shop_id, v_discount
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = p_subscription_id;

  if v_plan_code is null then
    raise exception 'Subscription not found';
  end if;

  -- What the money path charges for this subscription, right now, with the
  -- campaign price, this cycle's account leg and this cycle's global rule all
  -- resolved.
  v_expected := public.subscription_payment_plan_amount (v_plan_code, v_interval, v_discount);
  v_effective := public._admin_discount_effective (v_discount, v_plan_code, v_interval);

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
    -- every later call. The status predicate is the atomic gate: if another
    -- session settled this offer first, the update matches nothing and the
    -- payment is refused rather than recording a second one against a
    -- commitment that is already spent. `fulfilled`/`fulfilled_at` are the
    -- schema's existing terminal state for a settled offer, which is also what
    -- 039's fulfil writes — so that flow's own update becomes a harmless no-op
    -- instead of a conflict.
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
         public._admin_discount_for_row (s, s.billing_interval)
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

  -- ELIGIBILITY, resolved exactly as checkout resolves it, for THIS
  -- subscription's own cycle: the account leg if it is in force, otherwise the
  -- plan's global leg for the same cycle, otherwise none. A 100% monthly rule
  -- therefore does not entitle a yearly period, and the reverse holds too.
  v_effective := public._admin_discount_effective (v_individual, v_plan, v_interval);

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

notify pgrst, 'reload schema';
