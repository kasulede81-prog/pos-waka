-- ============================================================================
-- Phase 5 — Google-first staff invitation acceptance
-- ============================================================================
-- Phase 1 established that shop_accept_staff_invite() was already server-side
-- authoritative about almost everything: it derives shop_id, membership_role,
-- pos_role and staff_id from the invitation row, takes the identity from
-- auth.uid(), reads the email from auth.email() (never from the client), locks
-- the invitation row FOR UPDATE, and checks revoked / accepted / expired / email
-- match before mutating anything. None of that changes here.
--
-- The gap it did have is the one this phase closes: it accepted ANY verified
-- email, so an email/password account with the invited address could accept a
-- staff invitation. The source of truth requires a Google identity whose email
-- matches the invitation.
--
-- auth_user_email_verified() — the existing gate — explicitly accepts
-- `email_confirmed_at is not null` as sufficient, and it never checks that a
-- Google identity's own email agrees with the account email. So it cannot be
-- used to prove Google. The check below is added alongside it, not instead of it.
--
-- NOT changed here: which shops a user may belong to (multi-shop accounts remain
-- permitted exactly as before), the invitation token scheme, the invitation
-- table, or any other RPC.

-- ----------------------------------------------------------------------------
-- Google identity of the authenticated user
-- ----------------------------------------------------------------------------
-- Reads auth.identities — Supabase's own authoritative record of linked provider
-- identities, populated by the Auth server from the ID token Google signed. It is
-- written only by GoTrue, so a client cannot forge it, and it is not derived from
-- anything the client sends.
--
-- Returns the unverified-identity-safe answer: NULL unless the user actually has
-- a Google identity, that identity carries an email, and Google did not mark that
-- email unverified. `email_verified` is absent for some older rows, in which case
-- the identity is accepted — Google only issues the primary email claim for
-- addresses it controls.
--
-- Never returns tokens: identity_data's sub / access_token / refresh_token are
-- not read, and nothing here is stored in a shop table.
create or replace function public.auth_user_google_identity_email ()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower (trim (i.identity_data ->> 'email'))
  from auth.identities i
  where i.user_id = auth.uid ()
    and i.provider = 'google'
    and coalesce (i.identity_data ->> 'email', '') <> ''
    and coalesce ((i.identity_data ->> 'email_verified')::boolean, true)
  order by i.last_sign_in_at desc nulls last
  limit 1;
$$;

revoke all on function public.auth_user_google_identity_email () from public;
revoke all on function public.auth_user_google_identity_email () from anon;
grant execute on function public.auth_user_google_identity_email () to authenticated;

-- ----------------------------------------------------------------------------
-- Acceptance requires a verified Google identity matching the invitation
-- ----------------------------------------------------------------------------
create or replace function public.shop_accept_staff_invite (p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_email text;
  v_google_email text;
  v_hash text;
  v_inv public.shop_staff_invitations%rowtype;
  v_existing_count int;
  v_staff_id uuid;
  v_name text;
  v_linked_existing boolean := false;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  perform public.require_verified_email_for_cloud ();

  if coalesce (trim (p_token), '') = '' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_token');
  end if;

  v_email := lower (trim (coalesce (auth.email (), '')));
  if v_email = '' then
    return jsonb_build_object ('ok', false, 'error', 'email_mismatch');
  end if;

  -- Google-first. Checked BEFORE the invitation is even looked up, so a caller
  -- without a Google identity learns nothing about whether a token exists.
  --
  -- Requiring the Google identity email to equal the account email keeps the
  -- chain tight: invitation.email = auth.email() = Google identity email. Without
  -- this second comparison an account could carry a matching auth email while its
  -- Google identity pointed somewhere else.
  v_google_email := public.auth_user_google_identity_email ();

  if v_google_email is null or v_google_email = '' then
    return jsonb_build_object ('ok', false, 'error', 'google_identity_required');
  end if;

  if v_google_email is distinct from v_email then
    return jsonb_build_object ('ok', false, 'error', 'email_mismatch');
  end if;

  v_hash := public.staff_v2_hash_invite_token (p_token);

  select *
  into v_inv
  from public.shop_staff_invitations i
  where i.token_hash = v_hash
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'invalid_token');
  end if;

  if v_inv.revoked_at is not null then
    return jsonb_build_object ('ok', false, 'error', 'revoked');
  end if;

  if v_inv.accepted_at is not null then
    return jsonb_build_object ('ok', false, 'error', 'already_accepted');
  end if;

  if v_inv.expires_at <= now () then
    return jsonb_build_object ('ok', false, 'error', 'expired');
  end if;

  -- The invitation's own email is the source of truth. Lowercased comparison
  -- only — no Gmail alias rewriting, matching the existing implementation.
  if v_inv.email is distinct from v_email then
    return jsonb_build_object ('ok', false, 'error', 'email_mismatch');
  end if;

  if exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = v_inv.shop_id
      and sm.user_id = v_uid
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_member');
  end if;

  select count (*)
  into v_existing_count
  from public.shop_members sm
  where sm.user_id = v_uid;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_inv.shop_id, v_uid, v_inv.membership_role);

  if v_inv.staff_id is not null then
    -- Links the invitation's OWN staff record. The guard rejects a record that
    -- belongs to another shop, is deleted, or is already linked to someone else.
    update public.shop_pos_staff s
    set user_id = v_uid
    where s.id = v_inv.staff_id
      and s.shop_id = v_inv.shop_id
      and s.deleted_at is null
      and (s.user_id is null or s.user_id = v_uid)
    returning s.id into v_staff_id;

    if v_staff_id is null then
      raise exception 'staff_link_failed';
    end if;
    v_linked_existing := true;
  elsif v_inv.membership_role <> 'viewer' then
    v_name := nullif (initcap (replace (split_part (v_inv.email, '@', 1), '.', ' ')), '');
    if v_name is null then
      v_name := 'Staff';
    end if;

    insert into public.shop_pos_staff (
      shop_id,
      client_id,
      name,
      username,
      role,
      pin_hash,
      email,
      permissions,
      is_active,
      user_id
    )
    values (
      v_inv.shop_id,
      gen_random_uuid (),
      v_name,
      null,
      v_inv.pos_role,
      null,
      v_inv.email,
      '[]'::jsonb,
      true,
      v_uid
    )
    returning id into v_staff_id;
  end if;

  update public.shop_staff_invitations
  set
    accepted_at = now (),
    accepted_by = v_uid
  where id = v_inv.id
    and accepted_at is null
    and revoked_at is null;

  if v_existing_count = 0 then
    update public.profiles pr
    set primary_shop_id = v_inv.shop_id
    where pr.id = v_uid
      and pr.primary_shop_id is null;
  end if;

  -- Auditable acceptance. Records identifiers only — never the invitation token,
  -- never a provider token.
  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    v_inv.shop_id,
    v_uid,
    v_inv.membership_role,
    'staff_invite_accepted',
    'Staff invitation accepted',
    jsonb_build_object (
      'invitation_id', v_inv.id,
      'staff_id', v_staff_id,
      'membership_role', v_inv.membership_role,
      'pos_role', v_inv.pos_role,
      'linked_existing_staff', v_linked_existing
    )
  );

  return jsonb_build_object (
    'ok', true,
    'shop_id', v_inv.shop_id,
    'membership_role', v_inv.membership_role,
    'pos_role', v_inv.pos_role,
    'staff_id', v_staff_id,
    'linked_existing', v_linked_existing
  );
end;
$$;
