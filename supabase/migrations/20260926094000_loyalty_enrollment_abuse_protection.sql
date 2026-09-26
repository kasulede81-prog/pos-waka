-- WAKA Loyalty - Phase 4: public enrollment abuse protection + member status filtering.
--
-- Phase 2 made public enrollment a merchant-approved request. That left four holes this
-- migration closes, all server-side:
--
--   1. COOLDOWN - a rejected or expired request blocked a same-phone retry for a while.
--      Keyed on shop + NORMALISED PHONE, never on IP: mobile networks, shared Wi-Fi and
--      CGNAT put many legitimate customers behind one address, so an IP rule would
--      punish real shoppers. A client timer is never trusted.
--   2. BOUNDED PENDING QUEUE - a merchant's pending queue is capped, so the public
--      endpoint cannot accumulate unbounded rows. Pending is NOT charged against the
--      paid member allowance: active members remain the commercial count and the queue
--      is a separate bounded resource.
--   3. EXPIRY - pending requests used to sit forever. They now settle to 'expired'.
--      Settlement happens inside the public submit path and the merchant list path, so
--      the system is correct with or without a scheduled job; pg_cron is hygiene only.
--   4. MEMBER STATUS FILTER - applied SERVER-SIDE before the LIMIT, so the merchant
--      never receives a page of 100 members to filter in the browser.
--
-- Thresholds are CONFIGURABLE DATA in platform_settings (key
-- 'loyalty_enrollment_settings'), read through loyalty_enrollment_settings() with safe
-- defaults. No pricing, no billing, no plan coupling.
--
-- Also adds an explicit request state machine: only a pending request may move, and only
-- to approved / rejected / expired, so rejected->approved and friends are impossible
-- even by direct SQL.
--
-- Not touched: the member allowance architecture (active count, advisory lock, INSERT and
-- UPDATE guards, renewal guard), the loyalty ledger, points/redemption calculations,
-- sale finalization, inventory, void/return, and the Google Wallet issuer/class/JWT.
--
-- Depends on: 20260926090000, 20260926091000, 20260926093000.

-- ============================================================================
-- 1) Configurable thresholds (server-side data, not hard-coded logic)
-- ============================================================================

create or replace function public.loyalty_enrollment_settings ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select ps.value from public.platform_settings ps
      where ps.key = 'loyalty_enrollment_settings'),
    '{
      "cooldown_days": 3,
      "pending_queue_limit": 50,
      "pending_expiry_days": 30
    }'::jsonb
  );
$fn$;

do $gr$
begin
  execute 'revoke all on function public.loyalty_enrollment_settings () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_enrollment_settings () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_enrollment_settings () from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_enrollment_settings () to service_role';
  end if;
end;
$gr$;

-- Advisory-lock seed 3: the enrollment queue. Deliberately NOT the membership lock
-- (seed 2), so a public spammer can never block a merchant's approvals.
create or replace function public.loyalty_enrollment_queue_lock_key (p_shop_id uuid)
returns bigint
language sql
immutable
as $fn$
  select hashtextextended (p_shop_id::text, 3);
$fn$;

do $gk$
begin
  execute 'revoke all on function public.loyalty_enrollment_queue_lock_key (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_enrollment_queue_lock_key (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_enrollment_queue_lock_key (uuid) from authenticated';
  end if;
end;
$gk$;

-- ============================================================================
-- 2) Request state machine: 'expired' + explicit transitions
-- ============================================================================

do $sc$
declare
  v_con text;
begin
  -- Widen the status CHECK to admit 'expired'.
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'loyalty_enrollment_requests'
    and c.contype = 'c'
    and pg_get_constraintdef (c.oid) ilike '%status%'
    and pg_get_constraintdef (c.oid) ilike '%pending%';
  if v_con is not null then
    execute format ('alter table public.loyalty_enrollment_requests drop constraint %I', v_con);
  end if;
end;
$sc$;

alter table public.loyalty_enrollment_requests
  add constraint loyalty_enrollment_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired'));

