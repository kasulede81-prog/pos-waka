-- ============================================================================
-- ADMIN SUBSCRIPTION DISCOUNTS — global (per plan) and individual (per account)
-- ============================================================================
-- WHAT ALREADY EXISTED, AND WHY THIS IS ADDITIVE.
--
-- Two discount mechanisms already reach a subscription price, and they are
-- deliberately different (pinned by src/lib/subscriptionAdminDiscount.sql.integration.test.ts):
--
--   1. `subscriptions.admin_discount_percent` (numeric 0–100) — a per-subscription
--      admin discount, applied by `subscription_payment_plan_amount` AFTER any
--      campaign price. It can reach 100% (price 0). **It has never had a setter:**
--      the column is read in five places and written by nothing, so the capability
--      existed end-to-end with no way to reach it.
--
--   2. pricing-campaign plan discounts (113) — campaign-wide, and deliberately
--      bounded: percentages clamp at 90% and every plan floors at UGX 5,000
--      (`_pricing_min_final_monthly_ugx`). It can NOT reach 0.
--
-- This migration does NOT touch (2). The 90% clamp and the UGX 5,000 floor are
-- campaign rules, they are pinned by tests, and `_pricing_compute_plan_row` is
-- left byte-identical. Nothing here changes a campaign price.
--
-- It adds the missing piece of (1) — a setter — plus a GLOBAL counterpart that
-- does not exist today.
--
-- ----------------------------------------------------------------------------
-- PRECEDENCE (deterministic, and it never stacks)
-- ----------------------------------------------------------------------------
--   base        canonical price for the cycle, with the campaign discount
--               applied first — exactly as today, unchanged
--   then        effective admin discount =
--                 individual (`subscriptions.admin_discount_percent`) if > 0
--                 ELSE the active global rule for that plan
--                 ELSE 0
--   then        amount = round(base * (100 - effective) / 100), floored at 0
--
-- An individual discount REPLACES a global one; it is never added to it, and the
-- two are never applied one after the other. With no global rule defined,
-- `_admin_discount_effective` returns exactly the individual percent it was
-- given, so every existing price is bit-for-bit what it was before this file.
--
-- INDIVIDUAL = 0 MEANS "NO INDIVIDUAL RULE" — so it falls back to the global. A
-- shop cannot currently opt OUT of a global discount; that needs an explicit
-- override flag and is deliberately NOT invented here.
--
-- ----------------------------------------------------------------------------
-- WHY THE RESOLUTION LIVES INSIDE subscription_payment_plan_amount
-- ----------------------------------------------------------------------------
-- That function is the single choke point every money path already calls —
-- `subscription_payment_quote`, `subscription_payment_create`,
-- `subscription_payment_expected_amount` and both concurrency guards all route
-- through it with `coalesce(s.admin_discount_percent, 0)`. It is also the only
-- one of them that receives the PLAN CODE, which is what a global rule is keyed
-- by. Resolving here therefore reaches quote, create and server-side validation
-- in ONE change, and cannot drift between them.
--
-- BOTH KINDS OF DISCOUNT CARRY A WINDOW. Making the individual one window-aware
-- needed a second change, and it is the smallest one that works: the three money
-- paths that read the discount — subscription_payment_create,
-- subscription_payment_quote and subscription_payment_expected_amount — read the
-- whole subscription ROW they already had, through `_admin_discount_for_row`,
-- instead of a bare percentage. Each of those three is reproduced below with
-- exactly ONE line changed and is otherwise byte-identical to its current
-- definition; the transformation was applied mechanically and diffed line by
-- line, not retyped.
--
-- The alternative — threading a subscription id down as a new parameter — would
-- have meant rewriting the same three functions (and any future caller) to pass
-- an argument that the row already carries. Reading the row is strictly less
-- surface area, and it is why an expired discount cannot be applied by ANY
-- money path: they all resolve it through the same predicate.

