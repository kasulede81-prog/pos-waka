-- ============================================================================
-- Phase 2C — authenticated member join by WPL program code
-- ============================================================================
-- ADDS a path. Changes nothing about the one that already exists.
--
--   existing : anonymous → code/link → PENDING request → merchant approves
--              → Phase 2A links by canonical phone.  UNCHANGED, byte for byte.
--   new      : authenticated member → code → PENDING request carrying member_id
--              → merchant approves → Phase 2A links by THAT IDENTITY.
--
-- The anonymous path is the one live in production and it still works exactly as before: its
-- requests carry `member_id = NULL`, so the approval function falls through to the original phone
-- match it has always used. Nothing about merchant approval is bypassed on the new path either —
-- an authenticated join still queues a PENDING request that a merchant must review. Google
-- authentication proves who asked; it does not decide whether they may join.
--
-- WHY member_id AND NOT JUST THE PHONE. When a customer is authenticated we already know exactly
-- who they are, from the server. Inferring their identity a second time from a phone number at
-- approval would be strictly weaker: `loyalty_members.phone_e164` is deliberately NON-UNIQUE, and
-- the phone match is a ternary (exactly one match links, zero or many do not). Recording the
-- identity at request time removes that inference for authenticated members while leaving it
-- exactly as it was for everyone else.

-- ============================================================================
-- 1) The request records WHO asked, when the asker was authenticated
-- ============================================================================
alter table public.loyalty_enrollment_requests
  add column if not exists member_id uuid null
    references public.loyalty_members (id) on delete set null;

comment on column public.loyalty_enrollment_requests.member_id is
  'Set when the request came from an AUTHENTICATED member (auth.uid() → loyalty_members). NULL for the anonymous path, which is linked by phone at approval as before.';

create index if not exists loyalty_enrollment_requests_member_idx
  on public.loyalty_enrollment_requests (member_id)
  where member_id is not null;

-- ============================================================================
-- 2) The authenticated join
-- ============================================================================
-- There is deliberately NO member/account/shop/organization parameter on this function. The
-- member is `auth.uid()`, the program is the code, and both are resolved here. A caller cannot
-- name any of them, so there is nothing to forge.
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
    coalesce (nullif (btrim (v_member.display_name), ''), 'WAKA member'),
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

do $g$
begin
  execute 'revoke all on function public.loyalty_member_join_by_code (text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_join_by_code (text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- Called from the browser with the member's own session, which is the whole point: the
    -- function reads auth.uid(). Unlike the anonymous path this does NOT go through the
    -- public-program Edge Function, which stays a pure anonymous lookup.
    execute 'grant execute on function public.loyalty_member_join_by_code (text) to authenticated';
  end if;
end;
$g$;

-- ============================================================================
-- 3) Approval binds an AUTHENTICATED request by identity, not by phone
-- ============================================================================
-- Reproduced from 20260928110000 with ONE guarded addition: when the request carries a
-- member_id the link is bound to that member; otherwise the original single-match phone logic
-- runs exactly as before. A file that says which direction it moves.
CREATE OR REPLACE FUNCTION public.loyalty_review_enrollment_request (
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

  -- ---------------------------------------------------------------------------
  -- Phase 2A — attach this account to the WAKA member who owns that phone.
  --
  -- The identity is found SERVER-SIDE from the approved request's phone. A caller
  -- can never name a member, so a merchant cannot attach an account to an arbitrary
  -- member, and the account/shop pair is already fixed by the rows above, so one shop
  -- can never link another shop's account.
  --
  -- Phone is a MATCHING HINT, never a key: loyalty_members.phone_e164 is deliberately
  -- non-unique (the customer data it is matched against has no phone uniqueness
  -- either). Only an unambiguously single active identity is acted on; more than one
  -- means we do not guess, and the membership is simply left unlinked.
  --
  -- Both sides are canonical E.164 — the same '^\+256[0-9]{9}$' CHECK constrains
  -- loyalty_members.phone_e164, customers.phone_e164 and this request's phone_e164 —
  -- so this is a direct equality, which also keeps it index-usable.
  -- ---------------------------------------------------------------------------
  declare
    v_member_id uuid;
    v_member_matches integer;
    v_shop_links integer;
  begin
    -- One statement, so the count and the chosen id always come from the same
    -- snapshot. A concurrent registration that adds a second identity for this phone
    -- therefore cannot make us link an arbitrary one: it just drops to the ambiguous
    -- case below and nothing is linked.
    -- Phase 2C — prefer the identity recorded when the asker was AUTHENTICATED.
    --
    -- An authenticated join stores member_id on the request, so the person is KNOWN rather than
    -- inferred. The anonymous path leaves it NULL and falls straight through to the original
    -- phone match below, unchanged. The status re-check means a member suspended between asking
    -- and approval is not linked.
    if v_req.member_id is not null
       and exists (
         select 1 from public.loyalty_members m
         where m.id = v_req.member_id and m.status = 'active'
       )
    then
      v_member_matches := 1;
      v_member_id := v_req.member_id;
    else
      select count (*), (array_agg (m.id))[1]
        into v_member_matches, v_member_id
      from public.loyalty_members m
      where m.status = 'active'
        and m.phone_e164 = v_req.phone_e164;
    end if;

    if v_member_matches = 1 then
      -- Same person + same shop = one card. Counted by SHOP, not by account, so a
      -- member who already holds an active card at this merchant gets no second link
      -- whether or not this is the same account row. A member already linked to THIS
      -- account therefore falls into the same branch, which is what makes a replayed
      -- approval idempotent.
      select count (*) into v_shop_links
      from public.loyalty_member_links l
      join public.loyalty_accounts a on a.id = l.account_id
      where l.member_id = v_member_id
        and l.status = 'active'
        and a.shop_id = p_shop_id;

      if v_shop_links = 0 then
        -- The composite FK (account_id, shop_id) -> loyalty_accounts (id, shop_id)
        -- makes a cross-shop link structurally impossible, and
        -- loyalty_member_links_one_active_per_account keeps a card single-owner.
        -- The conflict clause absorbs the one remaining case: a previously REVOKED
        -- link to this same account, which must stay revoked.
        insert into public.loyalty_member_links (
          member_id, account_id, shop_id, link_source, status
        )
        values (
          v_member_id, v_account_id, p_shop_id, 'enrollment_approval', 'active'
        )
        on conflict (member_id, account_id) do nothing;
      end if;
    end if;
  exception
    when others then
      -- Linking is additive: it must never be able to fail the approval it decorates,
      -- and an unrecognised state means "leave the membership unlinked", never
      -- "merge the identities anyway".
      null;
  end;

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

-- ============================================================================
-- 4) Re-assert the closed half of the execute posture
-- ============================================================================
-- CREATE OR REPLACE keeps the existing ACL, so the grant to `authenticated` that 20260926091000
-- issued is untouched. Deliberately NOT re-granting: this migration has no business widening a
-- privilege, and a re-grant would silently undo any future deliberate revoke on a fresh replay.
do $acl$
begin
  execute 'revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from anon';
  end if;
end;
$acl$;
