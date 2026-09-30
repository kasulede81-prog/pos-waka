-- ============================================================================
-- MINIMAL MERCHANT SCHEMA for the registration tests.
-- ============================================================================
-- Deliberately NOT the loyalty bootstrap: that one models a shop's loyalty surface and has none
-- of the tenancy tables the merchant bootstrap writes. This one carries exactly the objects
-- `bootstrap_owner_workspace`, `save_owner_business_profile_bundle` and `owner_onboarding_status`
-- touch, and nothing else, so the tests exercise the real function bodies against the real
-- constraints (including the two named unique constraints the RPCs upsert on by name).
--
-- It is intentionally small. If a test needs a table that is not here, that is a signal the test
-- is reaching outside merchant registration.

-- gen_random_uuid() is core since PostgreSQL 13; no pgcrypto extension is required (and PGlite
-- does not ship one).

-- ---------- roles ----------
do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$r$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid (),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now ()
);

create or replace function auth.uid ()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

-- ---------- tenancy ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  business_name text,
  email text,
  role text not null default 'owner',
  phone_e164 text,
  primary_shop_id uuid,
  default_currency text not null default 'UGX',
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  business_type text not null default 'kiosk_duka',
  default_currency text not null default 'UGX',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid references auth.users (id),
  role text not null default 'staff' check (role in ('owner', 'admin', 'billing', 'staff')),
  created_at timestamptz not null default now (),
  -- The name matters: the bootstrap upserts ON CONFLICT ON CONSTRAINT this exact name.
  constraint organization_members_organization_id_user_id_key unique (organization_id, user_id)
);

create table if not exists public.districts (
  id uuid primary key default gen_random_uuid (),
  name text not null
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  business_type text not null default 'kiosk_duka',
  is_active boolean not null default true,
  district_id uuid references public.districts (id),
  district text,
  city text,
  area text,
  phone_e164 text,
  address_line text,
  latitude double precision,
  longitude double precision,
  gps_missing boolean not null default true,
  owner_user_id uuid references auth.users (id),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'cashier'
    check (role in ('owner', 'manager', 'cashier', 'stock_keeper', 'viewer')),
  created_at timestamptz not null default now (),
  constraint shop_members_shop_id_user_id_key unique (shop_id, user_id)
);

-- One owner per shop, as production enforces (095). Reproduced because the bootstrap's upsert
-- and the bundle's re-save both have to survive it.
create unique index if not exists shop_members_one_owner_per_shop
  on public.shop_members (shop_id) where role = 'owner';

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid (),
  code text not null unique,
  name text,
  is_active boolean not null default true
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid (),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  plan_id uuid references public.subscription_plans (id),
  status text not null default 'trial',
  billing_interval text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  external_provider text,
  created_at timestamptz not null default now ()
);

-- ---------- validators the RPCs call ----------
-- Kept in step with the shops CHECK constraint in production (078 / 20260918143000).
create or replace function public.is_valid_shop_business_type (p_type text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(p_type, '') in (
    'kiosk_duka', 'wholesale', 'mini_supermarket', 'hardware', 'hospitality', 'restaurant',
    'bar', 'restaurant_bar', 'hotel', 'salon', 'pharmacy', 'boutique', 'electronics',
    'produce_market', 'mobile_money_agent', 'other'
  );
$fn$;

insert into public.subscription_plans (code, name, is_active)
values ('business', 'Business', true)
on conflict (code) do nothing;

-- ---------- grants, as production has them ----------
-- 010_grants.sql grants DML on every table to `authenticated`; the RPCs are SECURITY DEFINER so
-- they run as the owner, but the tests also read the tables directly as a user.
grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to service_role;
