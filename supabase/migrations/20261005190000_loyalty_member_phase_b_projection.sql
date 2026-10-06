-- ============================================================================
-- CUSTOMER LOYALTY — PHASE B: member projection extensions (projection-only)
-- ============================================================================
--
-- Additive by design: NO schema change, NO new table, NO new grant surface. The
-- same single member-scoped function keeps resolving everything from auth.uid()
-- alone, so the Phase 1 isolation property (cross-member access is structurally
-- impossible rather than merely checked) is unchanged.
--
-- WHAT THIS ADDS AND WHY
--
-- 1. WALLET STATE (honest "Add to Google Wallet" labelling — the Phase A audit's
--    P0-2). The columns already existed on loyalty_accounts; only the member
--    projection never exposed them, so the button could only ever say "Add".
--    Exposed here: google_wallet_issued_at (was a pass ever issued?) and
--    google_wallet_sync_balance (is the pass's cached balance stale?). NEVER
--    exposed: google_wallet_object_id (it embeds the account uuid), and never any
--    claim about "installed"/"saved" — the Google Wallet API gives this
--    architecture no such signal, and inventing one would be a lie in the UI.
--
-- 2. CARD IDENTITY for the member's own premium digital card on their dashboard
--    (audit P1-2 / §22):
--      - member_number / member_cvc: the SAME one-way derivation the public card
--        already publishes (deriveLoyaltyMemberNumber in
--        supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts): first 16
--        hex chars of SHA-256(account id), grouped; CVC = last 32 bits mod 1000.
--        Verified byte-for-byte against the TypeScript reference (node:crypto) on
--        multiple vectors. Not reversible to the UUID, not a credential, and — as
--        on the public card — the CVC is decorative membership-card reference
--        only: never authentication, authorisation or payment security.
--      - qr_token: the MEMBER'S OWN scan credential, for the QR on their OWN
--        card. This is the audited decision (Phase B report §22 options 1): the
--        member is the legitimate holder of their own card face — showing it is
--        the product. The projection resolves it only through
--        auth.uid() -> member -> OWN active links, so one member can never read
--        another member's token, exactly like every other field here.
--        public_card_token (the shareable bearer URL) remains withheld, as does
--        customer_id.
--
-- 3. projection_version 2, so clients can tell the shapes apart.
--
-- The card identity derivation lives in one immutable SQL helper so the dashboard
-- projection stays readable and the numbers cannot drift between call sites.
--
-- Uses core sha256() (PostgreSQL 11+); no extension dependency, so the PGlite
-- integration harness exercises the exact production SQL.
-- ============================================================================

create or replace function public.loyalty_member_card_identity (p_account_id uuid)
returns jsonb
language plpgsql
immutable
strict
as $$
declare
  -- SHA-256(account id) as UPPERcase hex — core sha256(), no extension dependency.
  -- The TypeScript reference uppercases the grouped body; uppercasing the whole
  -- digest here keeps member_number identical and is inert for the bit(32) CVC parse.
  v_hex text := upper (encode (sha256 (convert_to (p_account_id::text, 'UTF8')), 'hex'));
begin
  return jsonb_build_object (
    -- Grouped like a card number: "26D4 33F0 2BED 4ABE" (matches the TS reference
    -- deriveLoyaltyMemberNumber in the public-card edge code).
    'member_number',
      substr (v_hex, 1, 4) || ' '
      || substr (v_hex, 5, 4) || ' '
      || substr (v_hex, 9, 4) || ' '
      || substr (v_hex, 13, 4),
    -- Last 8 hex chars as an UNSIGNED 32-bit value (bit(32)::bigint is unsigned in
    -- PostgreSQL), mod 1000 — identical to parseInt(hex.slice(-8), 16) % 1000.
    -- substr uses an explicit positive start because negative indexes behave
    -- differently under the PGlite harness than under production PostgreSQL.
    'member_cvc',
      lpad (
        ((('x' || substr (v_hex, length (v_hex) - 7))::bit (32)::bigint) % 1000)::text,
        3,
        '0'
      )
  );
end;
$$;

comment on function public.loyalty_member_card_identity (uuid) is
  'One-way card-format identity (member number + decorative CVC) derived from the account UUID. Same derivation as deriveLoyaltyMemberNumber in the public-card edge code. Not a credential; never reversible to the UUID.';

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
        'enrolled_at', a.enrolled_at,
        -- Phase B: honest wallet labelling only. object_id is deliberately NOT
        -- returned (it embeds the account uuid); "installed" is unknowable here.
        'google_wallet_issued_at', a.google_wallet_issued_at,
        'google_wallet_sync_balance', a.google_wallet_sync_balance
      ),
      -- Presence of the shareable card, plus the fields the member's OWN premium
      -- card face needs. public_card_token and customer_id remain withheld:
      -- public_card_token IS the public card URL (bearer), customer_id is a
      -- merchant-internal identifier. qr_token is returned ONLY through this
      -- auth.uid()-scoped path and ONLY for the caller's own accounts.
      'card', jsonb_build_object (
        'has_public_card', (a.public_card_token is not null),
        'qr_token', a.qr_token,
        'member_number', (public.loyalty_member_card_identity (a.id) ->> 'member_number'),
        'member_cvc', (public.loyalty_member_card_identity (a.id) ->> 'member_cvc')
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
      'projection_version', 2
    )
  );
end;
$fn$;

-- Same signature as before, so the existing grants carry over; re-asserted here
-- so a database built from this migration alone has the same posture.
do $gd$
begin
  execute 'revoke all on function public.loyalty_member_dashboard () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_dashboard () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_dashboard () to authenticated';
  end if;
  -- The card-identity helper is a pure function of its argument and is not an
  -- authority for anything: it derives public display data from a uuid. Still,
  -- only the member projection needs it — revoke from the browser roles.
  execute 'revoke all on function public.loyalty_member_card_identity (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_card_identity (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.loyalty_member_card_identity (uuid) from authenticated';
  end if;
end;
$gd$;
