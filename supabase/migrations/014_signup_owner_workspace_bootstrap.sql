-- App-controlled, idempotent owner workspace bootstrap for sign-up reliability.
-- Avoids fragile trigger chains by creating profile/org/shop/membership explicitly.

alter table public.profiles
  add column if not exists email text,
  add column if not exists role text not null default 'owner';

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('owner', 'admin', 'manager', 'cashier', 'stock_keeper'));

alter table public.organizations
  add column if not exists business_type text not null default 'kiosk_duka';

alter table public.organizations
  drop constraint if exists organizations_business_type_check;
alter table public.organizations
  add constraint organizations_business_type_check check (
    business_type in (
      'kiosk_duka',
      'wholesale',
      'mini_supermarket',
      'hardware',
      'restaurant',
      'salon',
      'pharmacy',
      'boutique',
      'electronics',
      'produce_market',
      'mobile_money_agent',
      'other'
    )
  );

alter table public.organization_members
  add column if not exists profile_id uuid references auth.users (id);

update public.organization_members
set profile_id = user_id
where profile_id is null;

create or replace function public.bootstrap_owner_workspace (
  p_org_name text,
  p_business_type text default 'kiosk_duka',
  p_full_name text default null,
  p_email text default null
) returns table (
  organization_id uuid,
  shop_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_org_id uuid;
  v_shop_id uuid;
  v_business_type text := coalesce(nullif(trim(p_business_type), ''), 'kiosk_duka');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_business_type not in (
    'kiosk_duka','wholesale','mini_supermarket','hardware','restaurant','salon',
    'pharmacy','boutique','electronics','produce_market','mobile_money_agent','other'
  ) then
    v_business_type := 'kiosk_duka';
  end if;

  insert into public.profiles (id, full_name, business_name, email, role)
  values (
    v_uid,
    nullif(trim(p_full_name), ''),
    nullif(trim(p_org_name), ''),
    nullif(lower(trim(p_email)), ''),
    'owner'
  )
  on conflict (id) do update
  set full_name = coalesce(excluded.full_name, public.profiles.full_name),
      business_name = coalesce(excluded.business_name, public.profiles.business_name),
      email = coalesce(excluded.email, public.profiles.email),
      role = 'owner',
      updated_at = now();

  select om.organization_id
  into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, business_type, created_by)
    values (coalesce(nullif(trim(p_org_name), ''), 'My Shop'), v_business_type, v_uid)
    returning id into v_org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, profile_id, role)
  values (v_org_id, v_uid, v_uid, 'owner')
  on conflict (organization_id, user_id) do update
  set role = 'owner',
      profile_id = coalesce(public.organization_members.profile_id, excluded.profile_id);

  select s.id
  into v_shop_id
  from public.shops s
  where s.organization_id = v_org_id
  order by s.created_at asc
  limit 1;

  if v_shop_id is null then
    insert into public.shops (organization_id, name, business_type, is_active)
    values (v_org_id, coalesce(nullif(trim(p_org_name), ''), 'Main Shop'), v_business_type, true)
    returning id into v_shop_id;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop_id, v_uid, 'owner')
  on conflict (shop_id, user_id) do update
  set role = 'owner';

  return query select v_org_id, v_shop_id;
end;
$$;

grant execute on function public.bootstrap_owner_workspace (text, text, text, text) to authenticated;

