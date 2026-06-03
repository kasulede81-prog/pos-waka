-- Phase 2: enforce package device limits only on NEW device activation (login registration).
-- Prerequisites from 088/089 (idempotent — safe if already applied).

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

update public.shop_devices d
set is_active = (d.status = 'active'::public.shop_device_status);

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

revoke all on function public.user_is_shop_owner (uuid) from public;
grant execute on function public.user_is_shop_owner (uuid) to authenticated;

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

create or replace function public.resolve_shop_device_limit (p_shop_id uuid)
returns table (
  device_limit int,
  plan_code text,
  plan_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_features jsonb;
  v_devices jsonb;
  v_limit int;
begin
  if p_shop_id is null then
    return;
  end if;

  select sp.features, sp.code, sp.name
  into v_features, plan_code, plan_name
  from public.shops sh
  join lateral (
    select s2.plan_id
    from public.subscriptions s2
    where s2.organization_id = sh.organization_id
    order by s2.created_at desc
    limit 1
  ) sub on true
  join public.subscription_plans sp on sp.id = sub.plan_id
  where sh.id = p_shop_id
  limit 1;

  if plan_code is null then
    device_limit := null;
    plan_code := 'unknown';
    plan_name := 'Unknown';
    return next;
    return;
  end if;

  v_devices := v_features -> 'devices';
  if jsonb_typeof(v_devices) = 'number' then
    v_limit := (v_devices #>> '{}')::int;
  elsif jsonb_typeof(v_devices) = 'string' then
    v_limit := nullif(trim(both '"' from v_devices::text), '')::int;
  else
    v_limit := null;
  end if;

  if v_limit is null or v_limit <= 0 then
    device_limit := null;
  else
    device_limit := v_limit;
  end if;

  return next;
end;
$$;

revoke all on function public.resolve_shop_device_limit (uuid) from public;
grant execute on function public.resolve_shop_device_limit (uuid) to authenticated;

create or replace function public.count_shop_active_devices (
  p_shop_id uuid,
  p_exclude_fingerprint text default null
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.status = 'active'::public.shop_device_status
    and (
      p_exclude_fingerprint is null
      or d.device_fingerprint <> nullif(trim(p_exclude_fingerprint), '')
    );
$$;

revoke all on function public.count_shop_active_devices (uuid, text) from public;
grant execute on function public.count_shop_active_devices (uuid, text) to authenticated;

create or replace function public.shop_device_limit_context (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j_devices jsonb;
  v_limit int;
  v_code text;
  v_name text;
  v_active int;
  v_is_owner boolean;
begin
  if p_shop_id is null then
    raise exception 'shop_id required';
  end if;

  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_is_owner := public.user_is_shop_owner(p_shop_id);

  select dl.device_limit, dl.plan_code, dl.plan_name
  into v_limit, v_code, v_name
  from public.resolve_shop_device_limit(p_shop_id) dl;

  v_active := public.count_shop_active_devices(p_shop_id, null);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'device_fingerprint', d.device_fingerprint,
        'label', d.label,
        'platform', d.platform,
        'last_seen_at', d.last_seen_at,
        'status', d.status::text
      )
      order by d.last_seen_at desc nulls last, d.created_at desc
    ),
    '[]'::jsonb
  )
  into j_devices
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.status = 'active'::public.shop_device_status;

  return jsonb_build_object(
    'shop_id', p_shop_id,
    'plan_code', coalesce(v_code, 'unknown'),
    'plan_name', coalesce(v_name, 'Unknown'),
    'device_limit', v_limit,
    'active_count', v_active,
    'is_owner', v_is_owner,
    'at_limit', v_limit is not null and v_active >= v_limit,
    'devices', j_devices
  );
end;
$$;

revoke all on function public.shop_device_limit_context (uuid) from public;
grant execute on function public.shop_device_limit_context (uuid) to authenticated;

create or replace function public.owner_record_device_replacement (
  p_shop_id uuid,
  p_old_device_fingerprint text,
  p_new_device_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  perform public.audit_shop_device_event(
    p_shop_id,
    'device_replacement_completed',
    'Device slot freed for new activation',
    p_new_device_fingerprint,
    jsonb_build_object(
      'old_device_fingerprint', nullif(trim(coalesce(p_old_device_fingerprint, '')), ''),
      'new_device_fingerprint', nullif(trim(coalesce(p_new_device_fingerprint, '')), '')
    )
  );
end;
$$;

revoke all on function public.owner_record_device_replacement (uuid, text, text) from public;
grant execute on function public.owner_record_device_replacement (uuid, text, text) to authenticated;

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
  v_limit int;
  v_plan_code text;
  v_plan_name text;
  v_active int;
  v_needs_slot boolean := false;
begin
  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text, 0));

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
      'activated', false,
      'status', 'revoked',
      'reactivated', false
    );
  end if;

  if v_status = 'active'::public.shop_device_status then
    update public.shop_devices d
    set
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    perform public.refresh_shop_active_device_count(p_shop_id);

    return jsonb_build_object(
      'ok', true,
      'accepted', true,
      'activated', true,
      'status', 'active',
      'reactivated', false,
      'existing_device', true
    );
  end if;

  v_needs_slot := v_status is null
    or v_status = 'disconnected'::public.shop_device_status;

  if v_needs_slot then
    select dl.device_limit, dl.plan_code, dl.plan_name
    into v_limit, v_plan_code, v_plan_name
    from public.resolve_shop_device_limit(p_shop_id) dl;

    v_active := public.count_shop_active_devices(p_shop_id, v_fp);

    if v_limit is not null and v_active >= v_limit then
      perform public.audit_shop_device_event(
        p_shop_id,
        'device_limit_hit',
        'Device limit reached during login activation',
        v_fp,
        jsonb_build_object(
          'plan_code', v_plan_code,
          'plan_name', v_plan_name,
          'active_device_count', v_active,
          'device_limit', v_limit
        )
      );

      perform public.audit_shop_device_event(
        p_shop_id,
        'device_login_blocked',
        'Login blocked: device activation over plan limit',
        v_fp,
        jsonb_build_object(
          'plan_code', v_plan_code,
          'plan_name', v_plan_name,
          'active_device_count', v_active,
          'device_limit', v_limit
        )
      );

      return jsonb_build_object(
        'ok', false,
        'accepted', false,
        'activated', false,
        'limit_blocked', true,
        'status', coalesce(v_status::text, 'new'),
        'plan_code', v_plan_code,
        'plan_name', v_plan_name,
        'active_count', v_active,
        'device_limit', v_limit
      );
    end if;
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
  end if;

  perform public.refresh_shop_active_device_count(p_shop_id);

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'activated', true,
    'status', 'active',
    'reactivated', v_reactivated,
    'existing_device', false,
    'plan_code', v_plan_code,
    'plan_name', v_plan_name,
    'active_count', public.count_shop_active_devices(p_shop_id, null),
    'device_limit', v_limit
  );
end;
$$;

create or replace function public.shop_device_ensure_activation (
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
  v_status public.shop_device_status;
  v_fp text;
begin
  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  select d.status
  into v_status
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

  if v_status = 'active'::public.shop_device_status then
    return jsonb_build_object(
      'ok', true,
      'activated', true,
      'existing_device', true,
      'status', 'active'
    );
  end if;

  return public.shop_device_register_on_login(
    p_shop_id,
    p_device_fingerprint,
    p_label,
    p_platform,
    p_app_version
  );
end;
$$;

revoke all on function public.shop_device_ensure_activation (uuid, text, text, text, text) from public;
grant execute on function public.shop_device_ensure_activation (uuid, text, text, text, text) to authenticated;

-- Owner disconnect must set status (not only is_active) for limit + lifecycle consistency.
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

revoke all on function public.owner_disconnect_shop_device (uuid) from public;
grant execute on function public.owner_disconnect_shop_device (uuid) to authenticated;