-- Re-shape: an expired request is settled by the SYSTEM, so reviewed_at is set while
-- reviewed_by stays null, meaning "not a person".
do $sh$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'loyalty_enrollment_requests'
    and c.conname = 'loyalty_enrollment_requests_review_shape';
  if v_con is not null then
    execute format ('alter table public.loyalty_enrollment_requests drop constraint %I', v_con);
  end if;
end;
$sh$;

alter table public.loyalty_enrollment_requests
  add constraint loyalty_enrollment_requests_review_shape check (
    (status = 'pending' and reviewed_at is null and approved_loyalty_account_id is null)
    or (status = 'approved' and reviewed_at is not null and approved_loyalty_account_id is not null)
    or (status = 'rejected' and reviewed_at is not null and approved_loyalty_account_id is null)
    or (status = 'expired' and reviewed_at is not null and approved_loyalty_account_id is null)
  );

-- Transition guard: settled is settled. The only legal move is pending -> a terminal
-- state, so rejected->approved (etc.) is impossible for any writer, including a future
-- one that forgets to check.
create or replace function public.trg_loyalty_enrollment_request_transition ()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'loyalty_request_already_settled'
        using errcode = 'P0001',
              detail = format ('from=%s to=%s', old.status, new.status);
    end if;
    if new.status not in ('approved', 'rejected', 'expired') then
      raise exception 'loyalty_request_invalid_transition'
        using errcode = 'P0001',
              detail = format ('from=%s to=%s', old.status, new.status);
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_loyalty_enrollment_request_transition on public.loyalty_enrollment_requests;
create trigger trg_loyalty_enrollment_request_transition
  before update on public.loyalty_enrollment_requests
  for each row execute function public.trg_loyalty_enrollment_request_transition ();

do $gt$
begin
  execute 'revoke all on function public.trg_loyalty_enrollment_request_transition () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.trg_loyalty_enrollment_request_transition () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.trg_loyalty_enrollment_request_transition () from authenticated';
  end if;
end;
$gt$;

-- Targeted index: the expiry sweep and the queue count both filter (shop_id, status)
-- and now order by age, which the existing (shop_id, status, requested_at desc) index
-- cannot serve for an ASC age scan.
create index if not exists loyalty_enrollment_requests_expiry_idx
  on public.loyalty_enrollment_requests (shop_id, requested_at)
  where status = 'pending';

-- ============================================================================
-- 3) Stale-request expiry (server-side; correct with or without a cron job)
-- ============================================================================

create or replace function public.loyalty_expire_stale_enrollment_requests (p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days integer;
  v_count integer := 0;
begin
  if p_shop_id is null then
    return 0;
  end if;

  v_days := greatest (1, coalesce ((public.loyalty_enrollment_settings () ->> 'pending_expiry_days')::integer, 30));

  with due as (
    select r.id
    from public.loyalty_enrollment_requests r
    where r.shop_id = p_shop_id
      and r.status = 'pending'
      and r.requested_at <= now () - make_interval (days => v_days)
    order by r.requested_at asc
    limit 500
    for update skip locked
  )
  update public.loyalty_enrollment_requests t
  set status = 'expired',
      reviewed_at = now (),
      reviewed_by = null,
      updated_at = now ()
  from due
  where t.id = due.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

do $ge$
begin
  execute 'revoke all on function public.loyalty_expire_stale_enrollment_requests (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_expire_stale_enrollment_requests (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_expire_stale_enrollment_requests (uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_expire_stale_enrollment_requests (uuid) to service_role';
  end if;
end;
$ge$;

-- Hygiene only: correctness does not depend on this job, because the sweep also runs
-- inline in the public submit path and the merchant list path.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule ('waka-loyalty-expire-enrollment-requests');
    exception when others then
      null;
    end;
    perform cron.schedule (
      'waka-loyalty-expire-enrollment-requests',
      '35 3 * * *',
      'select public.loyalty_expire_stale_enrollment_requests (s.id) from public.shops s
        where exists (select 1 from public.loyalty_enrollment_requests r
                       where r.shop_id = s.id and r.status = ''pending'')'
    );
  end if;
end;
$cron$;

-- ============================================================================
-- 4) Public submit: stale sweep + cooldown + bounded queue
-- ============================================================================
-- Body reproduced from 20260926091000_loyalty_enrollment_requests.sql with the sweep,
-- the cooldown gate, the queue gate and their declarations added. Every validation, the
-- tenant derivation, the already-member handling and the duplicate semantics are
-- byte-for-byte unchanged.

