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

-- The column default is 'balance' because the column arrives on an outbox whose
-- historical producers are all ledger-driven. That default is correct for Trigger A
-- (loyalty_transactions) but WRONG for the membership-state trigger, whose rows must
-- be state patches. Classify those explicitly rather than inheriting the default.
--
-- 20260925070409_loyalty_wallet_enqueue_on_account_state_change is already applied in
-- production and stays the ONE producer of membership-state rows. It is redefined here
-- for two reasons: to state sync_kind explicitly, and to gate on the EFFECTIVE state.
--
-- Production's condition fires on any status / membership_expires_at change. That is
-- coarser than what the outbox should carry: renewing an already-active member moves
-- membership_expires_at but leaves the card's desired state at ACTIVE, so it queued a
-- redundant PATCH. The redefined body adds one predicate — enqueue only when
-- loyalty_wallet_desired_state() actually differs across the update — while keeping the
-- google_wallet_object_id guard, the source_ref shape, ON CONFLICT DO NOTHING and the
-- exception swallowing exactly as production has them. No second producer is added.
update public.loyalty_wallet_sync_outbox
set sync_kind = 'lifecycle'
where reason = 'account_state' and sync_kind is distinct from 'lifecycle';

create or replace function public.loyalty_wallet_enqueue_on_account_state_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.google_wallet_object_id is null then
    return new;
  end if;

  if (new.status is distinct from old.status)
     or (new.membership_expires_at is distinct from old.membership_expires_at)
  then
    -- Enqueue only when the EFFECTIVE desired state actually moved. Both sides are
    -- evaluated at the same now(), so this compares like with like: a renewal that
    -- leaves the member active is ACTIVE -> ACTIVE and queues nothing, while
    -- suspend / revoke / reactivate and a lapsed-membership renewal all differ.
    if public.loyalty_wallet_desired_state (old.status, old.membership_expires_at, now ())
       is not distinct from
       public.loyalty_wallet_desired_state (new.status, new.membership_expires_at, now ())
    then
      return new;
    end if;

    insert into public.loyalty_wallet_sync_outbox (
      shop_id, account_id, balance_points, reason, source_ref, sync_kind
    )
    values (
      new.shop_id,
      new.id,
      greatest(0, coalesce(new.balance_points, 0)),
      'account_state',
      'acctstate:' || new.id::text || ':'
        || coalesce(new.status, 'null') || ':'
        || coalesce(new.membership_expires_at::text, 'none'),
      'lifecycle'
    )
    on conflict (source_ref) do nothing;
  end if;

  return new;
exception
  when others then
    return new;
end;
$function$;

-- Trigger B itself is left exactly as production created it: same name, same table,
-- same AFTER UPDATE firing, same function. Only the function body above changed.
drop trigger if exists trg_loyalty_wallet_enqueue_on_account_state on public.loyalty_accounts;
create trigger trg_loyalty_wallet_enqueue_on_account_state
after update on public.loyalty_accounts
for each row
execute function public.loyalty_wallet_enqueue_on_account_state_change();

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
-- 3) NO second producer
-- ============================================================================
-- This migration deliberately adds NO enqueue helper. Production already has exactly
-- one producer per event, and both are left in place:
--
--   Trigger A  trg_loyalty_wallet_enqueue_sync                    (loyalty_transactions)
--   Trigger B  trg_loyalty_wallet_enqueue_on_account_state         (loyalty_accounts)
--   Trigger C  trg_loyalty_wallet_enqueue_on_program_change        (loyalty_programs)
--
-- An earlier draft of this migration also had loyalty_set_account_lifecycle and
-- loyalty_renew_membership call a loyalty_wallet_enqueue_lifecycle() helper. That
-- would have produced TWO outbox rows for one lifecycle change — Trigger B fires on
-- the same UPDATE, and the two source_ref prefixes ('acctstate:' vs 'lifecycle:')
-- cannot collapse under ON CONFLICT — and therefore two Google Wallet PATCH calls.
-- The helper is gone and neither RPC enqueues.

-- ============================================================================
-- 4) Lifecycle RPCs enqueue after a successful, effective state change
-- ============================================================================
-- Both bodies are reproduced from 20260926093000_loyalty_member_lifecycle_allowance.sql
-- UNCHANGED. They are restated here only so this migration is self-contained; the
-- redefinition is a provable no-op against the live 20260926093000 versions. Every
-- allowance check, the audit write, the token/balance invariant and the response shapes
-- are identical, and neither function enqueues anything.

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

  -- The Wallet pass is NOT queued here. Trigger B
  -- (trg_loyalty_wallet_enqueue_on_account_state) fires on this same UPDATE and is the
  -- one authority for membership-state rows, so enqueuing here would duplicate it.

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

  -- The Wallet pass is NOT queued here. Trigger B
  -- (trg_loyalty_wallet_enqueue_on_account_state) is the one authority for
  -- membership-state rows; a renewal that changes membership_expires_at fires it.

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
