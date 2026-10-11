-- ============================================================================
-- Discount scope, subscription resolution, and window-correct reporting
-- ============================================================================
-- APPROVED DECISION B. "Individual discounts apply organization-wide. Display
-- the number of shops covered and ensure other organizations are unaffected."
-- Plus the audit's item 5 (unambiguous subscription selection) and item 8
-- (active-window reporting).
--
-- ----------------------------------------------------------------------------
-- 1. ONE RESOLVER, USED BY EVERYONE
-- ----------------------------------------------------------------------------
-- A subscription is addressed through its ORGANIZATION, and the rule used to be
-- "newest row by created_at" — evaluated independently in the discount setter,
-- in `_subscription_payment_resolve` (quote/create) and in the shop-console
-- read. Three copies of a query that can each pick a different row is how a
-- discount ends up on a subscription the checkout never prices.
--
-- `_subscription_latest_for_org` is now the single definition: the org's LIVE
-- subscription (trial/trialing/active/past_due) if there is one, newest first;
-- otherwise the newest row of any status. The schema allows at most one live
-- row per org (`subscriptions_one_active_per_org`, 006/017), so "the live one"
-- is unambiguous where it matters, and a dead-but-newer row can no longer
-- shadow the subscription the shop is actually operating under.
--
-- The setter and the money path now call the SAME function, so a discount can
-- only ever land on the row the checkout prices from.
--
-- ----------------------------------------------------------------------------
-- 2. SCOPE IS EXPLICIT
-- ----------------------------------------------------------------------------
-- A discount is stored on the organization's subscription row, so it covers
-- every shop of that organization by construction — one live subscription per
-- org is structural, not an accident. The setter and the overview now report
-- `scope: 'organization'` and `shop_count`, so the screen can say how many
-- shops a discount covers instead of implying a single shop. Tenancy is
-- untouched: the row belongs to one organization, and no other organization
-- resolves it.
--
-- ----------------------------------------------------------------------------
-- 3. WINDOW-CORRECT PRICING IN THE OVERVIEW
-- ----------------------------------------------------------------------------
-- The global table reported `final_monthly_ugx` as a formula over the stored
-- percentage, ignoring `active` and both window columns — so a rule that was
-- not in force still advertised a discounted "effective price". The reported
-- price is now the one the money path would charge right now (which is the
-- campaign price when the rule is not live), and the hypothetical figure is
-- reported separately as `configured_monthly_ugx`. The field names the screen
-- already reads keep their positions; only their meaning is corrected.

