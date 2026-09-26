-- WAKA Loyalty - Phase 5: Google Wallet follows the membership lifecycle.
--
-- Until now the outbox had exactly one producer: the ledger insert trigger, which keeps
-- the pass's points balance current. Nothing propagated a MEMBERSHIP change, so a pass
-- issued while a member was active stayed ACTIVE after suspension or revocation — the
-- merchant UI told the truth while the customer's phone did not.
--
-- This migration adds lifecycle synchronization to the EXISTING outbox rather than a
-- second queue:
--
--   1. `sync_kind` discriminates 'balance' (unchanged sale path) from 'lifecycle'.
--   2. The lifecycle RPCs enqueue a lifecycle row AFTER a successful state change and
--      ONLY when the effective membership state actually changed. A refused operation
--      (e.g. reactivation blocked by the member allowance) or an idempotent no-op
--      enqueues nothing.
--   3. `loyalty_wallet_desired_state` is the ONE definition of membership state -> Wallet
--      state, and it is derived from the authoritative `loyalty_account_membership_active`
--      so a lazily-expired membership is reported as EXPIRED without any scheduler.
--   4. `google_wallet_sync_state` records the last state pushed, so the worker patches
--      only when it drifted (no redundant Google calls, and expiry self-heals on the
--      next sync for that account).
--
-- NOT changed: issuer ID, class ID, class resource, service account, JWT claims, object
-- identity (`{issuerId}.acct_{account_uuid}`), pass layout, the balance sync path, and
-- the loyalty ledger. Enqueue is a database write only — no Google call happens inside a
-- lifecycle or sale transaction.
--
-- Depends on: 20260923120000 (outbox), 20260926093000 (lifecycle RPCs).

-- ============================================================================
-- 1) Outbox kind + last-synced Wallet state
-- ============================================================================

alter table public.loyalty_wallet_sync_outbox
  add column if not exists sync_kind text not null default 'balance'
  check (sync_kind in ('balance', 'lifecycle'));

comment on column public.loyalty_wallet_sync_outbox.sync_kind is
  'balance = ledger-driven points patch (sale path). lifecycle = membership-state patch.';

alter table public.loyalty_accounts
  add column if not exists google_wallet_sync_state text;

comment on column public.loyalty_accounts.google_wallet_sync_state is
  'Last membership state pushed to the Wallet object (ACTIVE/INACTIVE/EXPIRED).';

-- ============================================================================
-- 2) The single membership-state -> Wallet-state mapping
-- ============================================================================

create or replace function public.loyalty_wallet_desired_state (
  p_status text,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns text
language sql
stable
as $fn$
  select case
    when coalesce (p_status, '') <> 'active' then 'INACTIVE'
    when not public.loyalty_account_membership_active (p_status, p_expires_at, p_now) then 'EXPIRED'
    else 'ACTIVE'
  end;
$fn$;

comment on function public.loyalty_wallet_desired_state (text, timestamptz, timestamptz) is
  'Authoritative membership state -> Google Wallet object state. ACTIVE/INACTIVE/EXPIRED only.';

-- Reads the account and applies the mapping, so the worker never re-implements the rule.
create or replace function public.loyalty_wallet_state_for_account (p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select public.loyalty_wallet_desired_state (a.status, a.membership_expires_at, now ())
  from public.loyalty_accounts a
  where a.id = p_account_id;
$fn$;

do $gr$
begin
  execute 'revoke all on function public.loyalty_wallet_desired_state (text, timestamptz, timestamptz) from public';
  execute 'revoke all on function public.loyalty_wallet_state_for_account (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_wallet_desired_state (text, timestamptz, timestamptz) from anon';
    execute 'revoke all on function public.loyalty_wallet_state_for_account (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_wallet_desired_state (text, timestamptz, timestamptz) from authenticated';
    execute 'revoke all on function public.loyalty_wallet_state_for_account (uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_wallet_state_for_account (uuid) to service_role';
  end if;
end;
$gr$;

-- ============================================================================
-- 3) Lifecycle enqueue (idempotent, transaction-stable, no Google call)
-- ============================================================================

create or replace function public.loyalty_wallet_enqueue_lifecycle (
  p_shop_id uuid,
  p_account_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance integer;
  v_n integer;
begin
  if p_shop_id is null or p_account_id is null then
    return false;
  end if;

  -- The outbox requires a balance; carry the authoritative one unchanged. A lifecycle
  -- row never patches points, it only needs a value to satisfy the column.
  select greatest (0, coalesce (a.balance_points, 0))
    into v_balance
  from public.loyalty_accounts a
  where a.id = p_account_id and a.shop_id = p_shop_id;
  if not found then
    return false;
  end if;

  insert into public.loyalty_wallet_sync_outbox (
    shop_id, account_id, balance_points, reason, source_ref, sync_kind
  )
  values (
    p_shop_id,
    p_account_id,
    v_balance,
    coalesce (nullif (btrim (coalesce (p_reason, '')), ''), 'lifecycle'),
    -- now() is transaction-stable, so two enqueues inside one transaction collapse via
    -- the unique source_ref, while two separate transitions stay distinct and the last
    -- one wins. That is what makes suspend -> reactivate converge to ACTIVE.
    'lifecycle:' || p_account_id::text || ':' || now ()::text,
    'lifecycle'
  )
  on conflict (source_ref) do nothing;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

do $gl$
begin
  execute 'revoke all on function public.loyalty_wallet_enqueue_lifecycle (uuid, uuid, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_wallet_enqueue_lifecycle (uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_wallet_enqueue_lifecycle (uuid, uuid, text) from authenticated';
  end if;
end;
$gl$;

-- ============================================================================
-- 4) Lifecycle RPCs enqueue after a successful, effective state change
-- ============================================================================
-- Both bodies are reproduced from 20260926093000_loyalty_member_lifecycle_allowance.sql
-- with exactly three additions each: the `v_state_before` declaration, its capture from
-- the pre-change row, and the enqueue block. Every allowance check, the audit write, the
-- token/balance invariant and the response shapes are unchanged.

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
  v_state_before text;
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
  v_state_before := public.loyalty_wallet_state_for_account (v_account.id);

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

  -- Phase 5: Wallet state follows the authoritative membership state. Enqueued only
  -- after the change has actually committed inside this transaction, and only when the
  -- EFFECTIVE state changed — so a refused operation and an idempotent no-op (both of
  -- which return earlier) never queue Wallet work. Asynchronous: no Google call here.
  if public.loyalty_wallet_state_for_account (v_account.id) is distinct from v_state_before then
    perform public.loyalty_wallet_enqueue_lifecycle (p_shop_id, v_account.id, 'lifecycle_' || v_action);
  end if;

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

-- ============================================================================
-- 5) Renewal
-- ============================================================================

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
  v_state_before text;
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
  v_state_before := public.loyalty_wallet_state_for_account (v_account.id);

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

  -- Phase 5: a renewal that restores an active membership must reach the Wallet pass.
  -- Renewing an already-active member changes no effective state and queues nothing; a
  -- renewal refused by the allowance gate returns before this point.
  if public.loyalty_wallet_state_for_account (v_account.id) is distinct from v_state_before then
    perform public.loyalty_wallet_enqueue_lifecycle (p_shop_id, v_account.id, 'lifecycle_renewed');
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
revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from public;
do $g5$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_set_account_lifecycle (uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_set_account_lifecycle (uuid, uuid, text) to authenticated';
  end if;
end;
$g5$;

revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from public;
do $g6$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_renew_membership (uuid, uuid, text, date, integer) to authenticated';
  end if;
end;
$g6$;
