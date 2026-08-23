-- STAFF-V2 Phase 9 — shop_invite_staff accepts server id OR client_id.
-- No schema changes. Resolves p_staff_id against shop_pos_staff.id first,
-- then shop_pos_staff.client_id within the shop. Invitation.staff_id always
-- stores the server PK so shop_accept_staff_invite keeps working.

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
  v_resolved_staff_id uuid := null;
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
    -- Prefer server PK (Phase 5 / SQL callers).
    select *
    into v_staff
    from public.shop_pos_staff s
    where s.id = p_staff_id;

    if not found then
      -- Client StaffAccount.id is client_id after download/sync.
      select *
      into v_staff
      from public.shop_pos_staff s
      where s.shop_id = p_shop_id
        and s.client_id = p_staff_id
        and s.deleted_at is null;
    end if;

    if not found then
      return jsonb_build_object ('ok', false, 'error', 'staff_not_found');
    end if;

    if v_staff.shop_id is distinct from p_shop_id or v_staff.deleted_at is not null then
      return jsonb_build_object ('ok', false, 'error', 'staff_wrong_shop');
    end if;

    if v_staff.user_id is not null then
      return jsonb_build_object ('ok', false, 'error', 'staff_already_linked');
    end if;

    v_resolved_staff_id := v_staff.id;
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
    v_resolved_staff_id,
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
    'staff_id', v_resolved_staff_id,
    'token', v_token,
    'expires_at', v_expires,
    'accept_path', '/staff/accept?token=' || v_token
  );
end;
$$;

comment on function public.shop_invite_staff (uuid, text, text, text, uuid) is
  'STAFF-V2 Phase 9. Owner-only. Creates a pending staff invite. p_staff_id may be shop_pos_staff.id or client_id; invitation stores server PK. Does not insert shop_members or create Auth users.';

revoke all on function public.shop_invite_staff (uuid, text, text, text, uuid) from public, anon;
grant execute on function public.shop_invite_staff (uuid, text, text, text, uuid) to authenticated;
