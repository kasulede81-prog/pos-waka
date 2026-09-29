-- ============================================================================
-- WPL code — merchant surface + internal admin surface
-- ============================================================================
-- Read-only exposure of the code to the two parties entitled to see it:
--
--   * the merchant, for their own shop, through the existing `loyalty_shop_overview`
--     (already gated by `user_can_access_shop`);
--   * internal WAKA staff, through new `internal_ops_loyalty_*` RPCs that follow the existing
--     Phase 6A control-plane convention exactly (granted to `authenticated`, gated INSIDE by
--     `is_waka_internal_role`, audited by the existing mechanisms).
--
-- Nothing here can write a code. The code is issued once, by trigger, at insert.

-- ============================================================================
-- 1) Merchant overview — expose the code read-only
-- ============================================================================
-- Body reproduced from 20260924120000 (loyalty_points_expiry) with `public_code` and `join_path`
-- added to the `program` object. `program` is a jsonb object, so this is an additive change; no
-- existing consumer breaks and no other key moves.
--
-- `join_path` rather than a full URL: the origin (loyalty.waka.ug) is a client concern already
-- owned by `WAKA_LOYALTY_URL` in src/config/company.ts, and the existing join/card links are built
-- client-side by `buildLoyaltyJoinUrl` / `buildCustomerLoyaltyCardUrl`. Baking a hostname into SQL
-- would create a second source of truth for it.
create or replace function public.loyalty_shop_overview (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select jsonb_build_object(
    'ok', true,
    'program', (
      select jsonb_build_object(
        'enabled', p.enabled,
        'earn_unit_ugx', p.earn_unit_ugx,
        'earn_points_per_unit', p.earn_points_per_unit,
        'min_eligible_spend_ugx', p.min_eligible_spend_ugx,
        'rule_kind', p.rule_kind,
        'membership_expiry_mode', p.membership_expiry_mode,
        'membership_fixed_expires_on', p.membership_fixed_expires_on,
        'membership_duration_months', p.membership_duration_months,
        'points_expiry_mode', p.points_expiry_mode,
        'points_expiry_months', p.points_expiry_months,
        'updated_at', p.updated_at,
        -- Permanent public identity of this shop's Loyalty Program. READ-ONLY: no RPC accepts a
        -- code as an input to write, and `loyalty_update_program` never mentions the column.
        'public_code', p.public_code,
        'join_path', case
          when p.public_code is null then null
          else '/j/' || p.public_code
        end
      )
      from public.loyalty_programs p
      where p.shop_id = p_shop_id
    ),
    'members_total', (
      select count(*) from public.loyalty_accounts a where a.shop_id = p_shop_id
    ),
    'members_active', (
      select count(*) from public.loyalty_accounts a
      where a.shop_id = p_shop_id
        and public.loyalty_account_membership_active(a.status, a.membership_expires_at, now())
    ),
    'points_issued', (
      select coalesce(sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.points > 0
    ),
    'points_redeemed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind in ('redeemed', 'expired')
    ),
    'points_reversed', (
      select coalesce(-sum(t.points), 0)
      from public.loyalty_transactions t
      where t.shop_id = p_shop_id and t.kind = 'reversed'
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select
          t.id, t.account_id, t.kind, t.points, t.balance_after, t.cause, t.note,
          t.created_at, c.name as customer_name
        from public.loyalty_transactions t
        join public.loyalty_accounts a on a.id = t.account_id
        join public.customers c on c.id = a.customer_id
        where t.shop_id = p_shop_id
        order by t.created_at desc
        limit 10
      ) x
    )
  )
  into v_result;

  return v_result;
