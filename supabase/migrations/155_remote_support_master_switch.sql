-- RS-FREEZE-1: Remote Support master switch (platform_settings).
-- Reuses existing public.platform_settings. Does not alter remote_support_* tables.
-- Default OFF. Missing row or failed read is disabled (fail closed).

insert into public.platform_settings (key, value)
values ('remote_support', jsonb_build_object('enabled', false))
on conflict (key) do nothing;

create or replace function public.remote_support_is_enabled ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select (ps.value ->> 'enabled') = 'true'
      from public.platform_settings ps
      where ps.key = 'remote_support'
    ),
    false
  );
$$;

revoke all on function public.remote_support_is_enabled () from public;

create or replace function public.get_remote_support_platform_settings ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('enabled', public.remote_support_is_enabled ());
end;
$$;

revoke all on function public.get_remote_support_platform_settings () from public;
grant execute on function public.get_remote_support_platform_settings () to authenticated;

create or replace function public.admin_update_remote_support_platform_settings (p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merged jsonb;
begin
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not public.waka_can_remote_support () then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_merged := jsonb_build_object('enabled', coalesce(p_enabled, false));

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('remote_support', v_merged, now(), auth.uid ())
  on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'settings', v_merged);
end;
$$;

revoke all on function public.admin_update_remote_support_platform_settings (boolean) from public;
grant execute on function public.admin_update_remote_support_platform_settings (boolean) to authenticated;

comment on function public.admin_update_remote_support_platform_settings (boolean) is
  'RS-FREEZE-1 master switch. super_admin and support_admin only. Default remains off.';

-- ---------- Gate request_start (preserves 154 ticket shop binding) ----------
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
  if not public.remote_support_is_enabled () then
    return jsonb_build_object('ok', false, 'error', 'remote_support_disabled');
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

