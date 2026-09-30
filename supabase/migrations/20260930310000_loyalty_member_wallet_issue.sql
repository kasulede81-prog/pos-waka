-- ============================================================================
-- WAKA LOYALTY — MEMBER-SCOPED WALLET ACCOUNT RESOLUTION
-- ============================================================================
-- The member dashboard can now offer "Add to Google Wallet". The Wallet pass itself is NOT
-- built here and NOT built anywhere new: the Save URL comes from the SAME
-- `issueGoogleWalletSaveUrl` service the merchant button and the public card page already
-- use, with the SAME deterministic object id (`{issuerId}.acct_{accountId}`) and the SAME
-- published class (`{issuerId}.waka_loyalty`). A card the merchant issued and a card the
-- member adds are the same Google Wallet object, not two.
--
-- What was missing was AUTHORITY, not Wallet. `loyalty-wallet-pass` reads the account with
-- the CALLER'S JWT, so the policy `loyalty_accounts_select` (`user_can_access_shop`) decides
-- the outcome. A merchant is a `shop_members` row and passes; a loyalty member is not, and
-- is refused with `account_not_found`. That is the whole difference between the two paths —
-- no Wallet credential differs between them, and none is added here.
--
-- This function supplies the member's authority chain, and nothing else:
--
--     auth.uid () -> loyalty_members.auth_user_id
--                 -> loyalty_member_links (status = 'active')
--                 -> loyalty_accounts (same shop, via the composite FK)
--
-- It takes a SHOP, never an account. No account id supplied by a caller is read here, so
-- there is nothing to forge: a member asking about shop B is answered from their OWN link at
-- shop B, and a member with no link there gets `not_found` — the same answer a shop they have
-- never heard of gets, so this cannot be used to probe which shops exist.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN: `qr_token`, `public_card_token`, `customer_id`, or
-- anything else a browser could replay. Both tokens are bearer credentials and every member
-- projection already refuses to publish them; this one adds no new way to obtain either. It
-- returns the two ids the Edge Function needs to load the pass material server-side, plus the
-- lifecycle verdict. Shop staff are unaffected: they are not on this path at all.
--
-- READ-ONLY. `stable`, no writes, no link creation, no lifecycle change. It cannot issue,
-- revoke or alter a pass — issuance stays in the Edge Function, where the credentials live.

create or replace function public.loyalty_member_wallet_account (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_account public.loyalty_accounts%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  if v_member.id is null or v_member.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'not_a_member');
  end if;

  -- The ONLY account this can ever return: the member's own, at this shop, through an ACTIVE
  -- link. `a.shop_id = l.shop_id` is redundant against the composite FK that already enforces
  -- it, and is written out anyway so the join reads as the rule it is.
  -- Ordered, not merely `limit 1`: one card per member per shop is the product rule, but if a
  -- legacy pair of links ever existed the answer must still be deterministic rather than whichever
  -- row the planner happened to return first. Oldest link wins.
  select a.* into v_account
  from public.loyalty_member_links l
  join public.loyalty_accounts a on a.id = l.account_id and a.shop_id = l.shop_id
  where l.member_id = v_member.id
    and l.status = 'active'
    and l.shop_id = p_shop_id
  order by l.linked_at asc, a.id asc
  limit 1;

  if v_account.id is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  -- The same lifecycle vocabulary the Edge Function already answers with, in the same order:
  -- revoked, then inactive, then expired. Kept identical so a member and a merchant see one
  -- set of error codes, and so the client needs no second mapping.
  if v_account.status = 'revoked' then
    return jsonb_build_object ('ok', false, 'error', 'account_revoked');
  end if;
  if v_account.status <> 'active' then
    return jsonb_build_object ('ok', false, 'error', 'account_inactive');
  end if;
  if v_account.membership_expires_at is not null
     and now () >= v_account.membership_expires_at then
    return jsonb_build_object ('ok', false, 'error', 'membership_expired');
  end if;

  return jsonb_build_object (
    'ok', true,
    'shop_id', v_account.shop_id,
    'account_id', v_account.id,
    'status', v_account.status,
    'membership_expires_at', v_account.membership_expires_at
  );
end;
$fn$;

do $g$
begin
  execute 'revoke all on function public.loyalty_member_wallet_account (uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_wallet_account (uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_wallet_account (uuid) to authenticated';
  end if;
  -- The Edge Function calls this with the member's JWT, never with the service key, so the
  -- service role needs no grant: `auth.uid()` is what makes the answer trustworthy, and a
  -- caller who could pass an arbitrary uid would not have any.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.loyalty_member_wallet_account (uuid) from service_role';
  end if;
end;
$g$;

comment on function public.loyalty_member_wallet_account (uuid) is
  'Resolves the authenticated member''s own loyalty account at one shop via an active loyalty_member_links row. Returns ids and lifecycle state only — never qr_token or public_card_token. Read-only.';
