-- Phase 12.9 — Enterprise device licensing: count only approved+active slots,
-- block registration/approval over limit, owner remove device.

-- Licensed slot = status active AND approval approved (WhatsApp / M365 model).
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
    and d.approval_status = 'approved'
    and (
      p_exclude_fingerprint is null
      or d.device_fingerprint <> nullif(trim(p_exclude_fingerprint), '')
    );
$$;

-- Limit context: only licensed devices in the active list.
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
        'status', d.status::text,
        'approval_status', d.approval_status,
        'device_authority', d.device_authority
      )
      order by (d.device_authority = 'primary') desc, d.last_seen_at desc nulls last
    ),
    '[]'::jsonb
  )
  into j_devices
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.status = 'active'::public.shop_device_status
    and d.approval_status = 'approved';

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

-- Approval must respect license cap.
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

  v_fp := nullif(trim(coalesce(p_actor_device_fingerprint, '')), '');
  if v_fp is not null and not public.shop_device_can_manage_staff(p_shop_id, v_fp) then
    return jsonb_build_object('ok', false, 'error', 'not_primary_device');
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

  update public.shop_devices d
  set
    approval_status = p_approval_status,
    status = case
      when p_approval_status = 'approved' then 'active'::public.shop_device_status
      when p_approval_status in ('revoked', 'disabled', 'suspended') then 'revoked'::public.shop_device_status
      when p_approval_status = 'pending' then 'disconnected'::public.shop_device_status
      else d.status
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

-- Remove device: revoke license slot (stronger than disconnect).
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
  v_authority text;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select d.shop_id, d.device_fingerprint, coalesce(nullif(trim(d.label), ''), d.platform, 'Device'), d.device_authority
  into v_shop, v_fp, v_label, v_authority
  from public.shop_devices d
  where d.id = p_device_id;

  if v_shop is null then
    raise exception 'Device not found';
  end if;

  if not public.user_is_shop_owner(v_shop) then
    raise exception 'Forbidden';
  end if;

  if v_authority = 'primary' then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_primary');
  end if;

  update public.shop_devices d
  set
    status = 'revoked'::public.shop_device_status,
    approval_status = 'revoked',
    current_staff_client_id = null,
    updated_at = now()
  where d.id = p_device_id;

  perform public.refresh_shop_active_device_count(v_shop);

  perform public.audit_shop_device_event(
    v_shop,
    'device_removed',
    'Removed device: ' || v_label,
    v_fp,
    jsonb_build_object('device_id', p_device_id)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'shop_id', v_shop, 'status', 'revoked');
end;
$$;

revoke all on function public.owner_remove_shop_device (uuid) from public;
grant execute on function public.owner_remove_shop_device (uuid) to authenticated;

-- Patch registration: never create a 5th record when at limit — return limit_blocked instead.
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
  v_form_factor := public.infer_shop_device_form_factor(p_platform, null);

  select d.status, d.approval_status, d.device_authority
  into v_status, v_approval, v_authority
  from public.shop_devices d
  where d.shop_id = p_shop_id
    and d.device_fingerprint = v_fp;

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
      -- At limit: do NOT insert pending record (enterprise license model).
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
        last_seen_at, status, device_authority, approval_status, form_factor, updated_at
      )
      values (
        p_shop_id, v_fp, v_label,
        nullif(trim(coalesce(p_platform, '')), ''),
        nullif(trim(coalesce(p_app_version, '')), ''),
        v_now,
        'disconnected'::public.shop_device_status,
        'secondary', 'pending', v_form_factor, now()
      );

      perform public.audit_shop_device_event(
        p_shop_id,
        'device_pending_approval',
        'New device awaiting primary approval',
        v_fp,
        jsonb_build_object('notify_owner', true)
      );

      perform public.refresh_shop_active_device_count(p_shop_id);

      return jsonb_build_object(
        'ok', true,
        'accepted', false,
        'activated', false,
        'pending_approval', true,
        'approval_status', 'pending',
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
