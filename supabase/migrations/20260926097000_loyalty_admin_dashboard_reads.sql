-- WAKA Loyalty - Phase 6B: read-only internal-admin dashboard queries.
--
-- The Phase 6A control plane exposed per-shop and per-tier reads but nothing that answers
-- "what is the state of Loyalty across the platform?". These three functions are that
-- read surface: the internal Loyalty dashboard calls them, and they are STRICTLY
-- read-only - no INSERT, UPDATE or DELETE anywhere in this file, and no Wallet, member,
-- points or entitlement mutation. Phase 6C owns every write.
--
-- Authorization reuses the Phase 6A allowlist and helper exactly:
--   is_waka_internal_role (array['super_admin', 'operations_admin'])
-- which in turn reads public.internal_admins. No second role system, no new permission key.
--
-- Counts come from the SAME authoritative primitives the enforcement paths use
-- (loyalty_entitlement_active, loyalty_plan_tier_limit, count_shop_active_loyalty_members),
-- so the dashboard can never disagree with what the database will actually enforce.
--
-- Nothing sensitive is returned: no tokens, no qr_token, no public_card_token, no Wallet
-- object ids, no customer PII, no credentials.
--
-- Depends on: 20260926090000 (entitlement + resolvers), 20260926096000 (control plane).

-- ============================================================================
-- 1) Platform-wide overview
-- ============================================================================

create or replace function public.internal_ops_loyalty_admin_overview ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_default_tier text;
  v_result jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select t.code into v_default_tier
  from public.loyalty_plan_tiers t
  where t.is_default and t.is_active
  limit 1;

  with enabled_orgs as (
    select e.organization_id, e.plan_code
    from public.organization_feature_entitlements e
    where e.feature_code = 'loyalty'
      and public.loyalty_entitlement_active (e.status, e.trial_ends_at, now ())
  ),
  shop_rows as (
    select
      sh.id as shop_id,
      o.organization_id,
      -- Same fallback the resolver applies: an org with no tier uses the default one.
      public.loyalty_plan_tier_limit (coalesce (o.plan_code, v_default_tier)) as member_limit,
      public.count_shop_active_loyalty_members (sh.id) as active_members,
      (select count (*) from public.loyalty_enrollment_requests r
        where r.shop_id = sh.id and r.status = 'pending') as pending_requests
    from public.shops sh
    join enabled_orgs o on o.organization_id = sh.organization_id
  )
  select jsonb_build_object (
    'ok', true,
    'organizations_enabled', (select count (*) from enabled_orgs),
    'shops_enabled', (select count (*) from shop_rows),
    'active_members', (select coalesce (sum (active_members), 0) from shop_rows),
    'shops_over_limit',
      (select count (*) from shop_rows where active_members > greatest (member_limit, 0)),
    'organizations_over_limit',
      (select count (distinct organization_id) from shop_rows
        where active_members > greatest (member_limit, 0)),
    'members_over_limit',
      (select coalesce (sum (greatest (active_members - greatest (member_limit, 0), 0)), 0) from shop_rows),
    'pending_requests', (select coalesce (sum (pending_requests), 0) from shop_rows),
    'plans_active', (select count (*) from public.loyalty_plan_tiers where is_active),
    'plans_inactive', (select count (*) from public.loyalty_plan_tiers where not is_active),
    'default_tier_code', v_default_tier,
    'at', now ()
  ) into v_result;

  return v_result;
end;
$fn$;

-- ============================================================================
-- 2) Plan catalog with usage
-- ============================================================================

