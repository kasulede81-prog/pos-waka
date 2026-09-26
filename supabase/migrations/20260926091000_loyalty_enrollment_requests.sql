-- WAKA Loyalty monetisation — Phase 2: public enrollment REQUESTS + merchant approval.
--
-- Replaces the public behaviour
--   PUBLIC QR -> immediately creates an ACTIVE loyalty_accounts row
-- with
--   PUBLIC QR -> pending request -> merchant approves/rejects -> account created.
--
-- Deliberate design choices (see the Phase 2 report):
--  * A pending request is a ROW IN ITS OWN TABLE, never a status on loyalty_accounts.
--    loyalty_accounts keeps `active|suspended|revoked` and its (shop_id, customer_id)
--    uniqueness; a pending row there would be an account, would collide with a later
--    request, and would leak into counts, Wallet lookups and POS scans.
--  * The public request path creates NO customer. A `customers` row appears only when
--    a merchant approves, so unapproved public traffic cannot pollute the customer
--    list. The request records the phone so an existing customer can still be matched
--    and shown to the merchant.
--  * Merchant/cashier enrollment stays immediate (`loyalty_enroll_customer` unchanged
--    from Phase 1, still entitlement- and allowance-gated).
--
-- Not touched: loyalty_transactions and its trigger, the points formula, reversals,
-- redemption accounting, sale finalization, inventory, Google Wallet issuer/class/JWT.
--
-- Depends on: 20260926090000 (Phase 1 entitlement, allowance, advisory lock seed 2).

-- ============================================================================
-- 1) The request queue
-- ============================================================================

create table if not exists public.loyalty_enrollment_requests (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- Set when the phone matches an existing customer, and again on approval when a
  -- customer is created. Never set by the public caller.
  customer_id uuid null references public.customers (id) on delete set null,
  enrollment_link_id uuid null references public.loyalty_enrollment_links (id) on delete set null,
  name text not null check (char_length (btrim (name)) between 2 and 120),
  phone_e164 text not null check (phone_e164 ~ '^\+256[0-9]{9}$'),
  email text null check (
    email is null
    or (char_length (email) <= 254 and email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now (),
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users (id) on delete set null,
  rejection_reason text null check (
    rejection_reason is null or char_length (btrim (rejection_reason)) between 1 and 280
  ),
  approved_loyalty_account_id uuid null references public.loyalty_accounts (id) on delete set null,
  -- Consent receipt captured at request time (public users must consent).
  consent_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  constraint loyalty_enrollment_requests_review_shape check (
    (status = 'pending' and reviewed_at is null and approved_loyalty_account_id is null)
    or (status = 'approved' and reviewed_at is not null and approved_loyalty_account_id is not null)
    or (status = 'rejected' and reviewed_at is not null and approved_loyalty_account_id is null)
  )
);

-- ONE pending request per shop + phone. This is the duplicate-submission guarantee:
-- it is a database constraint, so a concurrent double-submit cannot both land.
create unique index if not exists loyalty_enrollment_requests_one_pending_per_phone
  on public.loyalty_enrollment_requests (shop_id, phone_e164)
  where status = 'pending';

-- Merchant queue read path.
create index if not exists loyalty_enrollment_requests_shop_status_idx
  on public.loyalty_enrollment_requests (shop_id, status, requested_at desc);

-- Cooldown / history lookups by phone (Phase 4 will use this; cheap to have now).
create index if not exists loyalty_enrollment_requests_shop_phone_idx
  on public.loyalty_enrollment_requests (shop_id, phone_e164, requested_at desc);

drop trigger if exists trg_loyalty_enrollment_requests_updated on public.loyalty_enrollment_requests;
create trigger trg_loyalty_enrollment_requests_updated
  before update on public.loyalty_enrollment_requests
  for each row execute function public.set_updated_at ();

alter table public.loyalty_enrollment_requests enable row level security;

-- Merchants read their own shop's queue. There is deliberately NO insert/update/delete
-- policy: every write goes through a SECURITY DEFINER function below, so a client
-- cannot fabricate an approval or self-approve.
drop policy if exists loyalty_enrollment_requests_select on public.loyalty_enrollment_requests;
create policy loyalty_enrollment_requests_select
  on public.loyalty_enrollment_requests for select
  to authenticated
  using (public.user_can_access_shop (shop_id));

revoke all on public.loyalty_enrollment_requests from public;
revoke all on public.loyalty_enrollment_requests from anon;
revoke all on public.loyalty_enrollment_requests from authenticated;
grant select on public.loyalty_enrollment_requests to authenticated;
do $gr$
begin
  -- Guarded like the loyalty migrations before it: `service_role` is a Supabase-platform
  -- role and is absent in a bare Postgres (and in the test harness).
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.loyalty_enrollment_requests to service_role';
  end if;
end;
$gr$;

comment on table public.loyalty_enrollment_requests is
  'Public loyalty enrollment requests awaiting merchant approval. A pending row is NOT a membership.';

-- ============================================================================
-- 2) Public path — submit a PENDING request (no account, no customer, no points)
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
  v_customer_id uuid;
  v_account public.loyalty_accounts%rowtype;
  v_request_id uuid;
  v_existing public.loyalty_enrollment_requests%rowtype;
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

revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from public;
revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from anon;
revoke all on function public.loyalty_request_enrollment (text, text, text, text, boolean) from authenticated;
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loyalty_request_enrollment (text, text, text, text, boolean) to service_role;
  end if;
end;
$g$;

-- Retire the direct-create public path. The name is kept so any caller still resolves,
-- but it now only queues a request — there is exactly ONE public enrollment semantics.
create or replace function public.loyalty_enroll_by_enrollment_token (
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
begin
  -- Phase 2: public self-enrollment is a REQUEST. This wrapper exists only so the
  -- former entry point cannot create an active membership any more.
  return public.loyalty_request_enrollment (
    p_token, p_name, p_phone_e164, p_email, p_consent_accepted
  );
end;
$fn$;

revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from public;
revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from anon;
revoke all on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) from authenticated;
do $g2$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.loyalty_enroll_by_enrollment_token (text, text, text, text, boolean) to service_role;
  end if;
end;
$g2$;

-- ============================================================================
-- 3) Merchant queue read
-- ============================================================================

