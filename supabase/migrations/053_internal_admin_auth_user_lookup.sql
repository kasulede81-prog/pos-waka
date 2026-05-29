-- Align internal admin helpers with auth_user_id / is_active columns (021+).

create or replace function public.is_waka_internal_staff ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.internal_admins ia
    where coalesce(ia.auth_user_id, ia.user_id) = auth.uid ()
      and coalesce(ia.is_active, ia.active, true) = true
  );
$$;

create or replace function public.is_waka_internal_role (p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.internal_admins ia
    where coalesce(ia.auth_user_id, ia.user_id) = auth.uid ()
      and coalesce(ia.is_active, ia.active, true) = true
      and ia.role = any (p_roles)
  );
$$;

create or replace function public.waka_internal_me ()
returns table (
  id uuid,
  role text,
  assigned_district_ids uuid[],
  active boolean,
  max_shops int,
  full_name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ia.id,
    ia.role,
    ia.assigned_district_ids,
    coalesce(ia.is_active, ia.active, true) as active,
    ia.max_shops,
    ia.full_name,
    ia.email
  from public.internal_admins ia
  where coalesce(ia.auth_user_id, ia.user_id) = auth.uid ()
    and coalesce(ia.is_active, ia.active, true) = true;
$$;
