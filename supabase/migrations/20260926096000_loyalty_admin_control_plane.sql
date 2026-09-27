-- WAKA Loyalty - Phase 6A: internal-admin control plane (server-side foundation).
--
-- The Phase 6 audit found that until now an internal admin had NO supported way to
-- administer Loyalty: the tier catalog was migration-seeded only, the entitlement table
-- had no writer for feature_code='loyalty', and the only admin machinery touching loyalty
-- data was destructive (shop reset / account delete). This migration adds the controlled
-- server-side surface a future admin UI will call, plus the privilege hardening the audit
-- called out.
--
-- Shape, matching the existing internal-admin architecture rather than inventing one:
--
--   internal admin -> authorized internal_ops_* RPC (SECURITY DEFINER) -> transaction
--                  -> authoritative loyalty data -> internal_ops_admin_audit event
--
-- Reused, not reinvented:
--   * identity + authorization : public.internal_admins via is_waka_internal_role(text[])
--                                (the canonical helper, 053_internal_admin_auth_user_lookup)
--   * audit sink               : public.internal_ops_admin_audit (retained by the shop reset)
--   * entitlement storage      : public.organization_feature_entitlements (feature_code='loyalty')
--   * resolvers                : resolve_shop_loyalty_entitlement / count_shop_active_loyalty_members
--   * correction path          : loyalty_adjust_points stays the only points correction
--
-- Deliberately NOT done: no new entitlement table, no new audit table, no second role
-- system, no admin UI, no member-data mutation of any kind, no Wallet API access, no
-- automatic remediation of over-limit shops, no DELETE of tiers or entitlements.
--
-- Errors are returned as {ok:false, error:<code>} rather than raised, so the future UI
-- never receives a raw SQL error; every validation happens before any write, and the
-- audit insert shares the mutation's transaction so a failure rolls back both.
--
-- Depends on: 20260926090000 (catalog + entitlement columns + resolvers).

-- ============================================================================
-- 1) Read-only decision helpers (internal only)
-- ============================================================================

-- Impact of a proposed member_limit for one tier: which organizations and shops use it,
-- and how many would be over the new limit. Existing members are NEVER touched - this only
-- measures, so an admin can see the blast radius before changing a GLOBAL catalog value.
create or replace function public.internal_ops_loyalty_plan_impact (
  p_code text,
  p_proposed_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_code text := lower (btrim (coalesce (p_code, '')));
  v_limit integer := greatest (0, coalesce (p_proposed_limit, 0));
  v_default boolean;
  v_orgs integer := 0;
  v_shops integer := 0;
  v_over integer := 0;
  v_members_over integer := 0;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select t.is_default into v_default from public.loyalty_plan_tiers t where t.code = v_code;
  v_default := coalesce (v_default, false);

  with affected as (
    select sh.id as shop_id
    from public.organization_feature_entitlements e
    join public.shops sh on sh.organization_id = e.organization_id
    where e.feature_code = 'loyalty'
      and e.status in ('active', 'trial')
      -- An org with no explicit tier falls back to the default tier, so the default
      -- tier's limit reaches those orgs too.
      and (e.plan_code = v_code or (e.plan_code is null and v_default))
  ),
  usage as (
    select a.shop_id, public.count_shop_active_loyalty_members (a.shop_id) as n
    from affected a
  )
  select
    (select count (distinct e.organization_id)
       from public.organization_feature_entitlements e
      where e.feature_code = 'loyalty'
        and e.status in ('active', 'trial')
        and (e.plan_code = v_code or (e.plan_code is null and v_default))),
    count (*),
    count (*) filter (where u.n > v_limit),
    coalesce (sum (greatest (u.n - v_limit, 0)), 0)
  into v_orgs, v_shops, v_over, v_members_over
  from usage u;

  return jsonb_build_object (
    'ok', true,
    'tier_code', v_code,
    'proposed_member_limit', v_limit,
    'is_default', v_default,
    'organizations', coalesce (v_orgs, 0),
    'shops', coalesce (v_shops, 0),
    'shops_over_limit', coalesce (v_over, 0),
    'members_over_limit', coalesce (v_members_over, 0)
  );
end;
$fn$;

-- One shop's Loyalty administrative state. Internal only: ordinary merchants must not be
-- able to read another shop's figures, and the merchant-facing equivalent has its own
-- access check (shop_loyalty_usage).
create or replace function public.internal_ops_loyalty_shop_state (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_ent record;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_shop');
  end if;

  select sh.organization_id into v_org from public.shops sh where sh.id = p_shop_id;
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);

  return jsonb_build_object (
    'ok', true,
    'shop_id', p_shop_id,
    'organization_id', v_org,
    'usage', public.shop_loyalty_usage (p_shop_id),
    'entitlement_status', v_ent.entitlement_status,
    'over_limit',
      v_ent.loyalty_enabled
      and public.count_shop_active_loyalty_members (p_shop_id) > coalesce (v_ent.member_limit, 0)
  );
end;
$fn$;

-- ============================================================================
-- 2) Plan catalog control
-- ============================================================================