create or replace function public.loyalty_list_enrollment_requests (
  p_shop_id uuid,
  p_status text default 'pending',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
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
  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
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

revoke all on function public.loyalty_list_enrollment_requests (uuid, text, integer) from public;
revoke all on function public.loyalty_list_enrollment_requests (uuid, text, integer) from anon;
grant execute on function public.loyalty_list_enrollment_requests (uuid, text, integer) to authenticated;

-- ============================================================================
-- 4) Merchant approve / reject — atomic, entitlement-checked, idempotent
-- ============================================================================

create or replace function public.loyalty_review_enrollment_request (
  p_shop_id uuid,
  p_request_id uuid,
  p_action text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_action text := lower (btrim (coalesce (p_action, '')));
  v_req public.loyalty_enrollment_requests%rowtype;
  v_account_id uuid;
  v_customer_id uuid;
  v_existing_account uuid;
  v_ent record;
  v_count integer;
  v_new boolean := false;
  v_reason text := nullif (btrim (coalesce (p_rejection_reason, '')), '');
begin
  if not public.user_can_manage_shop (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;
  if v_action not in ('approve', 'reject') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_action');
  end if;
  if v_reason is not null and char_length (v_reason) > 280 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_reason');
  end if;

  -- Lock ordering: the per-shop allowance lock FIRST (seed 2, same key Phase 1 uses),
  -- then the request row. Every writer takes the advisory lock before any row lock, so
  -- a concurrent approval for the same shop cannot interleave between the count and
  -- the insert, and no lock cycle is possible.
  perform pg_advisory_xact_lock (public.loyalty_member_limit_lock_key (p_shop_id));

  select * into v_req
  from public.loyalty_enrollment_requests
  where id = p_request_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object ('ok', false, 'error', 'request_not_found');
  end if;

  -- Idempotency: a replayed call reports the settled state instead of acting twice.
  if v_req.status <> 'pending' then
    if v_req.status = 'approved' then
      return jsonb_build_object (
        'ok', true, 'status', 'approved', 'already_reviewed', true,
        'loyalty_account_id', v_req.approved_loyalty_account_id,
        'customer_id', v_req.customer_id
      );
    end if;
    return jsonb_build_object (
      'ok', false, 'error', 'already_reviewed', 'status', v_req.status
    );
  end if;

  -- ---------- REJECT ----------
  if v_action = 'reject' then
    update public.loyalty_enrollment_requests
    set status = 'rejected',
        reviewed_at = now (),
        reviewed_by = auth.uid (),
        rejection_reason = v_reason
    where id = v_req.id;
    return jsonb_build_object ('ok', true, 'status', 'rejected');
  end if;

  -- ---------- APPROVE ----------
  select * into v_ent from public.resolve_shop_loyalty_entitlement (p_shop_id);
  if not v_ent.loyalty_enabled then
    return jsonb_build_object (
      'ok', false, 'error', 'loyalty_not_enabled',
      'entitlement_status', v_ent.entitlement_status
    );
  end if;

  v_count := public.count_shop_active_loyalty_members (p_shop_id);
  if coalesce (v_ent.member_limit, 0) <= 0 or v_count >= v_ent.member_limit then
    -- Fail safe: the request stays PENDING so the merchant can retry after freeing a
    -- slot or upgrading. Nothing is created.
    return jsonb_build_object (
      'ok', false, 'error', 'loyalty_member_limit_reached',
      'tier_code', v_ent.tier_code,
      'member_limit', v_ent.member_limit,
      'active_count', v_count,
      'request_status', 'pending'
    );
  end if;

  -- Find or create the customer, now that a merchant has approved.
  v_customer_id := v_req.customer_id;
  if v_customer_id is null then
    select c.id into v_customer_id
    from public.customers c
    where c.shop_id = p_shop_id and c.phone_e164 = v_req.phone_e164
    order by c.created_at desc
    limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers (shop_id, name, phone_e164, email)
    values (p_shop_id, v_req.name, v_req.phone_e164, v_req.email)
    returning id into v_customer_id;
  end if;

  select a.id into v_existing_account
  from public.loyalty_accounts a
  where a.shop_id = p_shop_id and a.customer_id = v_customer_id;

  if v_existing_account is not null then
    -- Already a member (matched customer). Link the request to it; do not create a
    -- second account and do not consume another slot.
    v_account_id := v_existing_account;
  else
    insert into public.loyalty_accounts (shop_id, customer_id, enrolled_by, metadata)
    values (
      p_shop_id, v_customer_id, auth.uid (),
      jsonb_build_object (
        'enrollment', jsonb_build_object (
          'source', 'merchant_approved_request',
          'request_id', v_req.id,
          'approved_at', now (),
          'approved_by', auth.uid ()
        ),
        'consent', coalesce (v_req.consent_metadata, '{}'::jsonb) || jsonb_build_object ('accepted_by', auth.uid ())
      )
    )
    returning id into v_account_id;
    if v_account_id is not null then
      v_new := true;
      perform public.loyalty_stamp_new_account_membership (v_account_id, p_shop_id);
    end if;
  end if;

  update public.loyalty_enrollment_requests
  set status = 'approved',
      reviewed_at = now (),
      reviewed_by = auth.uid (),
      customer_id = v_customer_id,
      approved_loyalty_account_id = v_account_id
  where id = v_req.id;

  return jsonb_build_object (
    'ok', true,
    'status', 'approved',
    'loyalty_account_id', v_account_id,
    'customer_id', v_customer_id,
    'new_membership', v_new,
    'tier_code', v_ent.tier_code,
    'member_limit', v_ent.member_limit
  );
end;
$fn$;

revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from public;
revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from anon;
grant execute on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) to authenticated;