-- ---------- Gate customer approve (preserves 152 body) ----------
create or replace function public.remote_support_customer_approve (
  p_request_id uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.remote_support_requests%rowtype;
  v_dev public.shop_devices%rowtype;
  v_fp text;
  v_session_id uuid;
  v_grant uuid;
  v_grant_exp timestamptz;
begin
  perform public.remote_support_expire_stale ();

  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not public.remote_support_is_enabled () then
    return jsonb_build_object('ok', false, 'error', 'remote_support_disabled');
  end if;

  select * into v_req from public.remote_support_requests r where r.id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  perform public.remote_support_expire_stale (v_req.shop_id);
  select * into v_req from public.remote_support_requests r where r.id = p_request_id;

  if not public.user_can_access_shop (v_req.shop_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_req.device_fingerprint is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'device_mismatch');
  end if;
  if v_req.status = 'expired' or v_req.expires_at <= now () then
    return jsonb_build_object('ok', false, 'error', 'request_expired');
  end if;
  if v_req.status is distinct from 'requested' then
    return jsonb_build_object('ok', false, 'error', 'invalid_state');
  end if;

  select * into v_dev from public.shop_devices d where d.id = v_req.shop_device_id;
  if v_dev.id is null
    or v_dev.shop_id is distinct from v_req.shop_id
    or v_dev.device_fingerprint is distinct from v_req.device_fingerprint
    or not public._remote_support_device_is_eligible (v_dev.id)
  then
    update public.remote_support_requests
    set status = 'expired'
    where id = v_req.id
      and status = 'requested';
    perform public._remote_support_append_event (
      null, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', auth.uid (), 'request_expired',
      jsonb_build_object('request_id', v_req.id, 'reason', 'device_no_longer_eligible')
    );
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
  end if;

  v_grant := gen_random_uuid ();
  v_grant_exp := now () + public.remote_support_grant_ttl ();

  update public.remote_support_requests
  set
    status = 'approved',
    customer_responded_at = now (),
    customer_actor_type = 'member',
    customer_actor_id = auth.uid ()
  where id = v_req.id
    and status = 'requested'
    and exists (
      select 1
      from public.shop_devices d
      where d.id = v_req.shop_device_id
        and d.shop_id = v_req.shop_id
        and d.device_fingerprint = v_req.device_fingerprint
        and public._remote_support_device_is_eligible (d.id)
    );

  if not found then
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
  end if;

  insert into public.remote_support_sessions (
    request_id, shop_id, shop_device_id, technician_admin_id, status,
    approved_at, grant_jti, grant_expires_at
  )
  values (
    v_req.id, v_req.shop_id, v_req.shop_device_id, v_req.technician_admin_id, 'connecting',
    now (), v_grant, v_grant_exp
  )
  returning id into v_session_id;

  perform public._remote_support_append_event (
    v_session_id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'customer', auth.uid (), 'customer_approved',
    jsonb_build_object('request_id', v_req.id, 'session_id', v_session_id)
  );
  perform public._remote_support_append_event (
    v_session_id, v_req.id, v_req.shop_id, v_req.shop_device_id, 'system', null, 'session_created',
    jsonb_build_object('session_id', v_session_id)
  );
  perform public._remote_support_shop_audit (
    v_req.shop_id,
    'remote_support_customer_approved',
    'Customer approved remote support',
    v_fp,
    jsonb_build_object('request_id', v_req.id, 'session_id', v_session_id)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'session_id', v_session_id,
    'status', 'approved'
  );
end;
$$;

revoke all on function public.remote_support_customer_approve (uuid, text) from public;
grant execute on function public.remote_support_customer_approve (uuid, text) to authenticated;

-- ---------- Gate grant_assert ----------
create or replace function public.remote_support_grant_assert (
  p_session_id uuid,
  p_grant_jti uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.remote_support_sessions%rowtype;
  v_fp text;
  v_req_fp text;
  v_consumed uuid;
  v_status text;
begin
  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not public.remote_support_is_enabled () then
    return jsonb_build_object('ok', false, 'error', 'remote_support_disabled');
  end if;

  select * into v_sess from public.remote_support_sessions s where s.id = p_session_id;
  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'error', 'grant_session_mismatch');
  end if;

  select r.device_fingerprint into v_req_fp
  from public.remote_support_requests r
  where r.id = v_sess.request_id;

  if not (
    public.user_can_access_shop (v_sess.shop_id)
    or public.waka_can_remote_support ()
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_sess.grant_jti is distinct from p_grant_jti then
    return jsonb_build_object('ok', false, 'error', 'grant_invalid');
  end if;
  if v_req_fp is distinct from v_fp then
    return jsonb_build_object('ok', false, 'error', 'grant_device_mismatch');
  end if;
  if v_sess.grant_consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'grant_replayed');
  end if;
  if v_sess.grant_expires_at <= now () then
    return jsonb_build_object('ok', false, 'error', 'grant_expired');
  end if;
  if v_sess.status not in ('connecting', 'active') then
    return jsonb_build_object('ok', false, 'error', 'grant_invalid');
  end if;
  if not public._remote_support_device_is_eligible (v_sess.shop_device_id) then
    update public.remote_support_sessions
    set
      status = 'revoked',
      ended_at = now (),
      ended_by = 'system',
      failure_reason = 'device_no_longer_eligible',
      grant_consumed_at = coalesce(grant_consumed_at, now ()),
      grant_expires_at = least(grant_expires_at, now ())
    where id = v_sess.id
      and status in ('connecting', 'active');
    perform public._remote_support_append_event (
      v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', auth.uid (), 'session_revoked',
      jsonb_build_object('session_id', v_sess.id, 'reason', 'device_no_longer_eligible')
    );
    return jsonb_build_object('ok', false, 'error', 'device_no_longer_eligible');
  end if;

  update public.remote_support_sessions s
  set grant_consumed_at = now ()
  where s.id = v_sess.id
    and s.grant_jti = p_grant_jti
    and s.grant_consumed_at is null
    and s.grant_expires_at > now ()
    and s.status in ('connecting', 'active')
    and exists (
      select 1
      from public.remote_support_requests r
      join public.shop_devices d on d.id = s.shop_device_id
      where r.id = s.request_id
        and r.device_fingerprint = v_fp
        and d.shop_id = s.shop_id
        and d.device_fingerprint = r.device_fingerprint
        and public._remote_support_device_is_eligible (d.id)
    )
  returning s.id, s.status into v_consumed, v_status;

  if v_consumed is null then
    return jsonb_build_object('ok', false, 'error', 'grant_replayed');
  end if;

  perform public._remote_support_append_event (
    v_sess.id, v_sess.request_id, v_sess.shop_id, v_sess.shop_device_id, 'system', auth.uid (), 'grant_asserted',
    jsonb_build_object('session_id', v_sess.id)
  );

  return jsonb_build_object('ok', true, 'session_id', v_sess.id, 'status', v_status);
end;
$$;

revoke all on function public.remote_support_grant_assert (uuid, uuid, text) from public;
grant execute on function public.remote_support_grant_assert (uuid, uuid, text) to authenticated;

-- ---------- Gate customer inbox ----------
create or replace function public.remote_support_customer_inbox (p_device_fingerprint text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_req jsonb;
  v_sess jsonb;
begin
  v_fp := trim(coalesce(p_device_fingerprint, ''));
  if auth.uid () is null or char_length(v_fp) < 8 then
    return jsonb_build_object('request', null, 'session', null);
  end if;
  if not public.remote_support_is_enabled () then
    return jsonb_build_object('request', null, 'session', null);
  end if;

  select jsonb_build_object(
    'id', r.id,
    'shop_id', r.shop_id,
    'shop_device_id', r.shop_device_id,
    'device_fingerprint', r.device_fingerprint,
    'technician_name', coalesce(nullif(trim(ia.full_name), ''), 'WAKA Support'),
    'reason_code', r.reason_code,
    'reason_text', r.reason_text,
    'status', r.status,
    'requested_at', r.requested_at,
    'expires_at', r.expires_at
  )
  into v_req
  from public.remote_support_requests r
  join public.internal_admins ia on ia.id = r.technician_admin_id
  join public.shop_devices d on d.id = r.shop_device_id
  where r.device_fingerprint = v_fp
    and d.device_fingerprint = v_fp
    and d.shop_id = r.shop_id
    and r.status = 'requested'
    and r.expires_at > now ()
    and public.user_can_access_shop (r.shop_id)
  order by r.requested_at desc
  limit 1;

  select jsonb_build_object(
    'id', s.id,
    'request_id', s.request_id,
    'shop_id', s.shop_id,
    'shop_device_id', s.shop_device_id,
    'technician_name', coalesce(nullif(trim(ia.full_name), ''), 'WAKA Support'),
    'status', s.status,
    'approved_at', s.approved_at
  )
  into v_sess
  from public.remote_support_sessions s
  join public.remote_support_requests r on r.id = s.request_id
  join public.internal_admins ia on ia.id = s.technician_admin_id
  join public.shop_devices d on d.id = s.shop_device_id
  where r.device_fingerprint = v_fp
    and d.device_fingerprint = v_fp
    and d.shop_id = s.shop_id
    and s.status in ('connecting', 'active')
    and public.user_can_access_shop (s.shop_id)
  order by s.approved_at desc
  limit 1;

  return jsonb_build_object('request', v_req, 'session', v_sess);
end;
$$;

revoke all on function public.remote_support_customer_inbox (text) from public;
grant execute on function public.remote_support_customer_inbox (text) to authenticated;