create or replace function public.internal_ops_loyalty_create_plan (
  p_code text,
  p_name text,
  p_member_limit integer,
  p_monthly_price_ugx bigint default 0,
  p_annual_price_ugx bigint default 0,
  p_sort_order integer default 0,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text := lower (btrim (coalesce (p_code, '')));
  v_name text := btrim (coalesce (p_name, ''));
  v_reason text := nullif (btrim (coalesce (p_reason, '')), '');
  v_after jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Phase 6C: a mutation with no stated reason is not auditable, so the server refuses it
  -- rather than recording an unattributed change. Enforced here, not in the client.
  if v_reason is null or char_length (v_reason) < 3 or char_length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  -- Validate before writing anything, so a rejected call leaves no trace to roll back.
  if v_code !~ '^[a-z][a-z0-9_]{1,31}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_code');
  end if;
  if v_name = '' or char_length (v_name) > 60 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_name');
  end if;
  if p_member_limit is null or p_member_limit < 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_member_limit');
  end if;
  if coalesce (p_monthly_price_ugx, 0) < 0 or coalesce (p_annual_price_ugx, 0) < 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_price');
  end if;
  if exists (select 1 from public.loyalty_plan_tiers t where t.code = v_code) then
    return jsonb_build_object ('ok', false, 'error', 'code_exists');
  end if;

  insert into public.loyalty_plan_tiers (
    code, name, member_limit, monthly_price_ugx, annual_price_ugx, sort_order, is_active, is_default
  )
  values (
    v_code, v_name, p_member_limit,
    coalesce (p_monthly_price_ugx, 0), coalesce (p_annual_price_ugx, 0),
    coalesce (p_sort_order, 0), true, false
  );

  select to_jsonb (t) into v_after from public.loyalty_plan_tiers t where t.code = v_code;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), 'loyalty_plan_created', jsonb_build_object (
    'target_type', 'loyalty_plan_tier',
    'target_id', v_code,
    'before', null,
    'after', v_after,
    'reason', v_reason,
    'at', now ()
  ));

  return jsonb_build_object ('ok', true, 'code', v_code, 'tier', v_after);
end;
$fn$;

