-- ============================================================================
-- Schema for the Phase 5 Google-first invitation tests.
-- ============================================================================
-- Self-contained: the invitation acceptance path touches objects (invitations,
-- profiles, auth.identities) that the Phase 3/4 fixtures do not carry.
--
-- `auth.email()` reads a GUC, standing in for the Supabase-signed JWT claim.
-- `auth.identities` stands in for GoTrue's authoritative provider record. Both
-- are the SERVER's inputs — the RPC under test has no email or identity
-- parameter at all, which is the point.

do $r$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end;
$r$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid (),
  email text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

-- GoTrue's linked-provider record.
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  provider_id text,
  identity_data jsonb not null default '{}'::jsonb,
  last_sign_in_at timestamptz default now (),
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now ()
);

create or replace function auth.uid ()
returns uuid
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

create or replace function auth.email ()
returns text
language sql
stable
as $fn$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$fn$;

-- ---------- tenancy ----------
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid (),
  name text not null default 'Shop'
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  primary_shop_id uuid
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

create table if not exists public.shop_pos_staff (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid not null default gen_random_uuid (),
  name text not null default 'Staff',
  username text,
  role text not null default 'cashier',
  pin_hash text,
  email text,
  permissions jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  deleted_at timestamptz,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (shop_id, client_id)
);

create table if not exists public.shop_staff_invitations (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  email text not null,
  membership_role text not null,
  pos_role text not null,
  staff_id uuid references public.shop_pos_staff (id) on delete set null,
  invited_by uuid,
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now (),
  unique (token_hash)
);

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

-- ---------- helpers the RPC calls ----------
create or replace function public.staff_v2_hash_invite_token (p_token text)
returns text
language sql
immutable
as $fn$
  -- Test stand-in for the real hash. Deterministic, and never a real digest.
  select 'testhash:' || p_token;
$fn$;

create or replace function public.auth_user_email_verified ()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid ()
      and (
        u.email_confirmed_at is not null
        or coalesce (u.raw_app_meta_data ->> 'provider', '') in ('google', 'apple')
      )
  );
$fn$;

create or replace function public.require_verified_email_for_cloud ()
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
begin
  if auth.uid () is null then
    raise exception 'Not authenticated';
  end if;
  if not public.auth_user_email_verified () then
    raise exception 'email_not_verified';
  end if;
end;
$fn$;

-- ---------- PRE-Phase-5 acceptance: no Google requirement ----------
create or replace function public.shop_accept_staff_invite (p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_uid uuid := auth.uid ();
  v_email text;
  v_hash text;
  v_inv public.shop_staff_invitations%rowtype;
  v_existing_count int;
  v_staff_id uuid;
  v_name text;
  v_linked_existing boolean := false;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;

  perform public.require_verified_email_for_cloud ();

  if coalesce (trim (p_token), '') = '' then
    return jsonb_build_object ('ok', false, 'error', 'invalid_token');
  end if;

  v_email := lower (trim (coalesce (auth.email (), '')));
  if v_email = '' then
    return jsonb_build_object ('ok', false, 'error', 'email_mismatch');
  end if;

  v_hash := public.staff_v2_hash_invite_token (p_token);

  select * into v_inv
  from public.shop_staff_invitations i
  where i.token_hash = v_hash
  for update;

  if not found then
    return jsonb_build_object ('ok', false, 'error', 'invalid_token');
  end if;

  if v_inv.revoked_at is not null then
    return jsonb_build_object ('ok', false, 'error', 'revoked');
  end if;

  if v_inv.accepted_at is not null then
    return jsonb_build_object ('ok', false, 'error', 'already_accepted');
  end if;

  if v_inv.expires_at <= now () then
    return jsonb_build_object ('ok', false, 'error', 'expired');
  end if;

  if v_inv.email is distinct from v_email then
    return jsonb_build_object ('ok', false, 'error', 'email_mismatch');
  end if;

  if exists (
    select 1 from public.shop_members sm
    where sm.shop_id = v_inv.shop_id and sm.user_id = v_uid
  ) then
    return jsonb_build_object ('ok', false, 'error', 'already_member');
  end if;

  select count (*) into v_existing_count
  from public.shop_members sm
  where sm.user_id = v_uid;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_inv.shop_id, v_uid, v_inv.membership_role);

  if v_inv.staff_id is not null then
    update public.shop_pos_staff s
    set user_id = v_uid
    where s.id = v_inv.staff_id
      and s.shop_id = v_inv.shop_id
      and s.deleted_at is null
      and (s.user_id is null or s.user_id = v_uid)
    returning s.id into v_staff_id;

    if v_staff_id is null then
      raise exception 'staff_link_failed';
    end if;
    v_linked_existing := true;
  elsif v_inv.membership_role <> 'viewer' then
    v_name := nullif (initcap (replace (split_part (v_inv.email, '@', 1), '.', ' ')), '');
    if v_name is null then v_name := 'Staff'; end if;

    insert into public.shop_pos_staff (
      shop_id, client_id, name, username, role, pin_hash, email, permissions, is_active, user_id
    )
    values (
      v_inv.shop_id, gen_random_uuid (), v_name, null, v_inv.pos_role,
      null, v_inv.email, '[]'::jsonb, true, v_uid
    )
    returning id into v_staff_id;
  end if;

  update public.shop_staff_invitations
  set accepted_at = now (), accepted_by = v_uid
  where id = v_inv.id
    and accepted_at is null
    and revoked_at is null;

  if v_existing_count = 0 then
    update public.profiles pr
    set primary_shop_id = v_inv.shop_id
    where pr.id = v_uid and pr.primary_shop_id is null;
  end if;

  return jsonb_build_object (
    'ok', true,
    'shop_id', v_inv.shop_id,
    'membership_role', v_inv.membership_role,
    'pos_role', v_inv.pos_role,
    'staff_id', v_staff_id,
    'linked_existing', v_linked_existing
  );
end;
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on public.shop_members, public.shop_pos_staff, public.shops to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select, update on public.profiles to authenticated;
grant execute on function public.shop_accept_staff_invite (text) to authenticated;
grant execute on function auth.uid () to anon, authenticated;
grant execute on function auth.email () to anon, authenticated;
