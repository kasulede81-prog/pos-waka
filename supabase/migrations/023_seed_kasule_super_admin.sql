-- Waka POS — seed first super admin (Kasule) dynamically from Auth email

create or replace function public.seed_kasule_internal_admin ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_norm text := lower(trim(new.email));
  v_target text := lower('kasule.de81@gmail.com');
  v_full_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  if v_email_norm is null then
    return new;
  end if;

  if v_email_norm <> v_target then
    return new;
  end if;

  insert into public.internal_admins (
    user_id,
    auth_user_id,
    email,
    full_name,
    role,
    assigned_district_ids,
    assigned_districts,
    max_shops,
    created_by,
    active,
    is_active,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.id,
    v_email_norm,
    v_full_name,
    'super_admin',
    '{}'::uuid[],
    '{}'::uuid[],
    null,
    null,
    true,
    true,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.internal_admins.full_name),
    role = 'super_admin',
    assigned_district_ids = '{}'::uuid[],
    assigned_districts = '{}'::uuid[],
    active = true,
    is_active = true,
    updated_at = now();

  return new;
end;
$$;

-- Trigger for future signups.
drop trigger if exists waka_seed_kasule_internal_admin on auth.users;
create trigger waka_seed_kasule_internal_admin
  after insert on auth.users
  for each row execute function public.seed_kasule_internal_admin ();

-- Backfill if the user already exists before this migration.
insert into public.internal_admins (
  user_id,
  auth_user_id,
  email,
  full_name,
  role,
  assigned_district_ids,
  assigned_districts,
  max_shops,
  created_by,
  active,
  is_active,
  created_at,
  updated_at
)
select
  u.id,
  u.id,
  lower(trim(u.email)) as email_norm,
  nullif(trim(u.raw_user_meta_data ->> 'full_name'), '') as full_name,
  'super_admin' as role,
  '{}'::uuid[] as assigned_district_ids,
  '{}'::uuid[] as assigned_districts,
  null as max_shops,
  null as created_by,
  true as active,
  true as is_active,
  now() as created_at,
  now() as updated_at
from auth.users u
where lower(trim(u.email)) = lower('kasule.de81@gmail.com')
on conflict (user_id) do update
set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, public.internal_admins.full_name),
  role = 'super_admin',
  assigned_district_ids = '{}'::uuid[],
  assigned_districts = '{}'::uuid[],
  active = true,
  is_active = true,
  updated_at = now();