create or replace function public.internal_ops_loyalty_update_plan (
  p_code text,
  p_name text,
  p_member_limit integer,
  p_monthly_price_ugx bigint default 0,
  p_annual_price_ugx bigint default 0,
  p_sort_order integer default 0,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text := lower (btrim (coalesce (p_code, '')));
  v_name text := btrim (coalesce (p_name, ''));
  v_reason text := nullif (btrim (coalesce (p_reason, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_limit_changed boolean;
  v_impact jsonb := '{}'::jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Phase 6C: a mutation with no stated reason is not auditable, so the server refuses it
  -- rather than recording an unattributed change. Enforced here, not in the client.
  if v_reason is null or char_length (v_reason) < 3 or char_length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;

  select to_jsonb (t) into v_before from public.loyalty_plan_tiers t where t.code = v_code;
  if v_before is null then
    return jsonb_build_object ('ok', false, 'error', 'tier_not_found');
  end if;

  if v_name = '' or char_length (v_name) > 60 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_name');
  end if;
  if p_member_limit is null or p_member_limit < 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_member_limit');
  end if;
  if coalesce (p_monthly_price_ugx, 0) < 0 or coalesce (p_annual_price_ugx, 0) < 0 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_price');
  end if;

  v_limit_changed := (v_before ->> 'member_limit')::integer is distinct from p_member_limit;

  -- Measure the blast radius of a GLOBAL limit change. This only reads: no member, point,
  -- redemption or Wallet row is modified by this function or any caller of it.
  if v_limit_changed then
    v_impact := public.internal_ops_loyalty_plan_impact (v_code, p_member_limit);
  end if;

  update public.loyalty_plan_tiers
  set name = v_name,
      member_limit = p_member_limit,
      monthly_price_ugx = coalesce (p_monthly_price_ugx, 0),
      annual_price_ugx = coalesce (p_annual_price_ugx, 0),
      sort_order = coalesce (p_sort_order, 0),
      updated_at = now ()
  where code = v_code;

  select to_jsonb (t) into v_after from public.loyalty_plan_tiers t where t.code = v_code;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), 'loyalty_plan_updated', jsonb_build_object (
    'target_type', 'loyalty_plan_tier',
    'target_id', v_code,
    'before', v_before,
    'after', v_after,
    'reason', v_reason,
    'member_limit_changed', v_limit_changed,
    'impact', v_impact,
    'at', now ()
  ));

  return jsonb_build_object (
    'ok', true, 'code', v_code, 'tier', v_after,
    'member_limit_changed', v_limit_changed,
    'impact', v_impact
  );
end;
$fn$;

create or replace function public.internal_ops_loyalty_set_plan_active (
  p_code text,
  p_is_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text := lower (btrim (coalesce (p_code, '')));
  v_reason text := nullif (btrim (coalesce (p_reason, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_active boolean;
  v_default boolean;
  v_in_use integer := 0;
  v_other_active integer := 0;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Phase 6C: a mutation with no stated reason is not auditable, so the server refuses it
  -- rather than recording an unattributed change. Enforced here, not in the client.
  if v_reason is null or char_length (v_reason) < 3 or char_length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;
  if p_is_active is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_state');
  end if;

  select to_jsonb (t), t.is_active, t.is_default
    into v_before, v_active, v_default
  from public.loyalty_plan_tiers t where t.code = v_code;
  if v_before is null then
    return jsonb_build_object ('ok', false, 'error', 'tier_not_found');
  end if;

  -- Deactivation is refused rather than silently changing merchants. Deactivating a tier
  -- would make resolve_shop_loyalty_entitlement fall back to the default tier, quietly
  -- changing every assigned organization's allowance - the audit explicitly forbids silent
  -- merchant changes, so the admin is told why instead.
  if not p_is_active then
    if v_default then
      return jsonb_build_object ('ok', false, 'error', 'tier_is_default',
        'message', 'The fallback tier cannot be deactivated; the resolver would fall back to nothing.');
    end if;

    select count (*) into v_in_use
    from public.organization_feature_entitlements e
    where e.feature_code = 'loyalty' and e.plan_code = v_code;
    if v_in_use > 0 then
      return jsonb_build_object ('ok', false, 'error', 'tier_in_use', 'organizations', v_in_use);
    end if;

    select count (*) into v_other_active
    from public.loyalty_plan_tiers t
    where t.is_active and t.code <> v_code;
    if v_other_active = 0 then
      return jsonb_build_object ('ok', false, 'error', 'last_active_tier');
    end if;
  end if;

  update public.loyalty_plan_tiers set is_active = p_is_active, updated_at = now () where code = v_code;

  select to_jsonb (t) into v_after from public.loyalty_plan_tiers t where t.code = v_code;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (auth.uid (), 'loyalty_plan_active_changed', jsonb_build_object (
    'target_type', 'loyalty_plan_tier',
    'target_id', v_code,
    'before', v_before,
    'after', v_after,
    'reason', v_reason,
    'at', now ()
  ));

  return jsonb_build_object ('ok', true, 'code', v_code, 'is_active', p_is_active, 'tier', v_after);
end;
$fn$;

-- ============================================================================
-- 3) Shop entitlement control (reuses organization_feature_entitlements)
-- ============================================================================

create or replace function public.internal_ops_loyalty_set_shop_entitlement (
  p_shop_id uuid,
  p_status text,
  p_plan_code text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text := lower (btrim (coalesce (p_status, '')));
  v_plan text := nullif (lower (btrim (coalesce (p_plan_code, ''))), '');
  v_reason text := nullif (btrim (coalesce (p_reason, '')), '');
  v_org uuid;
  v_before jsonb;
  v_after jsonb;
  v_ent record;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Phase 6C: a mutation with no stated reason is not auditable, so the server refuses it
  -- rather than recording an unattributed change. Enforced here, not in the client.
  if v_reason is null or char_length (v_reason) < 3 or char_length (v_reason) > 300 then
    return jsonb_build_object ('ok', false, 'error', 'reason_required');
  end if;
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_shop');
  end if;
  -- Enable and disable only. Trial/rejected stay owned by the merchant request flow.
  if v_status not in ('active', 'none') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  select sh.organization_id into v_org from public.shops sh where sh.id = p_shop_id;
  if v_org is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  -- A tier may only be assigned when it exists AND is active, so an admin cannot park an
  -- organization on a tier the resolver would silently ignore.
  if v_plan is not null then
    if not exists (select 1 from public.loyalty_plan_tiers t where t.code = v_plan) then
      return jsonb_build_object ('ok', false, 'error', 'tier_not_found');
    end if;
    if not exists (select 1 from public.loyalty_plan_tiers t where t.code = v_plan and t.is_active) then
      return jsonb_build_object ('ok', false, 'error', 'tier_inactive');
    end if;
  end if;

  select to_jsonb (e) into v_before
  from public.organization_feature_entitlements e
  where e.organization_id = v_org and e.feature_code = 'loyalty';

  -- Upsert the entitlement row ONLY. Members, points, rewards, redemptions, enrollment
  -- history and Wallet identity are untouched and remain intact across disable/enable.
  -- Disabling preserves plan_code so re-enabling restores the same tier.
  insert into public.organization_feature_entitlements (
    organization_id, feature_code, status, plan_code, approved_at, approved_by
  )
  values (
    v_org, 'loyalty', v_status, v_plan,
    case when v_status = 'active' then now () else null end,
    case when v_status = 'active' then auth.uid () else null end
  )
  on conflict (organization_id, feature_code) do update
  set status = excluded.status,
      plan_code = coalesce (excluded.plan_code, public.organization_feature_entitlements.plan_code),
      approved_at = case when excluded.status = 'active' then now () else public.organization_feature_entitlements.approved_at end,
      approved_by = case when excluded.status = 'active' then auth.uid () else public.organization_feature_entitlements.approved_by end,
      updated_at = now ();

  select to_jsonb (e) into v_after
  from public.organization_feature_entitlements e
  where e.organization_id = v_org and e.feature_code = 'loyalty';

  insert into public.internal_ops_admin_audit (actor, action, target_shop_id, target_org_id, payload)
  values (auth.uid (), 'loyalty_shop_entitlement_set', p_shop_id, v_org, jsonb_build_object (
    'target_type', 'organization_feature_entitlement',
    'target_id', v_org::text || ':loyalty',
    'before', v_before,
    'after', v_after,
    'reason', v_reason,
    'at', now ()
  ));

  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);

  return jsonb_build_object (
    'ok', true,
    'organization_id', v_org,
    'usage', public.shop_loyalty_usage (p_shop_id),
    'loyalty_enabled', v_ent.loyalty_enabled,
    'tier_code', v_ent.tier_code,
    'member_limit', v_ent.member_limit
  );
end;
$fn$;

-- ============================================================================
-- 4) Grants for the new surface
-- ============================================================================
-- The guard lives INSIDE each function, so these stay authenticated-executable exactly like
-- the existing internal_ops_* RPCs. The two read helpers are internal-only: the
-- merchant-facing equivalent of shop state is shop_loyalty_usage, which has its own check.

do $gr$
begin
  execute 'revoke all on function public.internal_ops_loyalty_create_plan (text, text, integer, bigint, bigint, integer, text) from public';
  execute 'revoke all on function public.internal_ops_loyalty_update_plan (text, text, integer, bigint, bigint, integer, text) from public';
  execute 'revoke all on function public.internal_ops_loyalty_set_plan_active (text, boolean, text) from public';
  execute 'revoke all on function public.internal_ops_loyalty_set_shop_entitlement (uuid, text, text, text) from public';
  execute 'revoke all on function public.internal_ops_loyalty_plan_impact (text, integer) from public';
  execute 'revoke all on function public.internal_ops_loyalty_shop_state (uuid) from public';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.internal_ops_loyalty_create_plan (text, text, integer, bigint, bigint, integer, text) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_update_plan (text, text, integer, bigint, bigint, integer, text) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_set_plan_active (text, boolean, text) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_set_shop_entitlement (uuid, text, text, text) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_plan_impact (text, integer) from anon';
    execute 'revoke all on function public.internal_ops_loyalty_shop_state (uuid) from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.internal_ops_loyalty_create_plan (text, text, integer, bigint, bigint, integer, text) to authenticated';
    execute 'grant execute on function public.internal_ops_loyalty_update_plan (text, text, integer, bigint, bigint, integer, text) to authenticated';
    execute 'grant execute on function public.internal_ops_loyalty_set_plan_active (text, boolean, text) to authenticated';
    execute 'grant execute on function public.internal_ops_loyalty_set_shop_entitlement (uuid, text, text, text) to authenticated';
    -- The read helpers are callable by an authenticated internal admin (their guard is
    -- inside, and an internal admin is not a member of the merchant's shop, so the
    -- merchant-scoped shop_loyalty_usage cannot serve them). Non-admins get `forbidden`.
    execute 'grant execute on function public.internal_ops_loyalty_plan_impact (text, integer) to authenticated';
    execute 'grant execute on function public.internal_ops_loyalty_shop_state (uuid) to authenticated';
  end if;
end;
$gr$;

-- ============================================================================
-- 5) Privilege hardening (Phase 6 audit findings A-D)
-- ============================================================================

-- 5A) Cross-shop reads. These three resolvers are called ONLY by other SECURITY DEFINER
-- functions and triggers, never by the client (the merchant UI reads shop_loyalty_usage),
-- so authenticated EXECUTE is removed outright rather than guarded. Definer callers run as
-- the owner and are unaffected, including the service-role public-enrollment path.
do $h1$
begin
  execute 'revoke all on function public.resolve_shop_loyalty_entitlement (uuid) from authenticated';
  execute 'revoke all on function public.count_shop_active_loyalty_members (uuid) from authenticated';
  execute 'revoke all on function public.loyalty_plan_tier_limit (text) from authenticated';
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.resolve_shop_loyalty_entitlement (uuid) to service_role';
    execute 'grant execute on function public.count_shop_active_loyalty_members (uuid) to service_role';
    execute 'grant execute on function public.loyalty_plan_tier_limit (text) to service_role';
  end if;
end;
$h1$;

-- shop_loyalty_usage IS merchant-facing (src/lib/loyalty/loyaltyUsage.ts), so it keeps its
-- grant and gains the shop-access check it should always have had. A null auth.uid() means
-- a service-role/server context (Edge, triggers, internal RPCs that already authorized),
-- which is allowed through; an authenticated caller must have access to that shop.
create or replace function public.shop_loyalty_usage (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ent record;
  v_count integer;
  v_pending integer;
  v_percent integer;
  v_queue_limit integer;
begin
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'invalid_shop');
  end if;

  -- An internal admin is not a member of the merchant's shop, so the merchant check alone
  -- would lock them out of the very figures this function feeds (internal_ops_loyalty_
  -- shop_state and the entitlement RPC return it). Internal staff on the control-plane
  -- allowlist may read it; a merchant still may not read another shop's.
  if auth.uid () is not null
     and not public.user_can_access_shop (p_shop_id)
     and not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  v_count := public.count_shop_active_loyalty_members (p_shop_id);
  select count (*)::integer into v_pending
  from public.loyalty_enrollment_requests r
  where r.shop_id = p_shop_id and r.status = 'pending';
  v_percent := case
    when coalesce (v_ent.member_limit, 0) <= 0 then 0
    else least (100, round (v_count::numeric * 100 / v_ent.member_limit)::integer)
  end;
  v_queue_limit := greatest (1, coalesce ((public.loyalty_enrollment_settings () ->> 'pending_queue_limit')::integer, 50));

  return jsonb_build_object (
    'ok', true,
    'loyalty_enabled', v_ent.loyalty_enabled,
    'entitlement_status', v_ent.entitlement_status,
    'tier_code', v_ent.tier_code,
    'tier_name', v_ent.tier_name,
    'member_limit', v_ent.member_limit,
    'active_members', v_count,
    'remaining', greatest (0, coalesce (v_ent.member_limit, 0) - v_count),
    'at_limit', v_ent.loyalty_enabled and v_count >= coalesce (v_ent.member_limit, 0),
    'pending_requests', v_pending,
    'usage_percent', v_percent,
    'pending_queue_limit', v_queue_limit,
    'pending_queue_full', v_pending >= v_queue_limit
  );
end;
$fn$;

do $h1b$
begin
  execute 'revoke all on function public.shop_loyalty_usage (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shop_loyalty_usage (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.shop_loyalty_usage (uuid) to authenticated';
  end if;
end;
$h1b$;

-- 5B) Plan catalog: the internal RPCs are the ONLY write path. Nothing in src/ or the Edge
-- functions reads this table, so SELECT is kept (harmless catalog data) and all DML is
-- revoked - including the residual grants inherited from 010_grants.sql default privileges.
revoke insert, update, delete on public.loyalty_plan_tiers from authenticated;
revoke insert, update, delete on public.loyalty_plan_tiers from anon;
revoke insert, update, delete on public.loyalty_plan_tiers from public;

-- 5C) Entitlements: no direct browser mutation. Revoking the grants closes the PostgREST
-- path outright; narrowing the policy from `for all` to `for select` additionally removes
-- the latent capability, so a future accidental re-grant cannot reopen it. SECURITY DEFINER
-- writers (internal_ops_activate_ai_stock_assistant and the new loyalty RPCs) run as the
-- table owner and are unaffected.
revoke insert, update, delete on public.organization_feature_entitlements from authenticated;
revoke insert, update, delete on public.organization_feature_entitlements from anon;
revoke insert, update, delete on public.organization_feature_entitlements from public;

