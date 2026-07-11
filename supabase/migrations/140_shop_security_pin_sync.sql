-- Phase 20.4: Enterprise Shop Security PIN — dedicated shop-scoped credential sync.

create table if not exists public.shop_security_credentials (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  pin_hash text,
  pin_version bigint not null default 0,
  pin_updated_at timestamptz,
  pin_updated_by uuid references auth.users (id),
  created_at timestamptz not null default timezone('Africa/Kampala', now()),
  updated_at timestamptz not null default timezone('Africa/Kampala', now())
);

comment on table public.shop_security_credentials is
  'Shop-scoped Shop Security / Back Office PIN hash (Argon2id). Server authoritative; never plaintext.';

alter table public.shop_security_credentials enable row level security;

create or replace function public.is_valid_shop_security_pin_hash (p_hash text)
returns boolean
language sql
immutable
as $$
  select p_hash is not null
    and length(trim(p_hash)) >= 16
    and (
      p_hash like 'argon2id:%'
      or p_hash like 'bcrypt:%'
      or p_hash like 'pbkdf2:%'
    );
$$;

create or replace function public.shop_security_pin_assert_operational_device (
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
begin
  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null then
    return true;
  end if;

  return exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and public.shop_device_is_operational(d.approval_status, d.status)
  );
end;
$$;

create or replace function public.shop_security_pin_get (
  p_shop_id uuid,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.shop_security_credentials%rowtype;
begin
  if p_shop_id is null then
    raise exception 'shop_id required';
  end if;

  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  perform public.require_verified_email_for_cloud();

  if not public.shop_security_pin_assert_operational_device(p_shop_id, p_device_fingerprint) then
    return jsonb_build_object('ok', false, 'error', 'device_not_authorized');
  end if;

  select c.*
  into v_row
  from public.shop_security_credentials c
  where c.shop_id = p_shop_id;

  if v_row.shop_id is null then
    return jsonb_build_object(
      'ok', true,
      'configured', false,
      'pin_hash', null,
      'version', 0,
      'updated_at', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'configured', v_row.pin_hash is not null,
    'pin_hash', v_row.pin_hash,
    'version', coalesce(v_row.pin_version, 0),
    'updated_at', v_row.pin_updated_at
  );
end;
$$;

create or replace function public.shop_security_pin_upsert (
  p_shop_id uuid,
  p_pin_hash text,
  p_expected_version bigint default null,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_security_credentials%rowtype;
  v_now timestamptz := timezone('Africa/Kampala', now());
  v_new_version bigint;
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_security_pin_assert_operational_device(p_shop_id, p_device_fingerprint) then
    return jsonb_build_object('ok', false, 'error', 'device_not_authorized');
  end if;

  if not public.is_valid_shop_security_pin_hash(p_pin_hash) then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin_hash');
  end if;

  select c.*
  into v_row
  from public.shop_security_credentials c
  where c.shop_id = p_shop_id
  for update;

  if v_row.shop_id is null then
    insert into public.shop_security_credentials (
      shop_id, pin_hash, pin_version, pin_updated_at, pin_updated_by, updated_at
    )
    values (
      p_shop_id, p_pin_hash, 1, v_now, auth.uid(), v_now
    );

    insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
    values (
      p_shop_id,
      auth.uid(),
      'owner',
      'shop_security_pin_created',
      'Shop Security PIN created',
      jsonb_build_object('version', 1)
    );

    return jsonb_build_object('ok', true, 'version', 1, 'updated_at', v_now);
  end if;

  if p_expected_version is not null
    and coalesce(v_row.pin_version, 0) <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'version_conflict',
      'version', coalesce(v_row.pin_version, 0),
      'pin_hash', v_row.pin_hash,
      'updated_at', v_row.pin_updated_at
    );
  end if;

  v_new_version := coalesce(v_row.pin_version, 0) + 1;

  update public.shop_security_credentials c
  set
    pin_hash = p_pin_hash,
    pin_version = v_new_version,
    pin_updated_at = v_now,
    pin_updated_by = auth.uid(),
    updated_at = v_now
  where c.shop_id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid(),
    'owner',
    case when v_row.pin_hash is null then 'shop_security_pin_created' else 'shop_security_pin_changed' end,
    case when v_row.pin_hash is null then 'Shop Security PIN created' else 'Shop Security PIN changed' end,
    jsonb_build_object('version', v_new_version)
  );

  return jsonb_build_object('ok', true, 'version', v_new_version, 'updated_at', v_now);
