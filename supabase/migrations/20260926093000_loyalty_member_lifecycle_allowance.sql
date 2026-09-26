-- WAKA Loyalty — Phase 3: merchant management of membership lifecycle.
--
-- Phase 1 put a member allowance on loyalty_accounts INSERT. Reactivating a suspended
-- member, or renewing an expired one, reaches the SAME state through UPDATE — so those
-- paths could push a shop past its allowance, and the browser could not be trusted to
-- prevent it. This migration closes that gap on the server:
--
--   1. a BEFORE UPDATE guard on loyalty_accounts, symmetric with the Phase 1 insert
--      guard, so EVERY update path is covered (including any added later);
--   2. explicit allowance checks in loyalty_set_account_lifecycle (reactivate) and
--      loyalty_renew_membership (renewing an expired member), so the merchant gets a
--      clean, translatable error instead of a raised exception;
--   3. shop_loyalty_usage extended with pending_requests and usage_percent, so the
--      Overview reads ONE authoritative usage call (no second counter to drift).
--
-- Only a false → true membership-active transition consumes a slot. Suspend, revoke,
-- balance-only updates and renewing an already-active member are unaffected, which is
-- what keeps the ledger trigger's frequent `update loyalty_accounts set balance_points`
-- free of any new work beyond one cheap boolean test.
--
-- Not touched: sale finalization, inventory, the loyalty ledger and its trigger, points
-- and redemption calculations, void/return, Google Wallet issuer/class/JWT.
--
-- Depends on: 20260926090000 (entitlement, allowance, advisory lock seed 2).

-- ============================================================================
-- 1) Allowance guard for UPDATE paths (backstop for every writer)
-- ============================================================================

create or replace function public.trg_loyalty_accounts_member_limit_update ()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ent record;
  v_count integer;
begin
  -- Only a transition INTO an active membership consumes a slot. A balance-only update,
  -- a suspend, a revoke, or a renewal of an already-active member all leave this false.
  if not public.loyalty_account_membership_active (new.status, new.membership_expires_at, now ()) then
    return new;
  end if;
  if public.loyalty_account_membership_active (old.status, old.membership_expires_at, now ()) then
    return new;
  end if;

  perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (new.shop_id));

  select * into v_ent from public.resolve_shop_loyalty_entitlement (new.shop_id);
  if not v_ent.loyalty_enabled then
    raise exception 'loyalty_not_enabled'
      using errcode = 'P0001',
            detail = format ('shop=%s status=%s', new.shop_id, v_ent.entitlement_status);
  end if;

  v_count := public.count_shop_active_loyalty_members (new.shop_id);
  if coalesce (v_ent.member_limit, 0) <= 0 or v_count >= v_ent.member_limit then
    raise exception 'loyalty_member_limit_reached'
      using errcode = 'P0001',
            detail = format ('shop=%s tier=%s limit=%s active=%s',
                             new.shop_id, v_ent.tier_code, v_ent.member_limit, v_count);
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_accounts_member_limit_update on public.loyalty_accounts;
create trigger trg_loyalty_accounts_member_limit_update
  before update on public.loyalty_accounts
  for each row execute function public.trg_loyalty_accounts_member_limit_update ();

do $gr$
begin
  execute 'revoke all on function public.trg_loyalty_accounts_member_limit_update () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.trg_loyalty_accounts_member_limit_update () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.trg_loyalty_accounts_member_limit_update () from authenticated';
  end if;
end;
$gr$;

-- ============================================================================
-- 2) One authoritative usage call: allowance + usage + pending requests
-- ============================================================================
-- Body reproduced from 20260926090000_loyalty_membership_entitlements.sql with the
-- pending-request count, usage percentage and their two declarations added. Nothing
-- else changed.

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
begin
  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  v_count := public.count_shop_active_loyalty_members (p_shop_id);
  select count(*)::integer into v_pending
  from public.loyalty_enrollment_requests r
  where r.shop_id = p_shop_id and r.status = 'pending';
  v_percent := case
    when coalesce (v_ent.member_limit, 0) <= 0 then 0
    else least (100, round (v_count::numeric * 100 / v_ent.member_limit)::integer)
  end;
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
    'usage_percent', v_percent
  );
end;
$fn$;

