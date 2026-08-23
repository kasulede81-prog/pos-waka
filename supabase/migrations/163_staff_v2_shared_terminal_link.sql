-- STAFF-V2-PHASE-8: expose shop_pos_staff.user_id on staff download/list for shared-terminal PIN.
-- Does not change sales schema, Phase 7 validator, Auth, or shop_members.
-- Client uses linked Auth UUID for sold_by_user_id while SessionActor.userId stays staff:<id>.

create or replace function public.shop_pos_staff_download (
  p_shop_id uuid,
  p_local_version bigint default 0,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version bigint;
  v_changed jsonb;
  v_removed jsonb;
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select sh.staff_version
  into v_version
  from public.shops sh
  where sh.id = p_shop_id;

  v_version := coalesce (v_version, 1);

  if p_local_version >= v_version and p_local_version > 0 then
    return jsonb_build_object (
      'ok', true,
      'unchanged', true,
      'version', v_version,
      'changed', '[]'::jsonb,
      'removed_client_ids', '[]'::jsonb
    );
  end if;

  if coalesce (p_local_version, 0) <= 0 then
    select coalesce(
      jsonb_agg (
        jsonb_build_object (
          'id', s.id,
          'client_id', s.client_id,
          'name', s.name,
          'username', s.username,
          'role', s.role,
          'pin_hash', s.pin_hash,
          'password_hash', s.password_hash,
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'user_id', s.user_id,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
        order by s.created_at asc
      ),
      '[]'::jsonb
    )
    into v_changed
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.deleted_at is null;
  else
    select coalesce(
      jsonb_agg (
        jsonb_build_object (
          'id', s.id,
          'client_id', s.client_id,
          'name', s.name,
          'username', s.username,
          'role', s.role,
          'pin_hash', s.pin_hash,
          'password_hash', s.password_hash,
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'user_id', s.user_id,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
      ),
      '[]'::jsonb
    )
    into v_changed
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.deleted_at is null
      and s.client_id in (
        select r.staff_client_id
        from public.shop_pos_staff_revisions r
        where r.shop_id = p_shop_id
          and r.shop_version > p_local_version
          and r.action = 'upsert'
          and r.staff_client_id is not null
      );
  end if;

  select coalesce(
    jsonb_agg (distinct r.staff_client_id),
    '[]'::jsonb
  )
  into v_removed
  from public.shop_pos_staff_revisions r
  where r.shop_id = p_shop_id
    and r.shop_version > coalesce (p_local_version, 0)
    and r.action = 'delete'
    and r.staff_client_id is not null;

  return jsonb_build_object (
    'ok', true,
    'unchanged', false,
    'version', v_version,
    'changed', coalesce (v_changed, '[]'::jsonb),
    'removed_client_ids', coalesce (v_removed, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.shop_pos_staff_download (uuid, bigint, text) from public;
grant execute on function public.shop_pos_staff_download (uuid, bigint, text) to authenticated;

drop function if exists public.shop_pos_staff_list (uuid);

create or replace function public.shop_pos_staff_list (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', s.id,
        'client_id', s.client_id,
        'name', s.name,
        'username', s.username,
        'role', s.role,
        'pin_hash', s.pin_hash,
        'password_hash', s.password_hash,
        'phone_e164', s.phone_e164,
        'email', s.email,
        'permissions', coalesce (s.permissions, '[]'::jsonb),
        'is_active', s.is_active,
        'user_id', s.user_id,
        'last_login_at', s.last_login_at,
        'last_device_fingerprint', s.last_device_fingerprint,
        'last_login_platform', s.last_login_platform,
        'failed_pin_attempts', s.failed_pin_attempts,
        'locked_until', s.locked_until,
        'last_failed_login_at', s.last_failed_login_at,
        'first_failed_login_at', s.first_failed_login_at,
        'failures_in_window', s.failures_in_window,
        'failure_window_started_at', s.failure_window_started_at,
        'pin_changed_at', s.pin_changed_at,
        'password_changed_at', s.password_changed_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return j;
end;
$$;

revoke all on function public.shop_pos_staff_list (uuid) from public;
grant execute on function public.shop_pos_staff_list (uuid) to authenticated;
