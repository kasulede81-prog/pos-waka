-- Shop account recovery: admin clears back-office PIN (device sync) + audit owner password reset requests

create table if not exists public.shop_recovery_signals (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  clear_back_office_pin_at timestamptz,
  password_reset_requested_at timestamptz,
  password_reset_requested_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.shop_recovery_signals is
  'Internal-admin recovery flags. clear_back_office_pin_at is applied on owner devices during cloud sync.';

alter table public.shop_recovery_signals enable row level security;

drop policy if exists shop_recovery_signals_staff on public.shop_recovery_signals;
create policy shop_recovery_signals_staff
  on public.shop_recovery_signals
  for all
  to authenticated
  using (public.is_waka_internal_staff ())
  with check (public.is_waka_internal_staff ());

drop policy if exists shop_recovery_signals_owner_read on public.shop_recovery_signals;
create policy shop_recovery_signals_owner_read
  on public.shop_recovery_signals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = shop_recovery_signals.shop_id
        and sm.user_id = auth.uid ()
        and sm.role in ('owner', 'manager')
    )
  );

create or replace function public.admin_shop_reset_backoffice_pin (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  insert into public.shop_recovery_signals (shop_id, clear_back_office_pin_at, updated_at)
  values (p_shop_id, now(), now())
  on conflict (shop_id) do update
    set clear_back_office_pin_at = now(),
        updated_at = now();

  insert into public.audit_logs (shop_id, actor_user_id, action, payload)
  values (
    p_shop_id,
    auth.uid (),
    'admin_reset_backoffice_pin',
    jsonb_build_object ('at', now())
  );

  return jsonb_build_object ('ok', true, 'clear_back_office_pin_at', now());
end;
$$;

create or replace function public.admin_shop_send_owner_password_reset (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_uid uuid;
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  select sm.user_id, lower (trim (pr.email))
  into v_uid, v_email
  from public.shop_members sm
  join public.profiles pr on pr.id = sm.user_id
  where sm.shop_id = p_shop_id
    and sm.role = 'owner'
  order by sm.created_at asc
  limit 1;

  if v_uid is null or v_email is null or v_email = '' then
    return jsonb_build_object ('ok', false, 'error', 'owner_not_found');
  end if;

  insert into public.shop_recovery_signals (shop_id, password_reset_requested_at, password_reset_requested_by, updated_at)
  values (p_shop_id, now(), auth.uid (), now())
  on conflict (shop_id) do update
    set password_reset_requested_at = now(),
        password_reset_requested_by = auth.uid (),
        updated_at = now();

  insert into public.audit_logs (shop_id, actor_user_id, action, payload)
  values (
    p_shop_id,
    auth.uid (),
    'admin_request_owner_password_reset',
    jsonb_build_object ('owner_email', v_email, 'at', now())
  );

  return jsonb_build_object ('ok', true, 'owner_email', v_email);
end;
$$;

create or replace function public.shop_fetch_recovery_signal (p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if auth.uid () is null then
    raise exception 'Forbidden';
  end if;

  if not (
    public.is_waka_internal_staff ()
    or exists (
      select 1
      from public.shop_members sm
      where sm.shop_id = p_shop_id
        and sm.user_id = auth.uid ()
    )
  ) then
    raise exception 'Forbidden';
  end if;

  select jsonb_build_object (
    'clear_back_office_pin_at', srs.clear_back_office_pin_at,
    'password_reset_requested_at', srs.password_reset_requested_at
  )
  into j
  from public.shop_recovery_signals srs
  where srs.shop_id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_shop_reset_backoffice_pin (uuid) from public;
grant execute on function public.admin_shop_reset_backoffice_pin (uuid) to authenticated;

revoke all on function public.admin_shop_send_owner_password_reset (uuid) from public;
grant execute on function public.admin_shop_send_owner_password_reset (uuid) to authenticated;

revoke all on function public.shop_fetch_recovery_signal (uuid) from public;
grant execute on function public.shop_fetch_recovery_signal (uuid) to authenticated;
