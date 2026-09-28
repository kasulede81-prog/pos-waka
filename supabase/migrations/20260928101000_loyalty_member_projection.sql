-- WAKA Loyalty — Phase 1: member projection + claim flow.
--
-- Depends on 20260928100000 (loyalty_members, loyalty_member_links, waka_account_identity).
--
-- SCOPE NOTE — claim never auto-links. Phase 1 explicitly forbids claiming accounts from phone
-- matching: "Do not silently merge customers. Do not automatically claim accounts from phone
-- matching. Ambiguous matches must not auto-link." So loyalty_member_claim_start() ALWAYS writes a
-- pending loyalty_member_claim_requests row and NEVER inserts a link, even when the phone matches
-- exactly one customer. The only path to a link in Phase 1 is a merchant approving a request via
-- loyalty_member_claim_review(). This is deliberately more conservative than a
-- unique-match-auto-link design: a wrong link silently attaches one person's points history to
-- another person's account, and unlike a wrong enrollment it cannot be undone by re-approving.
--
-- No transactions, no rewards, no Wallet data. Phase 2 owns those.

-- ============================================================================
-- 1) loyalty_member_claim_requests — a member-owned merchant review queue
-- ============================================================================
-- Deliberately NOT loyalty_enrollment_requests. That queue's approval path ENROLS a new customer
-- and account; a claim is the opposite case — the account already exists and must be linked
-- without creating or merging anything. Reusing it would corrupt its semantics.
create table if not exists public.loyalty_member_claim_requests (
  id uuid primary key default gen_random_uuid (),
  member_id uuid not null references public.loyalty_members (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- Nullable: a pending claim may not have resolved a unique candidate yet. Filled at approval.
  account_id uuid null,
  customer_id uuid null references public.customers (id) on delete set null,
  -- NULLABLE on purpose. The proof of a claim is the card token, not a phone: a member whose own
  -- phone is unset claiming an account whose customer row has none is a legitimate case, and a
  -- NOT NULL column would force a fabricated number into the row (which is what an earlier draft
  -- of this migration did — a sentinel that looked like a real Ugandan number to a reviewer).
  phone_e164 text null check (phone_e164 is null or phone_e164 ~ '^\+256[0-9]{9}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  -- How many customers in this shop matched the member's phone. Recorded so a reviewer can see
  -- WHY a request needed review rather than being resolved outright.
  match_count integer not null default 0,
  proof text not null check (proof in ('card_token', 'merchant_confirm')),
  note text null,
  created_at timestamptz not null default now (),
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users (id)
);

-- One open claim per member per shop.
create unique index if not exists loyalty_member_claim_requests_one_pending_idx
  on public.loyalty_member_claim_requests (member_id, shop_id) where status = 'pending';
create index if not exists loyalty_member_claim_requests_shop_idx
  on public.loyalty_member_claim_requests (shop_id, status);
create index if not exists loyalty_member_claim_requests_member_idx
  on public.loyalty_member_claim_requests (member_id, created_at desc);

alter table public.loyalty_member_claim_requests enable row level security;
alter table public.loyalty_member_claim_requests force row level security;

do $rc$
begin
  execute 'revoke all on table public.loyalty_member_claim_requests from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.loyalty_member_claim_requests from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.loyalty_member_claim_requests from authenticated';
  end if;
end;
$rc$;

-- Two read policies: the member sees their own; shop staff see their shop's.
-- NO INSERT/UPDATE/DELETE grant or policy — creation and review are RPC-only, which is what stops
-- a member writing status='approved' on their own pending claim.
do $pol$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'loyalty_member_claim_requests'
      and policyname = 'loyalty_member_claim_requests_select_self'
  ) then
    create policy loyalty_member_claim_requests_select_self
      on public.loyalty_member_claim_requests
      for select to authenticated
      using (exists (
        select 1 from public.loyalty_members m
        where m.id = loyalty_member_claim_requests.member_id
          and m.auth_user_id = auth.uid ()
      ));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'loyalty_member_claim_requests'
      and policyname = 'loyalty_member_claim_requests_select_shop'
  ) then
    create policy loyalty_member_claim_requests_select_shop
      on public.loyalty_member_claim_requests
      for select to authenticated
      using (public.user_can_access_shop (shop_id));
  end if;
