-- Phase 2: Explicit device authority (primary/secondary), approval workflow, health tracking.
-- Builds on migration 123 — does not change auth/signup flows.

-- ---------- Explicit authority & approval (separate from form factor) ----------
alter table public.shop_devices
  add column if not exists device_authority text not null default 'secondary',
  add column if not exists approval_status text not null default 'approved',
  add column if not exists form_factor text not null default 'tablet',
  add column if not exists pending_uploads int not null default 0,
  add column if not exists pending_downloads int not null default 0,
  add column if not exists current_shift_id uuid,
  add column if not exists cloud_status text,
  add column if not exists recovery_status text;

alter table public.shop_devices
  drop constraint if exists shop_devices_device_authority_check;

alter table public.shop_devices
  add constraint shop_devices_device_authority_check check (
    device_authority in ('primary', 'secondary')
  );

alter table public.shop_devices
  drop constraint if exists shop_devices_approval_status_check;

alter table public.shop_devices
  add constraint shop_devices_approval_status_check check (
    approval_status in ('pending', 'approved', 'suspended', 'revoked', 'disabled')
  );

alter table public.shop_devices
  drop constraint if exists shop_devices_form_factor_check;

alter table public.shop_devices
  add constraint shop_devices_form_factor_check check (
    form_factor in ('tablet', 'phone', 'windows', 'kitchen', 'bar')
  );

-- Backfill authority from is_primary
update public.shop_devices d
set device_authority = case when d.is_primary then 'primary' else 'secondary' end
where d.device_authority is distinct from case when d.is_primary then 'primary' else 'secondary' end;

-- Backfill approval from lifecycle status
update public.shop_devices d
set approval_status = case
  when d.status = 'revoked'::public.shop_device_status then 'revoked'
  when d.approval_status = 'pending' then 'pending'
  else 'approved'
end;

-- Backfill form factor from platform / device_type
update public.shop_devices d
set form_factor = case
  when d.device_type in ('kitchen_display') then 'kitchen'
  when d.device_type in ('bar_display') then 'bar'
  when d.device_type in ('windows_pos') then 'windows'
  when d.device_type in ('mobile_pos') then 'phone'
  when lower (coalesce (d.platform, '')) like '%android%' then 'tablet'
  when lower (coalesce (d.platform, '')) like '%ios%' then 'phone'
  when lower (coalesce (d.platform, '')) = 'web' then 'windows'
  else 'tablet'
end
where d.form_factor = 'tablet';

-- Keep is_primary synced with device_authority
create or replace function public.sync_shop_device_authority ()
returns trigger
language plpgsql
as $$
begin
  new.is_primary := (new.device_authority = 'primary');
  if new.device_authority = 'primary' then
    new.device_type := coalesce (
      nullif (new.device_type, ''),
      case new.form_factor
        when 'kitchen' then 'kitchen_display'
        when 'bar' then 'bar_display'
        when 'windows' then 'windows_pos'
        when 'phone' then 'mobile_pos'
        else 'primary_pos'
      end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shop_devices_sync_authority on public.shop_devices;
create trigger trg_shop_devices_sync_authority
  before insert or update of device_authority, form_factor on public.shop_devices
  for each row
  execute function public.sync_shop_device_authority ();

-- ---------- Helpers ----------
create or replace function public.infer_shop_device_form_factor (p_platform text, p_device_type text)
returns text
language sql
immutable
as $$
  select case
    when coalesce (p_device_type, '') in ('kitchen_display') then 'kitchen'
    when coalesce (p_device_type, '') in ('bar_display') then 'bar'
    when coalesce (p_device_type, '') in ('windows_pos') then 'windows'
    when coalesce (p_device_type, '') in ('mobile_pos') then 'phone'
    when lower (coalesce (p_platform, '')) like '%android%' then 'tablet'
    when lower (coalesce (p_platform, '')) like '%ios%' then 'phone'
    when lower (coalesce (p_platform, '')) = 'web' then 'windows'
    else 'tablet'
  end;
$$;

create or replace function public.shop_device_is_operational (p_approval text, p_status public.shop_device_status)
returns boolean
language sql
immutable
as $$
  select coalesce (p_approval, 'approved') = 'approved'
    and coalesce (p_status, 'active'::public.shop_device_status) = 'active'::public.shop_device_status;
$$;

-- ---------- Primary authority check (uses device_authority) ----------
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
      and d.device_authority = 'primary'
      and public.shop_device_is_operational (d.approval_status, d.status)
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
      and d.device_authority = 'primary'
      and public.shop_device_is_operational (d.approval_status, d.status)
  );
end;
$$;

