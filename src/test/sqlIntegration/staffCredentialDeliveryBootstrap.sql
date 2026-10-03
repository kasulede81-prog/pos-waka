-- ============================================================================
-- Additional schema for the Phase 4 credential-delivery tests.
-- ============================================================================
-- Layered on top of staffSecurityHardeningBootstrap.sql + the Phase 3 migration.
-- Adds only what Phase 4 touches, in its PRE-Phase-4 shape:
--
--   * shop_pos_staff_download()  with NO device check and hashes in the payload
--   * shop_device_set_approval() with the `v_fp is not null and not ...` skip
--   * the three unreachable write policies Phase 4 proposes to drop
--   * anon EXECUTE on the staff RPCs

-- ---------- device support ----------
do $e$
begin
  if not exists (select 1 from pg_type where typname = 'shop_device_status') then
    create type public.shop_device_status as enum ('active', 'disconnected', 'revoked');
  end if;
end;
$e$;

-- The Phase 3 bootstrap models status as text; production uses the enum, and the
-- real shop_device_set_approval() casts to it. Align the fixture so the function
-- body under test is the production one.
alter table public.shop_devices
  alter column status drop default;
alter table public.shop_devices
  alter column status type public.shop_device_status using status::public.shop_device_status;
alter table public.shop_devices
  alter column status set default 'active'::public.shop_device_status;

-- Production's signature takes the enum, not text (Phase 1 capture:
-- shop_device_is_operational(p_approval text, p_status shop_device_status)).
-- Replace the Phase 3 fixture's text version so resolution matches production.
drop function if exists public.shop_device_is_operational (text, text);
create or replace function public.shop_device_is_operational (
  p_approval text,
  p_status public.shop_device_status
)
returns boolean
language sql
immutable
as $fn$
  select coalesce (p_approval, '') = 'approved'
     and p_status = 'active'::public.shop_device_status;
$fn$;

alter table public.shop_devices
  add column if not exists updated_at timestamptz not null default now ();

-- Stubs for the device-limit path, which Phase 4 does not change.
create or replace function public.resolve_shop_device_limit (p_shop_id uuid)
returns table (device_limit int)
language sql
stable
as $fn$
  select null::int as device_limit;
$fn$;

create or replace function public.count_shop_active_devices (p_shop_id uuid, p_exclude_fingerprint text)
returns int
language sql
stable
as $fn$
  select count(*)::int from public.shop_devices d
  where d.shop_id = p_shop_id and d.status = 'active';
$fn$;

create or replace function public.refresh_shop_active_device_count (p_shop_id uuid)
returns void
language plpgsql
as $fn$
begin
  return;
end;
$fn$;

-- ---------- staff revision log (drives the delta download) ----------
create table if not exists public.shop_pos_staff_revisions (
  id uuid primary key default gen_random_uuid (),
  shop_id uuid not null references public.shops (id) on delete cascade,
  staff_client_id uuid,
  shop_version bigint not null,
  action text not null,
  created_at timestamptz not null default now ()
);

alter table public.shops
  add column if not exists staff_version bigint not null default 1;

-- ---------- PRE-Phase-4 download: no device check, hashes included ----------
create or replace function public.shop_pos_staff_download (
  p_shop_id uuid,
  p_local_version bigint default 0,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_changed jsonb;
begin
  perform public.require_verified_email_for_cloud ();

  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  -- p_device_fingerprint is accepted and never read: the historical behaviour.
  select coalesce(
    jsonb_agg (
      jsonb_build_object (
        'id', s.id,
        'client_id', s.client_id,
        'name', s.name,
        'role', s.role,
        'pin_hash', s.pin_hash,
        'password_hash', s.password_hash,
        'is_active', s.is_active,
        'user_id', s.user_id,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      order by s.created_at asc
    ),
    '[]'::jsonb
  )
  into v_changed
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  return jsonb_build_object (
    'ok', true,
    'unchanged', false,
    'version', 1,
    'changed', coalesce (v_changed, '[]'::jsonb),
    'removed_client_ids', '[]'::jsonb
  );
end;
$$;

-- ---------- PRE-Phase-4 device approval: nullable fingerprint skips the check ----------
create or replace function public.shop_device_set_approval (
  p_shop_id uuid,
  p_device_id uuid,
  p_approval_status text,
  p_actor_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text;
  v_row public.shop_devices%rowtype;
begin
  perform public.require_verified_email_for_cloud();

  if not public.user_is_shop_owner(p_shop_id) then
    raise exception 'Forbidden';
  end if;

  if p_approval_status not in ('pending', 'approved', 'suspended', 'revoked', 'disabled') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_fp := nullif(trim(coalesce(p_actor_device_fingerprint, '')), '');
  -- The bypass: a null fingerprint skips the check entirely.
  if v_fp is not null and not public.shop_device_can_manage_staff(p_shop_id, v_fp) then
    return jsonb_build_object('ok', false, 'error', 'not_primary_device');
  end if;

  select d.* into v_row
  from public.shop_devices d
  where d.id = p_device_id and d.shop_id = p_shop_id;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'device_not_found');
  end if;

  update public.shop_devices d
  set
    approval_status = p_approval_status,
    status = case
      when p_approval_status = 'approved' then 'active'::public.shop_device_status
      when p_approval_status in ('revoked', 'disabled', 'suspended') then 'revoked'::public.shop_device_status
      when p_approval_status = 'pending' then 'disconnected'::public.shop_device_status
      else d.status
    end,
    updated_at = now()
  where d.id = p_device_id;

  insert into public.audit_logs (shop_id, actor_user_id, role, action, payload_summary, payload)
  values (
    p_shop_id, auth.uid(), 'owner', 'device_approval_changed',
    'Device approval status changed',
    jsonb_build_object('device_id', p_device_id, 'approval_status', p_approval_status)
  );

  return jsonb_build_object('ok', true, 'device_id', p_device_id, 'approval_status', p_approval_status);
end;
$$;

-- ---------- the unreachable write policies Phase 4 proposes to drop ----------
drop policy if exists shop_members_update on public.shop_members;
create policy shop_members_update
  on public.shop_members for update
  using (public.user_can_manage_shop (shop_id));

drop policy if exists shop_members_delete on public.shop_members;
create policy shop_members_delete
  on public.shop_members for delete
  using (public.user_can_manage_shop (shop_id));

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

-- ---------- PRE-Phase-4 anon EXECUTE on the staff surface ----------
-- The 3-argument upsert is production's current signature; Phase 3's test schema
-- does not define it, so it is added here to prove the anon revoke reaches it.
create or replace function public.shop_pos_staff_upsert (
  p_shop_id uuid,
  p_row jsonb,
  p_device_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return jsonb_build_object ('ok', true);
end;
$fn$;

grant execute on function public.shop_pos_staff_list (uuid) to anon;
grant execute on function public.shop_pos_staff_download (uuid, bigint, text) to anon;
grant execute on function public.shop_pos_staff_upsert (uuid, jsonb, text) to anon;
grant execute on function public.shop_pos_staff_unlock (uuid, uuid, text) to anon;
grant execute on function public.shop_device_can_manage_staff (uuid, text) to anon;

grant execute on function public.resolve_shop_device_limit (uuid) to authenticated;
grant execute on function public.count_shop_active_devices (uuid, text) to authenticated;
grant execute on function public.shop_device_set_approval (uuid, uuid, text, text) to authenticated;
grant select, insert, update on public.shop_pos_staff_revisions to authenticated;
grant select, update on public.shops to authenticated;
