-- Owner-facing connected devices: list, disconnect (inactive), audit. No limit enforcement.

create or replace function public.user_is_shop_owner (p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop_id
      and sm.user_id = auth.uid ()
      and sm.role = 'owner'
  );
$$;

comment on function public.user_is_shop_owner (uuid) is
  'True when the current user is shop_members.role = owner for this shop.';

revoke all on function public.user_is_shop_owner (uuid) from public;
grant execute on function public.user_is_shop_owner (uuid) to authenticated;

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

  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', d.id,
        'device_fingerprint', d.device_fingerprint,
        'label', d.label,
        'platform', d.platform,
        'app_version', d.app_version,
        'last_seen_at', d.last_seen_at,
        'is_active', d.is_active,
        'created_at', d.created_at
      )
      order by d.is_active desc, d.last_seen_at desc nulls last, d.created_at desc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_devices d
  where d.shop_id = p_shop_id;

  return j;
end;
$$;

revoke all on function public.owner_list_shop_devices (uuid) from public;
grant execute on function public.owner_list_shop_devices (uuid) to authenticated;

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

  if not public.user_is_shop_owner (v_shop) then
    raise exception 'Forbidden';
  end if;

  update public.shop_devices d
  set
    is_active = false,
    updated_at = now ()
  where d.id = p_device_id;

  update public.shops sh
  set
    active_device_count = (
      select count(*)::int
      from public.shop_devices d2
      where d2.shop_id = v_shop
        and d2.is_active = true
    ),
    updated_at = now ()
  where sh.id = v_shop;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload,
    device_id
  )
  values (
    v_shop,
    auth.uid (),
    'owner',
    'device_disconnected',
    'Disconnected device: ' || v_label,
    jsonb_build_object (
      'device_id', p_device_id,
      'device_fingerprint', v_fp,
      'shop_id', v_shop
    ),
    v_fp
  );

  return jsonb_build_object (
    'ok', true,
    'device_id', p_device_id,
    'shop_id', v_shop
  );
end;
$$;

revoke all on function public.owner_disconnect_shop_device (uuid) from public;
grant execute on function public.owner_disconnect_shop_device (uuid) to authenticated;

create or replace function public.owner_record_devices_viewed (
  p_shop_id uuid,
  p_device_fingerprint text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_shop_id is null then
    return;
  end if;

  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  insert into public.audit_logs (
    shop_id,
    actor_user_id,
    role,
    action,
    payload_summary,
    payload,
    device_id
  )
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'device_viewed',
    'Viewed connected devices',
    jsonb_build_object (
      'shop_id', p_shop_id,
      'device_fingerprint', nullif(trim(coalesce(p_device_fingerprint, '')), '')
    ),
    nullif(trim(coalesce(p_device_fingerprint, '')), '')
  );
end;
$$;

revoke all on function public.owner_record_devices_viewed (uuid, text) from public;
grant execute on function public.owner_record_devices_viewed (uuid, text) to authenticated;
