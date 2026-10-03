-- ============================================================================
-- Minimal schema for the Phase 2 shop-membership lockdown tests.
-- ============================================================================
-- Carries exactly the objects the C1 attack path needs — tenancy, membership,
-- audit, the three membership predicates, the pre-Phase-2 single-owner trigger,
-- the 008 RLS policies and the production privilege state — and nothing else.
--
-- The privilege state here deliberately reproduces what Phase 1 found LIVE in
-- production BEFORE this migration:
--   * authenticated: SELECT, UPDATE, DELETE (+ TRUNCATE) — no INSERT (revoked by 161)
--   * anon:          ALL
-- so that applying 20261003000000_shop_membership_lockdown.sql is what closes C1,
-- rather than the bootstrap pre-closing it.

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

-- ---------- membership predicates (bodies as at 007 / 029 / 090) ----------
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
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
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
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop
      and sm.user_id = auth.uid ()
      and sm.role in ('owner', 'manager')
  )
  or exists (
    select 1
    from public.shops sh
    join public.organization_members om on om.organization_id = sh.organization_id
    where sh.id = p_shop
      and om.user_id = auth.uid ()
      and om.role in ('owner', 'admin')
  );
$$;

create or replace function public.user_is_shop_owner (p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shop_members sm
    where sm.shop_id = p_shop_id
      and sm.user_id = auth.uid ()
      and sm.role = 'owner'
  );
$$;

-- ---------- PRE-PHASE-2 single-owner trigger (body as at 118) ----------
-- Intentionally the vulnerable version: it passes immediately when the new role
-- is not 'owner', and it has no DELETE branch. The lockdown migration replaces it.
create or replace function public.trg_shop_members_enforce_single_owner ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if new.role is distinct from 'owner' then
    return new;
  end if;

  select sm.user_id
  into v_existing
  from public.shop_members sm
  where sm.shop_id = new.shop_id
    and sm.role = 'owner'
    and sm.user_id is distinct from new.user_id
  limit 1;

  if v_existing is not null then
    insert into public.audit_logs (
      shop_id, actor_user_id, role, action, payload_summary, payload
    )
    values (
      new.shop_id, auth.uid (), 'owner', 'auth_forbidden',
      'Rejected second shop owner assignment',
      jsonb_build_object ('attempted_user_id', new.user_id, 'existing_owner_user_id', v_existing)
    );
    raise exception 'shop_already_has_owner'
      using hint = 'This shop already has an owner.';
  end if;

  return new;
end;
$$;

create trigger trg_shop_members_single_owner
  before insert or update of role on public.shop_members
  for each row
  execute function public.trg_shop_members_enforce_single_owner ();

-- ---------- RLS as at 008 ----------
alter table public.shop_members enable row level security;

drop policy if exists shop_members_select on public.shop_members;
create policy shop_members_select
  on public.shop_members for select
  using (public.user_can_access_shop (shop_id));

drop policy if exists shop_members_write on public.shop_members;
create policy shop_members_write
  on public.shop_members for insert
  with check (public.user_can_manage_shop (shop_id));

drop policy if exists shop_members_update on public.shop_members;
create policy shop_members_update
  on public.shop_members for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists shop_members_delete on public.shop_members;
create policy shop_members_delete
  on public.shop_members for delete
  using (public.user_can_manage_shop (shop_id));

alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_member_insert on public.audit_logs;
create policy audit_logs_member_insert
  on public.audit_logs for insert
  with check (actor_user_id = auth.uid ());

-- ---------- privileges as found live in production (pre-Phase-2) ----------
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;

grant select, references, trigger, truncate, update, delete on public.shop_members to authenticated;
grant all on public.shop_members to anon;

grant select on public.shops, public.organization_members, public.organizations to authenticated;
grant select on public.shop_members to anon;

grant select, insert on public.audit_logs to authenticated;

grant execute on function public.user_can_access_shop (uuid) to authenticated;
grant execute on function public.user_can_manage_shop (uuid) to authenticated;
grant execute on function public.user_is_shop_owner (uuid) to authenticated;
grant execute on function auth.uid () to anon, authenticated;