end;
$pol$;

do $gc$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on table public.loyalty_member_claim_requests to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.loyalty_member_claim_requests to service_role';
  end if;
end;
$gc$;

-- ============================================================================
-- 2) loyalty_member_dashboard — the projection
-- ============================================================================
-- Takes NO parameters. The member is resolved from auth.uid() alone, so there is no id for a
-- caller to manipulate — cross-member access is structurally impossible rather than merely
-- checked. Every query below filters on the resolved v_member.id.
create or replace function public.loyalty_member_dashboard ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_accounts jsonb;
  v_linked integer := 0;
  v_active integer := 0;
  v_suspended integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status = 'closed' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  select coalesce(jsonb_agg (entry order by entry -> 'shop' ->> 'name'), '[]'::jsonb)
  into v_accounts
  from (
    select jsonb_build_object (
      'link_id', l.id,
      'shop', jsonb_build_object (
        'id', s.id,
        'name', s.name,
        'business_type', s.business_type,
        'district', s.district
      ),
      'account', jsonb_build_object (
        'status', a.status,
        'balance_points', a.balance_points,
        'lifetime_earned_points', a.lifetime_earned_points,
        'lifetime_redeemed_points', a.lifetime_redeemed_points,
        'membership_expires_at', a.membership_expires_at,
        'enrolled_at', a.enrolled_at
      ),
      -- Presence only. The project deliberately never returns public_card_token or qr_token:
      -- both are bearer credentials, and public_card_token IS the public card URL.
      'card', jsonb_build_object (
        'has_public_card', (a.public_card_token is not null)
      )
    ) as entry,
    a.status
    from public.loyalty_member_links l
    join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
    join public.shops s on s.id = l.shop_id
    where l.member_id = v_member.id and l.status = 'active'
  ) rows;

  select
    count (*),
    count (*) filter (where r.status = 'active'),
    count (*) filter (where r.status = 'suspended')
  into v_linked, v_active, v_suspended
  from (
    select a.status
    from public.loyalty_member_links l
    join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
    where l.member_id = v_member.id and l.status = 'active'
  ) r;

  return jsonb_build_object (
    'ok', true,
    'member', jsonb_build_object (
      'id', v_member.id,
      'display_name', v_member.display_name,
      -- Masked: the member's own number is shown back to them in a form that is recognisable but
      -- not copy-pasteable into another context.
      'phone_e164_masked', case
        when v_member.phone_e164 is null then null
        else substr (v_member.phone_e164, 1, 5) || '** *** ' || substr (v_member.phone_e164, 11, 3)
      end,
      'email', v_member.email,
      'status', v_member.status,
      'member_since', v_member.created_at,
      'phone_verified', (v_member.phone_verified_at is not null)
    ),
    'accounts', v_accounts,
    'counts', jsonb_build_object (
      'linked_accounts', v_linked,
      'active_accounts', v_active,
      'suspended_accounts', v_suspended
    ),
    'meta', jsonb_build_object (
      'generated_at', now (),
      'projection_version', 1
    )
  );
end;
$fn$;

do $gd$
begin
  execute 'revoke all on function public.loyalty_member_dashboard () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_dashboard () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_dashboard () to authenticated';
  end if;
end;
$gd$;