-- ---------- Device context (authority layer) ----------
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
  v_primary_id uuid;
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

  select d.device_fingerprint, d.id
  into v_primary_fp, v_primary_id
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_authority = 'primary'
    and public.shop_device_is_operational (d.approval_status, d.status)
  limit 1;

  return jsonb_build_object (
    'shop_id', p_shop_id,
    'device_fingerprint', v_fp,
    'device_id', v_row.id,
    'device_type', coalesce (v_row.device_type, 'secondary_pos'),
    'device_authority', coalesce (v_row.device_authority, 'secondary'),
    'form_factor', coalesce (v_row.form_factor, 'tablet'),
    'approval_status', coalesce (v_row.approval_status, 'approved'),
    'is_primary', coalesce (v_row.device_authority = 'primary', false),
    'primary_device_fingerprint', v_primary_fp,
    'primary_device_id', v_primary_id,
    'status', coalesce (v_row.status::text, 'unknown'),
    'operational', public.shop_device_is_operational (v_row.approval_status, v_row.status),
    'last_sync_at', v_row.last_sync_at,
    'last_login_at', v_row.last_login_at,
    'last_seen_at', v_row.last_seen_at,
    'current_staff_client_id', v_row.current_staff_client_id,
    'app_version', v_row.app_version,
    'label', v_row.label,
    'platform', v_row.platform,
    'pending_uploads', coalesce (v_row.pending_uploads, 0),
    'pending_downloads', coalesce (v_row.pending_downloads, 0),
    'cloud_status', v_row.cloud_status,
    'recovery_status', v_row.recovery_status
  );
end;
$$;

-- ---------- Atomic primary transfer ----------
create or replace function public.shop_device_transfer_primary (
  p_shop_id uuid,
  p_new_device_fingerprint text,
  p_actor_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_fp text;
  v_actor_fp text;
  v_new_id uuid;
  v_old_id uuid;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_new_fp := nullif (trim (coalesce (p_new_device_fingerprint, '')), '');
  v_actor_fp := nullif (trim (coalesce (p_actor_device_fingerprint, '')), '');

  if v_new_fp is null or length (v_new_fp) < 8 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_fingerprint');
  end if;

  if v_actor_fp is not null
    and not public.shop_device_can_manage_staff (p_shop_id, v_actor_fp) then
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
  end if;

  perform pg_advisory_xact_lock (hashtextextended (p_shop_id::text, 1));

  if not exists (
    select 1
    from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_new_fp
      and d.approval_status = 'approved'
  ) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_approved');
  end if;

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
    and d.device_fingerprint <> v_new_fp;

  update public.shop_devices d
  set
    device_authority = 'primary',
    status = 'active'::public.shop_device_status,
    updated_at = now ()
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_new_fp
  returning d.id into v_new_id;

  if v_new_id is null then
    return jsonb_build_object ('ok', false, 'error', 'device_not_found');
  end if;

  update public.shops sh
  set primary_device_id = v_new_id, updated_at = now ()
  where sh.id = p_shop_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    'device_primary_transferred',
    'Primary device authority transferred',
    jsonb_build_object (
      'new_device_id', v_new_id,
      'new_fingerprint', v_new_fp,
      'previous_primary_id', v_old_id
    )
  );

  return jsonb_build_object ('ok', true, 'device_id', v_new_id);
end;
$$;

revoke all on function public.shop_device_transfer_primary (uuid, text, text) from public;
grant execute on function public.shop_device_transfer_primary (uuid, text, text) to authenticated;

