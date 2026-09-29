-- ============================================================================
-- Phase 2D — a member can see the status of their OWN enrollment requests
-- ============================================================================
-- A member who joins with a WPL code gets a PENDING request that a merchant must
-- approve. Until now they had no way to see it: the ONLY select policy on
-- `loyalty_enrollment_requests` is `user_can_access_shop(shop_id)`, and a member
-- has no shop access, so their own row was invisible to them. `/member` would
-- show an empty dashboard and the customer would reasonably conclude the join
-- had failed.
--
-- TWO ADDITIVE PIECES, and deliberately no more:
--
--   1. a curated read of the member's own requests — the authority for what the
--      member is shown, and the thing the client re-fetches after every signal;
--   2. the minimum RLS visibility Realtime needs, plus the publication entry.
--
-- Realtime is a NUDGE, never an authority. `postgres_changes` respects RLS, so
-- without (2) an event would never be delivered — but even with it, the payload
-- only tells the client "something changed". Membership is created by the
-- merchant's approval and by nothing else, and the client confirms the resulting
-- `loyalty_member_links` row before it routes anywhere.
--
-- Nothing here can grant membership: no write path is added, `authenticated`
-- still holds SELECT only on this table, and the only status-changing function
-- remains the merchant-guarded approval RPC.

-- ============================================================================
-- 1) The member's own requests — curated, server-scoped
-- ============================================================================
-- Resolves the member from `auth.uid()`, so a caller cannot ask about anyone
-- else. Returns display fields only: no `reviewed_by`, no account or customer
-- id, no internal metadata, and no rejection text (a merchant's note may be
-- written for their own records, not for the customer — the UI says "not
-- approved" and offers the code step again).
create or replace function public.loyalty_member_enrollment_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member_id uuid;
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select m.id into v_member_id
  from public.loyalty_members m
  where m.auth_user_id = v_uid and m.status = 'active';

  if v_member_id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'request_id', r.id,
        'shop_name', s.name,
        'status', r.status,
        'requested_at', r.requested_at,
        'reviewed_at', r.reviewed_at
      )
      order by r.requested_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.loyalty_enrollment_requests r
  join public.shops s on s.id = r.shop_id
  where r.member_id = v_member_id;

  return jsonb_build_object ('ok', true, 'requests', v_rows);
end;
$fn$;

do $g$
begin
  execute 'revoke all on function public.loyalty_member_enrollment_status () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_enrollment_status () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_enrollment_status () to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 2) The RLS visibility Realtime requires — and nothing wider
-- ============================================================================
-- Policies are OR'd, so this ADDS to the existing shop-scoped merchant policy
-- rather than replacing it: a merchant still sees their shop's queue, and a
-- member now sees only rows that carry their OWN member_id.
--
-- Scoped through `loyalty_members.auth_user_id = auth.uid()` rather than
-- trusting anything in the row, so the only way to see a request is to be the
-- member it belongs to. `member_id is not null` keeps the anonymous path — which
-- has no member and therefore no one entitled to read it — out of this policy
-- entirely.
--
-- This grants row VISIBILITY only. `authenticated` holds no INSERT, UPDATE or
-- DELETE on this table, so a member still cannot approve themselves, reject
-- themselves, or reassign a request to another member.
drop policy if exists loyalty_enrollment_requests_select_own_member on public.loyalty_enrollment_requests;
create policy loyalty_enrollment_requests_select_own_member
  on public.loyalty_enrollment_requests for select to authenticated
  using (
    member_id is not null
    and exists (
      select 1
      from public.loyalty_members m
      where m.id = loyalty_enrollment_requests.member_id
        and m.auth_user_id = auth.uid ()
    )
  );

-- ============================================================================
-- 3) Publish the table, so the member's client can be nudged
-- ============================================================================
-- Idempotent and guarded: re-running must not error, and a project without the
-- realtime publication (a plain Postgres, a test harness) must not fail.
--
-- REPLICA IDENTITY stays DEFAULT, which is the default and is sufficient: the
-- client only needs the NEW row values for an UPDATE, and the member learns
-- nothing from a DELETE (rows are never deleted — a rejected request is kept).
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'loyalty_enrollment_requests'
     )
  then
    alter publication supabase_realtime add table public.loyalty_enrollment_requests;
  end if;
end;
$pub$;

