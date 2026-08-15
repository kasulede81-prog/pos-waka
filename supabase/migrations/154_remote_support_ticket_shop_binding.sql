-- RS-CI-0.2: bind optional support_request_id to the selected shop.
-- Ticket is context only. Does not authorize Remote Support.
-- Additive: replaces remote_support_request_start only. Does not change 151/152/153.

create or replace function public.remote_support_request_start (
  p_shop_id uuid,
  p_shop_device_id uuid,
  p_reason_code text,
  p_reason_text text,
  p_support_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.internal_admins%rowtype;
  v_dev public.shop_devices%rowtype;
  v_reason_code text;
  v_reason_text text;
  v_id uuid;
  v_expires timestamptz;
  v_ticket_exists boolean;
  v_ticket_shop uuid;
begin
  perform public.remote_support_expire_stale (p_shop_id);

  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not public.waka_can_remote_support () then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select *
  into v_admin
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;

  if v_admin.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_reason_code := lower(trim(coalesce(p_reason_code, '')));
  v_reason_text := trim(coalesce(p_reason_text, ''));
  if v_reason_code = '' or char_length(v_reason_text) < 3 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  select * into v_dev from public.shop_devices d where d.id = p_shop_device_id;
  if v_dev.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;
  if v_dev.shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'error', 'device_shop_mismatch');
  end if;
  if not public._remote_support_device_is_eligible (v_dev.id) then
    if lower(trim(coalesce(v_dev.platform, ''))) is distinct from 'windows' then
      return jsonb_build_object('ok', false, 'error', 'unsupported_platform');
    end if;
    if v_dev.last_seen_at is null or v_dev.last_seen_at < now () - public.remote_support_online_window () then
      return jsonb_build_object('ok', false, 'error', 'device_offline');
    end if;
    return jsonb_build_object('ok', false, 'error', 'device_not_eligible');
  end if;

  if exists (
    select 1
    from public.remote_support_requests r
    where r.shop_device_id = v_dev.id
      and r.status = 'requested'
  ) or exists (
    select 1
    from public.remote_support_sessions s
    where s.shop_device_id = v_dev.id
      and s.status in ('connecting', 'active')
  ) then
    return jsonb_build_object('ok', false, 'error', 'request_exists');
  end if;

  if p_support_request_id is not null then
    select true, sr.shop_id
    into v_ticket_exists, v_ticket_shop
    from public.support_requests sr
    where sr.id = p_support_request_id;

    if v_ticket_exists is not true then
      return jsonb_build_object('ok', false, 'error', 'support_request_not_found');
    end if;
    if v_ticket_shop is distinct from p_shop_id then
      return jsonb_build_object('ok', false, 'error', 'support_request_shop_mismatch');
    end if;
  end if;

  v_expires := now () + public.remote_support_request_ttl ();

  begin
    insert into public.remote_support_requests (
      shop_id, shop_device_id, device_fingerprint, technician_admin_id, technician_user_id,
      reason_code, reason_text, status, requested_at, expires_at, support_request_id
    )
    values (
      p_shop_id, v_dev.id, v_dev.device_fingerprint, v_admin.id, auth.uid (),
      v_reason_code, v_reason_text, 'requested', now (), v_expires, p_support_request_id
    )
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'request_exists');
  end;

  perform public._remote_support_append_event (
    null, v_id, p_shop_id, v_dev.id, 'technician', auth.uid (), 'request_created',
    jsonb_build_object(
      'request_id', v_id,
      'shop_id', p_shop_id,
      'shop_device_id', v_dev.id,
      'reason_code', v_reason_code
    )
  );
  perform public._remote_support_shop_audit (
    p_shop_id,
    'remote_support_request_created',
    'Remote support requested',
    v_dev.device_fingerprint,
    jsonb_build_object('request_id', v_id, 'reason_code', v_reason_code, 'technician_admin_id', v_admin.id)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_id,
    'status', 'requested',
    'expires_at', v_expires
  );
end;
$$;

revoke all on function public.remote_support_request_start (uuid, uuid, text, text, uuid) from public;
grant execute on function public.remote_support_request_start (uuid, uuid, text, text, uuid) to authenticated;

comment on function public.remote_support_request_start (uuid, uuid, text, text, uuid) is
  'Technician Remote Support request. Optional support_request_id is same-shop context only and does not authorize control.';
