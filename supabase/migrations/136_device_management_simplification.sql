-- Phase 17.7: Device management simplification.
-- Every approved operational device is equal — no primary-device gate on staff or approval RPCs.

-- ---------- Approved-device authorization (replaces primary-only check) ----------
create or replace function public.shop_device_can_manage_staff (
  p_shop_id uuid,
  p_device_fingerprint text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
begin
  if p_shop_id is null then
    return false;
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null then
    return true;
  end if;

  return exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and public.shop_device_is_operational (d.approval_status, d.status)
  );
end;
$$;

-- ---------- Staff RPCs: device_not_authorized instead of not_primary_device ----------
create or replace function public.shop_pos_staff_upsert (
  p_shop_id uuid,
  p_row jsonb,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_client_id uuid;
  v_name text;
  v_username text;
  v_role text;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_is_shop_owner (p_shop_id)
    and not exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = p_shop_id
        and sm.user_id = auth.uid ()
        and sm.role = 'manager'
    ) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  v_id := nullif (p_row ->> 'id', '')::uuid;
  v_client_id := nullif (p_row ->> 'client_id', '')::uuid;
  v_name := nullif (trim (p_row ->> 'name'), '');
  v_username := nullif (lower (trim (p_row ->> 'username')), '');
  v_role := coalesce (nullif (trim (p_row ->> 'role'), ''), 'cashier');

  if v_name is null then
    return jsonb_build_object ('ok', false, 'error', 'name_required');
  end if;

  if v_id is null and v_client_id is not null then
    select s.id
    into v_id
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.client_id = v_client_id
      and s.deleted_at is null
    limit 1;
  end if;

  if v_id is null then
    insert into public.shop_pos_staff (
      shop_id,
      client_id,
      name,
      username,
      role,
      pin_hash,
      password_hash,
      phone_e164,
      email,
      permissions,
      is_active
    )
    values (
      p_shop_id,
      v_client_id,
      v_name,
      v_username,
      v_role,
      nullif (p_row ->> 'pin_hash', ''),
      nullif (p_row ->> 'password_hash', ''),
      nullif (trim (p_row ->> 'phone_e164'), ''),
      nullif (lower (trim (p_row ->> 'email')), ''),
      coalesce (p_row -> 'permissions', '[]'::jsonb),
      coalesce ((p_row ->> 'is_active')::boolean, true)
    )
    returning id into v_id;
  else
    update public.shop_pos_staff s
    set
      name = v_name,
      username = v_username,
      role = v_role,
      pin_hash = coalesce (nullif (p_row ->> 'pin_hash', ''), s.pin_hash),
      password_hash = coalesce (nullif (p_row ->> 'password_hash', ''), s.password_hash),
      phone_e164 = coalesce (nullif (trim (p_row ->> 'phone_e164'), ''), s.phone_e164),
      email = coalesce (nullif (lower (trim (p_row ->> 'email')), ''), s.email),
      permissions = coalesce (p_row -> 'permissions', s.permissions),
      is_active = coalesce ((p_row ->> 'is_active')::boolean, s.is_active),
      client_id = coalesce (v_client_id, s.client_id),
      updated_at = now ()
    where s.id = v_id
      and s.shop_id = p_shop_id
      and s.deleted_at is null;
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    'Cloud staff account saved',
    jsonb_build_object ('staff_id', v_id, 'client_id', v_client_id)
  );

  return jsonb_build_object ('ok', true, 'id', v_id);
end;
$$;

create or replace function public.shop_pos_staff_set_active (
  p_shop_id uuid,
  p_staff_id uuid,
  p_active boolean,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  update public.shop_pos_staff s
  set is_active = p_active, updated_at = now ()
  where s.id = p_staff_id
    and s.shop_id = p_shop_id
    and s.deleted_at is null;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    case when p_active then 'Staff enabled' else 'Staff disabled' end,
    jsonb_build_object ('staff_id', p_staff_id, 'is_active', p_active)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

create or replace function public.shop_pos_staff_delete (
  p_shop_id uuid,
  p_staff_id uuid,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  update public.shop_pos_staff s
  set deleted_at = now (), is_active = false, updated_at = now ()
  where s.id = p_staff_id
    and s.shop_id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'staff_account_change',
    'Staff deleted',
    jsonb_build_object ('staff_id', p_staff_id)
  );

  return jsonb_build_object ('ok', true);
end;
$$;

create or replace function public.shop_pos_staff_unlock (
  p_shop_id uuid,
  p_client_id uuid,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  update public.shop_pos_staff s
  set
    failed_pin_attempts = 0,
    locked_until = null,
    last_failed_login_at = null,
    first_failed_login_at = null,
    failures_in_window = 0,
    failure_window_started_at = null,
    updated_at = now ()
  where s.shop_id = p_shop_id
    and s.client_id = p_client_id
    and s.deleted_at is null;

  return jsonb_build_object ('ok', true);
end;
$$;

-- ---------- Deprecate primary transfer RPCs ----------
create or replace function public.shop_device_transfer_primary (
  p_shop_id uuid,
  p_new_device_fingerprint text,
  p_actor_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object ('ok', false, 'error', 'primary_device_deprecated');
end;
$$;

create or replace function public.shop_device_set_primary (
  p_shop_id uuid,
  p_device_fingerprint text,
  p_device_type text default 'primary_pos'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object ('ok', false, 'error', 'primary_device_deprecated');
end;
$$;

create or replace function public.admin_shop_set_primary_device (
  p_shop_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object ('ok', false, 'error', 'primary_device_deprecated');
end;
$$;

-- ---------- Device list: sort by status, not primary authority ----------
create or replace function public.owner_list_shop_devices (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if p_shop_id is null then
    raise exception 'shop_id required';
  end if;

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  perform public.expire_stale_pending_shop_devices(p_shop_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'device_fingerprint', d.device_fingerprint,
        'label', d.label,
        'platform', d.platform,
        'app_version', d.app_version,
        'last_seen_at', d.last_seen_at,
        'last_sync_at', d.last_sync_at,
        'last_login_at', d.last_login_at,
        'is_active', d.is_active,
        'status', d.status::text,
        'device_authority', d.device_authority,
        'approval_status', d.approval_status,
        'approval_requested_at', d.approval_requested_at,
        'form_factor', d.form_factor,
        'device_type', d.device_type,
        'is_primary', d.device_authority = 'primary',
        'current_staff_client_id', d.current_staff_client_id,
        'pending_uploads', coalesce(d.pending_uploads, 0),
        'pending_downloads', coalesce(d.pending_downloads, 0),
        'cloud_status', d.cloud_status,
        'recovery_status', d.recovery_status,
        'created_at', d.created_at
      )
      order by d.approval_status = 'pending' desc, d.is_active desc,
        d.last_seen_at desc nulls last, d.created_at desc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_devices d
  where d.shop_id = p_shop_id;

  return j;
end;
$$;