-- ---------- Device approval (primary only) ----------
create or replace function public.shop_device_set_approval (
  p_shop_id uuid,
  p_device_id uuid,
  p_approval_status text,
  p_actor_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_row public.shop_devices%rowtype;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_is_shop_owner (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_approval_status not in ('pending', 'approved', 'suspended', 'revoked', 'disabled') then
    return jsonb_build_object ('ok', false, 'error', 'invalid_status');
  end if;

  v_fp := nullif (trim (coalesce (p_actor_device_fingerprint, '')), '');
  if v_fp is not null and not public.shop_device_can_manage_staff (p_shop_id, v_fp) then
    return jsonb_build_object ('ok', false, 'error', 'not_primary_device');
  end if;

  select d.*
  into v_row
  from public.shop_devices d
  where d.id = p_device_id
    and d.shop_id = p_shop_id;

  if v_row.id is null then
    return jsonb_build_object ('ok', false, 'error', 'device_not_found');
  end if;

  update public.shop_devices d
  set
    approval_status = p_approval_status,
    status = case
      when p_approval_status = 'approved' then 'active'::public.shop_device_status
      when p_approval_status in ('revoked', 'disabled', 'suspended') then 'revoked'::public.shop_device_status
      when p_approval_status = 'pending' then 'disconnected'::public.shop_device_status
      else d.status
    end,
    updated_at = now ()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count (p_shop_id);

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid (),
    'owner',
    case
      when p_approval_status = 'approved' then 'device_approved'
      when p_approval_status = 'revoked' then 'device_revoked'
      else 'device_approval_changed'
    end,
    'Device approval status changed',
    jsonb_build_object ('device_id', p_device_id, 'approval_status', p_approval_status)
  );

  return jsonb_build_object ('ok', true, 'device_id', p_device_id, 'approval_status', p_approval_status);
end;
$$;

revoke all on function public.shop_device_set_approval (uuid, uuid, text, text) from public;
grant execute on function public.shop_device_set_approval (uuid, uuid, text, text) to authenticated;

-- ---------- Enriched owner device list ----------
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
        'last_sync_at', d.last_sync_at,
        'last_login_at', d.last_login_at,
        'is_active', d.is_active,
        'status', d.status::text,
        'device_authority', d.device_authority,
        'approval_status', d.approval_status,
        'form_factor', d.form_factor,
        'device_type', d.device_type,
        'is_primary', d.device_authority = 'primary',
        'current_staff_client_id', d.current_staff_client_id,
        'pending_uploads', coalesce (d.pending_uploads, 0),
        'pending_downloads', coalesce (d.pending_downloads, 0),
        'cloud_status', d.cloud_status,
        'recovery_status', d.recovery_status,
        'created_at', d.created_at
      )
      order by (d.device_authority = 'primary') desc, d.approval_status = 'pending' desc,
        d.is_active desc, d.last_seen_at desc nulls last, d.created_at desc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_devices d
  where d.shop_id = p_shop_id;

  return j;
end;
$$;

