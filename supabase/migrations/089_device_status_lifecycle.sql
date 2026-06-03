-- Device lifecycle: ACTIVE / DISCONNECTED / REVOKED. Heartbeat cannot reactivate; login can.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'shop_device_status') then
    create type public.shop_device_status as enum ('active', 'disconnected', 'revoked');
  end if;
end
$$;

alter table public.shop_devices
  add column if not exists status public.shop_device_status not null default 'active';

update public.shop_devices d
set status = 'disconnected'::public.shop_device_status
where d.is_active = false
  and d.status = 'active'::public.shop_device_status;

update public.shop_devices d
set status = 'active'::public.shop_device_status
where d.is_active = true
  and d.status is distinct from 'active'::public.shop_device_status;

create or replace function public.sync_shop_device_is_active ()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.status = 'active'::public.shop_device_status);
  return new;
end;
$$;

drop trigger if exists trg_shop_devices_sync_is_active on public.shop_devices;
create trigger trg_shop_devices_sync_is_active
  before insert or update of status on public.shop_devices
  for each row
  execute function public.sync_shop_device_is_active ();

-- Backfill is_active from status for existing rows
update public.shop_devices d
set is_active = (d.status = 'active'::public.shop_device_status);

create or replace function public.refresh_shop_active_device_count (p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_shop_id is null then
    return;
  end if;

  update public.shops sh
  set
    active_device_count = (
      select count(*)::int
      from public.shop_devices d
      where d.shop_id = p_shop_id
        and d.status = 'active'::public.shop_device_status
    ),
    updated_at = now ()
  where sh.id = p_shop_id;
end;
$$;

revoke all on function public.refresh_shop_active_device_count (uuid) from public;
grant execute on function public.refresh_shop_active_device_count (uuid) to authenticated;

create or replace function public.audit_shop_device_event (
  p_shop_id uuid,
  p_action text,
  p_summary text,
  p_device_fingerprint text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_shop_id is null or p_action is null then
    return;
  end if;

  select sm.role
  into v_role
  from public.shop_members sm
  where sm.shop_id = p_shop_id
    and sm.user_id = auth.uid ()
  order by (case when sm.role = 'owner' then 0 else 1 end)
  limit 1;

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
    coalesce(v_role, 'owner'),
    p_action,
    p_summary,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object (
      'shop_id', p_shop_id,
      'device_fingerprint', nullif(trim(coalesce(p_device_fingerprint, '')), ''),
      'actor_user_id', auth.uid (),
      'at', timezone('Africa/Kampala', now())
    ),
    nullif(trim(coalesce(p_device_fingerprint, '')), '')
  );
end;
$$;

revoke all on function public.audit_shop_device_event (uuid, text, text, text, jsonb) from public;
grant execute on function public.audit_shop_device_event (uuid, text, text, text, jsonb) to authenticated;

create or replace function public.shop_device_heartbeat (
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

  if v_status is not null and v_status <> 'active'::public.shop_device_status then
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

  insert into public.shop_devices (
    shop_id,
    device_fingerprint,
    label,
    platform,
    app_version,
    last_seen_at,
    status,
    updated_at
  )
  values (
    p_shop_id,
    v_fp,
    nullif(trim(coalesce(p_label, '')), ''),
    nullif(trim(coalesce(p_platform, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    v_now,
    'active'::public.shop_device_status,
    now()
  )
  on conflict (shop_id, device_fingerprint) do update
  set
    label = coalesce(excluded.label, shop_devices.label),
    platform = coalesce(excluded.platform, shop_devices.platform),
    app_version = coalesce(excluded.app_version, shop_devices.app_version),
    last_seen_at = excluded.last_seen_at,
    updated_at = now()
  where shop_devices.status = 'active'::public.shop_device_status;

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

create or replace function public.shop_device_register_on_login (
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
  v_label text;
  v_reactivated boolean := false;
begin
  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  v_label := nullif(trim(coalesce(p_label, '')), '');

  select d.status
  into v_status
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

  if v_status = 'revoked'::public.shop_device_status then
    return jsonb_build_object(
      'ok', false,
      'accepted', false,
      'status', 'revoked',
      'reactivated', false
    );
  end if;

  if v_status = 'disconnected'::public.shop_device_status then
    update public.shop_devices d
    set
      status = 'active'::public.shop_device_status,
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    v_reactivated := true;

    perform public.audit_shop_device_event(
      p_shop_id,
      'device_reactivated',
      'Device reactivated after login',
      v_fp,
      jsonb_build_object('previous_status', 'disconnected')
    );
  elsif v_status is null then
    insert into public.shop_devices (
      shop_id,
      device_fingerprint,
      label,
      platform,
      app_version,
      last_seen_at,
      status,
      updated_at
    )
    values (
      p_shop_id,
      v_fp,
      v_label,
      nullif(trim(coalesce(p_platform, '')), ''),
      nullif(trim(coalesce(p_app_version, '')), ''),
      v_now,
      'active'::public.shop_device_status,
      now()
    );
  else
    update public.shop_devices d
    set
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and d.status = 'active'::public.shop_device_status;
  end if;

  perform public.refresh_shop_active_device_count(p_shop_id);

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'status', 'active',
    'reactivated', v_reactivated
  );
end;
$$;

revoke all on function public.shop_device_register_on_login (uuid, text, text, text, text) from public;
grant execute on function public.shop_device_register_on_login (uuid, text, text, text, text) to authenticated;

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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'device_fingerprint', d.device_fingerprint,
        'label', d.label,
        'platform', d.platform,
        'app_version', d.app_version,
        'last_seen_at', d.last_seen_at,
        'status', d.status::text,
        'is_active', d.is_active,
        'created_at', d.created_at
      )
      order by (d.status = 'active'::public.shop_device_status) desc,
        d.last_seen_at desc nulls last,
        d.created_at desc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_devices d
  where d.shop_id = p_shop_id;

  return j;
end;
$$;

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

  update public.shop_devices d
  set
    status = 'disconnected'::public.shop_device_status,
    updated_at = now()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(v_shop);

  perform public.audit_shop_device_event(
    v_shop,
    'device_disconnected',
    'Disconnected device: ' || v_label,
    v_fp,
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'shop_id', v_shop,
    'status', 'disconnected'
  );
end;
$$;
