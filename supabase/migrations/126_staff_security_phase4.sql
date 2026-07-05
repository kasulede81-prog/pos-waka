-- Phase 4: Staff authentication security hardening.

drop function if exists public.shop_pos_staff_record_login (uuid, uuid, text, boolean, int, int);

alter table public.shop_pos_staff
  add column if not exists first_failed_login_at timestamptz,
  add column if not exists last_login_platform text,
  add column if not exists last_login_ip inet,
  add column if not exists pin_changed_at timestamptz,
  add column if not exists password_changed_at timestamptz,
  add column if not exists failures_in_window int not null default 0,
  add column if not exists failure_window_started_at timestamptz;

create table if not exists public.shop_staff_security_events (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  staff_client_id uuid,
  event_type text not null,
  device_fingerprint text,
  platform text,
  online boolean not null default true,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create index if not exists shop_staff_security_events_shop_created_idx
  on public.shop_staff_security_events (shop_id, created_at desc);

alter table public.shop_staff_security_events enable row level security;

drop policy if exists shop_staff_security_events_select on public.shop_staff_security_events;
create policy shop_staff_security_events_select on public.shop_staff_security_events
  for select to authenticated
  using (public.user_can_access_shop (shop_id));

create or replace function public.shop_pos_staff_record_security_event (
  p_shop_id uuid,
  p_client_id uuid,
  p_event_type text,
  p_device_fingerprint text default null,
  p_platform text default null,
  p_online boolean default true,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
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

  insert into public.shop_staff_security_events (
    shop_id,
    staff_client_id,
    event_type,
    device_fingerprint,
    platform,
    online,
    reason,
    payload
  )
  values (
    p_shop_id,
    p_client_id,
    p_event_type,
    nullif (trim (p_device_fingerprint), ''),
    nullif (trim (p_platform), ''),
    coalesce (p_online, true),
    nullif (trim (p_reason), ''),
    coalesce (p_payload, '{}'::jsonb)
  );

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'system',
    'staff_security_event',
    coalesce (p_reason, p_event_type),
    jsonb_build_object (
      'event_type', p_event_type,
      'client_id', p_client_id,
      'device_fingerprint', p_device_fingerprint,
      'platform', p_platform,
      'online', p_online,
      'payload', coalesce (p_payload, '{}'::jsonb)
    )
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.shop_pos_staff_record_security_event (uuid, uuid, text, text, text, boolean, text, jsonb) from public;
grant execute on function public.shop_pos_staff_record_security_event (uuid, uuid, text, text, text, boolean, text, jsonb) to authenticated;

create or replace function public.shop_pos_staff_record_login (
  p_shop_id uuid,
  p_client_id uuid,
  p_device_fingerprint text,
  p_success boolean,
  p_max_attempts int default 5,
  p_lock_minutes int default 15,
  p_platform text default null,
  p_online boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.shop_pos_staff%rowtype;
  v_now timestamptz := now ();
  v_attempts int;
  v_window int;
  v_locked_until timestamptz;
  v_device public.shop_devices%rowtype;
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if nullif (trim (p_device_fingerprint), '') is not null then
    select d.*
    into v_device
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = trim (p_device_fingerprint)
    limit 1;

    if v_device.id is not null
      and coalesce (v_device.approval_status, 'approved') not in ('approved')
      and v_device.status <> 'active'::public.shop_device_status then
      perform public.shop_pos_staff_record_security_event (
        p_shop_id,
        p_client_id,
        'staff_login_rejected_device',
        p_device_fingerprint,
        p_platform,
        p_online,
        'Unapproved device login attempt',
        jsonb_build_object ('approval_status', v_device.approval_status, 'status', v_device.status)
      );
      return jsonb_build_object ('ok', false, 'error', 'device_not_approved');
    end if;
  end if;

  select s.*
  into v_staff
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.client_id = p_client_id
    and s.deleted_at is null
  limit 1;

  if v_staff.id is null then
    return jsonb_build_object ('ok', false, 'error', 'staff_not_found');
  end if;

  if v_staff.locked_until is not null and v_staff.locked_until > v_now then
    return jsonb_build_object (
      'ok', false,
      'error', 'staff_locked',
      'locked_until', v_staff.locked_until
    );
  end if;

  if p_success then
    if v_staff.last_device_fingerprint is not null
      and nullif (trim (p_device_fingerprint), '') is not null
      and v_staff.last_device_fingerprint <> trim (p_device_fingerprint) then
      perform public.shop_pos_staff_record_security_event (
        p_shop_id,
        p_client_id,
        'staff_device_changed',
        p_device_fingerprint,
        p_platform,
        p_online,
        'Staff logged in from a different device',
        jsonb_build_object (
          'previous_device_fingerprint', v_staff.last_device_fingerprint,
          'new_device_fingerprint', trim (p_device_fingerprint)
        )
      );
    end if;

    update public.shop_pos_staff s
    set
      last_login_at = v_now,
      last_device_fingerprint = nullif (trim (p_device_fingerprint), ''),
      last_login_platform = nullif (trim (p_platform), ''),
      failed_pin_attempts = 0,
      locked_until = null,
      last_failed_login_at = null,
      first_failed_login_at = null,
      failures_in_window = 0,
      failure_window_started_at = null,
      updated_at = v_now
    where s.id = v_staff.id;

    if nullif (trim (p_device_fingerprint), '') is not null then
      update public.shop_devices d
      set
        last_login_at = v_now,
        current_staff_client_id = p_client_id,
        updated_at = v_now
      where d.shop_id = p_shop_id
        and d.device_fingerprint = trim (p_device_fingerprint);
    end if;

    perform public.shop_pos_staff_record_security_event (
      p_shop_id,
      p_client_id,
      'staff_login_success',
      p_device_fingerprint,
      p_platform,
      p_online,
      'Staff login successful',
      '{}'::jsonb
    );

    return jsonb_build_object ('ok', true, 'success', true);
  end if;

  v_attempts := coalesce (v_staff.failed_pin_attempts, 0) + 1;

  v_window := coalesce (v_staff.failures_in_window, 0);
  if v_staff.failure_window_started_at is null
    or v_staff.failure_window_started_at < v_now - interval '24 hours' then
    v_window := 1;
    update public.shop_pos_staff s
    set failure_window_started_at = v_now
    where s.id = v_staff.id;
  else
    v_window := v_window + 1;
  end if;

  v_locked_until := case
    when v_attempts >= greatest (p_max_attempts, 1) then v_now + make_interval (mins => greatest (p_lock_minutes, 1))
    else v_staff.locked_until
  end;

  update public.shop_pos_staff s
  set
    failed_pin_attempts = v_attempts,
    last_failed_login_at = v_now,
    first_failed_login_at = coalesce (s.first_failed_login_at, v_now),
    failures_in_window = v_window,
    locked_until = v_locked_until,
    updated_at = v_now
  where s.id = v_staff.id;

  perform public.shop_pos_staff_record_security_event (
    p_shop_id,
    p_client_id,
    case when v_locked_until is not null and v_locked_until > v_now then 'staff_lockout_triggered' else 'staff_login_failed' end,
    p_device_fingerprint,
    p_platform,
    p_online,
    case when v_locked_until is not null and v_locked_until > v_now then 'Account locked after failed attempts' else 'Staff login failed' end,
    jsonb_build_object ('attempts', v_attempts, 'failures_in_window', v_window)
  );

  if v_window >= 10 then
    perform public.shop_pos_staff_record_security_event (
      p_shop_id,
      p_client_id,
      'staff_security_alert',
      p_device_fingerprint,
      p_platform,
      p_online,
      '10 failed login attempts within 24 hours',
      jsonb_build_object ('failures_in_window', v_window)
    );
  end if;

  return jsonb_build_object (
    'ok', true,
    'success', false,
    'attempts', v_attempts,
    'failures_in_window', v_window,
    'locked_until', v_locked_until
  );
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
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
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

  perform public.shop_pos_staff_record_security_event (
    p_shop_id,
    p_client_id,
    'staff_account_unlocked',
    p_device_fingerprint,
    null,
    true,
    'Owner unlocked staff account',
    '{}'::jsonb
  );

  return jsonb_build_object ('ok', true);
end;
$$;

revoke all on function public.shop_pos_staff_unlock (uuid, uuid, text) from public;
grant execute on function public.shop_pos_staff_unlock (uuid, uuid, text) to authenticated;

-- Extend staff list payloads with security fields (keep returns jsonb — matches 123).
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