-- ---------- Registration: pending approval for new secondary devices ----------
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
  v_now timestamptz := timezone ('Africa/Kampala', now ());
  v_fp text;
  v_status public.shop_device_status;
  v_approval text;
  v_authority text;
  v_label text;
  v_reactivated boolean := false;
  v_limit int;
  v_plan_code text;
  v_plan_name text;
  v_active int;
  v_needs_slot boolean := false;
  v_shop_has_devices boolean;
  v_form_factor text;
  v_device_id uuid;
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null or length (v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  perform pg_advisory_xact_lock (hashtextextended (p_shop_id::text, 0));

  v_label := nullif (trim (coalesce (p_label, '')), '');
  v_form_factor := public.infer_shop_device_form_factor (p_platform, null);

  select d.status, d.approval_status, d.device_authority
  into v_status, v_approval, v_authority
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

  if v_approval = 'revoked' or v_approval = 'disabled' or v_approval = 'suspended' then
    return jsonb_build_object (
      'ok', false,
      'accepted', false,
      'activated', false,
      'approval_status', v_approval,
      'status', coalesce (v_status::text, v_approval),
      'revoked', true
    );
  end if;

  if v_status = 'active'::public.shop_device_status and v_approval = 'approved' then
    update public.shop_devices d
    set
      label = coalesce (v_label, d.label),
      platform = coalesce (nullif (trim (coalesce (p_platform, '')), ''), d.platform),
      app_version = coalesce (nullif (trim (coalesce (p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      last_login_at = v_now,
      updated_at = now ()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    perform public.refresh_shop_active_device_count (p_shop_id);

    return jsonb_build_object (
      'ok', true,
      'accepted', true,
      'activated', true,
      'approval_status', 'approved',
      'device_authority', coalesce (v_authority, 'secondary'),
      'status', 'active',
      'reactivated', false,
      'existing_device', true
    );
  end if;

  if v_approval = 'pending' then
    update public.shop_devices d
    set
      label = coalesce (v_label, d.label),
      platform = coalesce (nullif (trim (coalesce (p_platform, '')), ''), d.platform),
      app_version = coalesce (nullif (trim (coalesce (p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      updated_at = now ()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    return jsonb_build_object (
      'ok', true,
      'accepted', false,
      'activated', false,
      'pending_approval', true,
      'approval_status', 'pending',
      'status', coalesce (v_status::text, 'disconnected')
    );
  end if;

  v_needs_slot := v_status is null
    or (v_status = 'disconnected'::public.shop_device_status and v_approval = 'approved');

  if v_needs_slot and v_status is not null then
    select dl.device_limit, dl.plan_code, dl.plan_name
    into v_limit, v_plan_code, v_plan_name
    from public.resolve_shop_device_limit (p_shop_id) dl;

    v_active := public.count_shop_active_devices (p_shop_id, v_fp);

    if v_limit is not null and v_active >= v_limit then
      return jsonb_build_object (
        'ok', false,
        'accepted', false,
        'activated', false,
        'limit_blocked', true,
        'plan_code', v_plan_code,
        'plan_name', v_plan_name,
        'active_count', v_active,
        'device_limit', v_limit
      );
    end if;
  end if;

  if v_status = 'disconnected'::public.shop_device_status and v_approval = 'approved' then
    update public.shop_devices d
    set
      status = 'active'::public.shop_device_status,
      label = coalesce (v_label, d.label),
      platform = coalesce (nullif (trim (coalesce (p_platform, '')), ''), d.platform),
      app_version = coalesce (nullif (trim (coalesce (p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      last_login_at = v_now,
      updated_at = now ()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    v_reactivated := true;
  elsif v_status is null then
    select exists (select 1 from public.shop_devices d where d.shop_id = p_shop_id)
    into v_shop_has_devices;

    if not v_shop_has_devices then
      insert into public.shop_devices (
        shop_id, device_fingerprint, label, platform, app_version,
        last_seen_at, last_login_at, status, device_authority, approval_status, form_factor, updated_at
      )
      values (
        p_shop_id, v_fp, v_label,
        nullif (trim (coalesce (p_platform, '')), ''),
        nullif (trim (coalesce (p_app_version, '')), ''),
        v_now, v_now,
        'active'::public.shop_device_status,
        'primary', 'approved', v_form_factor, now ()
      )
      returning id into v_device_id;

      update public.shops sh
      set primary_device_id = v_device_id, updated_at = now ()
      where sh.id = p_shop_id;
    else
      insert into public.shop_devices (
        shop_id, device_fingerprint, label, platform, app_version,
        last_seen_at, status, device_authority, approval_status, form_factor, updated_at
      )
      values (
        p_shop_id, v_fp, v_label,
        nullif (trim (coalesce (p_platform, '')), ''),
        nullif (trim (coalesce (p_app_version, '')), ''),
        v_now,
        'disconnected'::public.shop_device_status,
        'secondary', 'pending', v_form_factor, now ()
      );

      perform public.audit_shop_device_event (
        p_shop_id,
        'device_pending_approval',
        'New device awaiting primary approval',
        v_fp,
        jsonb_build_object ('notify_owner', true)
      );

      perform public.refresh_shop_active_device_count (p_shop_id);

      return jsonb_build_object (
        'ok', true,
        'accepted', false,
        'activated', false,
        'pending_approval', true,
        'approval_status', 'pending',
        'status', 'disconnected'
      );
    end if;
  end if;

  perform public.refresh_shop_active_device_count (p_shop_id);

  return jsonb_build_object (
    'ok', true,
    'accepted', true,
    'activated', true,
    'approval_status', 'approved',
    'status', 'active',
    'reactivated', v_reactivated,
    'existing_device', false,
    'plan_code', v_plan_code,
    'plan_name', v_plan_name,
    'active_count', public.count_shop_active_devices (p_shop_id, null),
    'device_limit', v_limit
  );
end;
$$;

-- ---------- Internal admin device health ----------
create or replace function public.internal_shop_device_health (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select jsonb_build_object (
    'shop_id', p_shop_id,
    'primary_device', (
      select jsonb_build_object (
        'id', d.id,
        'label', d.label,
        'fingerprint', d.device_fingerprint,
        'last_sync_at', d.last_sync_at,
        'last_login_at', d.last_login_at,
        'approval_status', d.approval_status,
        'app_version', d.app_version
      )
      from public.shop_devices d
      where d.shop_id = p_shop_id and d.device_authority = 'primary'
      limit 1
    ),
    'devices', coalesce (
      (
        select jsonb_agg (
          jsonb_build_object (
            'id', d.id,
            'label', d.label,
            'device_authority', d.device_authority,
            'approval_status', d.approval_status,
            'form_factor', d.form_factor,
            'status', d.status::text,
            'last_sync_at', d.last_sync_at,
            'last_login_at', d.last_login_at,
            'last_seen_at', d.last_seen_at,
            'current_staff_client_id', d.current_staff_client_id,
            'pending_uploads', d.pending_uploads,
            'pending_downloads', d.pending_downloads,
            'cloud_status', d.cloud_status,
            'recovery_status', d.recovery_status,
            'app_version', d.app_version
          )
          order by (d.device_authority = 'primary') desc, d.created_at asc
        )
        from public.shop_devices d
        where d.shop_id = p_shop_id
      ),
      '[]'::jsonb
    ),
    'pending_count', (
      select count(*)::int
      from public.shop_devices d
      where d.shop_id = p_shop_id and d.approval_status = 'pending'
    )
  )
  into j;

  return coalesce (j, jsonb_build_object ('shop_id', p_shop_id, 'devices', '[]'::jsonb));
end;
$$;

revoke all on function public.internal_shop_device_health (uuid) from public;
grant execute on function public.internal_shop_device_health (uuid) to authenticated;

-- Patch set_primary to sync device_authority
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

  return public.shop_device_transfer_primary (p_shop_id, v_fp, v_fp);
end;
$$;