create or replace function public.internal_ops_loyalty_admin_plans ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_plans jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  with ent as (
    select e.organization_id, e.plan_code
    from public.organization_feature_entitlements e
    where e.feature_code = 'loyalty'
      and public.loyalty_entitlement_active (e.status, e.trial_ends_at, now ())
  ),
  usage as (
    select
      t.code,
      -- Organizations explicitly assigned this tier, plus - for the default tier - the
      -- organizations with no explicit assignment, which resolve to it. Counting both
      -- keeps the dashboard honest about which merchants a limit change would reach.
      count (distinct e.organization_id) filter (
        where e.plan_code = t.code or (t.is_default and e.plan_code is null)
      ) as organizations,
      count (distinct sh.id) filter (
        where e.plan_code = t.code or (t.is_default and e.plan_code is null)
      ) as shops
    from public.loyalty_plan_tiers t
    left join ent e on e.plan_code = t.code
      or (t.is_default and e.plan_code is null)
    left join public.shops sh on sh.organization_id = e.organization_id
    group by t.code
  )
  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'code', t.code,
        'name', t.name,
        'member_limit', t.member_limit,
        'monthly_price_ugx', t.monthly_price_ugx,
        'annual_price_ugx', t.annual_price_ugx,
        'is_active', t.is_active,
        'is_default', t.is_default,
        'sort_order', t.sort_order,
        'organizations', coalesce (u.organizations, 0),
        'shops', coalesce (u.shops, 0)
      )
      order by t.sort_order, t.code
    ),
    '[]'::jsonb
  )
  into v_plans
  from public.loyalty_plan_tiers t
  left join usage u on u.code = t.code;

  return jsonb_build_object ('ok', true, 'plans', v_plans, 'at', now ());
end;
$fn$;

-- ============================================================================
-- 3) Searchable shop / organization state
-- ============================================================================

create or replace function public.internal_ops_loyalty_admin_shop_states (
  p_query text default null,
  p_filter text default 'all',
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_limit integer := least (greatest (coalesce (p_limit, 50), 1), 100);
  v_query text := nullif (btrim (coalesce (p_query, '')), '');
  v_filter text := lower (btrim (coalesce (p_filter, 'all')));
  v_default_tier text;
  v_rows jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;
  if v_filter not in ('all', 'enabled', 'disabled', 'over_limit') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_filter');
  end if;

  select t.code into v_default_tier
  from public.loyalty_plan_tiers t
  where t.is_default and t.is_active
  limit 1;

  select coalesce (jsonb_agg (row_to_json (x) order by x.shop_name, x.shop_id), '[]'::jsonb)
  into v_rows
  from (
    select
      sh.id as shop_id,
      sh.name as shop_name,
      sh.shop_number,
      org.id as organization_id,
      org.name as organization_name,
      coalesce (
        public.loyalty_entitlement_active (e.status, e.trial_ends_at, now ()),
        false
      ) as loyalty_enabled,
      coalesce (e.status, 'none') as entitlement_status,
      e.plan_code as tier_code,
      (select t.name from public.loyalty_plan_tiers t
        where t.code = coalesce (e.plan_code, v_default_tier)) as tier_name,
      public.loyalty_plan_tier_limit (coalesce (e.plan_code, v_default_tier)) as member_limit,
      public.count_shop_active_loyalty_members (sh.id) as active_members,
      (select count (*)::integer from public.loyalty_enrollment_requests r
        where r.shop_id = sh.id and r.status = 'pending') as pending_requests
    from public.shops sh
    join public.organizations org on org.id = sh.organization_id
    left join public.organization_feature_entitlements e
      on e.organization_id = org.id and e.feature_code = 'loyalty'
  ) x
  where
    (
      v_query is null
      or x.shop_name ilike '%' || v_query || '%'
      or x.organization_name ilike '%' || v_query || '%'
      or coalesce (x.shop_number, '') ilike '%' || v_query || '%'
    )
    and (
      v_filter = 'all'
      or (v_filter = 'enabled' and x.loyalty_enabled)
      or (v_filter = 'disabled' and not x.loyalty_enabled)
      or (v_filter = 'over_limit'
          and x.loyalty_enabled
          and x.active_members > greatest (x.member_limit, 0))
    )
  limit v_limit;

  return jsonb_build_object ('ok', true, 'shops', v_rows, 'limit', v_limit, 'at', now ());
end;
$fn$;

-- ============================================================================
-- 4) Grants
-- ============================================================================
-- Same shape as the Phase 6A surface: the role guard is INSIDE, so these are granted to
-- authenticated and return {ok:false,error:'forbidden'} for anyone else. They are revoked
-- from public and anon outright.

do $gr$
declare
  v_sigs text[] := array[
    'public.internal_ops_loyalty_admin_overview ()',
    'public.internal_ops_loyalty_admin_plans ()',
    'public.internal_ops_loyalty_admin_shop_states (text, text, integer)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    execute format ('revoke all on function %s from public', v_sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format ('revoke all on function %s from anon', v_sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format ('grant execute on function %s to authenticated', v_sig);
    end if;
  end loop;
end;
$gr$;