-- ============================================================================
-- 4) Floor the enrollment name at the length the request table requires
-- ============================================================================
-- `loyalty_members.display_name` permits one character; `loyalty_enrollment_requests.name` requires
-- at least two. A member whose display name was a single character therefore reached the insert
-- unchanged and the join failed on a raw CHECK violation (23514) rather than succeeding — the
-- customer saw a generic failure for a name the product had accepted one screen earlier.
--
-- Reproduced from 20260929120000 with that one expression guarded; everything else is identical.
-- Append-only: the applied migration is left exactly as it ran.
create or replace function public.loyalty_member_join_by_code (p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_code text := upper (btrim (coalesce (p_code, '')));
  v_shop_id uuid;
  v_customer_id uuid;
  v_link_exists boolean;
  v_existing public.loyalty_enrollment_requests%rowtype;
  v_request_id uuid;
  v_queue_limit integer;
  v_pending integer;
begin
  -- IDENTITY: the session, never the request body.
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member
  from public.loyalty_members m
  where m.auth_user_id = v_uid and m.status = 'active';
  if v_member.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  -- The merchant needs a number to reach and to reconcile this person against, and the request
  -- column is NOT NULL with the same canonical CHECK every other phone column carries.
  if v_member.phone_e164 is null then
    return jsonb_build_object ('ok', false, 'error', 'member_phone_required');
  end if;

  -- MERCHANT: the code, re-resolved here. The client's copy is never used for anything.
  if not public.is_waka_loyalty_program_code (v_code) then
    return jsonb_build_object ('ok', false, 'error', 'code_invalid');
  end if;

  select lp.shop_id into v_shop_id
  from public.loyalty_programs lp
  where lp.public_code = v_code
  limit 1;
  if v_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- The same three gates every other enrollment entry point passes through.
  if not exists (
    select 1 from public.loyalty_programs lp where lp.shop_id = v_shop_id and lp.enabled
  ) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  if not (select e.loyalty_enabled from public.resolve_shop_loyalty_entitlement (v_shop_id) e) then
    return jsonb_build_object ('ok', false, 'error', 'unavailable');
  end if;

  -- Already a member here? Counted by SHOP, matching Phase 2A's own rule, so a member holding an
  -- active card at this merchant gets no second membership and no second request.
  select exists (
    select 1
    from public.loyalty_member_links l
    join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
    where l.member_id = v_member.id
      and l.status = 'active'
      and a.shop_id = v_shop_id
  ) into v_link_exists;
  if v_link_exists then
    return jsonb_build_object ('ok', true, 'status', 'already_member');
  end if;

  -- Idempotent: one pending request per member per shop, reported rather than duplicated.
  select * into v_existing
  from public.loyalty_enrollment_requests r
  where r.shop_id = v_shop_id
    and r.member_id = v_member.id
    and r.status = 'pending'
  limit 1;
  if found then
    return jsonb_build_object ('ok', true, 'status', 'pending', 'already_requested', true);
  end if;

  -- Same bounded queue as the anonymous path, under the same advisory lock, so an authenticated
  -- member cannot be used to grow a merchant's queue without limit either.
  perform pg_advisory_xact_lock (public.loyalty_enrollment_queue_lock_key (v_shop_id));
  v_queue_limit := greatest (
    1,
    coalesce ((public.loyalty_enrollment_settings () ->> 'pending_queue_limit')::integer, 50)
  );
  select count(*)::integer into v_pending
  from public.loyalty_enrollment_requests r
  where r.shop_id = v_shop_id and r.status = 'pending';
  if v_pending >= v_queue_limit then
    return jsonb_build_object ('ok', false, 'error', 'loyalty_request_queue_full');
  end if;

  -- Merchant context only. Matched on the member's OWN canonical phone so the merchant sees a
  -- familiar name — a HINT, never the identity binding, which is member_id below.
  select c.id into v_customer_id
  from public.customers c
  where c.shop_id = v_shop_id and c.phone_e164 = v_member.phone_e164
  order by c.created_at desc
  limit 1;

  insert into public.loyalty_enrollment_requests (
    shop_id, customer_id, member_id, name, phone_e164, email, status,
    consent_metadata, metadata
  )
  values (
    v_shop_id,
    v_customer_id,
    v_member.id,
        -- The member's display name may be a single character (`loyalty_members.display_name` allows
    -- 1..120), but a request requires 2..120. Without this floor a one-letter name reached the
    -- insert as-is and the whole join died on a raw CHECK violation instead of succeeding.
    case
      when char_length (btrim (coalesce (v_member.display_name, ''))) >= 2
        then btrim (v_member.display_name)
      else 'WAKA member'
    end,
    v_member.phone_e164,
    v_member.email,
    'pending',
    jsonb_build_object (
      'accepted', true,
      'accepted_at', now (),
      'note', 'authenticated_member_join'
    ),
    jsonb_build_object ('source', 'authenticated_program_code', 'member_id', v_member.id)
  )
  returning id into v_request_id;

  return jsonb_build_object ('ok', true, 'status', 'pending', 'request_id', v_request_id);
end;
$fn$;
