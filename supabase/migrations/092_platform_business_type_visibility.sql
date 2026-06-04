-- Platform-wide business type visibility (onboarding / registration only).
-- Does not change shop.business_type for existing shops.

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_read_authenticated on public.platform_settings;
create policy platform_settings_read_authenticated
  on public.platform_settings for select
  to authenticated
  using (true);

-- Writes only via SECURITY DEFINER RPCs.

create or replace function public.platform_default_business_types_enabled ()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array (
    'kiosk_duka',
    'boutique',
    'pharmacy',
    'hardware',
    'electronics',
    'wholesale',
    'restaurant',
    'bar',
    'restaurant_bar',
    'hotel',
    'mini_supermarket',
    'salon',
    'produce_market',
    'mobile_money_agent',
    'other'
  );
$$;

insert into public.platform_settings (key, value)
values (
  'business_types_enabled',
  public.platform_default_business_types_enabled ()
)
on conflict (key) do nothing;

insert into public.platform_settings (key, value)
values ('show_experimental_business_types', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.get_platform_business_type_settings ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled jsonb;
  v_show_exp jsonb;
begin
  select ps.value
  into v_enabled
  from public.platform_settings ps
  where ps.key = 'business_types_enabled';

  if v_enabled is null or jsonb_typeof (v_enabled) <> 'array' then
    v_enabled := public.platform_default_business_types_enabled ();
  end if;

  select ps.value
  into v_show_exp
  from public.platform_settings ps
  where ps.key = 'show_experimental_business_types';

  return jsonb_build_object (
    'enabled',
    v_enabled,
    'show_experimental',
    coalesce (
      case jsonb_typeof (v_show_exp)
        when 'boolean' then (v_show_exp)::text::boolean
        else false
      end,
      false
    )
  );
end;
$$;

revoke all on function public.get_platform_business_type_settings () from public;
grant execute on function public.get_platform_business_type_settings () to authenticated;

create or replace function public.admin_set_business_type_enabled (p_business_type text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled jsonb;
  v_arr text[];
begin
  if not public.is_waka_internal_role (array['super_admin']) then
    raise exception 'Forbidden';
  end if;

  if not public.is_valid_shop_business_type (p_business_type) then
    return jsonb_build_object ('ok', false, 'error', 'invalid_business_type');
  end if;

  select ps.value
  into v_enabled
  from public.platform_settings ps
  where ps.key = 'business_types_enabled'
  for update;

  if v_enabled is null or jsonb_typeof (v_enabled) <> 'array' then
    v_enabled := public.platform_default_business_types_enabled ();
  end if;

  select coalesce (array_agg(elem), array[]::text[])
  into v_arr
  from jsonb_array_elements_text (v_enabled) elem;

  if coalesce (p_enabled, false) then
    if not (p_business_type = any (v_arr)) then
      v_arr := array_append (v_arr, p_business_type);
    end if;
  else
    v_arr := array_remove (v_arr, p_business_type);
  end if;

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('business_types_enabled', to_jsonb (v_arr), now(), auth.uid ())
  on conflict (key) do update
  set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (
    auth.uid (),
    case when coalesce (p_enabled, false) then 'business_type_enabled' else 'business_type_disabled' end,
    jsonb_build_object ('business_type', p_business_type, 'enabled', coalesce (p_enabled, false))
  );

  return jsonb_build_object ('ok', true, 'enabled', to_jsonb (v_arr));
end;
$$;

revoke all on function public.admin_set_business_type_enabled (text, boolean) from public;
grant execute on function public.admin_set_business_type_enabled (text, boolean) to authenticated;

create or replace function public.admin_set_show_experimental_business_types (p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin']) then
    raise exception 'Forbidden';
  end if;

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('show_experimental_business_types', to_jsonb (coalesce (p_enabled, false)), now(), auth.uid ())
  on conflict (key) do update
  set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.internal_ops_admin_audit (actor, action, payload)
  values (
    auth.uid (),
    case
      when coalesce (p_enabled, false) then 'show_experimental_business_types_on'
      else 'show_experimental_business_types_off'
    end,
    jsonb_build_object ('enabled', coalesce (p_enabled, false))
  );

  return jsonb_build_object ('ok', true, 'show_experimental', coalesce (p_enabled, false));
end;
$$;

revoke all on function public.admin_set_show_experimental_business_types (boolean) from public;
grant execute on function public.admin_set_show_experimental_business_types (boolean) to authenticated;