-- ============================================================================
-- 3) loyalty_member_claim_start — request a link; never create one
-- ============================================================================
-- Both failure modes answer identically (`not_found` for "no such token" AND "token belongs to
-- another shop") so this cannot be used to probe which tokens exist at which merchant.
create or replace function public.loyalty_member_claim_start (
  p_shop_id uuid,
  p_card_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_token text := btrim (coalesce (p_card_token, ''));
  v_account public.loyalty_accounts%rowtype;
  v_customer_phone text;
  v_match_count integer := 0;
  v_existing uuid;
  v_request_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  if p_shop_id is null or v_token = '' then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  select * into v_account
  from public.loyalty_accounts a
  where a.shop_id = p_shop_id
    and (a.public_card_token = v_token or a.qr_token = v_token)
  limit 1;

  -- Same answer for a wrong token and a token from another shop: no existence oracle.
  if v_account.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
  end if;

  if exists (
    select 1 from public.loyalty_member_links l
    where l.member_id = v_member.id and l.account_id = v_account.id and l.status = 'active'
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_claimed');
  end if;

  select nullif (btrim (coalesce(c.phone_e164, '')), '') into v_customer_phone
  from public.customers c where c.id = v_account.customer_id;

  -- Recorded for the reviewer's benefit only. It NEVER decides the outcome: no automatic linking
  -- in Phase 1, however clean the match.
  if v_member.phone_e164 is not null then
    select count (*) into v_match_count
    from public.customers c
    where c.shop_id = p_shop_id and c.phone_e164 = v_member.phone_e164;
  end if;

  select r.id into v_existing
  from public.loyalty_member_claim_requests r
  where r.member_id = v_member.id and r.shop_id = p_shop_id and r.status = 'pending'
  limit 1;

  if v_existing is not null then
    return jsonb_build_object ('ok', true, 'request_id', v_existing, 'status', 'pending',
                               'already_requested', true);
  end if;

  insert into public.loyalty_member_claim_requests (
    member_id, shop_id, account_id, customer_id, phone_e164, proof, match_count, note
  )
  values (
    v_member.id, p_shop_id, v_account.id, v_account.customer_id,
    -- No sentinel: if neither side has a phone, record NULL rather than invent one.
    coalesce (v_member.phone_e164, v_customer_phone),
    'card_token', v_match_count,
    case when v_match_count > 1 then 'multiple customers share this phone' else null end
  )
  returning id into v_request_id;

  return jsonb_build_object ('ok', true, 'request_id', v_request_id, 'status', 'pending');
end;
$fn$;

do $gs$
begin
  execute 'revoke all on function public.loyalty_member_claim_start (uuid, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_claim_start (uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_claim_start (uuid, text) to authenticated';
  end if;
end;
$gs$;

-- ============================================================================
-- 4) loyalty_member_claim_review — the only path to a link
-- ============================================================================
create or replace function public.loyalty_member_claim_review (
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_req public.loyalty_member_claim_requests%rowtype;
  v_note text := nullif (btrim (coalesce (p_note, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_req from public.loyalty_member_claim_requests r where r.id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if not public.user_can_access_shop (v_req.shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object ('ok', false, 'error', 'already_reviewed', 'status', v_req.status);
  end if;

  if not p_approve then
    update public.loyalty_member_claim_requests
    set status = 'rejected', reviewed_at = now (), reviewed_by = v_uid, note = coalesce (v_note, note)
    where id = v_req.id;
    return jsonb_build_object ('ok', true, 'status', 'rejected');
  end if;

  if v_req.account_id is null then
    return jsonb_build_object ('ok', false, 'error', 'no_account');
  end if;

  begin
    insert into public.loyalty_member_links (
      member_id, account_id, shop_id, link_source, status, confirmed_by
    )
    values (
      v_req.member_id, v_req.account_id, v_req.shop_id, 'merchant_confirmed', 'active', v_uid
    );
  exception
    when unique_violation then
      -- The one_active_per_account index fired: someone already holds this card. A refusal, not a
      -- 500.
      return jsonb_build_object ('ok', false, 'error', 'already_claimed');
  end;

  update public.loyalty_member_claim_requests
  set status = 'approved', reviewed_at = now (), reviewed_by = v_uid, note = coalesce (v_note, note)
  where id = v_req.id;

  return jsonb_build_object ('ok', true, 'status', 'approved');
end;
$fn$;

do $grv$
begin
  execute 'revoke all on function public.loyalty_member_claim_review (uuid, boolean, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_claim_review (uuid, boolean, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_claim_review (uuid, boolean, text) to authenticated';
  end if;
end;
$grv$;
