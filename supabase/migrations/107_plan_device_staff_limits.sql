-- Align subscription plan device/staff limits with client entitlements (May 2026).
-- Business: 4 devices / 4 staff; enforce limits even when features JSON is stale.

update public.subscription_plans
set
  description = 'Staff accounts, owner dashboard, and up to 4 devices.',
  max_pos_users = 4,
  features = '{"tier":"business","devices":4,"staff":4,"users":4,"products":null}'::jsonb
where code = 'business';

update public.subscription_plans
set
  features = jsonb_set(
    coalesce(features, '{}'::jsonb),
    '{devices}',
    '1'::jsonb,
    true
  )
where code in ('free', 'starter');

update public.subscription_plans
set
  features = jsonb_set(
    coalesce(features, '{}'::jsonb),
    '{devices}',
    '10'::jsonb,
    true
  )
where code = 'waka_plus';

create or replace function public._plan_default_device_limit (p_code text)
returns int
language sql
immutable
as $$
  select case lower(trim(coalesce(p_code, 'free')))
    when 'free' then 1
    when 'free_mode' then 1
    when 'starter' then 1
    when 'business' then 4
    when 'waka_plus' then 10
    when 'waka plus' then 10
    else 1
  end;
$$;

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
    plan_code := 'free';
    plan_name := 'Free Mode';
    device_limit := public._plan_default_device_limit(plan_code);
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
    device_limit := public._plan_default_device_limit(plan_code);
  else
    device_limit := v_limit;
  end if;

  return next;
end;
$$;

revoke all on function public._plan_default_device_limit (text) from public;
grant execute on function public._plan_default_device_limit (text) to authenticated;

revoke all on function public.resolve_shop_device_limit (uuid) from public;
grant execute on function public.resolve_shop_device_limit (uuid) to authenticated;
