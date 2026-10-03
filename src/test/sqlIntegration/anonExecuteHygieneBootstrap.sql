-- ============================================================================
-- Schema for the Phase 8 anon-EXECUTE posture tests.
-- ============================================================================
-- Reproduces the PRE-Phase-8 state: the three support functions executable by
-- anon, and the unguarded is_waka_internal_staff. A table carries an RLS policy
-- that calls is_waka_internal_staff, so the test can prove anon reads still work
-- after the migration rather than erroring.

do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end;
$r$;

create schema if not exists auth;

create or replace function auth.uid ()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

create table if not exists public.internal_admins (
  id uuid primary key default gen_random_uuid (),
  auth_user_id uuid,
  user_id uuid,
  is_active boolean default true,
  active boolean default true
);

-- A table whose SELECT policy depends on is_waka_internal_staff, mirroring the
-- 50 live policies Phase 4 found.
create table if not exists public.internal_audit (
  id uuid primary key default gen_random_uuid (),
  secret text not null default 'internal'
);

insert into public.internal_audit (secret) values ('row-a');

-- ---------- PRE-Phase-8 is_waka_internal_staff (unguarded) ----------
create or replace function public.is_waka_internal_staff ()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.internal_admins ia
    where coalesce (ia.auth_user_id, ia.user_id) = auth.uid ()
      and coalesce (ia.is_active, ia.active, true) = true
  );
$fn$;

alter table public.internal_audit enable row level security;
drop policy if exists internal_audit_staff_read on public.internal_audit;
create policy internal_audit_staff_read
  on public.internal_audit for select
  using (public.is_waka_internal_staff ());

-- ---------- the three support functions ----------
create or replace function public.admin_shop_reset_all_staff_credentials (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;
  return jsonb_build_object ('ok', true);
end;
$fn$;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid (),
  name text not null default 'Shop'
);

create or replace function public._report_assert_shop ()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $fn$declare
  v uuid;
begin
  if auth.uid () is null then
    raise exception 'Forbidden';
  end if;
  select id into v from public.shops limit 1;
  if v is null then
    raise exception 'Forbidden';
  end if;
  return v;
end;
$fn$;

create or replace function public.shop_get_staff_sales_summary (
  p_start_day date default null,
  p_end_day date default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform public._report_assert_shop ();
  return jsonb_build_object ('ok', true);
end;
$fn$;

create table if not exists public.shop_pos_staff (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid references public.shops (id) on delete cascade
);

create or replace function public.bump_shop_staff_version ()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return new;
end;
$fn$;

-- ---------- privileges as found live (PRE-Phase-8) ----------
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;

grant execute on function auth.uid () to anon, authenticated;
grant execute on function public.is_waka_internal_staff () to anon, authenticated;
grant execute on function public.admin_shop_reset_all_staff_credentials (uuid) to anon, authenticated;
grant execute on function public.shop_get_staff_sales_summary (date, date, integer) to anon, authenticated;
grant execute on function public.bump_shop_staff_version () to anon, authenticated;

grant select on public.internal_audit to anon, authenticated;
