-- Phase 21.9: Enterprise staff credential recovery — bulk invalidate staff PIN/password hashes.

alter table public.shop_recovery_signals
  add column if not exists clear_staff_credentials_at timestamptz;

comment on column public.shop_recovery_signals.clear_staff_credentials_at is
  'Internal-admin bulk staff credential reset. Devices clear local staff caches when this timestamp advances.';

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
    'clear_staff_credentials_at', srs.clear_staff_credentials_at,
    'password_reset_requested_at', srs.password_reset_requested_at
  )
  into j
  from public.shop_recovery_signals srs
  where srs.shop_id = p_shop_id;

  return coalesce (j, '{}'::jsonb);
end;
$$;

create or replace function public.admin_shop_reset_all_staff_credentials (p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared_at timestamptz := now();
  v_staff_count int := 0;
  v_snap jsonb;
  v_staff jsonb;
  v_new_staff jsonb := '[]'::jsonb;
  v_row jsonb;
  v_i int;
  v_len int;
  v_path text[];
begin
  if not public.is_waka_internal_staff () then
    raise exception 'Forbidden';
  end if;

  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    return jsonb_build_object ('ok', false, 'error', 'shop_not_found');
  end if;

  select count(*)::int
  into v_staff_count
  from public.shop_pos_staff s
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  insert into public.shop_recovery_signals (shop_id, clear_staff_credentials_at, updated_at)
  values (p_shop_id, v_cleared_at, v_cleared_at)
  on conflict (shop_id) do update
    set clear_staff_credentials_at = v_cleared_at,
        updated_at = v_cleared_at;

  update public.shop_pos_staff s
  set
    pin_hash = null,
    password_hash = null,
    locked_until = null,
    failed_pin_attempts = 0,
    updated_at = v_cleared_at
  where s.shop_id = p_shop_id
    and s.deleted_at is null;

  select scs.snapshot
  into v_snap
  from public.shop_cloud_snapshots scs
  where scs.shop_id = p_shop_id;

  if v_snap is not null then
    if v_snap ? 'snapshot' then
      v_staff := coalesce(v_snap #> '{snapshot,preferences,staffAccounts}', '[]'::jsonb);
      v_path := array['snapshot', 'preferences', 'staffAccounts'];
    else
      v_staff := coalesce(v_snap #> '{preferences,staffAccounts}', '[]'::jsonb);
      v_path := array['preferences', 'staffAccounts'];
    end if;

    if jsonb_typeof(v_staff) = 'array' then
      v_len := jsonb_array_length(v_staff);
      for v_i in 0..greatest(v_len - 1, 0) loop
        exit when v_i >= v_len;
        v_row := v_staff -> v_i;
        v_row := (v_row - 'pin' - 'password' - 'pinHash' - 'passwordHash')
          || jsonb_build_object(
            'pin', null,
            'password', null,
            'pinHash', null,
            'passwordHash', null,
            'credentialsInvalidatedAt', to_jsonb(v_cleared_at::text),
            'lockedUntil', null,
            'failedPinAttempts', 0
          );
        v_new_staff := v_new_staff || jsonb_build_array(v_row);
      end loop;

      update public.shop_cloud_snapshots scs
      set
        snapshot = jsonb_set(v_snap, v_path, v_new_staff, true),
        updated_at = v_cleared_at
      where scs.shop_id = p_shop_id;
    end if;
  end if;

  insert into public.audit_logs (shop_id, actor_user_id, action, payload)
  values (
    p_shop_id,
    auth.uid (),
    'admin_reset_all_staff_credentials',
    jsonb_build_object (
      'at', v_cleared_at,
      'staff_count', v_staff_count,
      'cloud_snapshot_scrubbed', v_snap is not null,
      'recovery_completed', true
    )
  );

  return jsonb_build_object (
    'ok', true,
    'clear_staff_credentials_at', v_cleared_at,
    'staff_count', v_staff_count
  );
end;
$$;

revoke all on function public.admin_shop_reset_all_staff_credentials (uuid) from public;
grant execute on function public.admin_shop_reset_all_staff_credentials (uuid) to authenticated;
