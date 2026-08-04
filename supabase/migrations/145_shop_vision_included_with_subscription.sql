-- Vision V1.4.6 — Vision included with WAKA subscription (capacity overrides only)
-- license_tier / separate Vision trial remain in schema for backward compat but are unused by the app.

alter table public.shop_vision_settings
  add column if not exists admin_disabled boolean not null default false;

comment on column public.shop_vision_settings.admin_disabled is
  'Support kill-switch. When true, Vision is off even with a paid WAKA plan.';

comment on column public.shop_vision_settings.license_tier is
  'Deprecated V1.4.6 — Vision is not a separate SKU. Capacity follows WAKA plan.';

comment on column public.shop_vision_settings.trial_enabled is
  'Deprecated V1.4.6 — Vision trial follows the WAKA subscription trial.';

comment on column public.shop_vision_settings.vision_enabled is
  'Deprecated for enablement V1.4.6 — kept in sync with NOT admin_disabled for older readers.';

-- Soft-migrate: previously licensed rows keep capacity overrides; enablement now follows WAKA plan.
update public.shop_vision_settings
set
  admin_disabled = false,
  vision_enabled = true,
  updated_at = now ()
where vision_enabled = true
   or license_tier in ('starter', 'business', 'enterprise')
   or trial_enabled = true;

create or replace function public.get_shop_vision_settings_row (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.shop_vision_settings;
begin
  if p_shop_id is null then
    return null;
  end if;

  select * into v_row
  from public.shop_vision_settings
  where shop_id = p_shop_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object (
    'shop_id', v_row.shop_id,
    'vision_enabled', v_row.vision_enabled,
    'admin_disabled', v_row.admin_disabled,
    'license_tier', v_row.license_tier,
    'max_dvrs', v_row.max_dvrs,
    'max_cameras', v_row.max_cameras,
    'feature_live_view', v_row.feature_live_view,
    'feature_monitoring', v_row.feature_monitoring,
    'feature_pos_timeline', v_row.feature_pos_timeline,
    'feature_remote_access', v_row.feature_remote_access,
    'feature_ai_analytics', v_row.feature_ai_analytics,
    'trial_enabled', v_row.trial_enabled,
    'trial_expires_at', v_row.trial_expires_at,
    'installer_label', v_row.installer_label,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_update_shop_vision_settings (
  p_shop_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce (p_settings, '{}'::jsonb);
  v_tier text;
  v_after public.shop_vision_settings;
  v_admin_disabled boolean;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  perform public.ensure_shop_vision_settings (p_shop_id);

  v_tier := coalesce (v_patch ->> 'license_tier', null);

  if v_patch ? 'admin_disabled' then
    v_admin_disabled := coalesce ((v_patch ->> 'admin_disabled')::boolean, false);
  elsif v_patch ? 'vision_enabled' then
    -- Legacy Admin clients: vision_enabled=false maps to admin_disabled.
    v_admin_disabled := not coalesce ((v_patch ->> 'vision_enabled')::boolean, true);
  else
    v_admin_disabled := null;
  end if;

  update public.shop_vision_settings sas
  set
    admin_disabled = coalesce (v_admin_disabled, sas.admin_disabled),
    vision_enabled = not coalesce (v_admin_disabled, sas.admin_disabled),
    license_tier = case
      when v_tier in ('none', 'starter', 'business', 'enterprise') then v_tier
      else sas.license_tier
    end,
    max_dvrs = case
      when v_patch ? 'max_dvrs' and (v_patch ->> 'max_dvrs') is null then null
      when v_patch ? 'max_dvrs' then greatest (0, (v_patch ->> 'max_dvrs')::integer)
      else sas.max_dvrs
    end,
    max_cameras = case
      when v_patch ? 'max_cameras' and (v_patch ->> 'max_cameras') is null then null
      when v_patch ? 'max_cameras' then greatest (0, (v_patch ->> 'max_cameras')::integer)
      else sas.max_cameras
    end,
    feature_live_view = coalesce ((v_patch ->> 'feature_live_view')::boolean, sas.feature_live_view),
    feature_monitoring = coalesce ((v_patch ->> 'feature_monitoring')::boolean, sas.feature_monitoring),
    feature_pos_timeline = coalesce ((v_patch ->> 'feature_pos_timeline')::boolean, sas.feature_pos_timeline),
    feature_remote_access = coalesce ((v_patch ->> 'feature_remote_access')::boolean, sas.feature_remote_access),
    feature_ai_analytics = coalesce ((v_patch ->> 'feature_ai_analytics')::boolean, sas.feature_ai_analytics),
    trial_enabled = coalesce ((v_patch ->> 'trial_enabled')::boolean, sas.trial_enabled),
    trial_expires_at = case
      when v_patch ? 'trial_expires_at' and nullif (v_patch ->> 'trial_expires_at', '') is null then null
      when v_patch ? 'trial_expires_at' then (v_patch ->> 'trial_expires_at')::timestamptz
      else sas.trial_expires_at
    end,
    installer_label = case
      when v_patch ? 'installer_label' then nullif (v_patch ->> 'installer_label', '')
      else sas.installer_label
    end,
    updated_at = now ()
  where sas.shop_id = p_shop_id
  returning * into v_after;

  insert into public.ai_admin_audit_log (actor_id, shop_id, action, payload)
  values (
    auth.uid (),
    p_shop_id,
    'shop_vision_settings_updated',
    jsonb_build_object ('settings', public.get_shop_vision_settings_row (p_shop_id))
  );

  return jsonb_build_object (
    'ok', true,
    'settings', public.get_shop_vision_settings_row (p_shop_id)
  );
end;
$$;
