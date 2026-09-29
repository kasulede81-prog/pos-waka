-- ============================================================================
-- WPL code resolution + code-based enrollment
-- ============================================================================
-- Two public entry points, BOTH reachable only through the existing loyalty-public Edge Function
-- architecture (service_role), never from a browser session:
--
--   loyalty_program_public_preview(p_code)      → safe merchant display payload, no ids
--   loyalty_request_enrollment_by_code(...)     → code → shop → the SAME request path as a token
--
-- The 64-hex enrollment-link token path is unchanged in behaviour. Its body is now shared with the
-- code path through `loyalty_request_enrollment_core`, which is an extraction, not a rewrite: the
-- token RPC performs identical validation in an identical order and produces identical results.
--
-- The client NEVER supplies shop_id / account_id on either path. On the token path the tenant comes
-- from the link; on the code path it comes from the resolved program. Both are server-side.

-- ============================================================================
-- 1) Rate-limit scope for the public code lookup
-- ============================================================================
-- The code is SHORT and therefore ENUMERABLE (WPL2026 followed by three digits), unlike every
-- existing 64-hex token. Rate limiting is not optional here; it is the control that keeps the
-- lookup from becoming a merchant directory.
do $rl$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'edge_rate_limit_buckets'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%scope%';
  if v_con is not null then
    execute format('alter table public.edge_rate_limit_buckets drop constraint %I', v_con);
  end if;
end;
$rl$;

alter table public.edge_rate_limit_buckets
  add constraint edge_rate_limit_buckets_scope_check
  check (scope in ('card_read', 'wallet_issue', 'enroll_join', 'enroll_submit', 'program_lookup'));

-- Body reproduced from 20260924170000 with 'program_lookup' added to the allowed scope list.
-- Nothing else changes.
create or replace function public.edge_rate_limit_consume (
  p_scope text,
  p_ip_hash text,
  p_token_hash text,
  p_ip_limit integer,
  p_ip_window_ms integer,
  p_token_limit integer,
  p_token_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now_ms bigint;
  v_ip_window_start timestamptz;
  v_token_window_start timestamptz;
  v_ip_window_start_ms bigint;
  v_token_window_start_ms bigint;
  v_ip_hash text;
  v_token_hash text;
  v_ip_ok boolean := true;
  v_token_ok boolean := true;
  v_retry integer := 1;
  v_row_count integer;
begin
  if p_scope is null
     or p_scope not in ('card_read', 'wallet_issue', 'enroll_join', 'enroll_submit', 'program_lookup')
  then
    return jsonb_build_object ('ok', false, 'error', 'invalid_scope');
  end if;

  perform public.edge_rate_limit_purge_expired (3_600_000);

  v_now_ms := (extract (epoch from clock_timestamp ()) * 1000)::bigint;

  v_ip_hash := nullif (btrim (coalesce (p_ip_hash, '')), '');
  v_token_hash := nullif (btrim (coalesce (p_token_hash, '')), '');

  if v_ip_hash is not null then
    if p_ip_limit is null or p_ip_limit < 1 or p_ip_window_ms is null or p_ip_window_ms < 1 then
      return jsonb_build_object ('ok', false, 'error', 'invalid_ip_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':ip:' || v_ip_hash, 0));
    v_ip_window_start_ms := (v_now_ms / p_ip_window_ms) * p_ip_window_ms;
    v_ip_window_start := to_timestamp (v_ip_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'ip', v_ip_hash, v_ip_window_start, p_ip_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_ip_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_ip_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_ip_window_start_ms + p_ip_window_ms) - v_now_ms) / 1000.0)::integer
      );
    end if;
  end if;

  if not v_ip_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  if v_token_hash is not null then
    if p_token_limit is null or p_token_limit < 1 or p_token_window_ms is null or p_token_window_ms < 1 then
      if v_ip_hash is not null and v_ip_ok then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
      return jsonb_build_object ('ok', false, 'error', 'invalid_token_limit');
    end if;
    perform pg_advisory_xact_lock (hashtextextended ('rl:' || p_scope || ':tok:' || v_token_hash, 0));
    v_token_window_start_ms := (v_now_ms / p_token_window_ms) * p_token_window_ms;
    v_token_window_start := to_timestamp (v_token_window_start_ms / 1000.0);
    v_row_count := null;

    insert into public.edge_rate_limit_buckets as b (
      scope, dim, key_hash, window_start, window_ms, count, updated_at
    )
    values (
      p_scope, 'token', v_token_hash, v_token_window_start, p_token_window_ms, 1, now ()
    )
    on conflict (scope, dim, key_hash, window_start) do update
      set count = b.count + 1,
          updated_at = now ()
      where b.count < p_token_limit
    returning b.count into v_row_count;

    if v_row_count is null then
      v_token_ok := false;
      v_retry := greatest (
        1,
        ceil (((v_token_window_start_ms + p_token_window_ms) - v_now_ms) / 1000.0)::integer
      );
      if v_ip_hash is not null and v_ip_ok then
        update public.edge_rate_limit_buckets
        set count = greatest (0, count - 1),
            updated_at = now ()
        where scope = p_scope
          and dim = 'ip'
          and key_hash = v_ip_hash
          and window_start = v_ip_window_start;
      end if;
    end if;
  end if;

  if not v_token_ok then
    return jsonb_build_object (
      'ok', false,
      'error', 'rate_limited',
      'retry_after_seconds', v_retry
    );
  end if;

  return jsonb_build_object ('ok', true);
