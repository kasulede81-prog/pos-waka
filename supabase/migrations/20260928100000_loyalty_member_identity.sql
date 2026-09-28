-- WAKA Loyalty — Phase 1: member identity core.
--
-- A loyalty member is a person with an account at a merchant, not a merchant. Until now the
-- system had no way to represent that: `customers` is shop-scoped (shop_id NOT NULL) and neither
-- it nor `loyalty_accounts` carries any link to auth.users. The only auth reference on any
-- loyalty row is `enrolled_by` / `actor`, which is the STAFF member who acted.
--
-- This migration adds the missing identity, deliberately as a separate table rather than a column
-- on `customers`: the same human is a different `customers` row at every merchant, so a column
-- there could not express "one person, many merchants" without duplicating an auth link N times.
--
-- ADDITIVE ONLY. No existing table is altered except one additive unique index, no existing row
-- is touched, no existing function is redefined. Wallet, the merchant Loyalty Hub, the POS earning
-- pipeline and the public card are all untouched.
--
-- Deliberately NOT done here: no projection RPC (migration B), no claim flow (migration B), no
-- member-facing UI, no auth-bootstrap change. This migration ships two unreachable tables, one
-- read-only classifier and one registration RPC, so it can be reviewed and applied with
-- effectively no blast radius.

-- ============================================================================
-- 1) The index the composite FK below depends on
-- ============================================================================
-- `loyalty_member_links` references loyalty_accounts (id, shop_id) so a link can never point at an
-- account belonging to a different shop. Postgres refuses that FK without a matching unique index
-- on the referenced pair. This index already existed historically; it is re-asserted here because
-- the FK below cannot be created without it, and it must come FIRST in this file.
create unique index if not exists loyalty_accounts_id_shop_uidx
  on public.loyalty_accounts (id, shop_id);

-- ============================================================================
-- 2) loyalty_members — the shopless, org-less, subscription-less identity
-- ============================================================================
-- Note what is absent on purpose: no organization_id, no shop_id, no subscription, no role. A
-- member is defined by their auth user, not by a tenancy. `status` mirrors the vocabulary the
-- account lifecycle already uses (active/suspended) plus 'closed' for a self-deleted member.
create table if not exists public.loyalty_members (
  id uuid primary key default gen_random_uuid (),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text null
    check (display_name is null or char_length (btrim (display_name)) between 1 and 120),
  -- Same pattern as 002_profiles.sql and the customers CHECK, so every phone column in the
  -- schema shares one identical format.
  phone_e164 text null
    check (phone_e164 is null or phone_e164 ~ '^\+256[0-9]{9}$'),
  phone_verified_at timestamptz null,
  email text null check (email is null or email = lower (email)),
  email_verified_at timestamptz null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  last_seen_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

drop trigger if exists trg_loyalty_members_updated on public.loyalty_members;
create trigger trg_loyalty_members_updated
  before update on public.loyalty_members
  for each row execute function public.set_updated_at ();

-- phone is a MATCHING HINT, never a global key: duplicates are tolerated by design (the customer
-- data it is matched against has no phone uniqueness either), so this is deliberately non-unique.
create index if not exists loyalty_members_phone_idx
  on public.loyalty_members (phone_e164) where phone_e164 is not null;
create index if not exists loyalty_members_email_idx
  on public.loyalty_members (lower (email)) where email is not null;
create index if not exists loyalty_members_status_idx
  on public.loyalty_members (status);

alter table public.loyalty_members enable row level security;
-- FORCE matters: the RPCs below are SECURITY DEFINER and run as the table owner, which would
-- otherwise bypass these policies entirely.
alter table public.loyalty_members force row level security;

do $rm$
begin
  execute 'revoke all on table public.loyalty_members from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.loyalty_members from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.loyalty_members from authenticated';
  end if;
end;
$rm$;

-- A member may read exactly their own row. Nothing wider, and no write path at all: every mutation
-- goes through loyalty_member_register() / loyalty_member_dashboard().
do $pol$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'loyalty_members'
      and policyname = 'loyalty_members_select_self'
  ) then
    create policy loyalty_members_select_self on public.loyalty_members
      for select to authenticated using (auth_user_id = auth.uid ());
  end if;
end;
$pol$;

do $gr$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on table public.loyalty_members to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.loyalty_members to service_role';
  end if;
end;
$gr$;

-- ============================================================================
-- 3) loyalty_member_links — the member-owned edge into a merchant-scoped account
-- ============================================================================
-- This is the many-to-many the schema never had. One member, many accounts, across many merchants.
create table if not exists public.loyalty_member_links (
  id uuid primary key default gen_random_uuid (),
  member_id uuid not null references public.loyalty_members (id) on delete cascade,
  account_id uuid not null,
  shop_id uuid not null references public.shops (id) on delete cascade,
  link_source text not null check (link_source in ('member_claim', 'merchant_confirmed')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  linked_at timestamptz not null default now (),
  confirmed_by uuid null references auth.users (id),
  revoked_at timestamptz null,
  constraint loyalty_member_links_unique unique (member_id, account_id),
  -- Composite FK: a link can never point at an account that belongs to a different shop, even if
  -- a caller supplies a mismatched pair.
  constraint loyalty_member_links_account_shop_fk
    foreign key (account_id, shop_id)
    references public.loyalty_accounts (id, shop_id) on delete cascade,
  constraint loyalty_member_links_revoke_shape check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null))
);

