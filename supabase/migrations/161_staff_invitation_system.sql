-- STAFF-V2-PHASE-5: secure staff invitation + Auth onboarding bridge.
-- Adds shop_staff_invitations and owner-only invite / accept RPCs.
-- Does not change PIN login, SessionActor, sales attribution, or migrations 158–160.
-- Does not apply or modify 151–157.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.shop_staff_invitations (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  email text not null,
  membership_role text not null,
  pos_role text not null,
  staff_id uuid references public.shop_pos_staff (id) on delete set null,
  invited_by uuid not null references auth.users (id),
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now (),
  constraint shop_staff_invitations_email_normalized
    check (email = lower (trim (email))),
  constraint shop_staff_invitations_email_shape
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint shop_staff_invitations_membership_role_check
    check (membership_role in ('manager', 'cashier', 'stock_keeper', 'waiter', 'viewer')),
  constraint shop_staff_invitations_pos_role_check
    check (
      pos_role in (
        'manager',
        'cashier',
        'stock_keeper',
        'supervisor',
        'waiter',
        'kitchen',
        'bar'
      )
    ),
  constraint shop_staff_invitations_no_owner_role
    check (membership_role <> 'owner' and pos_role <> 'owner')
);

create unique index if not exists shop_staff_invitations_token_hash_uidx
  on public.shop_staff_invitations (token_hash);

create unique index if not exists shop_staff_invitations_pending_shop_email_uidx
  on public.shop_staff_invitations (shop_id, email)
  where accepted_at is null
    and revoked_at is null;

create index if not exists shop_staff_invitations_shop_created_idx
  on public.shop_staff_invitations (shop_id, created_at desc);

comment on table public.shop_staff_invitations is
  'STAFF-V2 Phase 5. Pending shop membership invites. Store sha256(token) only. Token plaintext is returned once from shop_invite_staff for email delivery.';

comment on column public.shop_staff_invitations.token_hash is
  'sha256 hex of the single-use invite token. Never store plaintext.';

comment on column public.shop_staff_invitations.membership_role is
  'shop_members.role after accept. Never owner.';

comment on column public.shop_staff_invitations.pos_role is
  'shop_pos_staff.role after accept when a staff profile is created.';

alter table public.shop_staff_invitations enable row level security;

revoke all on table public.shop_staff_invitations from public, anon, authenticated;