create or replace function public.loyalty_request_enrollment (
  p_token text,
  p_name text,
  p_phone_e164 text,
  p_email text default null,
  p_consent_accepted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token text := lower (btrim (coalesce (p_token, '')));
  v_name text := btrim (coalesce (p_name, ''));
  v_phone text := btrim (coalesce (p_phone_e164, ''));
  v_email text := nullif (btrim (coalesce (p_email, '')), '');
  v_link public.loyalty_enrollment_links%rowtype;
  v_customer_id uuid;
  v_account public.loyalty_accounts%rowtype;
  v_request_id uuid;
  v_existing public.loyalty_enrollment_requests%rowtype;
  v_settings jsonb;
  v_cooldown_days integer;
  v_queue_limit integer;
  v_pending integer;
begin
  if v_token is null or v_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object ('ok', false, 'error', 'token_invalid');
  end if;
  if not coalesce (p_consent_accepted, false) then
    return jsonb_build_object ('ok', false, 'error', 'consent_required');
  end if;
  if char_length (v_name) < 2 or char_length (v_name) > 120 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_name');
  end if;
  if v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;
  if v_email is not null and (
    char_length (v_email) > 254
    or v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  ) then
    return jsonb_build_object ('ok', false, 'error', 'invalid_email');
  end if;

  -- Tenant identity comes from the link only; the caller never supplies shop_id.
  select * into v_link
  from public.loyalty_enrollment_links
  where token = v_token
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;
  if v_link.status is distinct from 'active' then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Do not collect requests for a shop that has not switched the program on.
  if not exists (
    select 1 from public.loyalty_programs lp
    where lp.shop_id = v_link.shop_id and lp.enabled
  ) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Nor for a shop with no active WAKA Loyalty entitlement: a queue nobody can
  -- approve would only mislead the customer.
  if not (select e.loyalty_enabled from public.resolve_shop_loyalty_entitlement (v_link.shop_id) e) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Phase 4: settle overdue pending requests first, so the queue count and the
  -- cooldown check below always see current state (no cron dependency).
  perform public.loyalty_expire_stale_enrollment_requests (v_link.shop_id);

  -- Match an existing customer for merchant context. Never create one here.
  select c.id into v_customer_id
  from public.customers c
  where c.shop_id = v_link.shop_id and c.phone_e164 = v_phone
  order by exists (
    select 1 from public.loyalty_accounts a
    where a.customer_id = c.id and a.shop_id = v_link.shop_id
  ) desc, c.created_at desc
  limit 1;

  if v_customer_id is not null then
    select * into v_account
    from public.loyalty_accounts
    where shop_id = v_link.shop_id and customer_id = v_customer_id
    for update;
    if found then
      if v_account.status = 'revoked' then
        return jsonb_build_object ('ok', false, 'error', 'account_revoked');
      end if;
      -- active or suspended: already a member — no request, no card, no enumeration.
      return jsonb_build_object ('ok', true, 'status', 'already_member');
    end if;
  end if;

  -- Idempotent: an existing pending request for this phone returns that state.
  select * into v_existing
  from public.loyalty_enrollment_requests
  where shop_id = v_link.shop_id and phone_e164 = v_phone and status = 'pending'
  limit 1;
  if found then
    return jsonb_build_object ('ok', true, 'status', 'pending', 'already_requested', true);
  end if;

  -- Phase 4 anti-abuse. Shop + NORMALISED PHONE is the identity: mobile networks, shared
  -- Wi-Fi and CGNAT put many legitimate customers behind one IP, so an IP-based rule
  -- would punish real shoppers. Enforced here, never by a client timer.
  v_settings := public.loyalty_enrollment_settings ();
  v_cooldown_days := greatest (0, coalesce ((v_settings ->> 'cooldown_days')::integer, 3));
  if v_cooldown_days > 0 and exists (
    select 1
    from public.loyalty_enrollment_requests r
    where r.shop_id = v_link.shop_id
      and r.phone_e164 = v_phone
      and r.status in ('rejected', 'expired')
      and r.reviewed_at is not null
      and r.reviewed_at > now () - make_interval (days => v_cooldown_days)
  ) then
    return jsonb_build_object ('ok', false, 'error', 'loyalty_enrollment_cooldown');
  end if;

  -- A bounded pending queue. Its own advisory-lock seed (3) so a public spammer can
  -- never block merchant approvals, which take the membership lock (seed 2).
  perform pg_advisory_xact_lock (public.loyalty_enrollment_queue_lock_key (v_link.shop_id));
  v_queue_limit := greatest (1, coalesce ((v_settings ->> 'pending_queue_limit')::integer, 50));
  select count(*)::integer into v_pending
  from public.loyalty_enrollment_requests r
  where r.shop_id = v_link.shop_id and r.status = 'pending';
  if v_pending >= v_queue_limit then
    return jsonb_build_object ('ok', false, 'error', 'loyalty_request_queue_full');
  end if;

  begin
    insert into public.loyalty_enrollment_requests (
      shop_id, customer_id, enrollment_link_id, name, phone_e164, email, status,
      consent_metadata, metadata
    )
    values (
      v_link.shop_id, v_customer_id, v_link.id, v_name, v_phone, v_email, 'pending',
      jsonb_build_object (
        'accepted', true,
        'accepted_at', now (),
        'note', 'public_enrollment_request'
      ),
      jsonb_build_object ('source', 'public_enrollment_link', 'link_id', v_link.id)
    )
    returning id into v_request_id;
  exception when unique_violation then
    -- Concurrent double-submit: the partial unique index won, this caller lost.
    -- Return the pending state rather than an error.
    return jsonb_build_object ('ok', true, 'status', 'pending', 'already_requested', true);
  end;

  return jsonb_build_object ('ok', true, 'status', 'pending', 'request_id', v_request_id);
end;
$fn$;
do $gp$
begin
  execute 'revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_request_enrollment (text, text, text, text, boolean) to service_role';
  end if;
end;
$gp$;

-- ============================================================================
-- 5) Merchant queue: settle stale rows, and accept the 'expired' filter
-- ============================================================================
-- Body reproduced from 20260926091000 with the inline sweep and 'expired' added to the
-- allowed filter values. Volatility changes stable -> volatile because it now writes.