-- ----------------------------------------------------------------------------
-- Global plan discounts
-- ----------------------------------------------------------------------------
create table if not exists public.admin_plan_discounts (
  -- One row per plan. The primary key is what makes "change one plan without
  -- touching another" structural rather than a matter of careful coding.
  plan_code text primary key,
  discount_percent numeric(5, 2) not null default 0
    check (discount_percent >= 0 and discount_percent <= 99),
  active boolean not null default true,
  starts_at timestamptz,
  expires_at timestamptz,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now (),
  constraint admin_plan_discounts_window
    check (expires_at is null or starts_at is null or expires_at > starts_at)
);

comment on table public.admin_plan_discounts is
  'WAKA-internal global per-plan subscription discount. Read only through '
  'SECURITY DEFINER RPCs; the table has RLS enabled and NO policies, so no '
  'client role can read or write it directly.';

comment on column public.admin_plan_discounts.discount_percent is
  'Percent off the canonical plan price, 0–99. 0 or active=false means the rule '
  'is inert. Applied by subscription_payment_plan_amount AFTER any campaign '
  'discount, and only when the subscription carries no individual discount.';

alter table public.admin_plan_discounts enable row level security;

-- No policies on purpose: the ONLY way in is a SECURITY DEFINER RPC that has
-- already checked the caller. Revoking the table privileges too means a future
-- policy cannot accidentally expose it.
revoke all on table public.admin_plan_discounts from public;
revoke all on table public.admin_plan_discounts from anon;
revoke all on table public.admin_plan_discounts from authenticated;

/**
 * The same active-state rule pricing campaigns use (113): enabled, a non-zero
 * discount, and now inside the optional window. Kept as one predicate so the
 * resolver, the overview and any future caller cannot disagree about which rules
 * are live.
 */
create or replace function public.admin_plan_discount_is_active (d public.admin_plan_discounts)
returns boolean
language sql
stable
as $$
  select d.active
    and d.discount_percent > 0
    and (d.starts_at is null or now () >= d.starts_at)
    and (d.expires_at is null or now () < d.expires_at)
$$;

comment on function public.admin_plan_discount_is_active (public.admin_plan_discounts) is
  'Enabled, non-zero and inside its window — the single definition of "this '
  'global discount is live right now".';

-- ----------------------------------------------------------------------------
-- The individual discount's window
-- ----------------------------------------------------------------------------
-- `admin_discount_percent` already existed; what it could not express was WHEN it
-- applies. These two nullable timestamps are that, and they are the reason the
-- discount below is resolved from the whole subscription ROW rather than from a
-- bare percentage.
--
-- Nullable with no default, so this is a catalogue-only change on PostgreSQL 11+
-- — no table rewrite, and every existing row is "no window" (active immediately,
-- never expires), which is exactly what a discount set before this migration
-- meant.
alter table public.subscriptions
  add column if not exists admin_discount_starts_at timestamptz;
alter table public.subscriptions
  add column if not exists admin_discount_expires_at timestamptz;

comment on column public.subscriptions.admin_discount_starts_at is
  'Optional: the individual admin discount does not apply before this instant.';
comment on column public.subscriptions.admin_discount_expires_at is
  'Optional: the individual admin discount does not apply from this instant. '
  'Enforced server-side by _admin_discount_for_row, on every money path.';

-- ----------------------------------------------------------------------------
-- Resolution — the one place precedence is decided
-- ----------------------------------------------------------------------------
/**
 * The individual discount this subscription is entitled to RIGHT NOW.
 *
 * Takes the whole row, not the percentage, because a window cannot be evaluated
 * from a number. Every money path already selects the subscription row to read
 * `admin_discount_percent`, so passing the row costs nothing and keeps the window
 * check on the server: quotes, payment creation and amount validation all resolve
 * it through here, and none of them can be talked out of it by a client.
 *
 * An expired or not-yet-started discount returns 0, which the caller reads as
 * "no individual discount" — so the GLOBAL rule then applies. That is deliberate:
 * a lapsed individual discount should fall back to whatever the plan's global
 * rule says, not to a stale personal rate.
 *
 * Not SECURITY INVOKER-sensitive: callers are SECURITY DEFINER payment functions,
 * and `now()` is evaluated per statement, so a long-running transaction cannot
 * apply a discount that expired while it was open.
 */
