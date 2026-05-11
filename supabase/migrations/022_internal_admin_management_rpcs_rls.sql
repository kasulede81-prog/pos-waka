-- Waka POS — internal admin management (super-admin driven)

-- ---------- Active internal staff helpers remain from 019 ----------

-- my assigned districts (security definer; used by RLS for field agents)
create or replace function public.waka_internal_my_districts ()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(ia.assigned_district_ids, '{}'::uuid[])
  from public.internal_admins ia
  where ia.user_id = auth.uid ()
    and ia.active = true
  limit 1;
$$;

revoke all on function public.waka_internal_my_districts () from public;
grant execute on function public.waka_internal_my_districts () to authenticated;

-- ---------- internal_admins: allow reads for any active internal admin; restrict field_agents to their districts ----------
drop policy if exists internal_admins_select on public.internal_admins;
create policy internal_admins_select
  on public.internal_admins
  for select
  using (
    public.is_waka_internal_staff ()
    and (
      -- Super admins see all.
      public.is_waka_internal_role (array['super_admin']::text[])
      or -- Non-field-agent internal roles see all.
      not public.is_waka_internal_role (array['field_agent']::text[])
      or -- Field agents see overlapping district admins (plus themselves).
      user_id = auth.uid ()
      or (
        assigned_district_ids && public.waka_internal_my_districts ()
      )
    )
  );

-- ---------- SECURITY DEFINER RPCs (mutations) ----------

-- Create / upsert an internal admin by auth user email.
create or replace function public.internal_admin_create_by_email (
  p_email text,
  p_full_name text,
  p_role text,
  p_assigned_district_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
  v_internal_admin_id uuid;
  v_email_norm text := lower(trim(p_email));
  v_full_name text := nullif(trim(p_full_name), '');
  v_role text := lower(trim(p_role));
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if v_email_norm is null or v_email_norm = '' then
    raise exception 'Email required';
  end if;

  select id
  into v_auth_user_id
  from auth.users
  where lower(email) = v_email_norm
  limit 1;

  if v_auth_user_id is null then
    raise exception 'Auth user not found for email %', v_email_norm;
  end if;

  if v_role is null or v_role = '' then
    raise exception 'Role required';
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
    created_at
  )
  values (
    v_auth_user_id,
    v_auth_user_id,
    v_email_norm,
    v_full_name,
    v_role,
    coalesce(p_assigned_district_ids, '{}'::uuid[]),
    coalesce(p_assigned_district_ids, '{}'::uuid[]),
    null,
    auth.uid (),
    true,
    true,
    now()
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.internal_admins.full_name),
    role = excluded.role,
    assigned_district_ids = excluded.assigned_district_ids,
    assigned_districts = excluded.assigned_districts,
    created_by = coalesce(public.internal_admins.created_by, excluded.created_by),
    active = true,
    is_active = true,
    updated_at = now();

  select ia.id
  into v_internal_admin_id
  from public.internal_admins ia
  where ia.user_id = v_auth_user_id
  limit 1;

  return v_internal_admin_id;
end;
$$;

revoke all on function public.internal_admin_create_by_email (text, text, text, uuid[]) from public;
grant execute on function public.internal_admin_create_by_email (text, text, text, uuid[]) to authenticated;

-- Activate / deactivate an admin (soft disable).
create or replace function public.internal_admin_set_active (
  p_internal_admin_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  update public.internal_admins
  set
    active = p_active,
    is_active = p_active,
    updated_at = now()
  where id = p_internal_admin_id;

  if not found then
    raise exception 'Admin not found';
  end if;
end;
$$;

revoke all on function public.internal_admin_set_active (uuid, boolean) from public;
grant execute on function public.internal_admin_set_active (uuid, boolean) to authenticated;

-- Update role + assigned districts for an admin.
create or replace function public.internal_admin_update_role_and_districts (
  p_internal_admin_id uuid,
  p_role text,
  p_assigned_district_ids uuid[] default '{}'::uuid[],
  p_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(p_role));
begin
  if not public.is_waka_internal_role (array['super_admin']::text[]) then
    raise exception 'Forbidden';
  end if;

  if v_role is null or v_role = '' then
    raise exception 'Role required';
  end if;

  update public.internal_admins
  set
    role = v_role,
    assigned_district_ids = coalesce(p_assigned_district_ids, '{}'::uuid[]),
    assigned_districts = coalesce(p_assigned_district_ids, '{}'::uuid[]),
    full_name = case when p_full_name is null then full_name else coalesce(nullif(trim(p_full_name), ''), full_name) end,
    updated_at = now()
  where id = p_internal_admin_id;

  if not found then
    raise exception 'Admin not found';
  end if;
end;
$$;

revoke all on function public.internal_admin_update_role_and_districts (uuid, text, uuid[], text) from public;
grant execute on function public.internal_admin_update_role_and_districts (uuid, text, uuid[], text) to authenticated;