create or replace function public.loyalty_list_enrollment_requests (
  p_shop_id uuid,
  p_status text default 'pending',
  p_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_limit integer := least (greatest (coalesce (p_limit, 100), 1), 200);
  v_status text := nullif (lower (btrim (coalesce (p_status, ''))), '');
  v_rows jsonb;
  v_usage jsonb;
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  -- Settle overdue pending requests for this shop before reporting, so the merchant's
  -- queue is accurate even if no cleanup job has run.
  perform public.loyalty_expire_stale_enrollment_requests (p_shop_id);
  if v_status is not null and v_status not in ('pending', 'approved', 'rejected', 'expired') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  select coalesce (jsonb_agg (row_json order by requested_at asc), '[]'::jsonb)
  into v_rows
  from (
    select
      r.requested_at,
      jsonb_build_object (
        'id', r.id,
        'name', r.name,
        'phone_e164', r.phone_e164,
        'email', r.email,
        'status', r.status,
        'requested_at', r.requested_at,
        'reviewed_at', r.reviewed_at,
        'rejection_reason', r.rejection_reason,
        'approved_loyalty_account_id', r.approved_loyalty_account_id,
        'matched_customer_id', r.customer_id
      ) as row_json
    from public.loyalty_enrollment_requests r
    where r.shop_id = p_shop_id
      and (v_status is null or r.status = v_status)
    order by r.requested_at asc
    limit v_limit
  ) t;

  select public.shop_loyalty_usage (p_shop_id) into v_usage;

  return jsonb_build_object (
    'ok', true,
    'requests', v_rows,
    'usage', v_usage
  );
end;
$fn$;
do $gl$
begin
  execute 'revoke all on function public.loyalty_list_enrollment_requests (uuid, text, integer) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_list_enrollment_requests (uuid, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_list_enrollment_requests (uuid, text, integer) to authenticated';
  end if;
end;
$gl$;

-- ============================================================================
-- 6) Member search: server-side status filter, applied before the LIMIT
-- ============================================================================
-- The 3-argument version is dropped rather than overloaded, so there is exactly one
-- candidate and no ambiguity. Body reproduced from 20260924160000:456-507 with the
-- status parameter, the filter predicate and a deterministic ORDER BY inside the LIMIT.
--
-- Filters: all | active | suspended | revoked | expired, where 'expired' is the
-- architecture's existing computed state (status active but membership not active),
-- not a stored status.

