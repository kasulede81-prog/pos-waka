-- ============================================================================
-- Public pricing shows the global discount; no path writes a zero payment
-- ============================================================================
-- APPROVED DECISION D: "Global discounts must be reflected consistently on
-- public pricing and upgrade pages. Individual discounts remain private to
-- their intended organization."
-- APPROVED DECISION C, second half: "Do not create zero-value payment records."
--
-- ----------------------------------------------------------------------------
-- 1. THE PUBLIC PRICE BOOK
-- ----------------------------------------------------------------------------
-- `public_subscription_pricing()` is the anon-readable source behind the
-- marketing pricing page, the in-app upgrade page and the shop console's
-- suggested payment amount. It read the canonical book and the campaign layer
-- only, so a live global discount was invisible everywhere except the checkout
-- quote — measured: a 50% global rule left this function reporting UGX 36,000
-- while the checkout quoted UGX 18,000.
--
-- It now applies the GLOBAL rule, and only the global rule:
--   * a global plan discount is plan-wide by construction, so publishing it is
--     the same class of information as the campaign price it already publishes;
--   * an account discount is never published. It is read from a specific
--     organization's subscription row, and that organization's price stays
--     private to it — the public book keeps showing what a shop with no account
--     discount pays, which is exactly what `_admin_discount_effective(0, plan)`
--     resolves.
--
-- `final_monthly_ugx` / `final_annual_ugx` are now taken from
-- `subscription_payment_plan_amount` ITSELF rather than re-derived here, so the
-- published price cannot drift from the amount checkout charges. The campaign
-- layer is still published alongside, as `campaign_monthly_ugx` /
-- `campaign_annual_ugx`, and `global_discount_percent` says how much of the
-- difference is an administrative discount rather than a campaign.
--
-- ----------------------------------------------------------------------------
-- 2. AND 3. NO ZERO-VALUE PAYMENT ROWS
-- ----------------------------------------------------------------------------
-- Both live writers of `subscription_payments` are closed here and in
-- `20261011130000`: `subscription_payment_create` returns a discriminated
-- `fully_discounted` / `zero_amount` refusal instead of writing a pending row
-- with amount_ugx = 0, and the ledger's own state guard refuses any insert with
-- a non-positive amount, whatever future writer tries it. A zero-amount row
-- could never settle — the provider rejects a UGX 0 request — so it would sit
-- pending, be swept as stale, and grant nothing.
--
-- The legitimate zero-price path is `admin_subscription_activate_free`
-- (`20261011140000`), which grants the period and writes NO ledger row at all.

-- ----------------------------------------------------------------------------
-- 1. The public price book, with the global rule folded in
-- ----------------------------------------------------------------------------
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
  v_global_pct numeric;
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
      -- discount of its own", so the resolver returns the plan's global rule.
      -- An actual account discount is never consulted here.
      v_global_pct := public._admin_discount_effective (0, v_plan);
      v_global_active := v_global_active or v_global_pct > 0;

      v_row := v_row || jsonb_build_object(
        -- The campaign layer, published explicitly so the difference between a
        -- promotion and an administrative discount stays visible.
        'campaign_monthly_ugx', v_campaign_monthly,
        'campaign_annual_ugx', v_campaign_annual,
        'global_discount_percent', v_global_pct,
        -- THE AUTHORITATIVE PRICE. Taken from the same function every money path
        -- uses, so the page cannot show a number checkout would not charge.
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

revoke all on function public.public_subscription_pricing () from public;
grant execute on function public.public_subscription_pricing () to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Payment creation refuses a zero amount
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261010120000_admin_subscription_discounts.sql` except the
-- guard below, which sits between the server price and the client-amount
-- comparison. Signature unchanged, so ACLs survive.
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

  -- DECISION C: there is no payment to make at zero. A pending row with
  -- amount_ugx = 0 can never settle — the provider rejects a UGX 0 request — so
  -- it would be swept as stale and grant nothing while looking like a real
  -- checkout. A fully discounted account is activated by
  -- `admin_subscription_activate_free`, which writes no ledger row at all.
  if v_amount <= 0 then
    if public._admin_discount_effective (v_discount, v_plan) >= 100 then
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
-- 3. The ledger itself refuses a non-positive amount
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261006090000` except one comparison: the state guard now
-- rejects a zero amount as well as a negative one, so no writer -- present or
-- future -- can record a payment that can never settle. Both live writers are
-- closed above and in 20261011130000; this is the backstop that does not depend
-- on either of them remembering.
create or replace function public.subscription_payment_state_guard ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'confirmed', 'recorded') then
      raise exception 'payment_invalid_initial_status';
    end if;
    -- Tightened from `< 0` to `<= 0`: the ledger records money that moved, and
    -- a zero-amount payment is not a payment. The 100% case is served by
    -- admin_subscription_activate_free, which writes no row here at all.
    if new.amount_ugx is null or new.amount_ugx <= 0 then
      raise exception 'payment_invalid_amount';
    end if;
    if new.reference is not null and new.provider is null then
      raise exception 'payment_reference_requires_provider';
    end if;
    if new.status in ('confirmed', 'recorded') and new.confirmed_at is null then
      new.confirmed_at := now ();
    end if;
    return new;
  end if;

  -- Immutable ledger fields: money and identity can never be rewritten.
  if new.id is distinct from old.id
     or new.subscription_id is distinct from old.subscription_id
     or new.organization_id is distinct from old.organization_id
     or new.shop_id is distinct from old.shop_id
     or new.amount_ugx is distinct from old.amount_ugx
     or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider
     or new.recorded_by is distinct from old.recorded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_row_is_immutable';
  end if;

  -- A reference may be bound once (settlement supplies it late), never changed.
  if new.reference is distinct from old.reference
     and not (old.reference is null and new.reference is not null) then
    raise exception 'payment_row_is_immutable';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status in ('confirmed', 'failed', 'cancelled') then
      if new.status = 'confirmed' and new.confirmed_at is null then
        new.confirmed_at := now ();
      end if;
      return new;
    end if;
    if old.status in ('confirmed', 'recorded') and new.status = 'refunded' then
      return new;
    end if;
    raise exception 'payment_invalid_transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