-- ----------------------------------------------------------------------------
-- The single resolver
-- ----------------------------------------------------------------------------
create or replace function public._subscription_latest_for_org (p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.subscriptions s
  where s.organization_id = p_organization_id
  order by
    -- Live rows first: a discount must land on (and be priced from) the
    -- subscription the shops are actually operating under.
    case
      when s.status in ('trial', 'trialing', 'active', 'past_due') then 0
      else 1
    end,
    s.created_at desc
  limit 1
$$;

comment on function public._subscription_latest_for_org (uuid) is
  'The organization''s subscription for pricing and discount purposes: the live '
  'row if there is one, else the newest. The ONE definition — the discount '
  'setter, subscription_payment_quote/create and the shop console all use it.';

revoke all on function public._subscription_latest_for_org (uuid) from public;
revoke all on function public._subscription_latest_for_org (uuid) from anon;
revoke all on function public._subscription_latest_for_org (uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- The money path resolves through it too
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261006090000` except the `else` branch, which now asks
-- the shared resolver instead of repeating "order by created_at desc limit 1".
-- Signature unchanged, so ACLs survive.
create or replace function public._subscription_payment_resolve (
  p_shop_id uuid,
  p_subscription_id uuid,
  out o_subscription_id uuid,
  out o_organization_id uuid
)
returns record
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop_org uuid;
  v_sub_org uuid;
  v_sub_shop uuid;
begin
  o_subscription_id := null;
  o_organization_id := null;

  select s.organization_id
    into v_shop_org
  from public.shops s
  where s.id = p_shop_id;

  if v_shop_org is null then
    return;
  end if;

  if p_subscription_id is not null then
    select s.organization_id, s.shop_id
      into v_sub_org, v_sub_shop
    from public.subscriptions s
    where s.id = p_subscription_id;
  else
    -- The ONE resolver — the same call the discount setter makes, so a
    -- discount is always written to the row this function prices from.
    o_subscription_id := public._subscription_latest_for_org (v_shop_org);

    select s.organization_id, s.shop_id
      into v_sub_org, v_sub_shop
    from public.subscriptions s
    where s.id = o_subscription_id;
  end if;

  if p_subscription_id is not null then
    o_subscription_id := p_subscription_id;
  end if;

  if o_subscription_id is null or v_sub_org is null then
    o_subscription_id := null;
    o_organization_id := null;
    return;
  end if;

  -- Same organization, and (when the subscription is shop-anchored) same shop.
  if v_sub_org <> v_shop_org or (v_sub_shop is not null and v_sub_shop <> p_shop_id) then
    o_subscription_id := null;
    o_organization_id := null;
    return;
  end if;

  o_organization_id := v_sub_org;
end;
$$;

-- ----------------------------------------------------------------------------
-- The discount setter targets the same row, and reports its scope
-- ----------------------------------------------------------------------------
-- Byte-identical to `20261010120000` except: the subscription lookup now goes
-- through `_subscription_latest_for_org`, a shop count is resolved, and the
-- return carries `organization_id`, `scope` and `shop_count`. The window,
-- bound, audit and history behaviour is unchanged.
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
  v_shop_count int := 0;
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

  -- The discount is stored on the organization's subscription, so it covers
  -- every shop of that organization. Counted here so the screen can say so.
  select count(*)::int into v_shop_count
  from public.shops sh
  where sh.organization_id = v_org;

  -- The same resolver the money path uses: the discount lands on the
  -- subscription `subscription_payment_quote`/`_create` will price.
  v_sub_id := public._subscription_latest_for_org (v_org);

  select sp.code
    into v_plan_code
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id = s.plan_id
  where s.id = v_sub_id;

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
    'organization_id', v_org,
    -- Explicit: this is an account-wide discount, not a per-shop one.
    'scope', 'organization',
    'shop_count', v_shop_count,
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

revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) from public;
revoke all on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) from anon;
grant execute on function public.admin_subscription_discount_save (uuid, numeric, text, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- Overview — window-correct global prices, and the scope of each rule
-- ----------------------------------------------------------------------------
-- Supersedes `20261011090000`. The campaign-layer base is still
-- `_admin_discount_campaign_amount`; what changes is that the reported
-- EFFECTIVE price is now the one the money path would charge right now, and the
-- hypothetical "if this rule were live" figure is reported separately.
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
      -- Same fact, named the way the screen talks about it.
      'applies_now', r.is_active_now,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      -- The campaign-layer price: what this plan costs with NO admin discount.
      'base_monthly_ugx', public._admin_discount_campaign_amount (r.plan_code, 'monthly'),
      -- WHAT A SHOP WITH NO ACCOUNT DISCOUNT PAYS RIGHT NOW. With the rule live
      -- this is the discounted price; with the rule inactive, expired or not
      -- yet started, it is the campaign price — because that is what checkout
      -- would actually charge. This is the number the screen must show as the
      -- effective price.
      'effective_monthly_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'effective_annual_ugx', public.subscription_payment_plan_amount (r.plan_code, 'yearly', 0),
      -- What the rule would be worth IF it were in force. Reported, never
      -- presented as the current price.
      'configured_monthly_ugx', greatest (round (
        public._admin_discount_campaign_amount (r.plan_code, 'monthly')
        * (100 - coalesce (r.discount_percent, 0)) / 100.0
      )::bigint, 0),
      -- Historical field names, kept so existing readers keep working — now
      -- carrying the live-aware price rather than a formula that ignored the
      -- rule's own window.
      'final_monthly_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0),
      'final_monthly_with_discount_ugx', public.subscription_payment_plan_amount (r.plan_code, 'monthly', 0)
    );
  end loop;

  for r in
    select s.id as subscription_id, s.organization_id, s.shop_id,
           s.admin_discount_percent, s.admin_discount_note, s.updated_at,
           s.admin_discount_starts_at, s.admin_discount_expires_at,
           public._admin_discount_for_row (s) as effective_percent,
           sp.code as plan_code,
           coalesce(sh.name, o.name, '') as account_name,
           (select count(*)::int from public.shops sh2 where sh2.organization_id = s.organization_id) as shop_count
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
      -- The discount lives on the organization's subscription and covers every
      -- shop of that organization.
      'scope', 'organization',
      'shop_count', r.shop_count,
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
      'applies_now', r.effective_percent > 0,
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

revoke all on function public.admin_discount_overview () from public;
revoke all on function public.admin_discount_overview () from anon;
grant execute on function public.admin_discount_overview () to authenticated;

notify pgrst, 'reload schema';
