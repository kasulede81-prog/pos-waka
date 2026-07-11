-- Phase 20.0: Enterprise device management decommission.
-- Remove primary/secondary authority enforcement; approved operational devices are equal.
-- Columns (device_authority, is_primary, shops.primary_device_id) are retained but deprecated.

-- ---------- Deprecate existing primary designation ----------
update public.shop_devices d
set
  device_authority = 'secondary',
  is_primary = false,
  updated_at = now()
where d.device_authority = 'primary'
   or d.is_primary = true;

update public.shops sh
set primary_device_id = null, updated_at = now()
where sh.primary_device_id is not null;

-- ---------- Stop syncing primary authority on writes ----------
create or replace function public.sync_shop_device_authority ()
returns trigger
language plpgsql
as $$
begin
  if new.device_authority = 'primary' then
    new.device_authority := 'secondary';
  end if;
  new.is_primary := false;
  return new;
end;
$$;

-- ---------- Device context: approval-based only ----------
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
  v_operational boolean;
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

  v_operational := public.shop_device_is_operational (v_row.approval_status, v_row.status);

  return jsonb_build_object (
    'shop_id', p_shop_id,
    'device_fingerprint', v_fp,
    'device_id', v_row.id,
    'device_type', coalesce (v_row.device_type, 'secondary_pos'),
    'form_factor', coalesce (v_row.form_factor, 'tablet'),
    'approval_status', coalesce (v_row.approval_status, 'approved'),
    'status', coalesce (v_row.status::text, 'unknown'),
    'operational', v_operational,
    'is_device_authorized', v_operational,
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

-- ---------- Remove device: no primary guard ----------
create or replace function public.owner_remove_shop_device (p_device_id uuid)
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

  select d.shop_id, d.device_fingerprint, coalesce (nullif (trim (d.label), ''), d.platform, 'Device')
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
    status = 'revoked'::public.shop_device_status,
    approval_status = 'revoked',
    current_staff_client_id = null,
    updated_at = now ()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count (v_shop);

  perform public.audit_shop_device_event (
    v_shop,
    'device_removed',
    'Removed device: ' || v_label,
    v_fp,
    jsonb_build_object ('device_id', p_device_id)
  );

  return jsonb_build_object ('ok', true, 'device_id', p_device_id, 'shop_id', v_shop, 'status', 'revoked');
end;
$$;

-- ---------- Limit context: sort by activity, not authority ----------
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

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_is_owner := public.user_is_shop_owner (p_shop_id);

  select dl.device_limit, dl.plan_code, dl.plan_name
  into v_limit, v_code, v_name
  from public.resolve_shop_device_limit (p_shop_id) dl;

  v_active := public.count_shop_active_devices (p_shop_id, null);

  select coalesce (
    jsonb_agg (
      jsonb_build_object (
        'id', d.id,
        'device_fingerprint', d.device_fingerprint,
        'label', d.label,
        'platform', d.platform,
        'last_seen_at', d.last_seen_at,
        'status', d.status::text,
        'approval_status', d.approval_status
      )
      order by d.last_seen_at desc nulls last
    ),
    '[]'::jsonb
  )
  into j_devices
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.status = 'active'::public.shop_device_status
    and d.approval_status = 'approved';

  return jsonb_build_object (
    'shop_id', p_shop_id,
    'plan_code', coalesce (v_code, 'unknown'),
    'plan_name', coalesce (v_name, 'Unknown'),
    'device_limit', v_limit,
    'active_count', v_active,
    'is_owner', v_is_owner,
    'at_limit', v_limit is not null and v_active >= v_limit,
    'devices', j_devices
  );
end;
$$;

-- ---------- Registration: first device is approved secondary; no primary assignment ----------
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
  v_approval text;
  v_label text;
  v_reactivated boolean := false;
  v_limit int;
  v_plan_code text;
  v_plan_name text;
  v_active int;
  v_needs_slot boolean := false;
  v_shop_has_devices boolean;
  v_form_factor text;
  v_requested_at timestamptz;
begin
  if not public.user_can_access_shop(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  v_fp := nullif(trim(coalesce(p_device_fingerprint, '')), '');
  if v_fp is null or length(v_fp) < 8 then
    raise exception 'Invalid device fingerprint';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text, 0));
  perform public.expire_stale_pending_shop_devices(p_shop_id);

  v_label := nullif(trim(coalesce(p_label, '')), '');
  v_form_factor := public.infer_shop_device_form_factor(p_platform, null);

  select d.status, d.approval_status, d.approval_requested_at
  into v_status, v_approval, v_requested_at
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

  if v_approval = 'pending'
    and public.shop_device_pending_is_expired(coalesce(v_requested_at, v_now - interval '2 minutes')) then
    delete from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and d.approval_status = 'pending';
    v_status := null;
    v_approval := null;
    v_requested_at := null;
  end if;

  if v_approval = 'revoked' or v_approval = 'disabled' or v_approval = 'suspended' then
    return jsonb_build_object(
      'ok', false,
      'accepted', false,
      'activated', false,
      'approval_status', v_approval,
      'status', coalesce(v_status::text, v_approval),
      'revoked', true
    );
  end if;

  if v_status = 'active'::public.shop_device_status and v_approval = 'approved' then
    update public.shop_devices d
    set
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      last_login_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    perform public.refresh_shop_active_device_count(p_shop_id);

    return jsonb_build_object(
      'ok', true,
      'accepted', true,
      'activated', true,
      'approval_status', 'approved',
      'status', 'active',
      'reactivated', false,
      'existing_device', true
    );
  end if;

  if v_approval = 'pending' then
    update public.shop_devices d
    set
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    return jsonb_build_object(
      'ok', true,
      'accepted', false,
      'activated', false,
      'pending_approval', true,
      'approval_status', 'pending',
      'approval_requested_at', v_requested_at,
      'approval_expires_at', v_requested_at + public.shop_device_pending_approval_ttl(),
      'status', coalesce(v_status::text, 'disconnected')
    );
  end if;

  v_needs_slot := v_status is null
    or (v_status = 'disconnected'::public.shop_device_status and v_approval = 'approved');

  if v_needs_slot then
    select dl.device_limit, dl.plan_code, dl.plan_name
    into v_limit, v_plan_code, v_plan_name
    from public.resolve_shop_device_limit(p_shop_id) dl;

    v_active := public.count_shop_active_devices(p_shop_id, v_fp);

    if v_limit is not null and v_active >= v_limit then
      return jsonb_build_object(
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
      label = coalesce(v_label, d.label),
      platform = coalesce(nullif(trim(coalesce(p_platform, '')), ''), d.platform),
      app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), d.app_version),
      last_seen_at = v_now,
      last_login_at = v_now,
      updated_at = now()
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp;

    v_reactivated := true;
  elsif v_status is null then
    select exists(select 1 from public.shop_devices d where d.shop_id = p_shop_id)
    into v_shop_has_devices;

    if not v_shop_has_devices then
      insert into public.shop_devices (
        shop_id, device_fingerprint, label, platform, app_version,
        last_seen_at, last_login_at, status, device_authority, approval_status, form_factor, updated_at
      )
      values (
        p_shop_id, v_fp, v_label,
        nullif(trim(coalesce(p_platform, '')), ''),
        nullif(trim(coalesce(p_app_version, '')), ''),
        v_now, v_now,
        'active'::public.shop_device_status,
        'secondary', 'approved', v_form_factor, now()
      );
    else
      v_active := public.count_shop_active_devices(p_shop_id, null);
      select dl.device_limit, dl.plan_code, dl.plan_name
      into v_limit, v_plan_code, v_plan_name
      from public.resolve_shop_device_limit(p_shop_id) dl;

      if v_limit is not null and v_active >= v_limit then
        return jsonb_build_object(
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

      insert into public.shop_devices (
        shop_id, device_fingerprint, label, platform, app_version,
        last_seen_at, status, device_authority, approval_status, approval_requested_at, form_factor, updated_at
      )
      values (
        p_shop_id, v_fp, v_label,
        nullif(trim(coalesce(p_platform, '')), ''),
        nullif(trim(coalesce(p_app_version, '')), ''),
        v_now,
        'disconnected'::public.shop_device_status,
        'secondary', 'pending', v_now, v_form_factor, now()
      );

      perform public.audit_shop_device_event(
        p_shop_id,
        'device_pending_approval',
        'New device awaiting owner approval',
        v_fp,
        jsonb_build_object('notify_owner', true, 'approval_requested_at', v_now)
      );

      perform public.refresh_shop_active_device_count(p_shop_id);

      return jsonb_build_object(
        'ok', true,
        'accepted', false,
        'activated', false,
        'pending_approval', true,
        'approval_status', 'pending',
        'approval_requested_at', v_now,
        'approval_expires_at', v_now + public.shop_device_pending_approval_ttl(),
        'status', 'disconnected'
      );
    end if;
  end if;

  perform public.refresh_shop_active_device_count(p_shop_id);

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'activated', true,
    'approval_status', 'approved',
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
