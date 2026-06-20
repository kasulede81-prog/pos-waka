-- Waka POS — expand internal admin session RPC to include identity fields

drop function if exists public.waka_internal_me ();

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
    ia.active,
    ia.max_shops,
    ia.full_name,
    ia.email
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true;
$$;

revoke all on function public.waka_internal_me () from public;
grant execute on function public.waka_internal_me () to authenticated;

