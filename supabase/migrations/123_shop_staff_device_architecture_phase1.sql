-- Phase 1: Shop-first staff & device architecture.
-- Staff belong to shops (cloud authoritative); devices cache staff; one primary device per shop.

-- ---------- Device roles & primary register ----------
alter table public.shop_devices
  add column if not exists device_type text not null default 'secondary_pos',
  add column if not exists is_primary boolean not null default false,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_login_at timestamptz,
  add column if not exists current_staff_client_id uuid;

alter table public.shop_devices
  drop constraint if exists shop_devices_device_type_check;

alter table public.shop_devices
  add constraint shop_devices_device_type_check check (
    device_type in (
      'primary_pos',
      'secondary_pos',
      'kitchen_display',
      'bar_display',
      'windows_pos',
      'mobile_pos',
      'customer_display'
    )
  );

create unique index if not exists shop_devices_one_primary_per_shop
  on public.shop_devices (shop_id)
  where is_primary = true
    and status = 'active'::public.shop_device_status;

alter table public.shops
  add column if not exists primary_device_id uuid references public.shop_devices (id) on delete set null;

-- Backfill: earliest active device becomes primary when none assigned.
with ranked as (
  select
    d.id,
    d.shop_id,
    row_number() over (partition by d.shop_id order by d.created_at asc) as rn
  from public.shop_devices d
  where d.status = 'active'::public.shop_device_status
)
update public.shop_devices d
set
  is_primary = true,
  device_type = 'primary_pos',
  updated_at = now ()
from ranked r
where d.id = r.id
  and r.rn = 1
  and not exists (
    select 1
    from public.shop_devices d2
    where d2.shop_id = d.shop_id
      and d2.is_primary = true
      and d2.status = 'active'::public.shop_device_status
  );

update public.shops sh
set primary_device_id = d.id, updated_at = now ()
from public.shop_devices d
where d.shop_id = sh.id
  and d.is_primary = true
  and d.status = 'active'::public.shop_device_status
  and sh.primary_device_id is null;

-- ---------- Staff identity fields ----------
alter table public.shop_pos_staff
  add column if not exists email text,
  add column if not exists last_login_at timestamptz,
  add column if not exists last_device_fingerprint text,
  add column if not exists failed_pin_attempts int not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists last_failed_login_at timestamptz;

alter table public.shop_pos_staff
  drop constraint if exists shop_pos_staff_role_check;

alter table public.shop_pos_staff
  add constraint shop_pos_staff_role_check check (
    role in (
      'manager',
      'cashier',
      'stock_keeper',
      'supervisor',
      'waiter',
      'kitchen',
      'bar'
    )
  );

-- ---------- Primary device helpers ----------
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
  v_has_primary boolean;
begin
  if p_shop_id is null then
    return false;
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null then
    return true;
  end if;

  select exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.is_primary = true
      and d.status = 'active'::public.shop_device_status
  )
  into v_has_primary;

  if not v_has_primary then
    return true;
  end if;

  return exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and d.is_primary = true
      and d.status = 'active'::public.shop_device_status
  );
end;
$$;

revoke all on function public.shop_device_can_manage_staff (uuid, text) from public;
grant execute on function public.shop_device_can_manage_staff (uuid, text) to authenticated;

create or replace function public.shop_device_context (
  p_shop_id uuid,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_row public.shop_devices%rowtype;
  v_primary_fp text;
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');

  select d.*
  into v_row
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp
  limit 1;

  select d.device_fingerprint
  into v_primary_fp
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.is_primary = true
    and d.status = 'active'::public.shop_device_status
  limit 1;

  return jsonb_build_object (
    'shop_id', p_shop_id,
    'device_fingerprint', v_fp,
    'device_id', v_row.id,
    'device_type', coalesce (v_row.device_type, 'secondary_pos'),
    'is_primary', coalesce (v_row.is_primary, false),
    'primary_device_fingerprint', v_primary_fp,
    'status', coalesce (v_row.status::text, 'unknown'),
    'last_sync_at', v_row.last_sync_at,
    'last_login_at', v_row.last_login_at,
    'current_staff_client_id', v_row.current_staff_client_id
  );
end;
$$;

revoke all on function public.shop_device_context (uuid, text) from public;
grant execute on function public.shop_device_context (uuid, text) to authenticated;

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
declare
  v_fp text;
  v_device_id uuid;
  v_type text;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null or length (v_fp) < 8 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_fingerprint');
  end if;

  v_type := coalesce (nullif (trim (p_device_type), ''), 'primary_pos');
  if v_type not in (
    'primary_pos', 'secondary_pos', 'kitchen_display', 'bar_display',
    'windows_pos', 'mobile_pos', 'customer_display'
  ) then
    v_type := 'primary_pos';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, v_fp) then
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
  end if;

  update public.shop_devices d
  set is_primary = false, updated_at = now ()
  where d.shop_id = p_shop_id
    and d.is_primary = true
    and d.device_fingerprint <> v_fp;

  update public.shop_devices d
  set
    is_primary = true,
    device_type = v_type,
    status = 'active'::public.shop_device_status,
    updated_at = now ()
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp
  returning d.id into v_device_id;

  if v_device_id is null then
    return jsonb_build_object ('ok', false, 'error', 'device_not_found');
  end if;

  update public.shops sh
  set primary_device_id = v_device_id, updated_at = now ()
  where sh.id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'device_primary_changed',
    'Primary POS device updated',
    jsonb_build_object ('device_id', v_device_id, 'device_fingerprint', v_fp)
  );

  return jsonb_build_object ('ok', true, 'device_id', v_device_id);