end;
$function$;

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_shop_overview (uuid) to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 2) Internal admin — identify, search, audit
-- ============================================================================
create or replace function public.internal_ops_loyalty_programs (
  p_search text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_search text := nullif (upper (btrim (coalesce (p_search, ''))), '');
  v_limit integer := least (greatest (coalesce (p_limit, 100), 1), 200);
  v_rows jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (jsonb_agg (row_json order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      lp.created_at,
      jsonb_build_object (
        'public_code', lp.public_code,
        'shop_id', s.id,
        'shop_name', s.name,
        'shop_number', s.shop_number,
        'organization_id', o.id,
        'organization_name', o.name,
        'program_display_name', nullif (btrim (coalesce (cd.program_display_name, '')), ''),
        'enabled', lp.enabled,
        'created_at', lp.created_at,
        'members_total', (
          select count(*) from public.loyalty_accounts a where a.shop_id = s.id
        ),
        'members_active', (
          select count(*) from public.loyalty_accounts a
          where a.shop_id = s.id
            and public.loyalty_account_membership_active (a.status, a.membership_expires_at, now ())
        )
      ) as row_json
    from public.loyalty_programs lp
    join public.shops s on s.id = lp.shop_id
    join public.organizations o on o.id = s.organization_id
    left join public.loyalty_card_designs cd on cd.shop_id = lp.shop_id
    where v_search is null
       or upper (coalesce (lp.public_code, '')) like '%' || v_search || '%'
       or upper (s.name) like '%' || v_search || '%'
       or upper (coalesce (s.shop_number, '')) like '%' || v_search || '%'
       or upper (o.name) like '%' || v_search || '%'
    order by lp.created_at desc
    limit v_limit
  ) rows;

  return jsonb_build_object ('ok', true, 'programs', v_rows);
end;
$fn$;

create or replace function public.internal_ops_loyalty_program_by_code (p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_code text := upper (btrim (coalesce (p_code, '')));
  v_row jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  if not public.is_waka_loyalty_program_code (v_code) then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  select jsonb_build_object (
    'public_code', lp.public_code,
    'shop_id', s.id,
    'shop_name', s.name,
    'shop_number', s.shop_number,
    'organization_id', o.id,
    'organization_name', o.name,
    'program_display_name', nullif (btrim (coalesce (cd.program_display_name, '')), ''),
    'enabled', lp.enabled,
    'created_at', lp.created_at,
    'members_total', (
      select count(*) from public.loyalty_accounts a where a.shop_id = s.id
    ),
    'members_active', (
      select count(*) from public.loyalty_accounts a
      where a.shop_id = s.id
        and public.loyalty_account_membership_active (a.status, a.membership_expires_at, now ())
    )
  )
  into v_row
  from public.loyalty_programs lp
  join public.shops s on s.id = lp.shop_id
  join public.organizations o on o.id = s.organization_id
  left join public.loyalty_card_designs cd on cd.shop_id = lp.shop_id
  where lp.public_code = v_code
  limit 1;

  if v_row is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object ('ok', true, 'program', v_row);
end;
$fn$;

do $g$
begin
  execute 'revoke all on function public.internal_ops_loyalty_programs (text, integer) from public';
  execute 'revoke all on function public.internal_ops_loyalty_program_by_code (text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.internal_ops_loyalty_programs (text, integer) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_program_by_code (text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- Granted to authenticated like every other internal_ops_loyalty_* RPC: the role check
    -- inside the body is the gate, not the grant.
    execute 'grant execute on function public.internal_ops_loyalty_programs (text, integer) to authenticated';
    execute 'grant execute on function public.internal_ops_loyalty_program_by_code (text) to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 3) Admin shop list carries the code, so it is correct for EVERY displayed row
-- ============================================================================
-- The admin table shows up to 100 shops (the RPC clamps to 100) drawn from the whole platform,
-- while `internal_ops_loyalty_programs` returns at most 200 programs ordered newest-first. Joining
-- the two in the browser therefore leaves the OLDEST programs blank as soon as a platform passes
-- 200 loyalty programs — the code would silently read "—" for exactly the merchants who have been
-- on WAKA longest.
--
-- So the code is projected onto the row itself instead: no second call, no cap to outrun, no
-- client-side join to keep in sync. Search accepts a WPL code here too, which means a code lookup
-- never has to be resolved client-side and then re-filtered.
--
-- Body reproduced from 20260926097000 (read-only internal-admin dashboard queries) with
-- `public_code` added to the projected row, a LEFT JOIN onto loyalty_programs, and the code added
-- to the search predicate. Every existing column, filter, ordering and the 100-row clamp are
-- unchanged; the return is jsonb, so the extra key is additive for current consumers.
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
      -- The merchant's permanent public Loyalty Program code. LEFT JOIN: a shop that has never
      -- switched Loyalty on has no program row yet, and must still appear in this list.
      lp.public_code,
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
    left join public.loyalty_programs lp on lp.shop_id = sh.id
  ) x
  where
    (
      v_query is null
      or x.shop_name ilike '%' || v_query || '%'
      or x.organization_name ilike '%' || v_query || '%'
      or coalesce (x.shop_number, '') ilike '%' || v_query || '%'
      -- Search by WPL code, case-insensitively, so an admin can paste one straight in.
      or coalesce (x.public_code, '') ilike '%' || v_query || '%'
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

do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.internal_ops_loyalty_admin_shop_states (text, text, integer) to authenticated';
  end if;
end;
$g$;
