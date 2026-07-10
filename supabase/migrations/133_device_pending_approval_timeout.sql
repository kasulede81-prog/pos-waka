-- Pending device approvals expire after 1 minute; owner can dismiss from any device.

alter table public.shop_devices
  add column if not exists approval_requested_at timestamptz;

update public.shop_devices d
set approval_requested_at = coalesce(d.updated_at, d.created_at, now())
where d.approval_status = 'pending'
  and d.approval_requested_at is null;

create or replace function public.shop_device_pending_approval_ttl ()
returns interval
language sql
immutable
as $$
  select interval '1 minute';
$$;

create or replace function public.shop_device_pending_is_expired (p_requested_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_requested_at is not null
    and p_requested_at < (now() - public.shop_device_pending_approval_ttl());
$$;

create or replace function public.expire_stale_pending_shop_devices (p_shop_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  with removed as (
    delete from public.shop_devices d
    where d.approval_status = 'pending'
      and public.shop_device_pending_is_expired(
        coalesce(d.approval_requested_at, d.updated_at, d.created_at)
      )
      and (p_shop_id is null or d.shop_id = p_shop_id)
    returning d.id, d.shop_id, d.device_fingerprint, d.label, d.platform
  )
  select count(*)::int into v_deleted from removed;

  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.expire_stale_pending_shop_devices (uuid) from public;
grant execute on function public.expire_stale_pending_shop_devices (uuid) to authenticated;

-- Dismiss pending request so the device can sign in again (delete row, not revoke).
create or replace function public.owner_dismiss_pending_shop_device (p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_fp text;
  v_label text;
  v_approval text;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select d.shop_id, d.device_fingerprint, coalesce(nullif(trim(d.label), ''), d.platform, 'Device'), d.approval_status
  into v_shop, v_fp, v_label, v_approval
  from public.shop_devices d
  where d.id = p_device_id;

  if v_shop is null then
    raise exception 'Device not found';
  end if;

  if not public.user_is_shop_owner(v_shop) then
    raise exception 'Forbidden';
  end if;

  if v_approval <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  delete from public.shop_devices d
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(v_shop);

  perform public.audit_shop_device_event(
    v_shop,
    'device_pending_dismissed',
    'Dismissed pending device: ' || v_label,
    v_fp,
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'shop_id', v_shop);
end;
$$;

revoke all on function public.owner_dismiss_pending_shop_device (uuid) from public;
grant execute on function public.owner_dismiss_pending_shop_device (uuid) to authenticated;

-- Shop owners may approve/reject from any signed-in device (this RPC is owner-only).
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
  v_row public.shop_devices%rowtype;
  v_limit int;
  v_active int;
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_approval_status not in ('pending', 'approved', 'suspended', 'revoked', 'disabled') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select d.*
  into v_row
  from public.shop_devices d
  where d.id = p_device_id
    and d.shop_id = p_shop_id;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;

  if p_approval_status = 'approved' and v_row.approval_status <> 'approved' then
    if public.shop_device_pending_is_expired(
      coalesce(v_row.approval_requested_at, v_row.updated_at, v_row.created_at)
    ) then
      delete from public.shop_devices d where d.id = p_device_id;
      perform public.refresh_shop_active_device_count(p_shop_id);
      return jsonb_build_object('ok', false, 'error', 'approval_expired');
    end if;

    select dl.device_limit into v_limit from public.resolve_shop_device_limit(p_shop_id) dl;
    v_active := public.count_shop_active_devices(p_shop_id, null);
    if v_limit is not null and v_active >= v_limit then
      return jsonb_build_object(
        'ok', false,
        'limit_blocked', true,
        'error', 'device_limit_reached',
        'device_limit', v_limit,
        'active_count', v_active
      );
    end if;
  end if;

  if p_approval_status = 'revoked' and v_row.approval_status = 'pending' then
    delete from public.shop_devices d where d.id = p_device_id;
    perform public.refresh_shop_active_device_count(p_shop_id);
    perform public.audit_shop_device_event(
      p_shop_id,
      'device_pending_dismissed',
      'Rejected pending device request',
      v_row.device_fingerprint,
      jsonb_build_object('device_id', p_device_id)
    );
    return jsonb_build_object('ok', true, 'device_id', p_device_id, 'approval_status', 'revoked');
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
    approval_requested_at = case
      when p_approval_status = 'pending' then now()
      when p_approval_status = 'approved' then null
      else d.approval_requested_at
    end,
    updated_at = now()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(p_shop_id);

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id,
    auth.uid(),
    'owner',
    case
      when p_approval_status = 'approved' then 'device_approved'
      when p_approval_status = 'revoked' then 'device_revoked'
      else 'device_approval_changed'
    end,
    'Device approval status changed',
    jsonb_build_object('device_id', p_device_id, 'approval_status', p_approval_status)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'approval_status', p_approval_status);
end;
$$;

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

  perform public.expire_stale_pending_shop_devices(p_shop_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
        'approval_requested_at', d.approval_requested_at,
        'form_factor', d.form_factor,
        'device_type', d.device_type,
        'is_primary', d.device_authority = 'primary',
        'current_staff_client_id', d.current_staff_client_id,
        'pending_uploads', coalesce(d.pending_uploads, 0),
        'pending_downloads', coalesce(d.pending_downloads, 0),
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

  select d.status, d.approval_status, d.device_authority, d.approval_requested_at
  into v_status, v_approval, v_authority, v_requested_at
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
    v_authority := null;
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
      'device_authority', coalesce(v_authority, 'secondary'),
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
        'primary', 'approved', v_form_factor, now()
      )
      returning id into v_device_id;

      update public.shops sh
      set primary_device_id = v_device_id, updated_at = now()
      where sh.id = p_shop_id;
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
        'New device awaiting primary approval',
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
