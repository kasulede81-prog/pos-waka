-- Fleet slots: only licensed + pending devices are visible; terminate deletes history immediately.

create or replace function public.purge_unassigned_shop_devices (p_shop_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_shop_id is null then
    return 0;
  end if;

  with removed as (
    delete from public.shop_devices d
    where d.shop_id = p_shop_id
      and not (
        (d.status = 'active'::public.shop_device_status and d.approval_status = 'approved')
        or d.approval_status = 'pending'
      )
    returning d.id
  )
  select count(*)::int into v_deleted from removed;

  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.purge_unassigned_shop_devices (uuid) from public;
grant execute on function public.purge_unassigned_shop_devices (uuid) to authenticated;

-- End session: hard-delete device row so the slot frees immediately (no disconnected/revoked history).
create or replace function public.owner_disconnect_shop_device (p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_fp text;
  v_label text;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select d.shop_id, d.device_fingerprint, coalesce(nullif(trim(d.label), ''), d.platform, 'Device')
  into v_shop, v_fp, v_label
  from public.shop_devices d
  where d.id = p_device_id;

  if v_shop is null then
    raise exception 'Device not found';
  end if;

  if not public.user_is_shop_owner(v_shop) then
    raise exception 'Forbidden';
  end if;

  delete from public.shop_devices d
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(v_shop);

  perform public.audit_shop_device_event(
    v_shop,
    'device_disconnected',
    'Ended device session: ' || v_label,
    v_fp,
    jsonb_build_object('device_id', p_device_id, 'purged', true)
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'shop_id', v_shop,
    'purged', true
  );
end;
$$;

create or replace function public.owner_remove_shop_device (p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_fp text;
  v_label text;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select d.shop_id, d.device_fingerprint, coalesce(nullif(trim(d.label), ''), d.platform, 'Device')
  into v_shop, v_fp, v_label
  from public.shop_devices d
  where d.id = p_device_id;

  if v_shop is null then
    raise exception 'Device not found';
  end if;

  if not public.user_is_shop_owner(v_shop) then
    raise exception 'Forbidden';
  end if;

  delete from public.shop_devices d
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(v_shop);

  perform public.audit_shop_device_event(
    v_shop,
    'device_removed',
    'Removed device: ' || v_label,
    v_fp,
    jsonb_build_object('device_id', p_device_id, 'purged', true)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'shop_id', v_shop, 'purged', true);
end;
$$;

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
  perform public.purge_unassigned_shop_devices(p_shop_id);

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
  where d.shop_id = p_shop_id
    and (
      (d.status = 'active'::public.shop_device_status and d.approval_status = 'approved')
      or d.approval_status = 'pending'
    );

  return j;
end;
$$;