end;
$fn$;

revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from public;
revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from anon;
revoke all on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) from authenticated;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.edge_rate_limit_consume (text, text, text, integer, integer, integer, integer) to service_role;
  end if;
end;
$g$;

-- ============================================================================
-- 2) Shared request core — the tenant is a PARAMETER, never a caller's choice
-- ============================================================================
-- Extracted verbatim from loyalty_request_enrollment (20260926094000) with three substitutions:
--   v_link.shop_id  → p_shop_id
--   v_link.id       → p_enrollment_link_id   (NULL on the code path; the column is nullable)
--   metadata source → p_source               ('public_enrollment_link' on the token path, so the
--                                             stored metadata is byte-identical to before)
-- Every guard below is the original one: program enabled, WAKA Loyalty entitlement, stale-request
-- settlement, customer match, idempotency, cooldown, bounded queue, and the unique-violation
-- handler. Internal only.
create or replace function public.loyalty_request_enrollment_core (
  p_shop_id uuid,
  p_enrollment_link_id uuid,
  p_source text,
  p_name text,
  p_phone_e164 text,
  p_email text,
  p_consent_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text := btrim (coalesce (p_name, ''));
  v_phone text := btrim (coalesce (p_phone_e164, ''));
  v_email text := nullif (btrim (coalesce (p_email, '')), '');
  v_customer_id uuid;
  v_account public.loyalty_accounts%rowtype;
  v_request_id uuid;
  v_existing public.loyalty_enrollment_requests%rowtype;
  v_settings jsonb;
  v_cooldown_days integer;
  v_queue_limit integer;
  v_pending integer;
begin
  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- Do not collect requests for a shop that has not switched the program on.
  if not exists (
    select 1 from public.loyalty_programs lp
    where lp.shop_id = p_shop_id and lp.enabled
  ) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Nor for a shop with no active WAKA Loyalty entitlement: a queue nobody can
  -- approve would only mislead the customer.
  if not (select e.loyalty_enabled from public.resolve_shop_loyalty_entitlement (p_shop_id) e) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Phase 4: settle overdue pending requests first, so the queue count and the
  -- cooldown check below always see current state (no cron dependency).
  perform public.loyalty_expire_stale_enrollment_requests (p_shop_id);

  -- Match an existing customer for merchant context. Never create one here.
  select c.id into v_customer_id
  from public.customers c
  where c.shop_id = p_shop_id and c.phone_e164 = v_phone
  order by exists (
    select 1 from public.loyalty_accounts a
    where a.customer_id = c.id and a.shop_id = p_shop_id
  ) desc, c.created_at desc
  limit 1;

  if v_customer_id is not null then
    select * into v_account
    from public.loyalty_accounts
    where shop_id = p_shop_id and customer_id = v_customer_id
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
  where shop_id = p_shop_id and phone_e164 = v_phone and status = 'pending'
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
    where r.shop_id = p_shop_id
      and r.phone_e164 = v_phone
      and r.status in ('rejected', 'expired')
      and r.reviewed_at is not null
      and r.reviewed_at > now () - make_interval (days => v_cooldown_days)
  ) then
    return jsonb_build_object ('ok', false, 'error', 'loyalty_enrollment_cooldown');
  end if;

  -- A bounded pending queue. Its own advisory-lock seed (3) so a public spammer can
  -- never block merchant approvals, which take the membership lock (seed 2).
  perform pg_advisory_xact_lock (public.loyalty_enrollment_queue_lock_key (p_shop_id));
  v_queue_limit := greatest (1, coalesce ((v_settings ->> 'pending_queue_limit')::integer, 50));
  select count(*)::integer into v_pending
  from public.loyalty_enrollment_requests r
  where r.shop_id = p_shop_id and r.status = 'pending';
  if v_pending >= v_queue_limit then
    return jsonb_build_object ('ok', false, 'error', 'loyalty_request_queue_full');
  end if;

  begin
    insert into public.loyalty_enrollment_requests (
      shop_id, customer_id, enrollment_link_id, name, phone_e164, email, status,
      consent_metadata, metadata
    )
    values (
      p_shop_id, v_customer_id, p_enrollment_link_id, v_name, v_phone, v_email, 'pending',
      jsonb_build_object (
        'accepted', true,
        'accepted_at', now (),
        'note', 'public_enrollment_request'
      ),
      jsonb_build_object ('source', p_source, 'link_id', p_enrollment_link_id)
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

revoke all on function public.loyalty_request_enrollment_core (uuid, uuid, text, text, text, text, boolean) from public;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_request_enrollment_core (uuid, uuid, text, text, text, text, boolean) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_request_enrollment_core (uuid, uuid, text, text, text, text, boolean) from authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 3) Token path — behaviour preserved exactly
-- ============================================================================
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

  return public.loyalty_request_enrollment_core (
    v_link.shop_id,
    v_link.id,
    'public_enrollment_link',
    v_name,
    v_phone,
    v_email,
    true
  );
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
-- 4) Code path — the merchant is resolved, never supplied
-- ============================================================================
create or replace function public.loyalty_request_enrollment_by_code (
  p_code text,
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
  v_code text := upper (btrim (coalesce (p_code, '')));
  v_name text := btrim (coalesce (p_name, ''));
  v_phone text := btrim (coalesce (p_phone_e164, ''));
  v_email text := nullif (btrim (coalesce (p_email, '')), '');
  v_shop_id uuid;
begin
  -- Validation order matches the token path exactly, so the same bad input yields the same error
  -- on either route: format, consent, name, phone, email, then resolution.
  if not public.is_waka_loyalty_program_code (v_code) then
    return jsonb_build_object ('ok', false, 'error', 'code_invalid');
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

  -- The ONLY thing the code is allowed to decide is WHICH shop. It selects no account, no member
  -- and no customer, and the caller supplies none of them.
  select lp.shop_id into v_shop_id
  from public.loyalty_programs lp
  where lp.public_code = v_code
  limit 1;

  if v_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- No enrollment link is involved: the code alone identifies the program (Decision 9). The
  -- program's own `enabled` flag and the shop's entitlement, both enforced inside the core, are
  -- what actually gate joining — so a merchant switching Loyalty off still closes the door.
  return public.loyalty_request_enrollment_core (
    v_shop_id,
    null,
    'public_program_code',
    v_name,
    v_phone,
    v_email,
    true
  );
end;
$fn$;

do $gp$
begin
  execute 'revoke all on function public.loyalty_request_enrollment_by_code (text, text, text, text, boolean) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_request_enrollment_by_code (text, text, text, text, boolean) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_request_enrollment_by_code (text, text, text, text, boolean) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_request_enrollment_by_code (text, text, text, text, boolean) to service_role';
  end if;
end;
$gp$;

-- ============================================================================
-- 5) Public preview — display fields only
-- ============================================================================
-- What a customer sees after entering or scanning a code: WHO the merchant is, and whether the
-- program is accepting members. There is no path from this payload to an internal identifier.
--
-- NEVER returned: shop_id, organization_id, loyalty account ids, member ids, customer data,
-- phone, email, qr_token, public_card_token, enrollment tokens, member counts.
--
-- Malformed and unknown codes return the SAME not_found, so the endpoint is not an existence
-- oracle for typos or probing. A code that resolves reports its own `enabled` state so the UI can
-- say "not accepting members" — that is Decision 11, and it is the one state a scanning customer
-- must be told.
create or replace function public.loyalty_program_public_preview (p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_code text := upper (btrim (coalesce (p_code, '')));
  v_row record;
begin
  if not public.is_waka_loyalty_program_code (v_code) then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  select
    lp.enabled,
    lp.public_code,
    s.name as shop_name,
    s.district,
    s.business_type,
    nullif (btrim (coalesce (cd.program_display_name, '')), '') as program_display_name
  into v_row
  from public.loyalty_programs lp
  join public.shops s on s.id = lp.shop_id
  left join public.loyalty_card_designs cd on cd.shop_id = lp.shop_id
  where lp.public_code = v_code
  limit 1;

  if v_row is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object (
    'ok', true,
    'code', v_row.public_code,
    -- The merchant's own chosen program name when they set one, otherwise the shop name.
    'program_name', coalesce (v_row.program_display_name, v_row.shop_name),
    'shop_name', v_row.shop_name,
    'district', v_row.district,
    'business_type', v_row.business_type,
    'enabled', v_row.enabled
  );
end;
$fn$;

do $gp$
begin
  execute 'revoke all on function public.loyalty_program_public_preview (text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_program_public_preview (text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_program_public_preview (text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.loyalty_program_public_preview (text) to service_role';
  end if;
end;
$gp$;
