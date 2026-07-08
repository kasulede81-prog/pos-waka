-- Admin recovery: clear shop PIN in cloud snapshot + assign primary device from internal admin.

create or replace function public.admin_shop_reset_backoffice_pin (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared_at timestamptz := now();
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  insert into public.shop_recovery_signals (shop_id, clear_back_office_pin_at, updated_at)
  values (p_shop_id, v_cleared_at, v_cleared_at)
  on conflict (shop_id) do update
    set clear_back_office_pin_at = v_cleared_at,
        updated_at = v_cleared_at;

  -- Strip shop security PIN from cloud snapshot so pull/restore cannot resurrect it.
  update public.shop_cloud_snapshots scs
  set
    snapshot = case
      when scs.snapshot is null then scs.snapshot
      when scs.snapshot ? 'snapshot' then
        jsonb_set(
          scs.snapshot,
          '{snapshot,preferences,backOfficePin}',
          'null'::jsonb,
          true
        )
      else
        jsonb_set(
          scs.snapshot,
          '{preferences,backOfficePin}',
          'null'::jsonb,
          true
        )
    end,
    updated_at = v_cleared_at
  where scs.shop_id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, action, payload)
  values (
    p_shop_id,
    auth.uid (),
    'admin_reset_backoffice_pin',
    jsonb_build_object ('at', v_cleared_at, 'cloud_snapshot_cleared', true)
  );

  return jsonb_build_object ('ok', true, 'clear_back_office_pin_at', v_cleared_at);
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
declare
  v_fp text;
  v_new_id uuid;
  v_old_id uuid;
begin
  if not public.is_waka_internal_role (array['super_admin', 'support_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select d.device_fingerprint, d.id
  into v_fp, v_new_id
  from public.shop_devices d
  where d.id = p_device_id
    and d.shop_id = p_shop_id
    and coalesce (d.is_active, true);

  if v_new_id is null or v_fp is null or length (v_fp) < 8 then
    return jsonb_build_object ('ok', false, 'error', 'device_not_found');
  end if;

  perform pg_advisory_xact_lock (hashtextextended (p_shop_id::text, 1));

  select d.id
  into v_old_id
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_authority = 'primary'
  limit 1;

  update public.shop_devices d
  set device_authority = 'secondary', updated_at = now ()
  where d.shop_id = p_shop_id
    and d.device_authority = 'primary'
    and d.id <> v_new_id;

  update public.shop_devices d
  set
    device_authority = 'primary',
    status = 'active'::public.shop_device_status,
    trusted = true,
    updated_at = now ()
  where d.id = v_new_id;

  update public.shops sh
  set primary_device_id = v_new_id, updated_at = now ()
  where sh.id = p_shop_id;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload
  )
  values (
    p_shop_id,
    auth.uid (),
    'internal',
    'admin_shop_set_primary_device',
    format ('Primary device set to %s', p_device_id::text),
    jsonb_build_object (
      'device_id', p_device_id,
      'device_fingerprint', v_fp,
      'previous_primary_device_id', v_old_id
    )
  );

  return jsonb_build_object ('ok', true, 'device_id', p_device_id, 'device_fingerprint', v_fp);
end;
$$;

revoke all on function public.admin_shop_set_primary_device (uuid, uuid) from public;
grant execute on function public.admin_shop_set_primary_device (uuid, uuid) to authenticated;
