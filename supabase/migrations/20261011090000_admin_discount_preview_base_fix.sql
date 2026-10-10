-- ============================================================================
-- FIX: the admin discount preview double-applied a saved global discount
-- ============================================================================
-- PROVEN, not inferred. With a 50% campaign AND a global 99% rule saved on
-- business, the harness showed:
--
--   subscription_payment_plan_amount('business','month',0)  ->  180   (correct)
--   admin_discount_preview('business', 99, false).monthly_ugx ->    2   (wrong)
--
-- THE CAUSE. Both read RPCs asked for their "undiscounted base" by calling
-- `subscription_payment_plan_amount (plan, cycle, 0)`. That is not the
-- undiscounted base once a global rule exists: a 0 in the third argument means
-- "this account has no INDIVIDUAL discount", which `_admin_discount_effective`
-- resolves by falling back to the GLOBAL rule. So the base came back already
-- discounted (18,000 → 180), and the preview's own percentage was then applied
-- on top of it (180 × 1% = 2).
--
-- SCOPE — WHAT THIS DOES AND DOES NOT TOUCH.
--
--   * AFFECTED: `admin_discount_preview` and `admin_discount_overview`. Both are
--     read-only, STABLE, admin-only RPCs. They report a number; they never
--     compute one that is charged.
--
--   * NOT AFFECTED, and deliberately NOT touched: `subscription_payment_plan_amount`.
--     The saved price, the checkout quote and `subscription_payment_expected_amount`
--     were already correct — they pass a REAL individual percentage, so the
--     global fallback never fires on them. The defect was confined to the two
--     preview/overview readers, so the fix is confined there. Re-churning a
--     function that moves money to repair a display bug would be the larger risk,
--     not the smaller one.
--
--   * NO CAMPAIGN RULE IS CHANGED. `_pricing_compute_plan_row`,
--     `_pricing_min_final_monthly_ugx` (the 90% clamp and UGX 5,000 floor) and
--     every `admin_pricing_campaign_*` RPC are untouched. The new helper below
--     only READS the campaign price book through the same function they use.
--
-- WHY A HELPER RATHER THAN INLINE SQL. The "price before any admin discount" is
-- the campaign layer, and it must read identically in every place that asks for
-- it. It is defined once here and called by both RPCs; a test pins it equal to
-- `subscription_payment_plan_amount (plan, cycle, 0)` whenever no global rule is
-- configured, which is exactly the condition under which the two must agree — so
-- the two definitions cannot drift apart silently.

-- ----------------------------------------------------------------------------
-- The campaign-layer price: canonical book + active campaign, or the legacy plan
-- row for non-catalog plans. No admin discount of any kind.
-- ----------------------------------------------------------------------------
create or replace function public._admin_discount_campaign_amount (
  p_plan_code text,
  p_billing_interval text
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

  -- Identical to the branch inside subscription_payment_plan_amount.
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
    if v_plan in ('starter', 'business', 'waka_plus') then
      raise exception 'pricing_unavailable';
    end if;

    select sp.monthly_price_ugx, sp.annual_price_ugx
      into v_monthly, v_annual
    from public.subscription_plans sp
    where sp.code = v_plan;

    if v_monthly is null then
      raise exception 'plan_not_available';
    end if;
  end if;

  return case when v_cycle = 'year' then v_annual else v_monthly end;
end;
$$;

revoke all on function public._admin_discount_campaign_amount (text, text) from public;
revoke all on function public._admin_discount_campaign_amount (text, text) from anon;
revoke all on function public._admin_discount_campaign_amount (text, text) from authenticated;

-- ----------------------------------------------------------------------------
-- Preview — base now genuinely undiscounted
-- ----------------------------------------------------------------------------
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

  -- THE FIX: the campaign layer, with NO admin discount in it. Asking
  -- subscription_payment_plan_amount for 0 would return the GLOBAL-discounted
  -- price and then be discounted a second time below.
  v_base_monthly := public._admin_discount_campaign_amount (v_plan, 'monthly');
  v_base_annual := public._admin_discount_campaign_amount (v_plan, 'yearly');

  if p_individual then
    -- An individual discount wins outright, so it is applied to the base exactly
    -- as the money path applies it.
    v_monthly := greatest (round (v_base_monthly * (100 - v_percent) / 100.0)::bigint, 0);
    v_annual := greatest (round (v_base_annual * (100 - v_percent) / 100.0)::bigint, 0);
  else
    -- A global rule only bites where no individual discount exists, and this is
    -- what such an account would pay.
    if v_percent > 0 then
      v_monthly := greatest (round (v_base_monthly * (100 - v_percent) / 100.0)::bigint, 0);
      v_annual := greatest (round (v_base_annual * (100 - v_percent) / 100.0)::bigint, 0);
    else
      v_monthly := v_base_monthly;
      v_annual := v_base_annual;
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

revoke all on function public.admin_discount_preview (text, numeric, boolean) from public;
revoke all on function public.admin_discount_preview (text, numeric, boolean) from anon;
grant execute on function public.admin_discount_preview (text, numeric, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Overview — the global rows' undiscounted base and discounted price
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
           public.admin_plan_discount_is_active (d) as is_active_now
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
      -- The campaign-layer price: what this plan costs with NO admin discount.
      'base_monthly_ugx', public._admin_discount_campaign_amount (r.plan_code, 'monthly'),
      -- What an account with no individual discount pays when this rule applies.
      -- (Was `subscription_payment_plan_amount (…, 0)`, which returned the
      -- global-discounted price once a rule existed and so was never the base.)
      'final_monthly_ugx',
        greatest (round (
          public._admin_discount_campaign_amount (r.plan_code, 'monthly')
          * (100 - coalesce (r.discount_percent, 0)) / 100.0
        )::bigint, 0),
      'final_monthly_with_discount_ugx',
        greatest (round (
          public._admin_discount_campaign_amount (r.plan_code, 'monthly')
          * (100 - coalesce (r.discount_percent, 0)) / 100.0
        )::bigint, 0)
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
      'effective_percent', r.effective_percent,
      'is_active_now', r.effective_percent > 0,
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

revoke all on function public.admin_discount_overview () from public;
revoke all on function public.admin_discount_overview () from anon;
grant execute on function public.admin_discount_overview () to authenticated;

notify pgrst, 'reload schema';