drop function if exists public.loyalty_search_accounts (uuid, text, integer);

create or replace function public.loyalty_search_accounts (
  p_shop_id uuid,
  p_query text default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
begin
  if not public.user_can_access_shop (p_shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- An unknown filter is a caller bug, not "show everything".
  if v_status is not null and v_status not in ('all', 'active', 'suspended', 'revoked', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  if v_status = 'all' then
    v_status := null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accounts', coalesce((
      select jsonb_agg(row_to_json(x) order by x.customer_name)
      from (
        select
          a.id,
          a.customer_id,
          a.status,
          a.balance_points,
          a.lifetime_earned_points,
          a.lifetime_redeemed_points,
          a.enrolled_at,
          a.membership_expires_at,
          a.revoked_at,
          a.purge_after,
          public.loyalty_account_membership_active(a.status, a.membership_expires_at, now()) as membership_active,
          public.loyalty_membership_expires_on_date(a.membership_expires_at) as membership_expires_on,
          c.name as customer_name,
          c.phone_e164 as customer_phone
        from public.loyalty_accounts a
        join public.customers c on c.id = a.customer_id
        where a.shop_id = p_shop_id
          and (
            p_query is null
            or btrim(p_query) = ''
            or c.name ilike '%' || btrim(p_query) || '%'
            or c.phone_e164 ilike '%' || btrim(p_query) || '%'
          )
          and (
            v_status is null
            or (v_status = 'active'
                and a.status = 'active'
                and public.loyalty_account_membership_active(a.status, a.membership_expires_at, now()))
            or (v_status = 'expired'
                and a.status = 'active'
                and not public.loyalty_account_membership_active(a.status, a.membership_expires_at, now()))
            or (v_status in ('suspended', 'revoked') and a.status = v_status)
          )
        -- Deterministic: the LIMIT must apply to a stable order, otherwise the page a
        -- merchant sees can change between identical searches.
        order by c.name asc, a.customer_id asc
        limit v_limit
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;
do $gs$
begin
  execute 'revoke all on function public.loyalty_search_accounts (uuid, text, text, integer) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_search_accounts (uuid, text, text, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_search_accounts (uuid, text, text, integer) to authenticated';
  end if;
end;
$gs$;

-- ============================================================================
-- 7) Usage also reports the pending-queue cap, so the merchant can see a full queue
-- ============================================================================
-- Body reproduced from 20260926093000 with the queue limit, its declaration and two
-- response keys added. Nothing else changed.

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
  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  v_count := public.count_shop_active_loyalty_members (p_shop_id);
  select count(*)::integer into v_pending
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
do $gu$
begin
  execute 'revoke all on function public.shop_loyalty_usage (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.shop_loyalty_usage (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.shop_loyalty_usage (uuid) to authenticated';
  end if;
end;
$gu$;