create or replace function public._admin_discount_for_row (s public.subscriptions)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce (s.admin_discount_percent, 0) <= 0 then 0
    when s.admin_discount_starts_at is not null and now () < s.admin_discount_starts_at then 0
    when s.admin_discount_expires_at is not null and now () >= s.admin_discount_expires_at then 0
    else least (greatest (s.admin_discount_percent, 0), 100)
  end
$$;

-- Internal only. It is called from SECURITY DEFINER payment functions, whose
-- owner keeps EXECUTE; no client role needs it, so none is given it.
revoke all on function public._admin_discount_for_row (public.subscriptions) from public;
revoke all on function public._admin_discount_for_row (public.subscriptions) from anon;
revoke all on function public._admin_discount_for_row (public.subscriptions) from authenticated;
create or replace function public._admin_discount_effective (
  p_individual_percent numeric,
  p_plan_code text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_global numeric;
begin
  -- An individual discount wins outright. It is NOT added to the global rule and
  -- the global rule is not applied underneath it: a shop on 50% does not become
  -- 60% because a 10% global rule is also live.
  --
  -- `p_individual_percent` is ALREADY window-resolved: every caller reads it
  -- through `_admin_discount_for_row`, which returns 0 for an expired or
  -- not-yet-started discount. A 0 here therefore means "no individual discount is
  -- in force", and the global rule below is the correct fallback.
  --
  -- Clamped 0–100, not 0–99, to match what this parameter has always accepted:
  -- the existing contract test pins 100% pricing at zero, and no setter in this
  -- migration can write above 99. Tightening the primitive would rewrite a
  -- tested guarantee to enforce a bound the write path already enforces.
  if coalesce (p_individual_percent, 0) > 0 then
    return least (greatest (p_individual_percent, 0), 100);
  end if;

  if v_plan is null or to_regclass ('public.admin_plan_discounts') is null then
    return 0;
  end if;

  select d.discount_percent
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

revoke all on function public._admin_discount_effective (numeric, text) from public;
revoke all on function public._admin_discount_effective (numeric, text) from anon;
grant execute on function public._admin_discount_effective (numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- The choke point — reproduced from 20261007210000 with ONE line changed
-- ----------------------------------------------------------------------------
-- Everything below is byte-identical to `20261007210000_subscription_pricing_fail_closed.sql`
-- except `v_discount` and its assignment. The fail-closed `pricing_unavailable`
-- raise, the canonical-book branch, the campaign lookup, the legacy fallback for
-- non-catalog plans and the final `greatest(..., 0)` are all untouched.
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

  -- THE ONE CHANGE: the caller passes the INDIVIDUAL discount it read from the
  -- subscription; precedence against the global rule is decided here, once.
  v_discount := public._admin_discount_effective (p_admin_discount_percent, v_plan);

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
-- The three money paths — reproduced with ONE expression changed each
-- ----------------------------------------------------------------------------
-- `subscription_payment_create`, `subscription_payment_quote` and
-- `subscription_payment_expected_amount` each read the subscription's discount as
-- `coalesce (s.admin_discount_percent, 0)` and hand it to the pricing primitive.
-- That bare number is what made a window impossible: by the time the price is
-- computed the row is gone.
--
-- Each body below is otherwise BYTE-IDENTICAL to its current definition
-- (20261007220000 / 20261007120000 / 20261007100000 — the latest of each; the
-- earlier `subscription_payment_create` bodies in 20261007100000 and
-- 20261007180000 are superseded). The transformation was applied mechanically
-- and verified line-by-line: exactly one line differs in each function, the
-- discount read. Signatures are unchanged, so `create or replace` preserves
-- every existing ACL — which is why no grants are re-issued here.
--
-- Nothing else in these functions moved: the amount-mismatch rejection, the
-- zero-amount guard, the provider/state machine and the idempotency handling are
-- the same code that is running today.

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
         public._admin_discount_for_row (s)
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

  select sp.code,
         s.billing_interval,
         public._admin_discount_for_row (s)
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
         s.billing_interval,
         public._admin_discount_for_row (s)
    into v_cur_plan, v_cur_cycle, v_discount
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
-- Global discount administration
-- ----------------------------------------------------------------------------
create or replace function public.admin_plan_discount_save (
  p_plan_code text,
  p_discount_percent numeric,
  p_active boolean default true,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_percent numeric := coalesce (p_discount_percent, 0);
  v_prev jsonb;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._pricing_require_admin ();

  if v_plan is null or v_plan not in ('starter', 'business', 'waka_plus') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  -- SERVER-SIDE BOUND. The table CHECK would also catch this, but returning a
  -- discriminated error beats surfacing a raw 23514 to the admin UI.
  if v_percent < 0 or v_percent > 99 then
    return jsonb_build_object ('ok', false, 'error', 'discount_out_of_range', 'max_percent', 99);
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
    'active', active,
    'starts_at', starts_at,
    'expires_at', expires_at,
    'reason', reason
  )
  into v_prev
  from public.admin_plan_discounts
  where plan_code = v_plan;

  insert into public.admin_plan_discounts (
    plan_code, discount_percent, active, starts_at, expires_at, reason,
    created_by, updated_by, updated_at
  )
  values (
    v_plan, v_percent, coalesce (p_active, true), p_starts_at, p_expires_at, v_reason,
    auth.uid (), auth.uid (), now ()
  )
  on conflict (plan_code) do update
  set
    discount_percent = excluded.discount_percent,
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
        'active', coalesce (p_active, true),
        'starts_at', p_starts_at,
        'expires_at', p_expires_at,
        'reason', v_reason
      )
    )
  );

  return jsonb_build_object ('ok', true, 'plan_code', v_plan, 'discount_percent', v_percent);