-- ============================================================================
-- 3) Reactivation must respect the allowance
-- ============================================================================
-- Body reproduced verbatim from 20260924160000_loyalty_customer_lifecycle.sql:240-355
-- with exactly three additions: the declaration, the allowance gate above the reactivate
-- UPDATE, and the lifecycle audit write before the final re-read. Suspend, revoke, the
-- already-* short-circuits, the token/balance invariant check and the response shape are
-- byte-for-byte unchanged (verified by strip-and-compare against the original).
--
-- The audit write exists because membership state changes recorded NO actor anywhere
-- before this — the ledger audits points, not lifecycle. It uses the account's existing
-- metadata column rather than introducing a second audit-log architecture.

create or replace function public.loyalty_set_account_lifecycle (
  p_shop_id uuid,
  p_account_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_account public.loyalty_accounts%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_token text;
  v_balance integer;
  v_revoked_at timestamptz;
  v_purge timestamptz;
  v_ent record;
  v_active integer;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_action not in ('suspend', 'reactivate', 'revoke') then
    return jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  v_token := v_account.public_card_token;
  v_balance := v_account.balance_points;

  if v_action = 'suspend' then
    if v_account.status = 'revoked' then
      return jsonb_build_object('ok', false, 'error', 'account_revoked');
    end if;
    if v_account.status = 'suspended' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'suspended',
        'already', true
      );
    end if;
    update public.loyalty_accounts
    set status = 'suspended',
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;

  elsif v_action = 'reactivate' then
    if v_account.status = 'revoked' then
      return jsonb_build_object('ok', false, 'error', 'account_revoked');
    end if;
    if v_account.status = 'active' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'active',
        'already', true
      );
    end if;
    if v_account.status <> 'suspended' then
      return jsonb_build_object('ok', false, 'error', 'invalid_status');
    end if;
    -- Phase 3: a reactivation that actually restores an ACTIVE membership consumes an
    -- allowance slot, so it is checked here (clean error) and backstopped by
    -- trg_loyalty_accounts_member_limit_update for every other update path.
    if public.loyalty_account_membership_active ('active', v_account.membership_expires_at, now ()) then
      select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
      if not v_ent.loyalty_enabled then
        return jsonb_build_object('ok', false, 'error', 'loyalty_not_enabled',
                                  'entitlement_status', v_ent.entitlement_status);
      end if;
      perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (p_shop_id));
      v_active := public.count_shop_active_loyalty_members (p_shop_id);
      if coalesce (v_ent.member_limit, 0) <= 0 or v_active >= v_ent.member_limit then
        return jsonb_build_object('ok', false, 'error', 'loyalty_member_limit_reached',
                                  'tier_code', v_ent.tier_code,
                                  'member_limit', v_ent.member_limit,
                                  'active_count', v_active);
      end if;
    end if;
    update public.loyalty_accounts
    set status = 'active',
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;

  else -- revoke
    if v_account.status = 'revoked' then
      return jsonb_build_object(
        'ok', true,
        'account_id', v_account.id,
        'status', 'revoked',
        'revoked_at', v_account.revoked_at,
        'purge_after', v_account.purge_after,
        'already', true
      );
    end if;
    v_revoked_at := now();
    v_purge := v_revoked_at + interval '30 days';
    update public.loyalty_accounts
    set status = 'revoked',
        revoked_at = v_revoked_at,
        purge_after = v_purge,
        updated_at = now()
    where id = v_account.id and shop_id = p_shop_id;
  end if;

  -- Phase 3 audit trail: record WHO changed the membership and when. No lifecycle audit
  -- existed before; rather than a second audit-log architecture, the account's existing
  -- metadata jsonb carries a bounded trail of the last 10 real transitions. The
  -- token/balance invariant check below still proves nothing else was touched.
  update public.loyalty_accounts
  set metadata = jsonb_set (
        coalesce (metadata, '{}'::jsonb),
        '{lifecycle_history}',
        case
          -- `jsonb -> -n` returns NULL when the array is shorter than n, which would
          -- blank the column, so slice only once the trail is genuinely over length.
          when jsonb_array_length (coalesce (metadata -> 'lifecycle_history', '[]'::jsonb)) >= 10
            then (coalesce (metadata -> 'lifecycle_history', '[]'::jsonb)
                  || jsonb_build_object ('action', v_action, 'at', now (), 'by', auth.uid ())) -> -10
          else coalesce (metadata -> 'lifecycle_history', '[]'::jsonb)
               || jsonb_build_object ('action', v_action, 'at', now (), 'by', auth.uid ())
        end,
        true
      )
  where id = v_account.id and shop_id = p_shop_id;

  select * into v_account from public.loyalty_accounts where id = p_account_id;

  if v_account.public_card_token is distinct from v_token
     or v_account.balance_points is distinct from v_balance then
    raise exception 'loyalty_set_account_lifecycle mutated token or balance';
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'status', v_account.status,
    'revoked_at', v_account.revoked_at,
    'purge_after', v_account.purge_after,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at),
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'balance_points', v_account.balance_points
  );
