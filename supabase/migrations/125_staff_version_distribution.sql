-- Phase 3: Cloud-authoritative staff distribution with versioning and delta download.

alter table public.shops
  add column if not exists staff_version bigint not null default 1;

create table if not exists public.shop_pos_staff_revisions (
  id bigserial primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  staff_client_id uuid,
  shop_version bigint not null,
  action text not null check (action in ('upsert', 'delete')),
  created_at timestamptz not null default now ()
);

create index if not exists shop_pos_staff_revisions_shop_version_idx
  on public.shop_pos_staff_revisions (shop_id, shop_version desc);

create or replace function public.bump_shop_staff_version ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_client uuid;
  v_action text;
  v_version bigint;
begin
  v_shop := coalesce (new.shop_id, old.shop_id);
  v_client := coalesce (new.client_id, old.client_id);

  update public.shops sh
  set staff_version = sh.staff_version + 1, updated_at = now ()
  where sh.id = v_shop
  returning sh.staff_version into v_version;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null) then
    v_action := 'delete';
  else
    v_action := 'upsert';
  end if;

  insert into public.shop_pos_staff_revisions (shop_id, staff_client_id, shop_version, action)
  values (v_shop, v_client, v_version, v_action);

  return coalesce (new, old);
end;
$$;

drop trigger if exists trg_shop_pos_staff_version on public.shop_pos_staff;
create trigger trg_shop_pos_staff_version
  after insert or update or delete on public.shop_pos_staff
  for each row
  execute function public.bump_shop_staff_version ();

-- Seed initial revision for existing staff (idempotent).
insert into public.shop_pos_staff_revisions (shop_id, staff_client_id, shop_version, action)
select s.shop_id, s.client_id, sh.staff_version, 'upsert'
from public.shop_pos_staff s
join public.shops sh on sh.id = s.shop_id
where s.deleted_at is null
  and s.client_id is not null
  and not exists (
    select 1
    from public.shop_pos_staff_revisions r
    where r.shop_id = s.shop_id
      and r.staff_client_id = s.client_id
  );

create or replace function public.shop_pos_staff_version (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version bigint;
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select sh.staff_version
  into v_version
  from public.shops sh
  where sh.id = p_shop_id;

  return jsonb_build_object ('ok', true, 'version', coalesce (v_version, 1));
end;
$$;

revoke all on function public.shop_pos_staff_version (uuid) from public;
grant execute on function public.shop_pos_staff_version (uuid) to authenticated;

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
  v_version bigint;
  v_changed jsonb;
  v_removed jsonb;
begin
  perform public.require_verified_email_for_cloud ();
  if not public.user_can_access_shop (p_shop_id) then
    raise exception 'Forbidden';
  end if;

  select sh.staff_version
  into v_version
  from public.shops sh
  where sh.id = p_shop_id;

  v_version := coalesce (v_version, 1);

  if p_local_version >= v_version and p_local_version > 0 then
    return jsonb_build_object (
      'ok', true,
      'unchanged', true,
      'version', v_version,
      'changed', '[]'::jsonb,
      'removed_client_ids', '[]'::jsonb
    );
  end if;

  if coalesce (p_local_version, 0) <= 0 then
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
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
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
  else
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
          'phone_e164', s.phone_e164,
          'email', s.email,
          'permissions', s.permissions,
          'is_active', s.is_active,
          'last_login_at', s.last_login_at,
          'last_device_fingerprint', s.last_device_fingerprint,
          'failed_pin_attempts', s.failed_pin_attempts,
          'locked_until', s.locked_until,
          'last_failed_login_at', s.last_failed_login_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        )
      ),
      '[]'::jsonb
    )
    into v_changed
    from public.shop_pos_staff s
    where s.shop_id = p_shop_id
      and s.deleted_at is null
      and s.client_id in (
        select r.staff_client_id
        from public.shop_pos_staff_revisions r
        where r.shop_id = p_shop_id
          and r.shop_version > p_local_version
          and r.action = 'upsert'
          and r.staff_client_id is not null
      );
  end if;

  select coalesce(
    jsonb_agg (distinct r.staff_client_id),
    '[]'::jsonb
  )
  into v_removed
  from public.shop_pos_staff_revisions r
  where r.shop_id = p_shop_id
    and r.shop_version > coalesce (p_local_version, 0)
    and r.action = 'delete'
    and r.staff_client_id is not null;

  return jsonb_build_object (
    'ok', true,
    'unchanged', false,
    'version', v_version,
    'changed', coalesce (v_changed, '[]'::jsonb),
    'removed_client_ids', coalesce (v_removed, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.shop_pos_staff_download (uuid, bigint, text) from public;
grant execute on function public.shop_pos_staff_download (uuid, bigint, text) to authenticated;
