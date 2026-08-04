-- WAKA Vision — per-shop licensing / provisioning (Internal Admin source of truth)

create table if not exists public.shop_vision_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  vision_enabled boolean not null default false,
  license_tier text not null default 'none'
    check (license_tier in ('none', 'starter', 'business', 'enterprise')),
  max_dvrs integer check (max_dvrs is null or max_dvrs >= 0),
  max_cameras integer check (max_cameras is null or max_cameras >= 0),
  feature_live_view boolean not null default true,
  feature_monitoring boolean not null default true,
  feature_pos_timeline boolean not null default false,
  feature_remote_access boolean not null default false,
  feature_ai_analytics boolean not null default false,
  trial_enabled boolean not null default false,
  trial_expires_at timestamptz,
  installer_label text,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create index if not exists shop_vision_settings_enabled_idx
  on public.shop_vision_settings (vision_enabled)
  where vision_enabled = true;

alter table public.shop_vision_settings enable row level security;

drop policy if exists shop_vision_settings_staff_all on public.shop_vision_settings;
create policy shop_vision_settings_staff_all on public.shop_vision_settings
  for all
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists shop_vision_settings_member_read on public.shop_vision_settings;
create policy shop_vision_settings_member_read on public.shop_vision_settings
  for select
  using (
    exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_vision_settings.shop_id
        and sm.user_id = auth.uid ()
    )
  );

create or replace function public.ensure_shop_vision_settings (p_shop_id uuid)
returns public.shop_vision_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.shop_vision_settings;
begin
  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  insert into public.shop_vision_settings (shop_id)
  values (p_shop_id)
  on conflict (shop_id) do nothing;

  select * into v_row
  from public.shop_vision_settings
  where shop_id = p_shop_id;

  return v_row;
end;
$$;

revoke all on function public.ensure_shop_vision_settings (uuid) from public;
grant execute on function public.ensure_shop_vision_settings (uuid) to authenticated;

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

revoke all on function public.get_shop_vision_settings_row (uuid) from public;
grant execute on function public.get_shop_vision_settings_row (uuid) to authenticated;

create or replace function public.get_shop_vision_settings_for_member (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_shop_id is null then
    return null;
  end if;

  if not public.is_waka_internal_staff ()
     and not exists (
       select 1
       from public.shop_members sm
       where sm.shop_id = p_shop_id
         and sm.user_id = auth.uid ()
     ) then
    raise exception 'Forbidden';
  end if;

  return public.get_shop_vision_settings_row (p_shop_id);
end;
$$;

revoke all on function public.get_shop_vision_settings_for_member (uuid) from public;
grant execute on function public.get_shop_vision_settings_for_member (uuid) to authenticated;

create or replace function public.admin_get_shop_vision_settings (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  perform public.ensure_shop_vision_settings (p_shop_id);
  return jsonb_build_object (
    'settings', public.get_shop_vision_settings_row (p_shop_id)
  );
end;
$$;

revoke all on function public.admin_get_shop_vision_settings (uuid) from public;
grant execute on function public.admin_get_shop_vision_settings (uuid) to authenticated;

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
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  if p_shop_id is null then
    raise exception 'shop_id_required';
  end if;

  perform public.ensure_shop_vision_settings (p_shop_id);

  v_tier := coalesce (v_patch ->> 'license_tier', null);

  update public.shop_vision_settings sas
  set
    vision_enabled = coalesce ((v_patch ->> 'vision_enabled')::boolean, sas.vision_enabled),
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

revoke all on function public.admin_update_shop_vision_settings (uuid, jsonb) from public;
grant execute on function public.admin_update_shop_vision_settings (uuid, jsonb) to authenticated;
