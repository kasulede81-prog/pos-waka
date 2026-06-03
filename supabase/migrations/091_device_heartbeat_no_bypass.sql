-- Close device-limit bypass: heartbeat must not register new active devices (login RPC only).
-- Production may still have shop_device_heartbeat from 048 (returns void); 089 returns jsonb.
-- DROP required before CREATE when return type differs.

drop function if exists public.shop_device_heartbeat (uuid, text, text, text, text);

create function public.shop_device_heartbeat (
  p_shop_id uuid,
  p_device_fingerprint text,
  p_label text default null,
  p_platform text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('Africa/Kampala', now());
  v_fp text;
  v_status public.shop_device_status;
  v_recent_reject timestamptz;
begin
  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  select d.status
  into v_status
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

  if v_status is null then
    return jsonb_build_object(
      'ok', false,
      'accepted', false,
      'status', 'unregistered',
      'needs_login_activation', true
    );
  end if;

  if v_status <> 'active'::public.shop_device_status then
    select al.created_at
    into v_recent_reject
    from public.audit_logs al
    where al.shop_id = p_shop_id
      and al.action = 'device_heartbeat_rejected'
      and al.device_id = v_fp
      and al.created_at > now() - interval '15 minutes'
    order by al.created_at desc
    limit 1;

    if v_recent_reject is null then
      perform public.audit_shop_device_event(
        p_shop_id,
        'device_heartbeat_rejected',
        'Heartbeat rejected for non-active device',
        v_fp,
        jsonb_build_object('status', v_status::text)
      );
    end if;

    return jsonb_build_object('ok', false, 'accepted', false, 'status', v_status::text);
  end if;

  update public.shop_devices d
  set
    label = coalesce(nullif(trim(coalesce(p_label, '')), ''), d.label),
    platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
    app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
    last_seen_at = v_now,
    updated_at = now()
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp
    and d.status = 'active'::public.shop_device_status;

  update public.shops sh
  set
    last_seen_at = v_now,
    updated_at = now()
  where sh.id = p_shop_id;

  perform public.refresh_shop_active_device_count(p_shop_id);

  return jsonb_build_object('ok', true, 'accepted', true, 'status', 'active');
end;
$$;

revoke all on function public.shop_device_heartbeat (uuid, text, text, text, text) from public;
grant execute on function public.shop_device_heartbeat (uuid, text, text, text, text) to authenticated;