end;
$$;

create or replace function public.admin_plan_discount_delete (p_plan_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower (nullif (trim (coalesce (p_plan_code, '')), ''));
  v_prev jsonb;
begin
  perform public._pricing_require_admin ();

  if v_plan is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_plan');
  end if;

  select to_jsonb (d) into v_prev from public.admin_plan_discounts d where d.plan_code = v_plan;
  if v_prev is null then
    return jsonb_build_object ('ok', false, 'error', 'discount_not_found');
  end if;

  delete from public.admin_plan_discounts where plan_code = v_plan;

  perform public._pricing_audit (
    'admin_plan_discount_deleted',
    jsonb_build_object ('plan_code', v_plan, 'previous', v_prev)
  );

  return jsonb_build_object ('ok', true, 'plan_code', v_plan);
end;
$$;

-- ----------------------------------------------------------------------------
-- Individual subscription discount administration
-- ----------------------------------------------------------------------------
-- Targets the SAME row `admin_shop_set_subscription_plan` targets — the shop's
-- organization's newest subscription — so a discount set from a shop console
-- lands on the row that shop's checkout actually prices from.
--
-- `p_discount_percent = 0` clears the individual rule (the column default), which
-- also removes the note. There is no separate "deactivate": a zero percent IS
-- inactive, which is what `_admin_discount_effective` keys on.
/**
 * DROPPED FIRST, deliberately. Adding parameters with `create or replace` would
 * create an OVERLOAD beside the three-argument version rather than replacing it,
 * leaving a callable function that writes a discount with no window at all.
 */
drop function if exists public.admin_subscription_discount_save (uuid, numeric, text);

create or replace function public.admin_subscription_discount_save (
  p_shop_id uuid,
  p_discount_percent numeric,
  p_reason text default null,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null
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
  v_prev numeric;
  v_reason text := nullif (trim (coalesce (p_reason, '')), '');
begin
  perform public._pricing_require_admin ();

  if v_percent < 0 or v_percent > 99 then
    return jsonb_build_object ('ok', false, 'error', 'discount_out_of_range', 'max_percent', 99);
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

  select s.id, sp.code
    into v_sub_id, v_plan_code
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.organization_id = v_org
  order by s.created_at desc
  limit 1;

  if v_sub_id is null then
    return jsonb_build_object ('ok', false, 'error', 'subscription_not_found');
  end if;

  select s.admin_discount_percent into v_prev
  from public.subscriptions s where s.id = v_sub_id;

  update public.subscriptions s
  set
    admin_discount_percent = v_percent,
    admin_discount_note = case when v_percent > 0 then v_reason else null end,
    -- A cleared discount clears its window with it, so "0" can never leave a
    -- window behind that a later edit would silently inherit.
    admin_discount_starts_at = case when v_percent > 0 then p_starts_at else null end,
    admin_discount_expires_at = case when v_percent > 0 then p_expires_at else null end,
    updated_at = now ()
  where s.id = v_sub_id;

  -- Same two audit records `admin_shop_set_subscription_plan` writes, so a
  -- discount is as traceable as a plan change: the subscription's own history
  -- and the shop-scoped audit log.
  perform public._internal_subscription_history_write (
    v_sub_id,
    'admin_set_subscription_discount',
    format ('%s%% -> %s%%', coalesce (v_prev, 0), v_percent),
    jsonb_build_object (
      'from_percent', v_prev,
      'to_percent', v_percent,
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
      'reason', v_reason
    )
  );

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_subscription_discount_save',
    case when v_percent > 0 then 'Admin set a subscription discount' else 'Admin cleared a subscription discount' end,
    jsonb_build_object (
      'subscription_id', v_sub_id,
      'from_percent', v_prev,
      'to_percent', v_percent,
      'plan_code', v_plan_code,
      'reason', v_reason
    )
  );

  /**
   * WHAT THIS DISCOUNT ACTUALLY COSTS, computed by the same function checkout
   * uses — never by the caller and never by the client. Returned so the admin UI
   * can show the real final price without re-deriving the pricing rules.
   *
   * `applies_now` is separate from the prices on purpose: the figures are what
   * this RULE is worth, which for a future-dated discount is NOT what the shop
   * pays today (today it pays the global rule, or list). The UI must not present
   * the two as the same thing.
   */
  return jsonb_build_object (
    'ok', true,
    'subscription_id', v_sub_id,
    'plan_code', v_plan_code,
    'discount_percent', v_percent,
    'starts_at', case when v_percent > 0 then p_starts_at else null end,
    'expires_at', case when v_percent > 0 then p_expires_at else null end,
    'applies_now',
      v_percent > 0
      and (p_starts_at is null or now () >= p_starts_at)
      and (p_expires_at is null or now () < p_expires_at),
    'monthly_ugx', public.subscription_payment_plan_amount (v_plan_code, 'monthly', v_percent),
    'annual_ugx', public.subscription_payment_plan_amount (v_plan_code, 'yearly', v_percent)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Reads for the admin UI
-- ----------------------------------------------------------------------------
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
    select d.plan_code, d.discount_percent, d.active, d.starts_at, d.expires_at,
           d.reason, d.created_at, d.updated_at,
           public.admin_plan_discount_is_active (d) as is_active_now,
           public._pricing_compute_plan_row (d.plan_code, 'none', 0, null) ->> 'original_monthly_ugx' as base_monthly
    from public.admin_plan_discounts d
    order by d.plan_code
  loop
    v_global := v_global || jsonb_build_object (
      'plan_code', r.plan_code,
      'discount_percent', r.discount_percent,
      'active', r.active,
      'starts_at', r.starts_at,
      'expires_at', r.expires_at,
      'reason', r.reason,
      'is_active_now', r.is_active_now,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'base_monthly_ugx', (r.base_monthly)::bigint,
      'final_monthly_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'final_monthly_with_discount_ugx',
        public.subscription_payment_plan_amount (r.plan_code, 'monthly', r.discount_percent)
    );
  end loop;

  for r in
    select s.id as subscription_id, s.organization_id, s.shop_id,
           s.admin_discount_percent, s.admin_discount_note, s.updated_at,
           s.admin_discount_starts_at, s.admin_discount_expires_at,
           public._admin_discount_for_row (s) as effective_percent,
           sp.code as plan_code,
           coalesce(sh.name, o.name, '') as account_name
    from public.subscriptions s
    left join public.subscription_plans sp on sp.id = s.plan_id
    left join public.shops sh on sh.id = s.shop_id
    left join public.organizations o on o.id = s.organization_id
    where coalesce (s.admin_discount_percent, 0) > 0
    order by s.updated_at desc
    limit 200
  loop
    v_individual := v_individual || jsonb_build_object (
      'subscription_id', r.subscription_id,
      'organization_id', r.organization_id,
      'shop_id', r.shop_id,
      'account_name', r.account_name,
      'plan_code', r.plan_code,
      'discount_percent', r.admin_discount_percent,
      'note', r.admin_discount_note,
      'updated_at', r.updated_at,
      'starts_at', r.admin_discount_starts_at,
      'expires_at', r.admin_discount_expires_at,
      -- What the shop is entitled to RIGHT NOW (0 once lapsed), as distinct from
      -- the configured `discount_percent` above.
      'effective_percent', r.effective_percent,
      'is_active_now', r.effective_percent > 0,
      -- Priced on the EFFECTIVE percent, so a lapsed discount shows the price the
      -- shop actually pays (the global rule, or list) rather than a rate that no
      -- longer applies.
      'final_monthly_ugx',
        case when r.plan_code is null then null
             else public.subscription_payment_plan_amount (r.plan_code, 'monthly', r.effective_percent) end,
      'final_annual_ugx',
        case when r.plan_code is null then null
             else public.subscription_payment_plan_amount (r.plan_code, 'yearly', r.effective_percent) end
    );
  end loop;

  return jsonb_build_object ('ok', true, 'plans', v_plans, 'global', v_global, 'individual', v_individual);
end;
$$;

/**
 * Server-side preview for the admin form. The admin types a percentage and sees
 * what checkout would charge — computed by the pricing function itself, so the
 * preview cannot disagree with the amount that is actually taken.
 *
 * `p_individual` selects which rule is being previewed: true previews a
 * per-account discount (which wins outright), false previews a global one (which
 * applies only where no individual discount exists).
 */
create or replace function public.admin_discount_preview (
  p_plan_code text,
  p_discount_percent numeric,
  p_individual boolean default false
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

  v_base_monthly := public.subscription_payment_plan_amount (v_plan, 'monthly', 0);
  v_base_annual := public.subscription_payment_plan_amount (v_plan, 'yearly', 0);

  if p_individual then
    v_monthly := public.subscription_payment_plan_amount (v_plan, 'monthly', v_percent);
    v_annual := public.subscription_payment_plan_amount (v_plan, 'yearly', v_percent);
  else
    -- A global rule only bites where no individual discount exists, so preview it
    -- the way a shop with no individual discount would be charged.
    v_monthly := v_base_monthly;
    v_annual := v_base_annual;
    if v_percent > 0 then
      v_monthly := greatest (round (v_base_monthly * (100 - v_percent) / 100.0)::bigint, 0);
      v_annual := greatest (round (v_base_annual * (100 - v_percent) / 100.0)::bigint, 0);
    end if;
  end if;

  return jsonb_build_object (
    'ok', true,
    'plan_code', v_plan,
    'discount_percent', v_percent,
    'base_monthly_ugx', v_base_monthly,
    'base_annual_ugx', v_base_annual,
    'monthly_ugx', v_monthly,
    'annual_ugx', v_annual,
    'monthly_discount_ugx', v_base_monthly - v_monthly,
    'annual_discount_ugx', v_base_annual - v_annual
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Privileges — EXECUTE granted explicitly, never left to PUBLIC
-- ----------------------------------------------------------------------------
revoke all on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text) from public;
revoke all on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text) from anon;
grant execute on function public.admin_plan_discount_save (text, numeric, boolean, timestamptz, timestamptz, text) to authenticated;

revoke all on function public.admin_plan_discount_delete (text) from public;
revoke all on function public.admin_plan_discount_delete (text) from anon;
grant execute on function public.admin_plan_discount_delete (text) to authenticated;

revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) from public;
revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) from anon;
grant execute on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_discount_overview () from public;
revoke all on function public.admin_discount_overview () from anon;
grant execute on function public.admin_discount_overview () to authenticated;

revoke all on function public.admin_discount_preview (text, numeric, boolean) from public;
revoke all on function public.admin_discount_preview (text, numeric, boolean) from anon;
grant execute on function public.admin_discount_preview (text, numeric, boolean) to authenticated;

notify pgrst, 'reload schema';