end;
$$;

revoke all on function public.shop_device_set_primary (uuid, text, text) from public;
grant execute on function public.shop_device_set_primary (uuid, text, text) to authenticated;

-- Auto-assign primary on first device registration.
create or replace function public.shop_device_assign_primary_if_missing (
  p_shop_id uuid,
  p_device_fingerprint text,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_device_id uuid;
  v_type text;
begin
  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null then
    return;
  end if;

  if exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.is_primary = true
      and d.status = 'active'::public.shop_device_status
  ) then
    return;
  end if;

  v_type := case
    when lower (coalesce (p_platform, '')) like '%android%' then 'mobile_pos'
    when lower (coalesce (p_platform, '')) like '%ios%' then 'mobile_pos'
    when lower (coalesce (p_platform, '')) = 'web' then 'windows_pos'
    else 'primary_pos'
  end;

  update public.shop_devices d
  set
    is_primary = true,
    device_type = v_type,
    updated_at = now ()
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp
  returning d.id into v_device_id;

  if v_device_id is not null then
    update public.shops sh
    set primary_device_id = v_device_id, updated_at = now ()
    where sh.id = p_shop_id;
  end if;
end;
$$;

-- ---------- Staff RPC updates ----------
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
        'permissions', s.permissions,
        'is_active', s.is_active,
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
  into j
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return j;
end;
$$;

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
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
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

revoke all on function public.shop_pos_staff_upsert (uuid, jsonb, text) from public;
grant execute on function public.shop_pos_staff_upsert (uuid, jsonb, text) to authenticated;

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
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
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

revoke all on function public.shop_pos_staff_set_active (uuid, uuid, boolean, text) from public;
grant execute on function public.shop_pos_staff_set_active (uuid, uuid, boolean, text) to authenticated;

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
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
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

revoke all on function public.shop_pos_staff_delete (uuid, uuid, text) from public;
grant execute on function public.shop_pos_staff_delete (uuid, uuid, text) to authenticated;

create or replace function public.shop_pos_staff_record_login (
  p_shop_id uuid,
  p_client_id uuid,
  p_device_fingerprint text,
  p_success boolean,
  p_max_attempts int default 5,
  p_lock_minutes int default 15
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
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
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
    update public.shop_pos_staff s
    set
      last_login_at = v_now,
      last_device_fingerprint = nullif (trim (p_device_fingerprint), ''),
      failed_pin_attempts = 0,
      locked_until = null,
      last_failed_login_at = null,
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

    return jsonb_build_object ('ok', true, 'success', true);
  end if;

  v_attempts := coalesce (v_staff.failed_pin_attempts, 0) + 1;

  update public.shop_pos_staff s
  set
    failed_pin_attempts = v_attempts,
    last_failed_login_at = v_now,
    locked_until = case
      when v_attempts >= greatest (p_max_attempts, 1) then v_now + make_interval (mins => greatest (p_lock_minutes, 1))
      else s.locked_until
    end,
    updated_at = v_now
  where s.id = v_staff.id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'system',
    'staff_login_failed',
    'Staff PIN login failed',
    jsonb_build_object (
      'client_id', p_client_id,
      'attempts', v_attempts,
      'device_fingerprint', p_device_fingerprint
    )
  );

  return jsonb_build_object (
    'ok', true,
    'success', false,
    'attempts', v_attempts,
    'locked_until', (
      select s.locked_until from public.shop_pos_staff s where s.id = v_staff.id
    )
  );
end;
$$;

revoke all on function public.shop_pos_staff_record_login (uuid, uuid, text, boolean, int, int) from public;
grant execute on function public.shop_pos_staff_record_login (uuid, uuid, text, boolean, int, int) to authenticated;

-- Auto-promote first registered device to primary.
create or replace function public.trg_shop_devices_assign_primary ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.shop_device_assign_primary_if_missing (
    new.shop_id,
    new.device_fingerprint,
    new.platform
  );
  return new;
end;
$$;

drop trigger if exists trg_shop_devices_auto_primary on public.shop_devices;
create trigger trg_shop_devices_auto_primary
  after insert on public.shop_devices
  for each row
  execute function public.trg_shop_devices_assign_primary ();
