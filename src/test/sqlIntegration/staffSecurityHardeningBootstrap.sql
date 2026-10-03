-- ============================================================================
-- Minimal schema for the Phase 3 staff-security tests (H1-H4, M2, M3).
-- ============================================================================
-- Reproduces the PRE-PHASE-3 production state for every object Phase 3 touches,
-- so applying 20261003010000_staff_security_hardening.sql is what changes the
-- behaviour under test. In particular the bootstrap installs:
--
--   * user_can_access_shop()          WITHOUT the staff-active check (H1 open)
--   * shop_device_can_manage_staff()  that returns TRUE for a null fingerprint (M2)
--   * shop_pos_staff_list()           returning pin_hash / password_hash (H3)
--   * shop_pos_staff_unlock()         gated only by user_can_access_shop (M3)
--   * the live grants: authenticated holds INSERT/UPDATE/DELETE on shop_pos_staff (H4)

-- ---------- roles ----------
do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end;
$r$;

-- ---------- auth ----------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid (),
  email text,
  email_confirmed_at timestamptz
);

create or replace function auth.uid ()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

-- Cloud email verification gate. Always satisfied in these tests: Phase 3 is not
-- about email verification, and every fixture user is confirmed.
create or replace function public.require_verified_email_for_cloud ()
returns void
language plpgsql
stable
as $fn$
begin
  return;
end;
$fn$;

-- ---------- tenancy ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid (),
  name text not null
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  unique (organization_id, user_id)
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null default 'Shop'
);

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now (),
  constraint shop_members_shop_id_user_id_key unique (shop_id, user_id),
  constraint shop_members_role_check
    check (role in ('owner', 'manager', 'cashier', 'stock_keeper', 'waiter', 'viewer'))
);

create unique index if not exists shop_members_one_owner_per_shop
  on public.shop_members (shop_id)
  where role = 'owner';

-- ---------- staff ----------
create table if not exists public.shop_pos_staff (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid not null default gen_random_uuid (),
  name text not null default 'Staff',
  username text,
  role text not null default 'cashier',
  pin_hash text,
  password_hash text,
  phone_e164 text,
  email text,
  permissions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  user_id uuid references auth.users (id) on delete set null,
  last_login_at timestamptz,
  last_device_fingerprint text,
  last_login_platform text,
  failed_pin_attempts integer not null default 0,
  locked_until timestamptz,
  last_failed_login_at timestamptz,
  first_failed_login_at timestamptz,
  failures_in_window integer not null default 0,
  failure_window_started_at timestamptz,
  pin_changed_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (shop_id, client_id),
  constraint shop_pos_staff_role_check
    check (role in ('manager', 'cashier', 'stock_keeper', 'supervisor', 'waiter', 'kitchen', 'bar'))
);

create unique index if not exists shop_pos_staff_shop_user_id_uidx
  on public.shop_pos_staff (shop_id, user_id)
  where user_id is not null;

-- ---------- devices ----------
create table if not exists public.shop_devices (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  device_fingerprint text not null,
  approval_status text not null default 'approved',
  status text not null default 'active',
  unique (shop_id, device_fingerprint)
);

create or replace function public.shop_device_is_operational (p_approval text, p_status text)
returns boolean
language sql
immutable
as $fn$
  select coalesce (p_approval, '') = 'approved' and coalesce (p_status, '') = 'active';
$fn$;

-- ---------- audit ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  role text,
  action text not null,
  payload_summary text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

-- ---------- predicates (PRE-Phase-3 bodies) ----------
create or replace function public.user_is_shop_owner (p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop_id and sm.user_id = auth.uid () and sm.role = 'owner'
  );
$$;

create or replace function public.user_can_manage_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager')
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop and om.user_id = auth.uid () and om.role in ('owner', 'admin')
  );
$$;

-- PRE-Phase-3: no staff-active check at all.
create or replace function public.user_can_access_shop (p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_members sm
    where sm.shop_id = p_shop and sm.user_id = auth.uid ()
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop and om.user_id = auth.uid () and om.role in ('owner', 'admin')
  );
$$;