end;
$$;

create or replace function public.shop_security_pin_clear (
  p_shop_id uuid,
  p_expected_version bigint default null,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_security_credentials%rowtype;
  v_now timestamptz := timezone('Africa/Kampala', now());
  v_new_version bigint;
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_security_pin_assert_operational_device(p_shop_id, p_device_fingerprint) then
    return jsonb_build_object('ok', false, 'error', 'device_not_authorized');
  end if;

  select c.*
  into v_row
  from public.shop_security_credentials c
  where c.shop_id = p_shop_id
  for update;

  if v_row.shop_id is null then
    return jsonb_build_object('ok', true, 'version', 0, 'updated_at', v_now);
  end if;

  if p_expected_version is not null
    and coalesce(v_row.pin_version, 0) <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'version_conflict',
      'version', coalesce(v_row.pin_version, 0)
    );
  end if;

  v_new_version := coalesce(v_row.pin_version, 0) + 1;

  update public.shop_security_credentials c
  set
    pin_hash = null,
    pin_version = v_new_version,
    pin_updated_at = v_now,
    pin_updated_by = auth.uid(),
    updated_at = v_now
  where c.shop_id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid(),
    'owner',
    'shop_security_pin_cleared',
    'Shop Security PIN cleared',
    jsonb_build_object('version', v_new_version)
  );

  return jsonb_build_object('ok', true, 'version', v_new_version, 'updated_at', v_now);
end;
$$;

create or replace function public.shop_security_pin_migrate (
  p_shop_id uuid,
  p_pin_hash text,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_security_credentials%rowtype;
  v_now timestamptz := timezone('Africa/Kampala', now());
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_security_pin_assert_operational_device(p_shop_id, p_device_fingerprint) then
    return jsonb_build_object('ok', false, 'error', 'device_not_authorized');
  end if;

  if not public.is_valid_shop_security_pin_hash(p_pin_hash) then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin_hash');
  end if;

  select c.*
  into v_row
  from public.shop_security_credentials c
  where c.shop_id = p_shop_id
  for update;

  if v_row.shop_id is not null and v_row.pin_hash is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_configured',
      'version', coalesce(v_row.pin_version, 0)
    );
  end if;

  insert into public.shop_security_credentials (
    shop_id, pin_hash, pin_version, pin_updated_at, pin_updated_by, updated_at
  )
  values (
    p_shop_id, p_pin_hash, 1, v_now, auth.uid(), v_now
  )
  on conflict (shop_id) do update
  set
    pin_hash = excluded.pin_hash,
    pin_version = 1,
    pin_updated_at = v_now,
    pin_updated_by = auth.uid(),
    updated_at = v_now
  where public.shop_security_credentials.pin_hash is null;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid(),
    'owner',
    'shop_security_pin_migrated',
    'Shop Security PIN migrated from device',
    jsonb_build_object('version', 1)
  );

  return jsonb_build_object('ok', true, 'version', 1, 'updated_at', v_now, 'migrated', true);
end;
$$;

revoke all on function public.shop_security_pin_get (uuid, text) from public;
grant execute on function public.shop_security_pin_get (uuid, text) to authenticated;

revoke all on function public.shop_security_pin_upsert (uuid, text, bigint, text) from public;
grant execute on function public.shop_security_pin_upsert (uuid, text, bigint, text) to authenticated;

revoke all on function public.shop_security_pin_clear (uuid, bigint, text) from public;
grant execute on function public.shop_security_pin_clear (uuid, bigint, text) to authenticated;

revoke all on function public.shop_security_pin_migrate (uuid, text, text) from public;
grant execute on function public.shop_security_pin_migrate (uuid, text, text) to authenticated;

-- Admin recovery: also clear dedicated credential table.
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

  insert into public.shop_security_credentials (shop_id, pin_hash, pin_version, pin_updated_at, updated_at)
  values (p_shop_id, null, 1, v_cleared_at, v_cleared_at)
  on conflict (shop_id) do update
    set
      pin_hash = null,
      pin_version = coalesce(public.shop_security_credentials.pin_version, 0) + 1,
      pin_updated_at = v_cleared_at,
      updated_at = v_cleared_at;

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
    jsonb_build_object ('at', v_cleared_at, 'cloud_snapshot_cleared', true, 'shop_security_credentials_cleared', true)
  );

  return jsonb_build_object ('ok', true, 'clear_back_office_pin_at', v_cleared_at);
end;
$$;
