-- Platform toggle for POS Display Scale (per-device density is client localStorage only).

insert into public.platform_settings (key, value)
values ('pos_display_scale', jsonb_build_object('enabled', true))
on conflict (key) do nothing;

create or replace function public.platform_default_pos_display_scale_settings ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('enabled', true);
$$;

create or replace function public.get_platform_pos_display_scale_settings ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw jsonb;
begin
  select ps.value into v_raw
  from public.platform_settings ps
  where ps.key = 'pos_display_scale';

  if v_raw is null or jsonb_typeof (v_raw) <> 'object' then
    return public.platform_default_pos_display_scale_settings ();
  end if;

  return public.platform_default_pos_display_scale_settings () || v_raw;
end;
$$;

revoke all on function public.get_platform_pos_display_scale_settings () from public;
grant execute on function public.get_platform_pos_display_scale_settings () to authenticated;
grant execute on function public.get_platform_pos_display_scale_settings () to anon;

create or replace function public.admin_update_platform_pos_display_scale_settings (p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merged jsonb;
begin
  if not public.is_waka_internal_role (array['super_admin', 'operations_admin']) then
    raise exception 'Forbidden';
  end if;

  v_merged := jsonb_build_object('enabled', coalesce (p_enabled, true));

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('pos_display_scale', v_merged, now(), auth.uid ())
  on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'settings', v_merged);
end;
$$;

revoke all on function public.admin_update_platform_pos_display_scale_settings (boolean) from public;
grant execute on function public.admin_update_platform_pos_display_scale_settings (boolean) to authenticated;