-- Latent shop_members INSERT: clients must not create memberships directly.
-- Owner bootstrap and accept RPCs are security definer and still write.
revoke insert on table public.shop_members from authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.staff_v2_hash_invite_token (p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode (digest (convert_to (p_token, 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function public.staff_v2_hash_invite_token (text) from public, anon, authenticated;

create or replace function public.staff_v2_membership_role_for_pos_role (p_pos_role text)
returns text
language sql
immutable
as $$
  select case p_pos_role
    when 'supervisor' then 'cashier'
    when 'kitchen' then 'waiter'
    when 'bar' then 'waiter'
    when 'manager' then 'manager'
    when 'cashier' then 'cashier'
    when 'stock_keeper' then 'stock_keeper'
    when 'waiter' then 'waiter'
    when 'viewer' then 'viewer'
    else null
  end;
$$;

revoke all on function public.staff_v2_membership_role_for_pos_role (text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- shop_invite_staff
-- ---------------------------------------------------------------------------

create or replace function public.shop_invite_staff (
  p_shop_id uuid,
  p_email text,
  p_membership_role text,
  p_pos_role text,
  p_staff_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_email text;
  v_membership_role text;
  v_pos_role text;
  v_token text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz := now () + interval '7 days';
  v_staff public.shop_pos_staff%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  perform public.require_verified_email_for_cloud ();

  if p_shop_id is null then
    return jsonb_build_object ('ok', false, 'error', 'shop_required');
  end if;

  if not public.user_is_shop_owner (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  v_email := lower (trim (coalesce (p_email, '')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_email');
  end if;

  v_membership_role := lower (trim (coalesce (p_membership_role, '')));
  v_pos_role := lower (trim (coalesce (p_pos_role, '')));

  if v_membership_role = 'owner' or v_pos_role = 'owner' then
    return jsonb_build_object ('ok', false, 'error', 'owner_role_forbidden');
  end if;

  if v_membership_role not in ('manager', 'cashier', 'stock_keeper', 'waiter', 'viewer') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_membership_role');
  end if;

  if v_pos_role not in ('manager', 'cashier', 'stock_keeper', 'supervisor', 'waiter', 'kitchen', 'bar') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_pos_role');
  end if;

  if public.staff_v2_membership_role_for_pos_role (v_pos_role) is distinct from v_membership_role
    and not (v_membership_role = 'viewer' and v_pos_role = 'cashier') then
    return jsonb_build_object ('ok', false, 'error', 'role_mismatch');
  end if;

  if exists (
    select 1
    from public.shop_members sm
    join auth.users u on u.id = sm.user_id
    where sm.shop_id = p_shop_id
      and lower (trim (coalesce (u.email, ''))) = v_email
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_member');
  end if;

  if p_staff_id is not null then
    select *
    into v_staff
    from public.shop_pos_staff s
    where s.id = p_staff_id;

    if not found then
      return jsonb_build_object ('ok', false, 'error', 'staff_not_found');
    end if;

    if v_staff.shop_id is distinct from p_shop_id or v_staff.deleted_at is not null then
      return jsonb_build_object ('ok', false, 'error', 'staff_wrong_shop');
    end if;

    if v_staff.user_id is not null then
      return jsonb_build_object ('ok', false, 'error', 'staff_already_linked');
    end if;
  end if;

  update public.shop_staff_invitations i
  set revoked_at = now ()
  where i.shop_id = p_shop_id
    and i.email = v_email
    and i.accepted_at is null
    and i.revoked_at is null;

  v_token := encode (gen_random_bytes (32), 'hex');
  v_hash := public.staff_v2_hash_invite_token (v_token);

  insert into public.shop_staff_invitations (
    shop_id,
    email,
    membership_role,
    pos_role,
    staff_id,
    invited_by,
    token_hash,
    expires_at
  )
  values (
    p_shop_id,
    v_email,
    v_membership_role,
    v_pos_role,
    p_staff_id,
    v_uid,
    v_hash,
    v_expires
  )
  returning id into v_id;

  return jsonb_build_object (
    'ok', true,
    'invitation_id', v_id,
    'shop_id', p_shop_id,
    'email', v_email,
    'membership_role', v_membership_role,
    'pos_role', v_pos_role,
    'staff_id', p_staff_id,
    'token', v_token,
    'expires_at', v_expires,
    'accept_path', '/staff/accept?token=' || v_token
  );
end;
$$;

comment on function public.shop_invite_staff (uuid, text, text, text, uuid) is
  'Owner-only. Creates a pending staff invite and returns the plaintext token once for email delivery. Does not insert shop_members or create Auth users.';

revoke all on function public.shop_invite_staff (uuid, text, text, text, uuid) from public, anon;
grant execute on function public.shop_invite_staff (uuid, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- shop_accept_staff_invite
-- ---------------------------------------------------------------------------

create or replace function public.shop_accept_staff_invite (p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_email text;
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

comment on function public.shop_accept_staff_invite (text) is
  'Invitee JWT only. Consumes a hashed token, inserts shop_members, and links or creates shop_pos_staff.user_id. Never grants owner.';

revoke all on function public.shop_accept_staff_invite (text) from public, anon;
grant execute on function public.shop_accept_staff_invite (text) to authenticated;

-- ---------------------------------------------------------------------------
-- shop_revoke_staff_invite / shop_list_staff_invitations
-- ---------------------------------------------------------------------------

create or replace function public.shop_revoke_staff_invite (p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
begin
  if auth.uid () is null then
    raise exception 'unauthenticated';
  end if;

  perform public.require_verified_email_for_cloud ();

  select i.shop_id
  into v_shop
  from public.shop_staff_invitations i
  where i.id = p_invitation_id;

  if v_shop is null then
    return jsonb_build_object ('ok', false, 'error', 'not_found');
  end if;

  if not public.user_is_shop_owner (v_shop) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  update public.shop_staff_invitations
  set revoked_at = now ()
  where id = p_invitation_id
    and accepted_at is null
    and revoked_at is null;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'not_pending');
  end if;

  return jsonb_build_object ('ok', true, 'invitation_id', p_invitation_id);
end;
$$;

revoke all on function public.shop_revoke_staff_invite (uuid) from public, anon;
grant execute on function public.shop_revoke_staff_invite (uuid) to authenticated;

create or replace function public.shop_list_staff_invitations (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid () is null then
    raise exception 'unauthenticated';
  end if;

  if not public.user_is_shop_owner (p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'forbidden');
  end if;

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'id', i.id,
        'email', i.email,
        'membership_role', i.membership_role,
        'pos_role', i.pos_role,
        'staff_id', i.staff_id,
        'expires_at', i.expires_at,
        'accepted_at', i.accepted_at,
        'revoked_at', i.revoked_at,
        'created_at', i.created_at
      )
      order by i.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.shop_staff_invitations i
  where i.shop_id = p_shop_id;

  return jsonb_build_object ('ok', true, 'invitations', v_rows);
end;
$$;

revoke all on function public.shop_list_staff_invitations (uuid) from public, anon;
grant execute on function public.shop_list_staff_invitations (uuid) to authenticated;

-- Used by AuthCallback to skip owner workspace bootstrap for staff invitees.
create or replace function public.shop_has_pending_staff_invite_for_me ()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if auth.uid () is null then
    return false;
  end if;

  v_email := lower (trim (coalesce (auth.email (), '')));
  if v_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.shop_staff_invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now ()
  );
end;
$$;

comment on function public.shop_has_pending_staff_invite_for_me () is
  'True when the current Auth email has a pending unexpired staff invite. Used to skip owner bootstrap.';

revoke all on function public.shop_has_pending_staff_invite_for_me () from public, anon;
grant execute on function public.shop_has_pending_staff_invite_for_me () to authenticated;