-- PRE-Phase-3: a blank fingerprint returns TRUE (the M2 bypass).
create or replace function public.shop_device_can_manage_staff (
  p_shop_id uuid,
  p_device_fingerprint text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fp text;
begin
  if p_shop_id is null then
    return false;
  end if;

  v_fp := nullif (trim (coalesce (p_device_fingerprint, '')), '');
  if v_fp is null then
    return true;
  end if;

  return exists (
    select 1 from public.shop_devices d
    where d.shop_id = p_shop_id
      and d.device_fingerprint = v_fp
      and public.shop_device_is_operational (d.approval_status, d.status)
  );
end;
$$;

-- POS role -> membership role (as at 161), used by the H2 tests.
create or replace function public.staff_v2_membership_role_for_pos_role (p_pos_role text)
returns text
language sql
immutable
as $fn$
  select case p_pos_role
    when 'supervisor' then 'cashier'
    when 'kitchen' then 'waiter'
    when 'bar' then 'waiter'
    when 'manager' then 'manager'
    when 'cashier' then 'cashier'
    when 'stock_keeper' then 'stock_keeper'
    when 'waiter' then 'waiter'
    when 'viewer' then 'viewer'
    else null
  end;
$fn$;

-- PRE-Phase-3: returns pin_hash and password_hash to any member (H3).
create or replace function public.shop_pos_staff_list (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', s.id,
        'client_id', s.client_id,
        'name', s.name,
        'username', s.username,
        'role', s.role,
        'pin_hash', s.pin_hash,
        'password_hash', s.password_hash,
        'email', s.email,
        'permissions', coalesce (s.permissions, '[]'::jsonb),
        'is_active', s.is_active,
        'user_id', s.user_id,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  into j
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return j;
end;
$$;

-- PRE-Phase-3: any member on an approved device may clear a lockout (M3).
create or replace function public.shop_pos_staff_unlock (
  p_shop_id uuid,
  p_client_id uuid,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if not public.shop_device_can_manage_staff (p_shop_id, p_device_fingerprint) then
    return jsonb_build_object ('ok', false, 'error', 'device_not_authorized');
  end if;

  update public.shop_pos_staff s
  set
    failed_pin_attempts = 0,
    locked_until = null,
    last_failed_login_at = null,
    first_failed_login_at = null,
    failures_in_window = 0,
    failure_window_started_at = null,
    updated_at = now ()
  where s.shop_id = p_shop_id
    and s.client_id = p_client_id
    and s.deleted_at is null;

  return jsonb_build_object ('ok', true);
end;
$$;

-- The 2-argument upsert overload that Phase 3 retires (M2).
create or replace function public.shop_pos_staff_upsert (p_shop_id uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object ('ok', true, 'legacy_overload', true);
end;
$$;

-- ---------- RLS (as at 095 / 126) ----------
alter table public.shop_pos_staff enable row level security;

drop policy if exists shop_pos_staff_select on public.shop_pos_staff;
create policy shop_pos_staff_select
  on public.shop_pos_staff for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_pos_staff_write on public.shop_pos_staff;
create policy shop_pos_staff_write
  on public.shop_pos_staff for all
  using (
    public.user_is_shop_owner (shop_id)
    or exists (
      select 1 from public.shop_members sm
      where sm.shop_id = shop_pos_staff.shop_id
        and sm.user_id = auth.uid ()
        and sm.role in ('owner', 'manager')
    )
  )
  with check (
    public.user_is_shop_owner (shop_id)
    or exists (
      select 1 from public.shop_members sm
      where sm.shop_id = shop_pos_staff.shop_id
        and sm.user_id = auth.uid ()
        and sm.role in ('owner', 'manager')
    )
  );

alter table public.shop_members enable row level security;
drop policy if exists shop_members_select on public.shop_members;
create policy shop_members_select
  on public.shop_members for select
  using (public.user_can_access_shop (shop_id));

-- ---------- privileges as found live (PRE-Phase-3) ----------
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;

-- The H4 starting point: authenticated holds full write access to the staff table.
grant select, insert, update, delete, truncate, references, trigger on public.shop_pos_staff to authenticated;
grant all on public.shop_pos_staff to anon;

grant select on public.shops, public.organization_members, public.organizations to authenticated;
grant select on public.shop_members to authenticated;
grant select, insert on public.audit_logs to authenticated;

grant execute on function public.user_can_access_shop (uuid) to authenticated;
grant execute on function public.user_can_manage_shop (uuid) to authenticated;
grant execute on function public.user_is_shop_owner (uuid) to authenticated;
grant execute on function public.shop_device_can_manage_staff (uuid, text) to authenticated;
grant execute on function public.shop_pos_staff_list (uuid) to authenticated;
grant execute on function public.shop_pos_staff_unlock (uuid, uuid, text) to authenticated;
grant execute on function public.shop_pos_staff_upsert (uuid, jsonb) to authenticated;
grant execute on function auth.uid () to anon, authenticated;