drop policy if exists org_feature_entitlements_internal_all on public.organization_feature_entitlements;
drop policy if exists org_feature_entitlements_internal_select on public.organization_feature_entitlements;
create policy org_feature_entitlements_internal_select
  on public.organization_feature_entitlements for select
  using (public.is_waka_internal_staff ());

-- 5D) loyalty_programs: every legitimate mutation already goes through
-- loyalty_update_program() (SECURITY DEFINER); no client code writes the table (verified:
-- src/lib/loyalty/loyaltyClient.ts only selects). Remove the residual direct write path.
revoke insert, update, delete on public.loyalty_programs from authenticated;
revoke insert, update, delete on public.loyalty_programs from anon;
revoke insert, update, delete on public.loyalty_programs from public;

drop policy if exists loyalty_programs_write on public.loyalty_programs;
drop policy if exists loyalty_programs_update on public.loyalty_programs;

-- 5E) Functions that were never revoked from PUBLIC. None of them needs anonymous access:
-- the public card and public enrollment reach the database through the service-role Edge
-- functions, not through these. Explicit `authenticated` grants are preserved.
do $h2$
declare
  v_sigs text[] := array[
    'public.loyalty_enroll_customer (uuid, uuid, boolean, text, jsonb)',
    'public.loyalty_adjust_points (uuid, integer, text)',
    'public.loyalty_shop_overview (uuid)',
    'public.loyalty_update_program (uuid, boolean, bigint, integer, bigint, text, date, integer, text, integer)',
    'public.loyalty_account_by_token (uuid, text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure (v_sig) is not null then
      execute format ('revoke all on function %s from public', v_sig);
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format ('revoke all on function %s from anon', v_sig);
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format ('grant execute on function %s to authenticated', v_sig);
      end if;
    end if;
  end loop;
end;
$h2$;
