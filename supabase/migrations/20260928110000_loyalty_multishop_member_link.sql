-- WAKA Loyalty — Phase 2A: multi-shop membership.
--
-- THE DEFECT THIS FIXES
--
-- Phase 1 made a loyalty member a real authenticated identity, but nothing on the
-- ENROLLMENT path ever created a loyalty_member_links row. Only
-- loyalty_member_claim_review() did. So a member who enrolled at a second shop got a
-- customers row and a loyalty_accounts row at that shop — and no link — which meant
-- loyalty_member_dashboard() (which joins through loyalty_member_links) never returned
-- the new card. The card existed; the member could not see it. That is what read as
-- "you cannot join another shop".
--
-- The data model was never the problem. Every constraint is correctly scoped —
-- loyalty_accounts unique(shop_id, customer_id), loyalty_enrollment_requests
-- unique(shop_id, phone_e164) where pending, and loyalty_member_links carrying only
-- (member_id, account_id) plus one-active-per-card. Nothing is keyed on a person
-- globally, so one member with many shop cards was always permitted. Only the link
-- was missing.
--
-- WHAT THIS DOES
--
-- Adds the missing step to the merchant approval transaction, so that
--
--     customer/account creation + request approval + member link
--
-- commit or roll back as one unit. The linking is deliberately conservative:
--
--   * the member identity is discovered SERVER-SIDE from the approved customer's
--     normalised phone — no caller ever supplies a member_id, so a merchant cannot
--     attach an account to an arbitrary member;
--   * exactly ONE active member must match. Zero or several means we do not guess:
--     the membership is left unlinked and the approval is unaffected. Silent identity
--     merging is precisely what must not happen here;
--   * the member must not already hold an active account at THIS shop, so the
--     same-person-same-shop rule (one card) is preserved;
--   * accounts at OTHER shops are never touched, so the same-person-different-shop
--     rule (many cards) now works;
--   * the block is exception-guarded because linking is additive and must never be
--     able to fail the merchant's approval.
--
-- Anti-spam is untouched: the per-shop pending-request index, the cooldown, the queue
-- cap, the member allowance and the entitlement checks all still run exactly as before.
-- The Phase 1 claim flow (claim_start -> pending -> review -> link) is unchanged.
--
-- No table shape changes. No RLS change. No new table privilege. The function stays
-- SECURITY DEFINER with a pinned search_path and keeps its user_can_manage_shop guard,
-- which is what stops one merchant approving for another shop.

-- ============================================================================
-- 1) link_source gains the enrollment provenance
-- ============================================================================
-- A link created by a merchant approving an enrollment is not the same event as one
-- created by a merchant confirming a member's claim, and the column exists to record
-- exactly that.
--
-- The old CHECK was declared inline and therefore carries Postgres's generated name,
-- so it is located BY DEFINITION rather than by name: whatever the constraint ended up
-- being called, dropping the wrong one here would leave an old CHECK in place that
-- silently rejects 'enrollment_approval', and the insert would then fail into the
-- fail-soft handler — an invisible no-op in production. Scanning pg_constraint removes
-- that assumption.
do $ck$
declare
  v_con text;
begin
  for v_con in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'loyalty_member_links'
      and con.contype = 'c'
      and pg_get_constraintdef (con.oid) like '%link_source%'
  loop
    execute format ('alter table public.loyalty_member_links drop constraint %I', v_con);
  end loop;
end;
$ck$;

alter table public.loyalty_member_links
  add constraint loyalty_member_links_link_source_check
  check (link_source in ('member_claim', 'merchant_confirmed', 'enrollment_approval'));

-- ============================================================================
-- 2) loyalty_review_enrollment_request — create the member link on approval
-- ============================================================================
-- Reproduced from the deployed definition with the Phase 2A block added immediately
-- before the success return. Everything above it — the shop guard, the advisory lock
-- ordering, the idempotent replay branch, the reject branch, the entitlement and
-- allowance checks, the customer/account resolution and the request settlement — is
-- byte-for-byte the existing behaviour, comments included.

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
    select count (*), (array_agg (m.id))[1]
      into v_member_matches, v_member_id
    from public.loyalty_members m
    where m.status = 'active'
      and m.phone_e164 = v_req.phone_e164;

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
-- 3) Re-assert the closed half of the execute posture
-- ============================================================================
-- CREATE OR REPLACE keeps the existing ACL, so this changes nothing today — the grant to
-- `authenticated` that 20260926091000 issued is untouched, which is what the merchant UI
-- calls through. Re-stated for the same reason 20260928102000 re-asserts the Phase 1
-- revokes: a file that says what the posture IS.
--
-- Deliberately NOT re-granting `authenticated`: this migration has no business widening a
-- privilege, and a re-grant here would silently undo any future deliberate revoke on a
-- fresh replay. Removing the browser path is the only direction this file moves privilege.
do $acl$
begin
  execute 'revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_review_enrollment_request (uuid, uuid, text, text) from anon';
  end if;
end;
$acl$;