-- THE constraint that actually prevents two members claiming one card. `unique (member_id,
-- account_id)` alone does NOT: it permits member A and member B to each hold a link to the same
-- account. This partial index is what makes an account single-owner while still allowing a
-- revoked link to be replaced.
create unique index if not exists loyalty_member_links_one_active_per_account
  on public.loyalty_member_links (account_id) where status = 'active';
create index if not exists loyalty_member_links_member_idx
  on public.loyalty_member_links (member_id, status);
create index if not exists loyalty_member_links_shop_idx
  on public.loyalty_member_links (shop_id, status);

alter table public.loyalty_member_links enable row level security;
alter table public.loyalty_member_links force row level security;

-- No policy and no grant: the projection RPC is the ONLY read path. Nothing here is directly
-- reachable from the browser.
do $rl$
begin
  execute 'revoke all on table public.loyalty_member_links from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.loyalty_member_links from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.loyalty_member_links from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.loyalty_member_links to service_role';
  end if;
end;
$rl$;

-- ============================================================================
-- 4) waka_account_identity — the classifier
-- ============================================================================
-- Returns FLAGS, never a mutually exclusive enum, so "merchant AND member" is representable and
-- nothing downstream has to pick a winner from a single value.
--
-- Crucially this is `stable` and WRITES NOTHING. A mutating "ensure identity" function would
-- recreate the exact failure mode Phase 1 exists to remove — a classification call that silently
-- provisions a tenancy. Classification must be a pure read.
--
-- `merchant_intent` is derived from the metadata the existing merchant signup has ALWAYS written
-- (useAuth.ts: business_name, organization_name, pos_role:'owner'). That is the backward
-- compatibility bridge: every pre-existing merchant keeps the old path with no migration.
create or replace function public.waka_account_identity ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_member public.loyalty_members%rowtype;
  v_meta jsonb;
  v_shop uuid;
  v_role text;
  v_org uuid;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;

  select sm.shop_id, sm.role into v_shop, v_role
  from public.shop_members sm
  where sm.user_id = v_uid
  order by sm.created_at asc
  limit 1;

  select om.organization_id into v_org
  from public.organization_members om
  where om.user_id = v_uid
  order by om.created_at asc
  limit 1;

  select coalesce(u.raw_user_meta_data, '{}'::jsonb) into v_meta
  from auth.users u where u.id = v_uid;

  return jsonb_build_object (
    'ok', true,
    'auth_user_id', v_uid,
    'is_member', (v_member.id is not null and v_member.status = 'active'),
    'member_id', v_member.id,
    'member_status', v_member.status,
    'is_shop_member', (v_shop is not null),
    'shop_id', v_shop,
    'membership_role', v_role,
    'is_org_member', (v_org is not null),
    'organization_id', v_org,
    'has_pending_staff_invite', public.shop_has_pending_staff_invite_for_me (),
    'merchant_intent', (
      coalesce(v_meta ->> 'pos_role', '') = 'owner'
      and (coalesce(v_meta ->> 'business_name', '') <> ''
           or coalesce(v_meta ->> 'organization_name', '') <> '')
    ),
    'member_intent', (coalesce(v_meta ->> 'account_kind', '') = 'member'),
    'profile_exists', exists (select 1 from public.profiles p where p.id = v_uid)
  );
end;
$fn$;

do $gi$
begin
  execute 'revoke all on function public.waka_account_identity () from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.waka_account_identity () from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.waka_account_identity () to authenticated';
  end if;
end;
$gi$;

-- ============================================================================
-- 5) loyalty_member_register — materialize the identity
-- ============================================================================
-- Idempotent on auth_user_id. Touches ONLY loyalty_members: it must never reach organizations,
-- shops, subscriptions, profiles or shop_members. That constraint is the whole point — a member
-- registering must not become a merchant.
create or replace function public.loyalty_member_register (
  p_display_name text default null,
  p_phone_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid ();
  v_name text := nullif (btrim (coalesce (p_display_name, '')), '');
  v_phone text := nullif (btrim (coalesce (p_phone_e164, '')), '');
  v_email text;
  v_member public.loyalty_members%rowtype;
  v_created boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object ('ok', false, 'error', 'not_authenticated');
  end if;

  if v_name is not null and char_length (v_name) > 120 then
    return jsonb_build_object ('ok', false, 'error', 'invalid_name');
  end if;
  if v_phone is not null and v_phone !~ '^\+256[0-9]{9}$' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_phone');
  end if;

  -- Read from auth.users rather than auth.jwt(): the classifier already reads that table, so
  -- this keeps one shape, and it does not depend on which claims the caller's token happens to
  -- carry.
  select lower (nullif (btrim (coalesce(u.email, '')), '')) into v_email
  from auth.users u where u.id = v_uid;

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;
  v_created := v_member.id is null;

  insert into public.loyalty_members (auth_user_id, display_name, phone_e164, email)
  values (v_uid, v_name, v_phone, v_email)
  on conflict (auth_user_id) do update
  set -- coalesce so a later call can never blank an existing value
      display_name = coalesce (excluded.display_name, public.loyalty_members.display_name),
      phone_e164 = coalesce (excluded.phone_e164, public.loyalty_members.phone_e164),
      email = coalesce (excluded.email, public.loyalty_members.email),
      updated_at = now ();

  select * into v_member from public.loyalty_members m where m.auth_user_id = v_uid;

  return jsonb_build_object (
    'ok', true,
    'member_id', v_member.id,
    'status', v_member.status,
    'created', v_created
  );
end;
$fn$;

do $gr2$
begin
  execute 'revoke all on function public.loyalty_member_register (text, text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.loyalty_member_register (text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.loyalty_member_register (text, text) to authenticated';
  end if;
end;
$gr2$;