end;
$fn$;

revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from public;
do $g3$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_set_account_lifecycle (uuid, uuid, text) to authenticated';
  end if;
end;
$g3$;

-- ============================================================================
-- 4) Renewing an expired membership must respect the allowance too
-- ============================================================================
-- Body reproduced verbatim from 20260924160000_loyalty_customer_lifecycle.sql:362-453
-- with the declaration and the gate above the expiry UPDATE. Renewing a member who is
-- already active, or a suspended member, consumes no slot and is unchanged.

create or replace function public.loyalty_renew_membership (
  p_shop_id uuid,
  p_account_id uuid,
  p_mode text default null,
  p_fixed_expires_on date default null,
  p_duration_months integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account public.loyalty_accounts%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_mode text;
  v_fixed date;
  v_months integer;
  v_expires timestamptz;
  v_token text;
  v_balance integer;
  v_ent record;
  v_active integer;
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_account
  from public.loyalty_accounts
  where id = p_account_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if v_account.status = 'revoked' then
    return jsonb_build_object('ok', false, 'error', 'account_revoked');
  end if;

  v_token := v_account.public_card_token;
  v_balance := v_account.balance_points;

  if p_mode is null or btrim(p_mode) = '' then
    select * into v_program from public.loyalty_programs where shop_id = p_shop_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'program_not_found');
    end if;
    v_mode := v_program.membership_expiry_mode;
    v_fixed := v_program.membership_fixed_expires_on;
    v_months := v_program.membership_duration_months;
  else
    v_mode := lower(btrim(p_mode));
    v_fixed := p_fixed_expires_on;
    v_months := p_duration_months;
  end if;

  if v_mode not in ('never', 'fixed_date', 'duration') then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_mode');
  end if;
  if v_mode = 'fixed_date' and v_fixed is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_fixed_date');
  end if;
  if v_mode = 'duration' and (v_months is null or v_months <= 0) then
    return jsonb_build_object('ok', false, 'error', 'invalid_membership_duration');
  end if;

  v_expires := public.loyalty_compute_membership_expires_at(v_mode, v_fixed, v_months, now());

  -- Phase 3: renewing an EXPIRED membership restores an active member and consumes an
  -- allowance slot. Renewing an already-active or suspended member does not.
  if public.loyalty_account_membership_active (v_account.status, v_expires, now ())
     and not public.loyalty_account_membership_active (v_account.status, v_account.membership_expires_at, now ()) then
    select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
    if not v_ent.loyalty_enabled then
      return jsonb_build_object('ok', false, 'error', 'loyalty_not_enabled',
                                'entitlement_status', v_ent.entitlement_status);
    end if;
    perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (p_shop_id));
    v_active := public.count_shop_active_loyalty_members (p_shop_id);
    if coalesce (v_ent.member_limit, 0) <= 0 or v_active >= v_ent.member_limit then
      return jsonb_build_object('ok', false, 'error', 'loyalty_member_limit_reached',
                                'tier_code', v_ent.tier_code,
                                'member_limit', v_ent.member_limit,
                                'active_count', v_active);
    end if;
  end if;

  update public.loyalty_accounts
  set membership_expires_at = v_expires,
      updated_at = now()
  where id = v_account.id
    and shop_id = p_shop_id;

  select * into v_account from public.loyalty_accounts where id = p_account_id;

  if v_account.public_card_token is distinct from v_token
     or v_account.balance_points is distinct from v_balance then
    raise exception 'loyalty_renew_membership mutated token or balance';
  end if;

  return jsonb_build_object(
    'ok', true,
    'account_id', v_account.id,
    'membership_expires_at', v_account.membership_expires_at,
    'membership_expires_on', public.loyalty_membership_expires_on_date(v_account.membership_expires_at),
    'membership_active', public.loyalty_account_membership_active(
      v_account.status, v_account.membership_expires_at, now()
    ),
    'balance_points', v_account.balance_points,
    'status', v_account.status
  );
end;
$function$;

revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from public;
do $g4$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) to authenticated';
  end if;
end;
$g4$;
